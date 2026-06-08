const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AgentEscrowV2 — optimistic escrow", function () {
  let escrow, client, agent, other;
  const RATE = ethers.parseEther("0.01");
  const DEPOSIT = ethers.parseEther("0.05");
  const WINDOW = 100; // seconds
  const COOLDOWN = 0;

  beforeEach(async function () {
    [client, agent, other] = await ethers.getSigners();
    escrow = await ethers.deployContract("AgentEscrowV2", [WINDOW, COOLDOWN]);
  });

  async function createJob() {
    await escrow.connect(client).createJob(agent.address, RATE, "spec", { value: DEPOSIT });
    return 0;
  }

  describe("submit reserves but does not pay", function () {
    it("submitTask reserves funds and pays nothing yet", async function () {
      await createJob();
      await expect(
        escrow.connect(agent).submitTask(0, ethers.id("work"), "did it")
      ).to.changeEtherBalance(agent, 0); // no payment on submit
      const job = await escrow.jobs(0);
      expect(job.reserved).to.equal(RATE);
      expect(job.balance).to.equal(DEPOSIT - RATE);
      expect(job.tasksPaid).to.equal(0);
      expect(await escrow.taskCount(0)).to.equal(1);
    });

    it("only the agent can submit", async function () {
      await createJob();
      await expect(
        escrow.connect(other).submitTask(0, ethers.ZeroHash, "x")
      ).to.be.revertedWithCustomError(escrow, "NotAgent");
    });

    it("cannot submit when free balance is below the rate", async function () {
      await escrow.connect(client).createJob(agent.address, RATE, "x", { value: RATE });
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "1");
      await expect(
        escrow.connect(agent).submitTask(0, ethers.ZeroHash, "2")
      ).to.be.revertedWithCustomError(escrow, "InsufficientEscrow");
    });
  });

  describe("approve pays the agent", function () {
    it("client approval pays the agent and clears the reserve", async function () {
      await createJob();
      await escrow.connect(agent).submitTask(0, ethers.id("w"), "done");
      await expect(escrow.connect(client).approveTask(0, 0)).to.changeEtherBalance(agent, RATE);
      const job = await escrow.jobs(0);
      expect(job.reserved).to.equal(0);
      expect(job.tasksPaid).to.equal(1);
    });

    it("emits TaskPaid on approval", async function () {
      await createJob();
      await escrow.connect(agent).submitTask(0, ethers.id("w"), "done");
      await expect(escrow.connect(client).approveTask(0, 0))
        .to.emit(escrow, "TaskPaid")
        .withArgs(0, 0, agent.address, RATE, ethers.id("w"), "done");
    });

    it("non-client cannot approve", async function () {
      await createJob();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x");
      await expect(escrow.connect(other).approveTask(0, 0)).to.be.revertedWithCustomError(
        escrow,
        "NotClient"
      );
    });
  });

  describe("reject protects the client", function () {
    it("rejecting returns the reserve to the job balance, agent unpaid", async function () {
      await createJob();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "garbage");
      await expect(
        escrow.connect(client).rejectTask(0, 0, "low quality")
      ).to.changeEtherBalance(agent, 0);
      const job = await escrow.jobs(0);
      expect(job.reserved).to.equal(0);
      expect(job.balance).to.equal(DEPOSIT); // fully restored
      expect(job.tasksPaid).to.equal(0);
    });

    it("a rejected task cannot then be approved or claimed", async function () {
      await createJob();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x");
      await escrow.connect(client).rejectTask(0, 0, "no");
      await expect(escrow.connect(client).approveTask(0, 0)).to.be.revertedWithCustomError(
        escrow,
        "NotPending"
      );
      await time.increase(WINDOW + 1);
      await expect(escrow.connect(agent).claimTask(0, 0)).to.be.revertedWithCustomError(
        escrow,
        "NotPending"
      );
    });
  });

  describe("optimistic claim after the window", function () {
    it("agent cannot claim before the window elapses", async function () {
      await createJob();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x");
      await expect(escrow.connect(agent).claimTask(0, 0)).to.be.revertedWithCustomError(
        escrow,
        "WindowNotElapsed"
      );
    });

    it("agent claims after the window when the client stayed silent", async function () {
      await createJob();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x");
      await time.increase(WINDOW + 1);
      await expect(escrow.connect(agent).claimTask(0, 0)).to.changeEtherBalance(agent, RATE);
      expect((await escrow.jobs(0)).tasksPaid).to.equal(1);
    });

    it("isClaimable flips true only after the window", async function () {
      await createJob();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x");
      expect(await escrow.isClaimable(0, 0)).to.equal(false);
      await time.increase(WINDOW + 1);
      expect(await escrow.isClaimable(0, 0)).to.equal(true);
    });

    it("client can still reject inside the window before a claim", async function () {
      await createJob();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x");
      await time.increase(WINDOW - 5);
      await escrow.connect(client).rejectTask(0, 0, "caught in time");
      expect((await escrow.jobs(0)).balance).to.equal(DEPOSIT);
    });
  });

  describe("close cannot rug pending agents (issue #3/#4 fix)", function () {
    it("closeJob only refunds free balance; reserved stays for the pending task", async function () {
      await createJob();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x"); // reserves RATE
      // client closes: should only get back DEPOSIT - RATE (free), not the reserved RATE
      await expect(escrow.connect(client).closeJob(0)).to.changeEtherBalance(
        client,
        DEPOSIT - RATE
      );
      // agent can still claim the pending task after the window even though closed
      await time.increase(WINDOW + 1);
      await expect(escrow.connect(agent).claimTask(0, 0)).to.changeEtherBalance(agent, RATE);
    });

    it("rejecting after close refunds the client directly (no stuck funds)", async function () {
      await createJob();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x");
      await escrow.connect(client).closeJob(0);
      await expect(escrow.connect(client).rejectTask(0, 0, "after close")).to.changeEtherBalance(
        client,
        RATE
      );
      expect(await ethers.provider.getBalance(escrow.target)).to.equal(0n);
    });

    it("cannot submit to a closed job", async function () {
      await createJob();
      await escrow.connect(client).closeJob(0);
      await expect(
        escrow.connect(agent).submitTask(0, ethers.ZeroHash, "x")
      ).to.be.revertedWithCustomError(escrow, "JobInactive");
    });
  });

  describe("cooldown blocks mempool spam", function () {
    it("enforces a minimum interval between submissions", async function () {
      const e = await ethers.deployContract("AgentEscrowV2", [WINDOW, 60]); // 60s cooldown
      await e.connect(client).createJob(agent.address, RATE, "x", { value: DEPOSIT });
      await e.connect(agent).submitTask(0, ethers.ZeroHash, "1");
      await expect(
        e.connect(agent).submitTask(0, ethers.ZeroHash, "2")
      ).to.be.revertedWithCustomError(e, "CooldownActive");
      await time.increase(61);
      await expect(e.connect(agent).submitTask(0, ethers.ZeroHash, "2")).to.emit(e, "TaskSubmitted");
    });
  });

  describe("accounting & integrity", function () {
    it("contract balance always equals free + reserved across the lifecycle", async function () {
      await createJob();
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "a");
      await escrow.connect(agent).submitTask(0, ethers.ZeroHash, "b");
      let job = await escrow.jobs(0);
      expect(await ethers.provider.getBalance(escrow.target)).to.equal(job.balance + job.reserved);

      await escrow.connect(client).approveTask(0, 0); // pay one
      await escrow.connect(client).rejectTask(0, 1, "no"); // refund one
      job = await escrow.jobs(0);
      expect(await ethers.provider.getBalance(escrow.target)).to.equal(job.balance + job.reserved);
    });

    it("paginates tasks", async function () {
      await escrow.connect(client).createJob(agent.address, RATE, "x", {
        value: RATE * 5n,
      });
      for (let i = 0; i < 3; i++) await escrow.connect(agent).submitTask(0, ethers.ZeroHash, `t${i}`);
      const page = await escrow.getTasks(0, 1, 2);
      expect(page.length).to.equal(2);
      expect(page[0].summary).to.equal("t1");
    });
  });

  describe("adversarial: reentrancy on payout", function () {
    it("reentrant agent cannot double-spend a claim", async function () {
      const attacker = await ethers.deployContract("ReentrantAgentV2", [escrow.target]);
      await escrow.connect(client).createJob(attacker.target, RATE, "trap", { value: DEPOSIT });
      await attacker.submit(0);
      await time.increase(WINDOW + 1);
      await attacker.claim(0); // receive() re-enters claimTask → must not double pay
      // exactly one task paid, attacker got exactly RATE
      expect((await escrow.jobs(0)).tasksPaid).to.equal(1);
      expect(await ethers.provider.getBalance(attacker.target)).to.equal(RATE);
    });
  });
});
