// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentPay Escrow V2 — optimistic escrow for AI agent work
/// @notice V1 paid the agent the instant it submitted any hash, so a lazy or
///         malicious agent could drain escrow doing zero real work. V2 fixes
///         that with an optimistic model borrowed from Upwork (acceptance),
///         optimistic rollups (challenge window) and staked oracles:
///
///         submitTask()  → records the deliverable + RESERVES the payout
///                         (no money moves yet)
///         approveTask() → client accepts → agent is paid immediately
///         rejectTask()  → client rejects bad work → funds returned, agent unpaid
///         claimTask()   → if the client stays silent past the dispute window,
///                         the agent claims payment (optimistic release)
///
///         A per-job cooldown blocks mempool-spam draining. Reserved funds can't
///         be reclaimed by closeJob, so the client can't rug a pending agent and
///         the agent can't front-run a close — payment is always either approved,
///         rejected, or claimable-after-window.
contract AgentEscrowV2 {
    enum Status {
        Pending,
        Paid,
        Rejected
    }

    struct Job {
        address client;
        address agent;
        uint256 ratePerTask;
        uint256 balance; // free escrow, available to reserve for new tasks
        uint256 reserved; // locked against pending (submitted, unresolved) tasks
        uint256 tasksPaid;
        uint64 lastSubmitAt;
        bool active;
        string spec;
    }

    struct Task {
        address agent;
        uint256 payout;
        uint64 submittedAt;
        uint64 claimableAt; // submittedAt + disputeWindow
        Status status;
        bytes32 workHash;
        string summary;
    }

    uint64 public immutable disputeWindow; // seconds a client has to reject
    uint64 public immutable cooldown; // min seconds between task submissions per job

    uint256 public nextJobId;
    mapping(uint256 => Job) public jobs;
    mapping(uint256 => Task[]) private _tasks;

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed agent,
        uint256 ratePerTask,
        uint256 deposit,
        string spec
    );
    event TaskSubmitted(
        uint256 indexed jobId,
        uint256 indexed taskId,
        address indexed agent,
        uint256 payout,
        bytes32 workHash,
        string summary,
        uint64 claimableAt
    );
    event TaskApproved(uint256 indexed jobId, uint256 indexed taskId);
    event TaskRejected(uint256 indexed jobId, uint256 indexed taskId, string reason);
    /// @notice Emitted whenever an agent is actually paid (approve or claim). This
    ///         is the "earnings" event the dashboard streams.
    event TaskPaid(
        uint256 indexed jobId,
        uint256 indexed taskId,
        address indexed agent,
        uint256 payout,
        bytes32 workHash,
        string summary
    );
    event JobFunded(uint256 indexed jobId, address indexed funder, uint256 amount);
    event JobClosed(uint256 indexed jobId, uint256 refund);

    error NotClient();
    error NotAgent();
    error JobInactive();
    error InsufficientEscrow();
    error ZeroAddress();
    error ZeroRate();
    error TransferFailed();
    error CooldownActive();
    error BadTask();
    error NotPending();
    error WindowNotElapsed();

    constructor(uint64 disputeWindow_, uint64 cooldown_) {
        disputeWindow = disputeWindow_;
        cooldown = cooldown_;
    }

    // ----------------------------------------------------------------- client

    function createJob(
        address agent,
        uint256 ratePerTask,
        string calldata spec
    ) external payable returns (uint256 jobId) {
        if (agent == address(0)) revert ZeroAddress();
        if (ratePerTask == 0) revert ZeroRate();
        if (msg.value < ratePerTask) revert InsufficientEscrow();

        jobId = nextJobId++;
        jobs[jobId] = Job({
            client: msg.sender,
            agent: agent,
            ratePerTask: ratePerTask,
            balance: msg.value,
            reserved: 0,
            tasksPaid: 0,
            lastSubmitAt: 0,
            active: true,
            spec: spec
        });
        emit JobCreated(jobId, msg.sender, agent, ratePerTask, msg.value, spec);
    }

    function fund(uint256 jobId) external payable {
        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        job.balance += msg.value;
        emit JobFunded(jobId, msg.sender, msg.value);
    }

    /// @notice Accept a pending task — pays the agent now.
    function approveTask(uint256 jobId, uint256 taskId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert NotClient();
        Task storage t = _pendingTask(jobId, taskId);
        emit TaskApproved(jobId, taskId);
        _pay(job, jobId, taskId, t);
    }

    /// @notice Reject a pending task — no payment; reserved funds are released
    ///         back to the client (to the job balance if open, else returned).
    function rejectTask(uint256 jobId, uint256 taskId, string calldata reason) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert NotClient();
        Task storage t = _pendingTask(jobId, taskId);

        t.status = Status.Rejected;
        job.reserved -= t.payout;
        emit TaskRejected(jobId, taskId, reason);

        if (job.active) {
            job.balance += t.payout; // reusable for future tasks
        } else {
            (bool ok, ) = job.client.call{value: t.payout}("");
            if (!ok) revert TransferFailed();
        }
    }

    /// @notice Close the job and reclaim the FREE (unreserved) escrow. Pending
    ///         tasks keep their reserved funds and remain resolvable.
    function closeJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert NotClient();
        if (!job.active) revert JobInactive();

        job.active = false;
        uint256 refund = job.balance;
        job.balance = 0;
        emit JobClosed(jobId, refund);
        if (refund > 0) {
            (bool ok, ) = job.client.call{value: refund}("");
            if (!ok) revert TransferFailed();
        }
    }

    // ------------------------------------------------------------------ agent

    /// @notice Submit a completed deliverable. RESERVES the payout but does not
    ///         pay — the client can approve or reject within the dispute window.
    function submitTask(
        uint256 jobId,
        bytes32 workHash,
        string calldata summary
    ) external returns (uint256 taskId) {
        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        if (msg.sender != job.agent) revert NotAgent();
        if (job.balance < job.ratePerTask) revert InsufficientEscrow();
        if (block.timestamp < job.lastSubmitAt + cooldown) revert CooldownActive();

        job.balance -= job.ratePerTask;
        job.reserved += job.ratePerTask;
        job.lastSubmitAt = uint64(block.timestamp);

        uint64 claimableAt = uint64(block.timestamp) + disputeWindow;
        taskId = _tasks[jobId].length;
        _tasks[jobId].push(
            Task({
                agent: job.agent,
                payout: job.ratePerTask,
                submittedAt: uint64(block.timestamp),
                claimableAt: claimableAt,
                status: Status.Pending,
                workHash: workHash,
                summary: summary
            })
        );
        emit TaskSubmitted(jobId, taskId, job.agent, job.ratePerTask, workHash, summary, claimableAt);
    }

    /// @notice After the dispute window with no rejection, the agent claims pay.
    function claimTask(uint256 jobId, uint256 taskId) external {
        Job storage job = jobs[jobId];
        Task storage t = _pendingTask(jobId, taskId);
        if (msg.sender != t.agent) revert NotAgent();
        if (block.timestamp < t.claimableAt) revert WindowNotElapsed();
        _pay(job, jobId, taskId, t);
    }

    // ------------------------------------------------------------------ views

    function tasksRemaining(uint256 jobId) external view returns (uint256) {
        Job storage job = jobs[jobId];
        if (!job.active || job.ratePerTask == 0) return 0;
        return job.balance / job.ratePerTask;
    }

    function taskCount(uint256 jobId) external view returns (uint256) {
        return _tasks[jobId].length;
    }

    function getTask(uint256 jobId, uint256 taskId) external view returns (Task memory) {
        if (taskId >= _tasks[jobId].length) revert BadTask();
        return _tasks[jobId][taskId];
    }

    function getTasks(uint256 jobId, uint256 offset, uint256 limit)
        external
        view
        returns (Task[] memory page)
    {
        Task[] storage arr = _tasks[jobId];
        if (offset >= arr.length) return new Task[](0);
        uint256 end = offset + limit > arr.length ? arr.length : offset + limit;
        page = new Task[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = arr[i];
        }
    }

    /// @notice True when a pending task can now be claimed by its agent.
    function isClaimable(uint256 jobId, uint256 taskId) external view returns (bool) {
        if (taskId >= _tasks[jobId].length) return false;
        Task storage t = _tasks[jobId][taskId];
        return t.status == Status.Pending && block.timestamp >= t.claimableAt;
    }

    // --------------------------------------------------------------- internal

    function _pendingTask(uint256 jobId, uint256 taskId) private view returns (Task storage t) {
        if (taskId >= _tasks[jobId].length) revert BadTask();
        t = _tasks[jobId][taskId];
        if (t.status != Status.Pending) revert NotPending();
    }

    function _pay(Job storage job, uint256 jobId, uint256 taskId, Task storage t) private {
        t.status = Status.Paid;
        job.reserved -= t.payout;
        job.tasksPaid += 1;
        emit TaskPaid(jobId, taskId, t.agent, t.payout, t.workHash, t.summary);
        (bool ok, ) = t.agent.call{value: t.payout}("");
        if (!ok) revert TransferFailed();
    }
}
