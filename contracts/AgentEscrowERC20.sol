// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal ERC-20 interface (no external deps — matches the project's
///      dependency-light style).
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title AgentPay ERC-20 Escrow — pay AI agents in a reward token per task
/// @notice The sibling of AgentEscrow: instead of native zkLTC, agents are paid
///         in an ERC-20 reward token (APAY) — deployed no-code with Dappit and
///         wired into the same AgentPay dapp. Clients approve + escrow tokens;
///         the agent is paid `ratePerTask` tokens for each completed task, with
///         the keccak256 work hash logged on-chain just like the native flow.
contract AgentEscrowERC20 {
    struct Job {
        address client;
        address agent;
        uint256 ratePerTask;
        uint256 balance; // escrowed reward tokens
        uint256 tasksCompleted;
        bool active;
        string spec;
    }

    IERC20 public immutable rewardToken;
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

    constructor(address rewardToken_) {
        if (rewardToken_ == address(0)) revert ZeroAddress();
        rewardToken = IERC20(rewardToken_);
    }

    /// @notice Open a job. Caller must first approve this contract for `deposit`
    ///         reward tokens; the tokens are pulled into escrow here.
    function createJob(
        address agent,
        uint256 ratePerTask,
        uint256 deposit,
        string calldata spec
    ) external returns (uint256 jobId) {
        if (agent == address(0)) revert ZeroAddress();
        if (ratePerTask == 0) revert ZeroRate();
        if (deposit < ratePerTask) revert InsufficientEscrow();

        if (!rewardToken.transferFrom(msg.sender, address(this), deposit)) revert TransferFailed();

        jobId = nextJobId++;
        jobs[jobId] = Job({
            client: msg.sender,
            agent: agent,
            ratePerTask: ratePerTask,
            balance: deposit,
            tasksCompleted: 0,
            active: true,
            spec: spec
        });
        emit JobCreated(jobId, msg.sender, agent, ratePerTask, deposit, spec);
    }

    /// @notice Agent reports a completed task and is paid `ratePerTask` tokens.
    function completeTask(uint256 jobId, bytes32 workHash, string calldata summary) external {
        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        if (msg.sender != job.agent) revert NotAgent();
        if (job.balance < job.ratePerTask) revert InsufficientEscrow();

        job.balance -= job.ratePerTask;
        job.tasksCompleted += 1;
        emit TaskCompleted(jobId, msg.sender, job.tasksCompleted, job.ratePerTask, workHash, summary);

        if (!rewardToken.transfer(job.agent, job.ratePerTask)) revert TransferFailed();
    }

    /// @notice Top up a job's token escrow (caller must approve first).
    function fund(uint256 jobId, uint256 amount) external {
        Job storage job = jobs[jobId];
        if (!job.active) revert JobInactive();
        if (!rewardToken.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        job.balance += amount;
        emit JobFunded(jobId, msg.sender, amount);
    }

    /// @notice Client closes the job and reclaims any unspent token escrow.
    function closeJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert NotClient();
        if (!job.active) revert JobInactive();

        job.active = false;
        uint256 refund = job.balance;
        job.balance = 0;
        emit JobClosed(jobId, refund);

        if (refund > 0 && !rewardToken.transfer(job.client, refund)) revert TransferFailed();
    }

    function tasksRemaining(uint256 jobId) external view returns (uint256) {
        Job storage job = jobs[jobId];
        if (!job.active || job.ratePerTask == 0) return 0;
        return job.balance / job.ratePerTask;
    }
}
