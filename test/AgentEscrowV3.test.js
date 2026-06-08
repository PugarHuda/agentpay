const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AgentEscrowV3 — stake & slashing", function () {
  let escrow, client, agent, other;
  const RATE = ethers.parseEther("0.01");
  const DEPOSIT = ethers.parseEther("0.05");
  const SLASH = ethers.parseEther("0.02"); // 2x rate — rejection costs the agent
  const STAKE = ethers.parseEther("0.06");
  const WINDOW = 100;
  const BURN = "0x000000000000000000000000000000000000dEaD";

  beforeEach(async function () {
    [client, agent, other] = await ethers.getSigners();
    escrow = await ethers.deployContract("AgentEscrowV3", [WINDOW, 0]);
  });

  async function createJob() {
    await escrow.connect(client).createJob(agent.address, RATE, SLASH, "spec", { value: DEPOSIT });
    return 0;
  }
  async function createAndAccept() {
    await createJob();
    await escrow.connect(agent).acceptJob(0, { value: STAKE });
  }

  describe("acceptance gating", function () {
    it("agent cannot submit before staking/accepting", async function () {
      await createJob();
      await expect(
        escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x")
      ).to.be.revertedWithCustomError(escrow, "NotAccepted");
    });

    it("acceptJob locks the stake", async function () {
      await createAndAccept();
      const job = await escrow.jobs(0);
      expect(job.stake).to.equal(STAKE);
      expect(job.accepted).to.equal(true);
    });

    it("only the named agent can accept, and only once", async function () {
      await createJob();
      await expect(
        escrow.connect(other).acceptJob(0, { value: STAKE })
      ).to.be.revertedWithCustomError(escrow, "NotAgent");
      await escrow.connect(agent).acceptJob(0, { value: STAKE });
      await expect(
        escrow.connect(agent).acceptJob(0, { value: STAKE })
      ).to.be.revertedWithCustomError(escrow, "AlreadyAccepted");
    });

    it("accept requires a non-zero stake", async function () {
      await createJob();
      await expect(escrow.connect(agent).acceptJob(0, { value: 0 })).to.be.revertedWithCustomError(
        escrow,
        "NoStake"
      );
    });
  });

  describe("slashing on reject", function () {
    it("rejecting burns slashPerReject from the agent's stake", async function () {
      await createAndAccept();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "garbage");
      const burnBefore = await ethers.provider.getBalance(BURN);

      await expect(escrow.connect(client).rejectTask(0, 0, "low quality"))
        .to.emit(escrow, "TaskRejected")
        .withArgs(0, 0, "low quality", SLASH);

      const job = await escrow.jobs(0);
      expect(job.stake).to.equal(STAKE - SLASH); // slashed
      expect(job.balance).to.equal(DEPOSIT); // escrow returned to client
      expect(await ethers.provider.getBalance(BURN)).to.equal(burnBefore + SLASH); // burned
      expect(await escrow.totalBurned()).to.equal(SLASH);
    });

    it("client gains nothing from rejecting (slash is burned, not paid out)", async function () {
      await createAndAccept();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x");
      // client balance only changes by gas; the reserved task value goes back to job.balance,
      // and the slash is burned — so no stake flows to the client
      await expect(escrow.connect(client).rejectTask(0, 0, "no")).to.changeEtherBalance(client, 0);
    });

    it("garbage spam is -EV: reject costs the agent more than the task would pay", async function () {
      await createAndAccept();
      // agent submits and the client approves one good task (+RATE)
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "good");
      await escrow.connect(client).approveTask(0, 0);
      // then a garbage task gets rejected (-SLASH from stake)
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "garbage");
      await escrow.connect(client).rejectTask(0, 1, "garbage");
      const job = await escrow.jobs(0);
      // net: earned RATE but lost SLASH (2x RATE) → strictly worse than not spamming
      expect(SLASH).to.be.greaterThan(RATE);
      expect(job.stake).to.equal(STAKE - SLASH);
      expect(job.tasksPaid).to.equal(1);
    });

    it("slash is capped at the remaining stake", async function () {
      const smallStake = ethers.parseEther("0.005"); // < SLASH
      await createJob();
      await escrow.connect(agent).acceptJob(0, { value: smallStake });
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x");
      await escrow.connect(client).rejectTask(0, 0, "no");
      expect((await escrow.jobs(0)).stake).to.equal(0); // can't go negative
    });
  });

  describe("stake withdrawal", function () {
    it("agent withdraws remaining stake when no tasks are pending", async function () {
      await createAndAccept();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x");
      await escrow.connect(client).approveTask(0, 0); // resolved
      await expect(escrow.connect(agent).withdrawStake(0)).to.changeEtherBalance(agent, STAKE);
      const job = await escrow.jobs(0);
      expect(job.stake).to.equal(0);
      expect(job.accepted).to.equal(false);
    });

    it("cannot withdraw stake while a task is pending (no dodging slashing)", async function () {
      await createAndAccept();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x");
      await expect(escrow.connect(agent).withdrawStake(0)).to.be.revertedWithCustomError(
        escrow,
        "PendingTasks"
      );
    });

    it("withdrawing after a slash returns only what's left", async function () {
      await createAndAccept();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x");
      await escrow.connect(client).rejectTask(0, 0, "no"); // -SLASH
      await expect(escrow.connect(agent).withdrawStake(0)).to.changeEtherBalance(
        agent,
        STAKE - SLASH
      );
    });
  });

  describe("V2 behaviours still hold", function () {
    it("approve pays, claim works after window", async function () {
      await createAndAccept();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "a");
      await expect(escrow.connect(client).approveTask(0, 0)).to.changeEtherBalance(agent, RATE);

      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "b");
      await time.increase(WINDOW + 1);
      await expect(escrow.connect(agent).claimTask(0, 1)).to.changeEtherBalance(agent, RATE);
    });

    it("closeJob refunds free balance; stake & reserved untouched", async function () {
      await createAndAccept();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x"); // reserves RATE
      await expect(escrow.connect(client).closeJob(0)).to.changeEtherBalance(client, DEPOSIT - RATE);
      // agent can still claim and later withdraw stake
      await time.increase(WINDOW + 1);
      await escrow.connect(agent).claimTask(0, 0);
      await expect(escrow.connect(agent).withdrawStake(0)).to.changeEtherBalance(agent, STAKE);
    });

    it("contract balance == free + reserved + stake at all times", async function () {
      await createAndAccept();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "a");
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "b");
      let job = await escrow.jobs(0);
      expect(await ethers.provider.getBalance(escrow.target)).to.equal(
        job.balance + job.reserved + job.stake
      );
      await escrow.connect(client).approveTask(0, 0);
      await escrow.connect(client).rejectTask(0, 1, "no"); // burns SLASH out of the contract
      job = await escrow.jobs(0);
      expect(await ethers.provider.getBalance(escrow.target)).to.equal(
        job.balance + job.reserved + job.stake
      );
    });
  });
});
