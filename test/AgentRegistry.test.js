const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentRegistry — marketplace catalog", function () {
  let reg, a1, a2, a3;
  const RATE = ethers.parseEther("0.001");

  beforeEach(async function () {
    [a1, a2, a3] = await ethers.getSigners();
    reg = await ethers.deployContract("AgentRegistry");
  });

  it("registers an agent profile", async function () {
    await expect(reg.connect(a1).register("ChainAnalyst", "on-chain analyst", "analytics,reporting", RATE))
      .to.emit(reg, "AgentRegistered")
      .withArgs(a1.address, "ChainAnalyst", RATE);
    expect(await reg.isRegistered(a1.address)).to.equal(true);
    expect(await reg.agentCount()).to.equal(1n);
    const [, p] = await reg.getAgent(a1.address);
    expect(p.name).to.equal("ChainAnalyst");
    expect(p.capabilities).to.equal("analytics,reporting");
    expect(p.active).to.equal(true);
  });

  it("rejects an empty name", async function () {
    await expect(reg.connect(a1).register("", "x", "y", RATE)).to.be.revertedWithCustomError(
      reg,
      "EmptyName"
    );
  });

  it("updating an existing profile does not duplicate the listing", async function () {
    await reg.connect(a1).register("A", "b", "c", RATE);
    await reg.connect(a1).register("A2", "b2", "c2", RATE * 2n);
    expect(await reg.agentCount()).to.equal(1n);
    const [, p] = await reg.getAgent(a1.address);
    expect(p.name).to.equal("A2");
    expect(p.suggestedRate).to.equal(RATE * 2n);
  });

  it("preserves `since` across updates", async function () {
    await reg.connect(a1).register("A", "b", "c", RATE);
    const [, p1] = await reg.getAgent(a1.address);
    await reg.connect(a1).register("A", "b2", "c", RATE);
    const [, p2] = await reg.getAgent(a1.address);
    expect(p2.since).to.equal(p1.since);
  });

  it("setActive toggles the listing", async function () {
    await reg.connect(a1).register("A", "b", "c", RATE);
    await reg.connect(a1).setActive(false);
    expect((await reg.getAgent(a1.address))[1].active).to.equal(false);
    await reg.connect(a1).setActive(true);
    expect((await reg.getAgent(a1.address))[1].active).to.equal(true);
  });

  it("setActive reverts for an unregistered address", async function () {
    await expect(reg.connect(a2).setActive(true)).to.be.revertedWith("not registered");
  });

  it("paginates the catalog", async function () {
    await reg.connect(a1).register("A", "", "", RATE);
    await reg.connect(a2).register("B", "", "", RATE);
    await reg.connect(a3).register("C", "", "", RATE);
    const [addrs, page] = await reg.getAgents(1, 2);
    expect(addrs.length).to.equal(2);
    expect(page[0].name).to.equal("B");
    expect(page[1].name).to.equal("C");
    expect((await reg.getAgents(5, 2))[0].length).to.equal(0);
  });
});
