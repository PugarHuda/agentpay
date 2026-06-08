/**
 * On-chain QA for the live AgentEscrowV3 — verifies stake/slash invariants.
 * Usage: node scripts/qa-v3.js
 */
require("dotenv").config();
const { ethers } = require("ethers");

const RPC = "https://liteforge.rpc.caldera.xyz/http";
const BURN = "0x000000000000000000000000000000000000dEaD";
const ABI = [
  "function nextJobId() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "function disputeWindow() view returns (uint64)",
  "function jobs(uint256) view returns (address client, address agent, uint256 ratePerTask, uint256 balance, uint256 reserved, uint256 tasksPaid, uint256 stake, uint256 slashPerReject, uint64 lastSubmitAt, bool active, bool accepted, string spec)",
  "function taskCount(uint256) view returns (uint256)",
  "function getTasks(uint256, uint256, uint256) view returns (tuple(address agent, uint256 payout, uint64 submittedAt, uint64 claimableAt, uint8 status, bytes32 workHash, string summary)[])",
  "event TaskPaid(uint256 indexed jobId, uint256 indexed taskId, address indexed agent, uint256 payout, bytes32 workHash, string summary)",
  "event TaskRejected(uint256 indexed jobId, uint256 indexed taskId, string reason, uint256 slashed)",
  "event JobAccepted(uint256 indexed jobId, address indexed agent, uint256 stake)",
];

let fail = 0;
const ok = (c, label, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};
const f = (w) => ethers.formatEther(w);

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const addr = process.env.ESCROW_V3_ADDRESS;
  const c = new ethers.Contract(addr, ABI, provider);
  const fromBlock = 16922745;
  console.log(`QA AgentEscrowV3 ${addr} (window ${await c.disputeWindow()}s)\n`);

  ok((await provider.getCode(addr)) !== "0x", "contract bytecode exists");

  const n = Number(await c.nextJobId());
  let sumFree = 0n, sumReserved = 0n, sumStake = 0n, sumPaidExpected = 0n;
  for (let i = 0; i < n; i++) {
    const j = await c.jobs(i);
    const tasks = await c.getTasks(i, 0, 500);
    const pending = tasks.filter((t) => Number(t.status) === 0).length;
    const paid = tasks.filter((t) => Number(t.status) === 1).length;
    // reserved must equal pending * rate
    ok(j.reserved === BigInt(pending) * j.ratePerTask, `job #${i}: reserved == pending*rate`, `${f(j.reserved)} / ${pending} pending`);
    // tasksPaid must equal count of Paid tasks
    ok(BigInt(paid) === j.tasksPaid, `job #${i}: tasksPaid == Paid task count`, `${paid}`);
    sumFree += j.balance;
    sumReserved += j.reserved;
    sumStake += j.stake;
    sumPaidExpected += j.tasksPaid * j.ratePerTask;
    console.log(`   job #${i}: stake ${f(j.stake)} slash/rej ${f(j.slashPerReject)} accepted=${j.accepted} paid=${paid} pending=${pending}`);
  }

  // conservation: contract balance == free + reserved + stake (burned funds have left)
  const bal = await provider.getBalance(addr);
  ok(bal === sumFree + sumReserved + sumStake, "conservation: balance == Σ(free + reserved + stake)", `${f(bal)} == ${f(sumFree + sumReserved + sumStake)}`);

  // payouts
  const paidEvents = await c.queryFilter(c.filters.TaskPaid(), fromBlock, "latest");
  const paidSum = paidEvents.reduce((s, e) => s + e.args.payout, 0n);
  ok(paidSum === sumPaidExpected, "Σ TaskPaid payouts == Σ(tasksPaid*rate)", `${f(paidSum)}`);

  // slash / burn accounting
  const rejEvents = await c.queryFilter(c.filters.TaskRejected(), fromBlock, "latest");
  const slashSum = rejEvents.reduce((s, e) => s + e.args.slashed, 0n);
  const totalBurned = await c.totalBurned();
  ok(slashSum === totalBurned, "Σ TaskRejected.slashed == totalBurned()", `${f(totalBurned)}`);
  const burnBal = await provider.getBalance(BURN);
  ok(burnBal >= totalBurned, "burn address holds at least totalBurned", `${f(burnBal)}`);
  console.log(`   ${rejEvents.length} rejection(s), ${f(totalBurned)} zkLTC slashed & burned`);

  // accepted jobs must have a positive stake recorded via JobAccepted
  const accepted = await c.queryFilter(c.filters.JobAccepted(), fromBlock, "latest");
  ok(accepted.every((e) => e.args.stake > 0n), "every JobAccepted recorded a positive stake", `${accepted.length} accepts`);

  console.log(`\n${fail === 0 ? "✅ ALL V3 ON-CHAIN CHECKS PASSED" : `❌ ${fail} FAILED`}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
