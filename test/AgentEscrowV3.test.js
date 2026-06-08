const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AgentEscrowV3 — stake & slashing", function () {
  let escrow, client, agent, other;
  const RATE = ethers.parseEther("0.01");
  const DEPOSIT = ethers.parseEther("0.05");
  const SLASH = ethers.parseEther("0.02"); // 2x rate — rejection costs the agent
  const MIN_STAKE = ethers.parseEther("0.04"); // floor (>= slash) set by client
  const STAKE = ethers.parseEther("0.06");
  const WINDOW = 100;
  const BURN = "0x000000000000000000000000000000000000dEaD";

  beforeEach(async function () {
    [client, agent, other] = await ethers.getSigners();
    escrow = await ethers.deployContract("AgentEscrowV3", [WINDOW, 0]);
  });

  async function createJob() {
    await escrow.connect(client).createJob(agent.address, RATE, SLASH, MIN_STAKE, "spec", { value: DEPOSIT });
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

    it("accept requires a stake meeting the minStake floor", async function () {
      await createJob();
      await expect(escrow.connect(agent).acceptJob(0, { value: 0 })).to.be.revertedWithCustomError(
        escrow,
        "InsufficientStake"
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

    it("slash is capped at the remaining stake (after repeated rejects)", async function () {
      // stake exactly the floor (0.04); slash 0.02 each → 2 rejects drains it,
      // a 3rd reject caps the slash to 0 (can't go negative)
      await createJob();
      await escrow.connect(agent).acceptJob(0, { value: MIN_STAKE });
      for (let i = 0; i < 3; i++) {
        await escrow.connect(agent).submitTask(0, ethers.ZeroHash, `g${i}`);
        await escrow.connect(client).rejectTask(0, i, "no");
      }
      expect((await escrow.jobs(0)).stake).to.equal(0);
    });
  });

  describe("stake floor — slashing has teeth (audit HIGH fix)", function () {
    it("agent cannot accept with a stake below the client's minStake", async function () {
      await createJob();
      await expect(
        escrow.connect(agent).acceptJob(0, { value: SLASH - 1n }) // dust-stake attack
      ).to.be.revertedWithCustomError(escrow, "InsufficientStake");
      // a 1-wei stake (the old nullify-slashing attack) is now rejected
      await expect(
        escrow.connect(agent).acceptJob(0, { value: 1n })
      ).to.be.revertedWithCustomError(escrow, "InsufficientStake");
    });

    it("accepting at exactly minStake works and guarantees a full first slash", async function () {
      await createJob();
      await escrow.connect(agent).acceptJob(0, { value: MIN_STAKE });
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "g");
      await escrow.connect(client).rejectTask(0, 0, "no");
      // the full slash landed (stake floor >= slash), so garbage is genuinely -EV
      expect((await escrow.jobs(0)).stake).to.equal(MIN_STAKE - SLASH);
    });

    it("rejects config with zero slash or minStake below slash", async function () {
      await expect(
        escrow.createJob(agent.address, RATE, 0, MIN_STAKE, "x", { value: DEPOSIT })
      ).to.be.revertedWithCustomError(escrow, "InvalidConfig");
      await expect(
        escrow.createJob(agent.address, RATE, SLASH, SLASH - 1n, "x", { value: DEPOSIT })
      ).to.be.revertedWithCustomError(escrow, "InvalidConfig");
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
