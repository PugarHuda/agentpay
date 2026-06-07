const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentEscrow — edge cases & adversarial", function () {
  let escrow, client, agent, stranger;
  const RATE = ethers.parseEther("0.01");

  beforeEach(async function () {
    [client, agent, stranger] = await ethers.getSigners();
    escrow = await ethers.deployContract("AgentEscrow");
  });

  describe("input validation", function () {
    it("rejects zero agent address", async function () {
      await expect(
        escrow.createJob(ethers.ZeroAddress, RATE, "x", { value: RATE })
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });

    it("rejects zero rate", async function () {
      await expect(
        escrow.createJob(agent.address, 0, "x", { value: RATE })
      ).to.be.revertedWithCustomError(escrow, "ZeroRate");
    });

    it("allows client to hire itself as agent (self-employment)", async function () {
      await escrow.createJob(client.address, RATE, "self", { value: RATE });
      await expect(
        escrow.connect(client).completeTask(0, ethers.ZeroHash, "did it myself")
      ).to.changeEtherBalance(client, RATE);
    });
  });

  describe("boundary conditions", function () {
    it("deposit exactly equal to one task rate works, then exhausts", async function () {
      await escrow.createJob(agent.address, RATE, "one-shot", { value: RATE });
      expect(await escrow.tasksRemaining(0)).to.equal(1n);
      await escrow.connect(agent).completeTask(0, ethers.ZeroHash, "task 1");
      expect(await escrow.tasksRemaining(0)).to.equal(0n);
      await expect(
        escrow.connect(agent).completeTask(0, ethers.ZeroHash, "task 2")
      ).to.be.revertedWithCustomError(escrow, "InsufficientEscrow");
    });

    it("leftover balance smaller than rate is refunded on close, not paid out", async function () {
      const deposit = RATE + RATE / 2n; // 1.5 tasks
      await escrow.createJob(agent.address, RATE, "x", { value: deposit });
      await escrow.connect(agent).completeTask(0, ethers.ZeroHash, "task 1");
      expect(await escrow.tasksRemaining(0)).to.equal(0n);
      await expect(escrow.connect(client).closeJob(0)).to.changeEtherBalance(
        client,
        RATE / 2n
      );
    });

    it("handles a very large rate without overflow", async function () {
      const bigRate = ethers.parseEther("9000"); // near the test account's full balance
      await escrow.createJob(agent.address, bigRate, "whale job", { value: bigRate });
      await expect(
        escrow.connect(agent).completeTask(0, ethers.ZeroHash, "big task")
      ).to.changeEtherBalance(agent, bigRate);
    });
  });

  describe("lifecycle abuse", function () {
    it("nonexistent job behaves as inactive", async function () {
      await expect(
        escrow.connect(agent).completeTask(99, ethers.ZeroHash, "ghost")
      ).to.be.revertedWithCustomError(escrow, "JobInactive");
      await expect(escrow.fund(99, { value: 1n })).to.be.revertedWithCustomError(
        escrow,
        "JobInactive"
      );
    });

    it("cannot close a job twice", async function () {
      await escrow.createJob(agent.address, RATE, "x", { value: RATE });
      await escrow.connect(client).closeJob(0);
      await expect(escrow.connect(client).closeJob(0)).to.be.revertedWithCustomError(
        escrow,
        "JobInactive"
      );
    });

    it("cannot fund a closed job", async function () {
      await escrow.createJob(agent.address, RATE, "x", { value: RATE });
      await escrow.connect(client).closeJob(0);
      await expect(escrow.fund(0, { value: RATE })).to.be.revertedWithCustomError(
        escrow,
        "JobInactive"
      );
    });

    it("tasksRemaining is 0 for closed and nonexistent jobs", async function () {
      await escrow.createJob(agent.address, RATE, "x", { value: RATE * 5n });
      await escrow.connect(client).closeJob(0);
      expect(await escrow.tasksRemaining(0)).to.equal(0n);
      expect(await escrow.tasksRemaining(99)).to.equal(0n);
    });

    it("top-up after exhaustion resumes work", async function () {
      await escrow.createJob(agent.address, RATE, "x", { value: RATE });
      await escrow.connect(agent).completeTask(0, ethers.ZeroHash, "task 1");
      await expect(
        escrow.connect(agent).completeTask(0, ethers.ZeroHash, "task 2")
      ).to.be.revertedWithCustomError(escrow, "InsufficientEscrow");

      await escrow.connect(stranger).fund(0, { value: RATE * 2n });
      await expect(
        escrow.connect(agent).completeTask(0, ethers.ZeroHash, "task 2")
      ).to.changeEtherBalance(agent, RATE);
    });

    it("interleaved jobs keep independent state and sequential ids", async function () {
      await escrow.createJob(agent.address, RATE, "job A", { value: RATE * 3n });
      await escrow
        .connect(stranger)
        .createJob(agent.address, RATE * 2n, "job B", { value: RATE * 4n });

      await escrow.connect(agent).completeTask(0, ethers.ZeroHash, "A1");
      await escrow.connect(agent).completeTask(1, ethers.ZeroHash, "B1");
      await escrow.connect(agent).completeTask(0, ethers.ZeroHash, "A2");

      const jobA = await escrow.jobs(0);
      const jobB = await escrow.jobs(1);
      expect(jobA.tasksCompleted).to.equal(2n);
      expect(jobA.balance).to.equal(RATE);
      expect(jobB.tasksCompleted).to.equal(1n);
      expect(jobB.balance).to.equal(RATE * 2n);
      expect(await escrow.nextJobId()).to.equal(2n);
    });
  });

  describe("adversarial agents", function () {
    it("reentrant agent cannot extract more than its escrowed wages", async function () {
      const attacker = await ethers.deployContract("ReentrantAgent", [escrow.target]);
      const deposit = RATE * 5n;
      await escrow.createJob(attacker.target, RATE, "trap", { value: deposit });
      // seed a second job so the escrow contract holds OTHER clients' funds too
      await escrow
        .connect(stranger)
        .createJob(agent.address, RATE, "innocent", { value: RATE * 3n });

      await attacker.attack(0);

      // attacker drained exactly its own job's escrow — nothing more
      expect(await ethers.provider.getBalance(attacker.target)).to.equal(deposit);
      const job = await escrow.jobs(0);
      expect(job.balance).to.equal(0n);
      expect(job.tasksCompleted).to.equal(5n);
      // the innocent job's funds are untouched
      expect((await escrow.jobs(1)).balance).to.equal(RATE * 3n);
      expect(await ethers.provider.getBalance(escrow.target)).to.equal(RATE * 3n);
    });

    it("agent that rejects payment reverts cleanly and client can still exit", async function () {
      const rejecter = await ethers.deployContract("RejectingAgent", [escrow.target]);
      await escrow.createJob(rejecter.target, RATE, "x", { value: RATE * 2n });

      await expect(rejecter.tryComplete(0)).to.be.revertedWithCustomError(
        escrow,
        "TransferFailed"
      );
      // state rolled back — no phantom task recorded
      expect((await escrow.jobs(0)).tasksCompleted).to.equal(0n);
      // client recovers the full escrow
      await expect(escrow.connect(client).closeJob(0)).to.changeEtherBalance(
        client,
        RATE * 2n
      );
    });
  });

  describe("event integrity", function () {
    it("task indexes increment monotonically across completions", async function () {
      await escrow.createJob(agent.address, RATE, "x", { value: RATE * 3n });
      for (let i = 1; i <= 3; i++) {
        await expect(
          escrow.connect(agent).completeTask(0, ethers.ZeroHash, `t${i}`)
        )
          .to.emit(escrow, "TaskCompleted")
          .withArgs(0, agent.address, i, RATE, ethers.ZeroHash, `t${i}`);
      }
    });

    it("JobClosed reports the exact refund amount", async function () {
      await escrow.createJob(agent.address, RATE, "x", { value: RATE * 3n });
      await escrow.connect(agent).completeTask(0, ethers.ZeroHash, "t1");
      await expect(escrow.connect(client).closeJob(0))
        .to.emit(escrow, "JobClosed")
        .withArgs(0, RATE * 2n);
    });
  });
});
