// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentPay Escrow V3 — optimistic escrow + agent stake & slashing
/// @notice V2 made the agent wait for approval (or a dispute window) before
///         being paid, which stops the "drain escrow for free" attack. But a
///         lazy agent could still spam low-effort submissions hoping the client
///         is asleep — rejection cost it nothing. V3 adds skin in the game:
///
///         acceptJob()  → the agent locks a STAKE to take the job
///         submitTask() → (V2) records the deliverable + reserves the payout
///         approveTask()→ (V2) client accepts → agent paid
///         rejectTask() → (V2) escrow returned to client AND `slashPerReject`
///                        is slashed from the agent's stake and BURNED
///         claimTask()  → (V2) agent claims after the dispute window
///         withdrawStake() → agent reclaims remaining stake (no pending tasks)
///
///         Slashing makes garbage work -EV: a rejected task costs the agent more
///         than the task would have paid. The slash is burned (sent to a dead
///         address), NOT given to the client — so the client gains nothing by
///         rejecting and has no incentive to falsely reject good work. (A neutral
///         arbiter/oracle for the remaining "who judges quality" question is the
///         documented next step.)
contract AgentEscrowV3 {
    address private constant BURN = 0x000000000000000000000000000000000000dEaD;

    enum Status {
        Pending,
        Paid,
        Rejected
    }

    struct Job {
        address client;
        address agent;
        uint256 ratePerTask;
        uint256 balance;
        uint256 reserved;
        uint256 tasksPaid;
        uint256 stake; // agent collateral, locked while working
        uint256 slashPerReject; // burned from stake on each rejected task
        uint256 minStake; // floor the agent must stake (>= slashPerReject), set by client
        uint256 pendingCount; // unresolved tasks (O(1) instead of scanning)
        uint64 lastSubmitAt;
        bool active;
        bool accepted; // agent has staked and accepted the job
        string spec;
    }

    struct Task {
        address agent;
        uint256 payout;
        uint64 submittedAt;
        uint64 claimableAt;
        Status status;
        bytes32 workHash;
        string summary;
    }

    uint64 public immutable disputeWindow;
    uint64 public immutable cooldown;

    uint256 public nextJobId;
    uint256 public totalBurned;
    mapping(uint256 => Job) public jobs;
    mapping(uint256 => Task[]) private _tasks;

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed agent,
        uint256 ratePerTask,
        uint256 deposit,
        uint256 slashPerReject,
        uint256 minStake,
        string spec
    );
    event JobAccepted(uint256 indexed jobId, address indexed agent, uint256 stake);
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
    event TaskRejected(uint256 indexed jobId, uint256 indexed taskId, string reason, uint256 slashed);
    event TaskPaid(
        uint256 indexed jobId,
        uint256 indexed taskId,
        address indexed agent,
        uint256 payout,
        bytes32 workHash,
        string summary
    );
    event StakeWithdrawn(uint256 indexed jobId, address indexed agent, uint256 amount);
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
    error NotAccepted();
    error AlreadyAccepted();
    error NoStake();
    error PendingTasks();
    error InvalidConfig();
    error InsufficientStake();

    constructor(uint64 disputeWindow_, uint64 cooldown_) {
        disputeWindow = disputeWindow_;
        cooldown = cooldown_;
    }

    // ----------------------------------------------------------------- client

    function createJob(
        address agent,
        uint256 ratePerTask,
        uint256 slashPerReject,
        uint256 minStake,
        string calldata spec
    ) external payable returns (uint256 jobId) {
        if (agent == address(0)) revert ZeroAddress();
        if (ratePerTask == 0) revert ZeroRate();
        if (msg.value < ratePerTask) revert InsufficientEscrow();
        // the deterrent must exist and the stake floor must cover at least one
        // slash — otherwise the agent could nullify slashing with a dust stake
        if (slashPerReject == 0 || minStake < slashPerReject) revert InvalidConfig();

        jobId = nextJobId++;
        Job storage job = jobs[jobId];
        job.client = msg.sender;
        job.agent = agent;
        job.ratePerTask = ratePerTask;
        job.balance = msg.value;
        job.slashPerReject = slashPerReject;
        job.minStake = minStake;
        job.active = true;
        job.spec = spec;
        emit JobCreated(jobId, msg.sender, agent, ratePerTask, msg.value, slashPerReject, minStake, spec);
    }

    function fund(uint256 jobId) external payable {
        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        job.balance += msg.value;
        emit JobFunded(jobId, msg.sender, msg.value);
    }

    function approveTask(uint256 jobId, uint256 taskId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert NotClient();
        Task storage t = _pendingTask(jobId, taskId);
        emit TaskApproved(jobId, taskId);
        _pay(job, jobId, taskId, t);
    }

    /// @notice Reject a pending task: no payout, escrow returned to the client,
    ///         and `slashPerReject` burned from the agent's stake.
    function rejectTask(uint256 jobId, uint256 taskId, string calldata reason) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert NotClient();
        Task storage t = _pendingTask(jobId, taskId);

        t.status = Status.Rejected;
        job.reserved -= t.payout;
        job.pendingCount -= 1;

        // slash & burn — neither party profits, so the client can't farm rejections
        uint256 slash = job.slashPerReject;
        if (slash > job.stake) slash = job.stake;
        if (slash > 0) {
            job.stake -= slash;
            totalBurned += slash;
        }
        emit TaskRejected(jobId, taskId, reason, slash);

        if (job.active) {
            job.balance += t.payout;
        } else {
            (bool ok, ) = job.client.call{value: t.payout}("");
            if (!ok) revert TransferFailed();
        }
        if (slash > 0) {
            (bool b, ) = BURN.call{value: slash}("");
            if (!b) revert TransferFailed();
        }
    }

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

    /// @notice Agent locks a stake to take the job. Required before submitting.
    function acceptJob(uint256 jobId) external payable {
        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        if (msg.sender != job.agent) revert NotAgent();
        if (job.accepted) revert AlreadyAccepted();
        if (msg.value < job.minStake) revert InsufficientStake(); // stake floor → slashing has teeth
        job.stake = msg.value;
        job.accepted = true;
        emit JobAccepted(jobId, msg.sender, msg.value);
    }

    function submitTask(
        uint256 jobId,
        bytes32 workHash,
        string calldata summary
    ) external returns (uint256 taskId) {
        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        if (msg.sender != job.agent) revert NotAgent();
        if (!job.accepted) revert NotAccepted();
        if (job.balance < job.ratePerTask) revert InsufficientEscrow();
        if (block.timestamp < job.lastSubmitAt + cooldown) revert CooldownActive();

        job.balance -= job.ratePerTask;
        job.reserved += job.ratePerTask;
        job.pendingCount += 1;
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

    function claimTask(uint256 jobId, uint256 taskId) external {
        Job storage job = jobs[jobId];
        Task storage t = _pendingTask(jobId, taskId);
        if (msg.sender != t.agent) revert NotAgent();
        if (block.timestamp < t.claimableAt) revert WindowNotElapsed();
        _pay(job, jobId, taskId, t);
    }

    /// @notice Reclaim remaining stake once no tasks are pending. Doing so ends
    ///         the agent's acceptance (it must re-accept to submit again).
    function withdrawStake(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.agent) revert NotAgent();
        if (job.stake == 0) revert NoStake();
        if (job.pendingCount != 0) revert PendingTasks();

        uint256 amount = job.stake;
        job.stake = 0;
        job.accepted = false;
        emit StakeWithdrawn(jobId, job.agent, amount);
        (bool ok, ) = job.agent.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ------------------------------------------------------------------ views

    function tasksRemaining(uint256 jobId) external view returns (uint256) {
        Job storage job = jobs[jobId];
        if (!job.active || !job.accepted || job.ratePerTask == 0) return 0;
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
        job.pendingCount -= 1;
        job.tasksPaid += 1;
        emit TaskPaid(jobId, taskId, t.agent, t.payout, t.workHash, t.summary);
        (bool ok, ) = t.agent.call{value: t.payout}("");
        if (!ok) revert TransferFailed();
    }
}
