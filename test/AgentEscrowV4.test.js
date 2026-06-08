const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AgentEscrowV4 — neutral arbitration", function () {
  let escrow, client, agent, arbiter, other;
  const RATE = ethers.parseEther("0.01");
  const DEPOSIT = ethers.parseEther("0.05");
  const SLASH = ethers.parseEther("0.02");
  const MIN_STAKE = ethers.parseEther("0.04");
  const STAKE = ethers.parseEther("0.06");
  const WINDOW = 100;

  beforeEach(async function () {
    [client, agent, arbiter, other] = await ethers.getSigners();
    escrow = await ethers.deployContract("AgentEscrowV4", [WINDOW, 0]);
  });

  async function setup() {
    await escrow
      .connect(client)
      .createJob(agent.address, arbiter.address, RATE, SLASH, MIN_STAKE, "spec", { value: DEPOSIT });
    await escrow.connect(agent).acceptJob(0, { value: STAKE });
  }
  const submit = (s = "x") => escrow.connect(agent).submitTask(0, ethers.ZeroHash, s);

  it("createJob requires a non-zero arbiter", async function () {
    await expect(
      escrow.createJob(agent.address, ethers.ZeroAddress, RATE, SLASH, MIN_STAKE, "x", { value: DEPOSIT })
    ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
  });

  describe("reject is only a proposal — nothing slashed yet", function () {
    it("rejectTask holds funds, does not slash on its own", async function () {
      await setup();
      await submit();
      await escrow.connect(client).rejectTask(0, 0, "looks wrong");
      const job = await escrow.jobs(0);
      expect(job.stake).to.equal(STAKE); // not slashed yet
      expect(job.reserved).to.equal(RATE); // still held
      const t = await escrow.getTask(0, 0);
      expect(t.status).to.equal(2); // RejectedProposed
    });
  });

  describe("the fix: arbiter overturns a false rejection", function () {
    it("agent disputes → arbiter rules for agent → paid, stake intact", async function () {
      await setup();
      await submit("good work");
      await escrow.connect(client).rejectTask(0, 0, "bogus rejection");
      await escrow.connect(agent).disputeRejection(0, 0);

      await expect(escrow.connect(arbiter).resolveDispute(0, 0, true)).to.changeEtherBalance(
        agent,
        RATE
      );
      const job = await escrow.jobs(0);
      expect(job.stake).to.equal(STAKE); // NOT slashed — false rejection cost the agent nothing
      expect(job.tasksPaid).to.equal(1n);
      expect((await escrow.getTask(0, 0)).status).to.equal(1); // Paid
    });

    it("arbiter rules for client → slash + refund", async function () {
      await setup();
      await submit("garbage");
      await escrow.connect(client).rejectTask(0, 0, "garbage");
      await escrow.connect(agent).disputeRejection(0, 0);

      await expect(escrow.connect(arbiter).resolveDispute(0, 0, false)).to.changeEtherBalance(agent, 0);
      const job = await escrow.jobs(0);
      expect(job.stake).to.equal(STAKE - SLASH); // slashed
      expect(job.balance).to.equal(DEPOSIT); // task payment refunded to client
      expect((await escrow.getTask(0, 0)).status).to.equal(4); // RejectedFinal
    });

    it("only the arbiter can resolve", async function () {
      await setup();
      await submit();
      await escrow.connect(client).rejectTask(0, 0, "x");
      await escrow.connect(agent).disputeRejection(0, 0);
      await expect(escrow.connect(client).resolveDispute(0, 0, false)).to.be.revertedWithCustomError(
        escrow,
        "NotArbiter"
      );
      await expect(escrow.connect(other).resolveDispute(0, 0, true)).to.be.revertedWithCustomError(
        escrow,
        "NotArbiter"
      );
    });
  });

  describe("finalize when the agent does not dispute", function () {
    it("rejection finalizes after the window: slash + refund", async function () {
      await setup();
      await submit();
      await escrow.connect(client).rejectTask(0, 0, "no");
      await time.increase(WINDOW + 1);
      await escrow.finalizeRejection(0, 0); // anyone can call
      const job = await escrow.jobs(0);
      expect(job.stake).to.equal(STAKE - SLASH);
      expect(job.balance).to.equal(DEPOSIT);
      expect((await escrow.getTask(0, 0)).status).to.equal(4); // RejectedFinal
    });

    it("cannot finalize before the window", async function () {
      await setup();
      await submit();
      await escrow.connect(client).rejectTask(0, 0, "no");
      await expect(escrow.finalizeRejection(0, 0)).to.be.revertedWithCustomError(
        escrow,
        "WindowNotElapsed"
      );
    });

    it("agent cannot dispute after the window elapsed", async function () {
      await setup();
      await submit();
      await escrow.connect(client).rejectTask(0, 0, "no");
      await time.increase(WINDOW + 1);
      await expect(escrow.connect(agent).disputeRejection(0, 0)).to.be.revertedWithCustomError(
        escrow,
        "WindowElapsed"
      );
    });
  });

  describe("happy paths still work", function () {
    it("approve pays immediately", async function () {
      await setup();
      await submit();
      await expect(escrow.connect(client).approveTask(0, 0)).to.changeEtherBalance(agent, RATE);
    });

    it("optimistic claim after window when client is silent", async function () {
      await setup();
      await submit();
      await time.increase(WINDOW + 1);
      await expect(escrow.connect(agent).claimTask(0, 0)).to.changeEtherBalance(agent, RATE);
    });
  });

  describe("stake withdrawal gated by unresolved disputes", function () {
    it("cannot withdraw stake while a rejection is unresolved", async function () {
      await setup();
      await submit();
      await escrow.connect(client).rejectTask(0, 0, "no"); // RejectedProposed (unresolved)
      await expect(escrow.connect(agent).withdrawStake(0)).to.be.revertedWithCustomError(
        escrow,
        "PendingTasks"
      );
      // resolve via finalize, then withdrawal works
      await time.increase(WINDOW + 1);
      await escrow.finalizeRejection(0, 0);
      await expect(escrow.connect(agent).withdrawStake(0)).to.changeEtherBalance(agent, STAKE - SLASH);
    });
  });

  describe("accounting integrity", function () {
    it("balance == free + reserved + stake across the dispute lifecycle", async function () {
      await setup();
      await submit("a");
      await submit("b");
      await escrow.connect(client).approveTask(0, 0);
      await escrow.connect(client).rejectTask(0, 1, "no");
      await escrow.connect(agent).disputeRejection(0, 1);
      await escrow.connect(arbiter).resolveDispute(0, 1, false); // burns SLASH
      const job = await escrow.jobs(0);
      expect(await ethers.provider.getBalance(escrow.target)).to.equal(
        job.balance + job.reserved + job.stake
      );
    });

    it("a resolved task cannot be resolved or finalized again (no double-pay)", async function () {
      await setup();
      await submit();
      await escrow.connect(client).rejectTask(0, 0, "no");
      await escrow.connect(agent).disputeRejection(0, 0);
      await escrow.connect(arbiter).resolveDispute(0, 0, true); // Paid (final)
      await expect(escrow.connect(arbiter).resolveDispute(0, 0, true)).to.be.revertedWithCustomError(
        escrow,
        "WrongState"
      );
      await expect(escrow.finalizeRejection(0, 0)).to.be.revertedWithCustomError(escrow, "WrongState");
    });
  });
});
