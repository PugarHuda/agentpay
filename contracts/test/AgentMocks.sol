// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentEscrow {
    function completeTask(uint256 jobId, bytes32 workHash, string calldata summary) external;
}

/// @dev Test mock: an agent that tries to re-enter completeTask from its
///      payout receive() hook, attempting to drain the escrow recursively.
contract ReentrantAgent {
    IAgentEscrow public immutable escrow;
    uint256 public jobId;

    constructor(address escrow_) {
        escrow = IAgentEscrow(escrow_);
    }

    function attack(uint256 jobId_) external {
        jobId = jobId_;
        escrow.completeTask(jobId_, keccak256("attack"), "reentrant");
    }

    receive() external payable {
        // re-enter as long as the payout keeps coming; swallow the final revert
        try escrow.completeTask(jobId, keccak256("attack"), "reentrant") {} catch {}
    }
}

interface IAgentEscrowV2 {
    function submitTask(uint256 jobId, bytes32 workHash, string calldata summary) external returns (uint256);
    function claimTask(uint256 jobId, uint256 taskId) external;
}

/// @dev Test mock: V2 agent that re-enters claimTask from its payout hook.
contract ReentrantAgentV2 {
    IAgentEscrowV2 public immutable escrow;
    uint256 public jobId;

    constructor(address escrow_) {
        escrow = IAgentEscrowV2(escrow_);
    }

    function submit(uint256 jobId_) external {
        jobId = jobId_;
        escrow.submitTask(jobId_, keccak256("attack"), "reentrant");
    }

    function claim(uint256 jobId_) external {
        escrow.claimTask(jobId_, 0);
    }

    receive() external payable {
        // try to claim the same task again — should revert (NotPending), swallowed
        try escrow.claimTask(jobId, 0) {} catch {}
    }
}

/// @dev Test mock: an agent whose receive() always reverts, so payouts fail.
contract RejectingAgent {
    IAgentEscrow public immutable escrow;

    constructor(address escrow_) {
        escrow = IAgentEscrow(escrow_);
    }

    function tryComplete(uint256 jobId_) external {
        escrow.completeTask(jobId_, keccak256("x"), "rejecting");
    }

    receive() external payable {
        revert("no thanks");
    }
}
