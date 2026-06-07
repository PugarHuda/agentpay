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
