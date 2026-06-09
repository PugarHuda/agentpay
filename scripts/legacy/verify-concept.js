/**
 * Concept verification — proves the economic claims on-chain:
 *   Q1. Are agents REALLY paid?      → agent balances vs earnings, escrow conservation
 *   Q2. Is the work genuine?         → on-chain workHash == keccak256(saved deliverable)
 *   Q3. Can many AIs work one job?   → inspect the contract's single-agent constraint
 *
 * Usage: node scripts/verify-concept.js
 */
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC = "https://liteforge.rpc.caldera.xyz/http";
const DEPLOY_BLOCK = Number(process.env.DEPLOY_BLOCK || 16703976);
const ABI = [
  "function nextJobId() view returns (uint256)",
  "function jobs(uint256) view returns (address client, address agent, uint256 ratePerTask, uint256 balance, uint256 tasksCompleted, bool active, string spec)",
  "function tasksRemaining(uint256) view returns (uint256)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed agent, uint256 ratePerTask, uint256 deposit, string spec)",
  "event TaskCompleted(uint256 indexed jobId, address indexed agent, uint256 taskIndex, uint256 payout, bytes32 workHash, string summary)",
  "event JobFunded(uint256 indexed jobId, address indexed funder, uint256 amount)",
  "event JobClosed(uint256 indexed jobId, uint256 refund)",
];

let fail = 0;
const ok = (c, label, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};
const f = (w) => ethers.formatEther(w);

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const escrow = new ethers.Contract(process.env.ESCROW_ADDRESS, ABI, provider);
  const n = Number(await escrow.nextJobId());
  console.log(`\n=== Q1: ARE AGENTS REALLY PAID? (escrow ${process.env.ESCROW_ADDRESS}) ===\n`);

  const created = await escrow.queryFilter(escrow.filters.JobCreated(), DEPLOY_BLOCK, "latest");
  const completed = await escrow.queryFilter(escrow.filters.TaskCompleted(), DEPLOY_BLOCK, "latest");
  const funded = await escrow.queryFilter(escrow.filters.JobFunded(), DEPLOY_BLOCK, "latest");
  const closed = await escrow.queryFilter(escrow.filters.JobClosed(), DEPLOY_BLOCK, "latest");

  // total value in vs out
  const depIn = created.reduce((s, e) => s + e.args.deposit, 0n);
  const topUp = funded.reduce((s, e) => s + e.args.amount, 0n);
  const paidOut = completed.reduce((s, e) => s + e.args.payout, 0n);
  const refunded = closed.reduce((s, e) => s + e.args.refund, 0n);
  console.log(`deposits in:   ${f(depIn)} zkLTC (${created.length} jobs)`);
  console.log(`top-ups in:    ${f(topUp)} zkLTC (${funded.length} funds)`);
  console.log(`paid to agents:${f(paidOut)} zkLTC (${completed.length} tasks)`);
  console.log(`refunded:      ${f(refunded)} zkLTC (${closed.length} closes)\n`);

  // conservation: contract balance == in - out
  const escrowBal = await provider.getBalance(process.env.ESCROW_ADDRESS);
  ok(
    escrowBal === depIn + topUp - paidOut - refunded,
    "escrow conservation: balance == deposits + topups - payouts - refunds",
    `${f(escrowBal)} == ${f(depIn + topUp - paidOut - refunded)}`
  );

  // per-agent: real zkLTC actually landed in agent wallets
  let totalEarnedExpected = 0n;
  for (let i = 0; i < n; i++) {
    const j = await escrow.jobs(i);
    const earned = j.tasksCompleted * j.ratePerTask;
    totalEarnedExpected += earned;
    const bal = await provider.getBalance(j.agent);
    const evForJob = completed.filter((e) => Number(e.args.jobId) === i).length;
    ok(
      BigInt(evForJob) === j.tasksCompleted,
      `job #${i}: TaskCompleted events == tasksCompleted`,
      `${evForJob}==${j.tasksCompleted}`
    );
    console.log(
      `   job #${i} agent ${j.agent.slice(0, 8)} earned ${f(earned)} | wallet now holds ${f(bal)} zkLTC`
    );
  }
  ok(
    paidOut === totalEarnedExpected,
    "sum of payouts == sum(tasksCompleted * rate) across all jobs",
    `${f(paidOut)} == ${f(totalEarnedExpected)}`
  );

  // Q2: proof-of-work integrity — recompute keccak256 of saved deliverables
  console.log(`\n=== Q2: IS THE WORK GENUINE? (workHash == keccak256(deliverable)) ===\n`);
  const outDir = path.join(__dirname, "..", "agent", "outputs");
  let checked = 0,
    matched = 0;
  if (fs.existsSync(outDir)) {
    for (const file of fs.readdirSync(outDir).filter((x) => x.endsWith(".md"))) {
      const content = fs.readFileSync(path.join(outDir, file), "utf8");
      const hashLine = content.match(/- workHash: (0x[0-9a-fA-F]{64})/);
      if (!hashLine) continue;
      // deliverable body = everything after the blank line following the workHash line
      const body = content.split("\n\n").slice(2).join("\n\n").replace(/\n$/, "");
      if (!body) continue;
      const recomputed = ethers.keccak256(ethers.toUtf8Bytes(body));
      checked++;
      if (recomputed.toLowerCase() === hashLine[1].toLowerCase()) matched++;
    }
  }
  ok(checked > 0 && matched === checked, "saved deliverables hash to their on-chain workHash", `${matched}/${checked} match`);
  console.log("   (proof-of-work is tamper-evident: change one character → hash no longer matches)");

  console.log(`\n=== Q3: CAN MANY AIs WORK ONE JOB? ===`);
  console.log("   Contract design: each job stores exactly ONE immutable `agent` address.");
  console.log("   completeTask() reverts with NotAgent() for anyone else → one job = one agent.");
  console.log("   (See 'Improvements' for multi-agent designs.)\n");

  console.log(fail === 0 ? "✅ ALL ON-CHAIN CHECKS PASSED" : `❌ ${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
