/**
 * On-chain QA: verifies the deployed AgentEscrow state on LiteForge using the
 * exact same reads the frontend performs (jobs, tasksRemaining, queryFilter).
 * Usage: node scripts/qa-onchain.js
 */
require("dotenv").config();
const { ethers } = require("ethers");

const RPC_URL = "https://liteforge.rpc.caldera.xyz/http";
// scanning from genesis times out on the public RPC (16.7M+ blocks) — start at the deploy block
const DEPLOY_BLOCK = Number(process.env.DEPLOY_BLOCK || 16703976);
const ABI = [
  "function nextJobId() view returns (uint256)",
  "function jobs(uint256) view returns (address client, address agent, uint256 ratePerTask, uint256 balance, uint256 tasksCompleted, bool active, string spec)",
  "function tasksRemaining(uint256) view returns (uint256)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed agent, uint256 ratePerTask, uint256 deposit, string spec)",
  "event TaskCompleted(uint256 indexed jobId, address indexed agent, uint256 taskIndex, uint256 payout, bytes32 workHash, string summary)",
];

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const escrow = new ethers.Contract(process.env.ESCROW_ADDRESS, ABI, provider);
  const agentAddress = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY).address;

  console.log(`QA target: ${process.env.ESCROW_ADDRESS} (LiteForge ${(await provider.getNetwork()).chainId})\n`);

  // contract is actually deployed
  const code = await provider.getCode(process.env.ESCROW_ADDRESS);
  check("contract bytecode exists on-chain", code !== "0x", `${(code.length - 2) / 2} bytes`);

  // job state
  const nextJobId = await escrow.nextJobId();
  check("nextJobId >= 1", nextJobId >= 1n, `nextJobId=${nextJobId}`);

  const job = await escrow.jobs(0);
  check("job0 agent matches .env agent wallet", job.agent === agentAddress, job.agent);
  check("job0 is active", job.active === true);
  check("job0 has completed tasks", job.tasksCompleted > 0n, `tasksCompleted=${job.tasksCompleted}`);

  // accounting invariant: deposit = balance + payouts
  const created = await escrow.queryFilter(escrow.filters.JobCreated(0), DEPLOY_BLOCK, "latest");
  const completed = await escrow.queryFilter(escrow.filters.TaskCompleted(0), DEPLOY_BLOCK, "latest");
  const deposit = created[0].args.deposit;
  const paidOut = completed.reduce((s, e) => s + e.args.payout, 0n);
  check(
    "accounting invariant: deposit == balance + total payouts",
    deposit === job.balance + paidOut,
    `${ethers.formatEther(deposit)} == ${ethers.formatEther(job.balance)} + ${ethers.formatEther(paidOut)}`
  );
  check(
    "event count matches tasksCompleted",
    BigInt(completed.length) === job.tasksCompleted,
    `${completed.length} TaskCompleted events`
  );

  // tasksRemaining consistency
  const remaining = await escrow.tasksRemaining(0);
  check(
    "tasksRemaining == floor(balance / rate)",
    remaining === job.balance / job.ratePerTask,
    `remaining=${remaining}`
  );

  // task indexes are 1..N with no gaps
  const indexes = completed.map((e) => Number(e.args.taskIndex)).sort((a, b) => a - b);
  check(
    "task indexes are sequential 1..N",
    indexes.every((v, i) => v === i + 1),
    indexes.join(",")
  );

  // every event carries a non-zero workHash (proof-of-work log)
  check(
    "all TaskCompleted events carry a workHash",
    completed.every((e) => e.args.workHash !== ethers.ZeroHash)
  );

  // escrow contract balance covers all active job balances
  const escrowBalance = await provider.getBalance(process.env.ESCROW_ADDRESS);
  let totalJobBalances = 0n;
  for (let i = 0n; i < nextJobId; i++) {
    totalJobBalances += (await escrow.jobs(i)).balance;
  }
  check(
    "contract holds exactly the sum of job balances",
    escrowBalance === totalJobBalances,
    `${ethers.formatEther(escrowBalance)} zkLTC`
  );

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
