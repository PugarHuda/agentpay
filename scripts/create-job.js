/**
 * Create a demo job: hire the ChainAnalyst agent.
 * Usage: npx hardhat run scripts/create-job.js --network liteforge
 * Env: ESCROW_ADDRESS, AGENT_ADDRESS (or derives from AGENT_PRIVATE_KEY),
 *      RATE_ZKLTC (default 0.001), DEPOSIT_ZKLTC (default 0.01)
 */
const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const [client] = await hre.ethers.getSigners();
  const escrowAddress = process.env.ESCROW_ADDRESS;
  if (!escrowAddress) throw new Error("Set ESCROW_ADDRESS in .env");

  const agentAddress =
    process.env.AGENT_ADDRESS ||
    new hre.ethers.Wallet(process.env.AGENT_PRIVATE_KEY).address;

  const rate = hre.ethers.parseEther(process.env.RATE_ZKLTC || "0.001");
  const deposit = hre.ethers.parseEther(process.env.DEPOSIT_ZKLTC || "0.01");

  const escrow = await hre.ethers.getContractAt("AgentEscrow", escrowAddress);
  console.log(`Client ${client.address} hiring agent ${agentAddress}`);
  console.log(`Rate ${hre.ethers.formatEther(rate)} zkLTC/task, deposit ${hre.ethers.formatEther(deposit)} zkLTC`);

  const tx = await escrow.createJob(
    agentAddress,
    rate,
    "ChainAnalyst: publish recurring LiteForge network health reports. Proof = keccak256(report).",
    { value: deposit }
  );
  const receipt = await tx.wait();

  const ev = receipt.logs
    .map((l) => { try { return escrow.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "JobCreated");
  console.log(`✅ Job #${ev.args.jobId} created — tx ${receipt.hash}`);
  console.log(`Run the agent: node agent/agent.js ${ev.args.jobId}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
