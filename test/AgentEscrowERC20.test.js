const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentEscrowERC20 — APAY token wages", function () {
  let token, escrow, client, agent, stranger;
  const RATE = ethers.parseEther("10"); // 10 APAY per task
  const DEPOSIT = ethers.parseEther("50");

  beforeEach(async function () {
    [client, agent, stranger] = await ethers.getSigners();
    token = await ethers.deployContract("MockERC20", [ethers.parseEther("1000000")]);
    escrow = await ethers.deployContract("AgentEscrowERC20", [token.target]);
  });

  it("rejects a zero token address at construction", async function () {
    await expect(
      ethers.deployContract("AgentEscrowERC20", [ethers.ZeroAddress])
    ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
  });

  async function createJob() {
    await token.connect(client).approve(escrow.target, DEPOSIT);
    await escrow.connect(client).createJob(agent.address, RATE, DEPOSIT, "APAY-paid analyst job");
    return 0;
  }

  it("escrows APAY tokens on job creation", async function () {
    await createJob();
    expect(await token.balanceOf(escrow.target)).to.equal(DEPOSIT);
    const job = await escrow.jobs(0);
    expect(job.balance).to.equal(DEPOSIT);
    expect(await escrow.tasksRemaining(0)).to.equal(5n);
  });

  it("pays the agent in APAY per completed task", async function () {
    await createJob();
    const workHash = ethers.keccak256(ethers.toUtf8Bytes("token task"));
    await expect(
      escrow.connect(agent).completeTask(0, workHash, "did it")
    ).to.changeTokenBalances(token, [escrow, agent], [-RATE, RATE]);
    expect((await escrow.jobs(0)).tasksCompleted).to.equal(1n);
  });

  it("emits TaskCompleted with the token payout", async function () {
    await createJob();
    await expect(escrow.connect(agent).completeTask(0, ethers.ZeroHash, "x"))
      .to.emit(escrow, "TaskCompleted")
      .withArgs(0, agent.address, 1, RATE, ethers.ZeroHash, "x");
  });

  it("blocks non-agents", async function () {
    await createJob();
    await expect(
      escrow.connect(stranger).completeTask(0, ethers.ZeroHash, "nope")
    ).to.be.revertedWithCustomError(escrow, "NotAgent");
  });

  it("stops paying when token escrow is exhausted", async function () {
    await createJob();
    for (let i = 0; i < 5; i++) await escrow.connect(agent).completeTask(0, ethers.ZeroHash, `t${i}`);
    await expect(
      escrow.connect(agent).completeTask(0, ethers.ZeroHash, "t6")
    ).to.be.revertedWithCustomError(escrow, "InsufficientEscrow");
  });

  it("rejects deposit below one task rate", async function () {
    await token.connect(client).approve(escrow.target, RATE - 1n);
    await expect(
      escrow.connect(client).createJob(agent.address, RATE, RATE - 1n, "x")
    ).to.be.revertedWithCustomError(escrow, "InsufficientEscrow");
  });

  it("allows top-ups and refunds unspent tokens on close", async function () {
    await createJob();
    await escrow.connect(agent).completeTask(0, ethers.ZeroHash, "t1");

    await token.connect(client).approve(escrow.target, RATE);
    await escrow.connect(client).fund(0, RATE);
    expect((await escrow.jobs(0)).balance).to.equal(DEPOSIT - RATE + RATE);

    await expect(escrow.connect(client).closeJob(0)).to.changeTokenBalance(
      token,
      client,
      DEPOSIT // got back the 40 left + the 10 top-up = original 50
    );
  });

  it("reverts cleanly when the token transfer fails on payout", async function () {
    const badToken = await ethers.deployContract("FalseReturningERC20");
    const badEscrow = await ethers.deployContract("AgentEscrowERC20", [badToken.target]);
    await badToken.connect(client).approve(badEscrow.target, DEPOSIT);
    await badEscrow.connect(client).createJob(agent.address, RATE, DEPOSIT, "x");
    await expect(
      badEscrow.connect(agent).completeTask(0, ethers.ZeroHash, "x")
    ).to.be.revertedWithCustomError(badEscrow, "TransferFailed");
    // no phantom task recorded
    expect((await badEscrow.jobs(0)).tasksCompleted).to.equal(0n);
  });

  it("only the client can close", async function () {
    await createJob();
    await expect(escrow.connect(agent).closeJob(0)).to.be.revertedWithCustomError(
      escrow,
      "NotClient"
    );
  });
});
