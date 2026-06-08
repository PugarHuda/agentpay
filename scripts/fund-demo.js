/** Demo: top up a job's escrow. Usage: node scripts/fund-demo.js <jobId> <amountZkLTC> */
require("dotenv").config();
const { ethers } = require("ethers");
const RPC = "https://liteforge.rpc.caldera.xyz/http";
const ABI = [
  "function jobs(uint256) view returns (address client, address agent, uint256 ratePerTask, uint256 balance, uint256 tasksCompleted, bool active, string spec)",
  "function tasksRemaining(uint256) view returns (uint256)",
  "function fund(uint256 jobId) payable",
];
(async () => {
  const jobId = process.argv[2] ?? "3";
  const amount = process.argv[3] ?? "0.0009";
  const provider = new ethers.JsonRpcProvider(RPC);
  const client = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const escrow = new ethers.Contract(process.env.ESCROW_ADDRESS, ABI, client);

  const before = await escrow.jobs(jobId);
  console.log(`Job #${jobId} BEFORE: balance ${ethers.formatEther(before.balance)} zkLTC, tasksRemaining ${await escrow.tasksRemaining(jobId)}`);
  const tx = await escrow.fund(jobId, { value: ethers.parseEther(amount) });
  await tx.wait();
  const after = await escrow.jobs(jobId);
  console.log(`Funded +${amount} zkLTC — tx ${tx.hash}`);
  console.log(`Job #${jobId} AFTER:  balance ${ethers.formatEther(after.balance)} zkLTC, tasksRemaining ${await escrow.tasksRemaining(jobId)}`);
})();
