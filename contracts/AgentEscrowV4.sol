// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentPay Escrow V4 — optimistic escrow + stake/slash + neutral arbitration
/// @notice V3 added agent stake & slashing, but left the CLIENT as the sole judge
///         of quality: a malicious client could reject good work, reclaim the
///         escrow, and burn the honest agent's stake. V4 closes that with a
///         neutral arbiter both parties agree to up front (the client names the
///         arbiter at createJob; the agent consents by staking to accept):
///
///         rejectTask()      → PROPOSES a rejection (funds held, nothing slashed yet)
///         disputeRejection()→ agent escalates a proposed rejection to the arbiter
///         resolveDispute()  → arbiter rules: agent wins → paid, no slash;
///                             client wins → slash + refund
///         finalizeRejection()→ if the agent doesn't dispute in time, the rejection
///                             stands (slash + refund) — the agent accepted it
///
///         So false rejection no longer pays the client: the agent disputes, the
///         neutral arbiter overturns it, and the agent is paid with stake intact.
///         (In production the arbiter would be a decentralized court / oracle
///         committee, e.g. Kleros; here it's a configurable address agreed by both.)
contract AgentEscrowV4 {
    address private constant BURN = 0x000000000000000000000000000000000000dEaD;

    enum Status {
        Pending, // submitted, awaiting client
        Paid, // approved/claimed/won-dispute → agent paid (final)
        RejectedProposed, // client rejected; agent may still dispute
        Disputed, // agent escalated to the arbiter
        RejectedFinal // rejection stood → slashed + refunded (final)
    }

    struct Job {
        address client;
        address agent;
        address arbiter;
        uint256 ratePerTask;
        uint256 balance;
        uint256 reserved;
        uint256 tasksPaid;
        uint256 stake;
        uint256 slashPerReject;
        uint256 minStake;
        uint256 unresolved; // tasks not yet in a final state (gates stake withdrawal)
        uint64 lastSubmitAt;
        bool active;
        bool accepted;
        string spec;
    }

    struct Task {
        address agent;
        uint256 payout;
        uint64 submittedAt;
        uint64 claimableAt; // Pending → claimable after this (optimistic)
        uint64 rejectedAt; // RejectedProposed → finalizable / disputable until +window
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
        address arbiter,
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
    event RejectionProposed(uint256 indexed jobId, uint256 indexed taskId, string reason);
    event RejectionDisputed(uint256 indexed jobId, uint256 indexed taskId);
    event DisputeResolved(uint256 indexed jobId, uint256 indexed taskId, bool agentWon, uint256 slashed);
    event RejectionFinalized(uint256 indexed jobId, uint256 indexed taskId, uint256 slashed);
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
    error NotArbiter();
    error JobInactive();
    error InsufficientEscrow();
    error ZeroAddress();
    error ZeroRate();
    error TransferFailed();
    error CooldownActive();
    error BadTask();
    error WrongState();
    error WindowNotElapsed();
    error WindowElapsed();
    error NotAccepted();
    error AlreadyAccepted();
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
        address arbiter,
        uint256 ratePerTask,
        uint256 slashPerReject,
        uint256 minStake,
        string calldata spec
    ) external payable returns (uint256 jobId) {
        if (agent == address(0) || arbiter == address(0)) revert ZeroAddress();
        if (ratePerTask == 0) revert ZeroRate();
        if (msg.value < ratePerTask) revert InsufficientEscrow();
        if (slashPerReject == 0 || minStake < slashPerReject) revert InvalidConfig();

        jobId = nextJobId++;
        Job storage job = jobs[jobId];
        job.client = msg.sender;
        job.agent = agent;
        job.arbiter = arbiter;
        job.ratePerTask = ratePerTask;
        job.balance = msg.value;
        job.slashPerReject = slashPerReject;
        job.minStake = minStake;
        job.active = true;
        job.spec = spec;
        emit JobCreated(jobId, msg.sender, agent, arbiter, ratePerTask, msg.value, slashPerReject, minStake, spec);
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
        Task storage t = _task(jobId, taskId);
        if (t.status != Status.Pending) revert WrongState();
        emit TaskApproved(jobId, taskId);
        _pay(job, jobId, taskId, t);
    }

    /// @notice Propose a rejection. Funds are HELD (nothing slashed yet) — the
    ///         agent can dispute within the window, or it finalizes after it.
    function rejectTask(uint256 jobId, uint256 taskId, string calldata reason) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert NotClient();
        Task storage t = _task(jobId, taskId);
        if (t.status != Status.Pending) revert WrongState();
        t.status = Status.RejectedProposed;
        t.rejectedAt = uint64(block.timestamp);
        emit RejectionProposed(jobId, taskId, reason);
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

    function acceptJob(uint256 jobId) external payable {
        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        if (msg.sender != job.agent) revert NotAgent();
        if (job.accepted) revert AlreadyAccepted();
        if (msg.value < job.minStake) revert InsufficientStake();
        job.stake = msg.value;
        job.accepted = true;
        emit JobAccepted(jobId, msg.sender, msg.value);
    }

    function submitTask(uint256 jobId, bytes32 workHash, string calldata summary)
        external
        returns (uint256 taskId)
    {
        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        if (msg.sender != job.agent) revert NotAgent();
        if (!job.accepted) revert NotAccepted();
        if (job.balance < job.ratePerTask) revert InsufficientEscrow();
        if (block.timestamp < job.lastSubmitAt + cooldown) revert CooldownActive();

        job.balance -= job.ratePerTask;
        job.reserved += job.ratePerTask;
        job.unresolved += 1;
        job.lastSubmitAt = uint64(block.timestamp);

        uint64 claimableAt = uint64(block.timestamp) + disputeWindow;
        taskId = _tasks[jobId].length;
        _tasks[jobId].push(
            Task({
                agent: job.agent,
                payout: job.ratePerTask,
                submittedAt: uint64(block.timestamp),
                claimableAt: claimableAt,
                rejectedAt: 0,
                status: Status.Pending,
                workHash: workHash,
                summary: summary
            })
        );
        emit TaskSubmitted(jobId, taskId, job.agent, job.ratePerTask, workHash, summary, claimableAt);
    }

    /// @notice Optimistic claim: client stayed silent on a Pending task past the window.
    function claimTask(uint256 jobId, uint256 taskId) external {
        Job storage job = jobs[jobId];
        Task storage t = _task(jobId, taskId);
        if (t.status != Status.Pending) revert WrongState();
        if (msg.sender != t.agent) revert NotAgent();
        if (block.timestamp < t.claimableAt) revert WindowNotElapsed();
        _pay(job, jobId, taskId, t);
    }

    /// @notice Agent escalates a proposed rejection to the neutral arbiter.
    function disputeRejection(uint256 jobId, uint256 taskId) external {
        Job storage job = jobs[jobId];
        Task storage t = _task(jobId, taskId);
        if (msg.sender != job.agent) revert NotAgent();
        if (t.status != Status.RejectedProposed) revert WrongState();
        if (block.timestamp > t.rejectedAt + disputeWindow) revert WindowElapsed();
        t.status = Status.Disputed;
        emit RejectionDisputed(jobId, taskId);
    }

    function withdrawStake(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.agent) revert NotAgent();
        if (job.stake == 0) revert InsufficientStake();
        if (job.unresolved != 0) revert PendingTasks();
        uint256 amount = job.stake;
        job.stake = 0;
        job.accepted = false;
        emit StakeWithdrawn(jobId, job.agent, amount);
        (bool ok, ) = job.agent.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ---------------------------------------------------------------- arbiter

    /// @notice Neutral arbiter resolves a dispute. agentWon → paid, no slash.
    function resolveDispute(uint256 jobId, uint256 taskId, bool agentWon) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.arbiter) revert NotArbiter();
        Task storage t = _task(jobId, taskId);
        if (t.status != Status.Disputed) revert WrongState();
        if (agentWon) {
            emit DisputeResolved(jobId, taskId, true, 0);
            _pay(job, jobId, taskId, t); // agent paid, stake untouched
        } else {
            uint256 slashed = _finalizeReject(job, jobId, taskId, t);
            emit DisputeResolved(jobId, taskId, false, slashed);
        }
    }

    // ------------------------------------------------------- finalize (anyone)

    /// @notice After the dispute window with no dispute, the proposed rejection
    ///         stands: slash + refund. Callable by anyone.
    function finalizeRejection(uint256 jobId, uint256 taskId) external {
        Job storage job = jobs[jobId];
        Task storage t = _task(jobId, taskId);
        if (t.status != Status.RejectedProposed) revert WrongState();
        if (block.timestamp <= t.rejectedAt + disputeWindow) revert WindowNotElapsed();
        uint256 slashed = _finalizeReject(job, jobId, taskId, t);
        emit RejectionFinalized(jobId, taskId, slashed);
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

    function _task(uint256 jobId, uint256 taskId) private view returns (Task storage t) {
        if (taskId >= _tasks[jobId].length) revert BadTask();
        t = _tasks[jobId][taskId];
    }

    function _pay(Job storage job, uint256 jobId, uint256 taskId, Task storage t) private {
        t.status = Status.Paid;
        job.reserved -= t.payout;
        job.unresolved -= 1;
        job.tasksPaid += 1;
        emit TaskPaid(jobId, taskId, t.agent, t.payout, t.workHash, t.summary);
        (bool ok, ) = t.agent.call{value: t.payout}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev Apply a final rejection: slash+burn from stake, refund reserved.
    function _finalizeReject(Job storage job, uint256 /*jobId*/, uint256 /*taskId*/, Task storage t)
        private
        returns (uint256 slash)
    {
        t.status = Status.RejectedFinal;
        job.reserved -= t.payout;
        job.unresolved -= 1;

        slash = job.slashPerReject;
        if (slash > job.stake) slash = job.stake;
        if (slash > 0) {
            job.stake -= slash;
            totalBurned += slash;
        }
        // refund the reserved task payment to the client (or job balance if open)
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
}
