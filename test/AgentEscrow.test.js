const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentEscrow", function () {
  let escrow, client, agent, other;
  const RATE = ethers.parseEther("0.01");
  const DEPOSIT = ethers.parseEther("0.05");

  beforeEach(async function () {
    [client, agent, other] = await ethers.getSigners();
    escrow = await ethers.deployContract("AgentEscrow");
  });

  async function createJob() {
    const tx = await escrow
      .connect(client)
      .createJob(agent.address, RATE, "Summarize crypto news hourly", { value: DEPOSIT });
    await tx.wait();
    return 0; // first jobId
  }

  it("creates a job with escrowed zkLTC", async function () {
    await createJob();
    const job = await escrow.jobs(0);
    expect(job.client).to.equal(client.address);
    expect(job.agent).to.equal(agent.address);
    expect(job.balance).to.equal(DEPOSIT);
    expect(job.active).to.equal(true);
    expect(await escrow.tasksRemaining(0)).to.equal(5n);
  });

  it("rejects job creation with deposit below one task rate", async function () {
    await expect(
      escrow.createJob(agent.address, RATE, "x", { value: RATE - 1n })
    ).to.be.revertedWithCustomError(escrow, "InsufficientEscrow");
  });

  it("pays the agent per completed task and logs the work hash", async function () {
    await createJob();
    const workHash = ethers.keccak256(ethers.toUtf8Bytes("task output #1"));

    await expect(
      escrow.connect(agent).completeTask(0, workHash, "Summarized 12 articles")
    ).to.changeEtherBalances([escrow, agent], [-RATE, RATE]);

    const job = await escrow.jobs(0);
    expect(job.tasksCompleted).to.equal(1n);
    expect(job.balance).to.equal(DEPOSIT - RATE);
  });

  it("emits TaskCompleted with task index and payout", async function () {
    await createJob();
    const workHash = ethers.keccak256(ethers.toUtf8Bytes("output"));
    await expect(escrow.connect(agent).completeTask(0, workHash, "done"))
      .to.emit(escrow, "TaskCompleted")
      .withArgs(0, agent.address, 1, RATE, workHash, "done");
  });

  it("blocks non-agents from claiming tasks", async function () {
    await createJob();
    await expect(
      escrow.connect(other).completeTask(0, ethers.ZeroHash, "fake")
    ).to.be.revertedWithCustomError(escrow, "NotAgent");
  });

  it("stops paying when escrow is exhausted", async function () {
    await createJob();
    for (let i = 0; i < 5; i++) {
      await escrow.connect(agent).completeTask(0, ethers.ZeroHash, `task ${i}`);
    }
    await expect(
      escrow.connect(agent).completeTask(0, ethers.ZeroHash, "task 6")
    ).to.be.revertedWithCustomError(escrow, "InsufficientEscrow");
  });

  it("allows anyone to top up escrow", async function () {
    await createJob();
    await escrow.connect(other).fund(0, { value: RATE });
    expect((await escrow.jobs(0)).balance).to.equal(DEPOSIT + RATE);
  });

  it("refunds the client on close and deactivates the job", async function () {
    await createJob();
    await escrow.connect(agent).completeTask(0, ethers.ZeroHash, "one task");

    await expect(escrow.connect(client).closeJob(0)).to.changeEtherBalances(
      [escrow, client],
      [-(DEPOSIT - RATE), DEPOSIT - RATE]
    );
    const job = await escrow.jobs(0);
    expect(job.active).to.equal(false);
    expect(job.balance).to.equal(0n);

    await expect(
      escrow.connect(agent).completeTask(0, ethers.ZeroHash, "late")
    ).to.be.revertedWithCustomError(escrow, "JobInactive");
  });

  it("only the client can close the job", async function () {
    await createJob();
    await expect(escrow.connect(agent).closeJob(0)).to.be.revertedWithCustomError(
      escrow,
      "NotClient"
    );
  });
});
