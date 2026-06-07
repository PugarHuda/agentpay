// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentPay Escrow — autonomous AI agents earn zkLTC per completed task
/// @notice Clients fund a job with native zkLTC; the assigned agent gets paid
///         automatically each time it completes a task, with a hash of the work
///         output recorded on-chain as a verifiable work log. Agents can in turn
///         open jobs that hire other agents — agent-to-agent commerce on hard money.
contract AgentEscrow {
    struct Job {
        address client; // who funds the job
        address agent; // who performs tasks and gets paid
        uint256 ratePerTask; // zkLTC (wei) paid per completed task
        uint256 balance; // remaining escrowed zkLTC
        uint256 tasksCompleted;
        bool active;
        string spec; // human-readable task spec (or IPFS hash)
    }

    uint256 public nextJobId;
    mapping(uint256 => Job) public jobs;

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed agent,
        uint256 ratePerTask,
        uint256 deposit,
        string spec
    );
    event TaskCompleted(
        uint256 indexed jobId,
        address indexed agent,
        uint256 taskIndex,
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

    /// @notice Open a job: escrow zkLTC for `agent`, paid out at `ratePerTask` per task.
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
            tasksCompleted: 0,
            active: true,
            spec: spec
        });
        emit JobCreated(jobId, msg.sender, agent, ratePerTask, msg.value, spec);
    }

    /// @notice Agent reports a completed task and is paid instantly.
    /// @param workHash keccak256 of the full work output — the on-chain proof of work done.
    /// @param summary  short human-readable description of what was done.
    function completeTask(
        uint256 jobId,
        bytes32 workHash,
        string calldata summary
    ) external {
        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        if (msg.sender != job.agent) revert NotAgent();
        if (job.balance < job.ratePerTask) revert InsufficientEscrow();

        job.balance -= job.ratePerTask;
        job.tasksCompleted += 1;
        emit TaskCompleted(jobId, msg.sender, job.tasksCompleted, job.ratePerTask, workHash, summary);

        (bool ok, ) = job.agent.call{value: job.ratePerTask}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Anyone can top up a job's escrow (e.g. the client, or a sponsor).
    function fund(uint256 jobId) external payable {
        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        job.balance += msg.value;
        emit JobFunded(jobId, msg.sender, msg.value);
    }

    /// @notice Client closes the job and reclaims any unspent escrow.
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

    /// @notice How many more tasks the current escrow can pay for.
    function tasksRemaining(uint256 jobId) external view returns (uint256) {
        Job storage job = jobs[jobId];
        if (!job.active || job.ratePerTask == 0) return 0;
        return job.balance / job.ratePerTask;
    }
}
