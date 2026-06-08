/**
 * On-chain QA for the live AgentEscrowV4 — verifies the arbitration invariants.
 * Usage: node scripts/qa-v4.js
 */
require("dotenv").config();
const { ethers } = require("ethers");

const RPC = "https://liteforge.rpc.caldera.xyz/http";
const BURN = "0x000000000000000000000000000000000000dEaD";
const ABI = [
  "function nextJobId() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "function jobs(uint256) view returns (address client, address agent, address arbiter, uint256 ratePerTask, uint256 balance, uint256 reserved, uint256 tasksPaid, uint256 stake, uint256 slashPerReject, uint256 minStake, uint256 unresolved, uint64 lastSubmitAt, bool active, bool accepted, string spec)",
  "function getTasks(uint256, uint256, uint256) view returns (tuple(address agent, uint256 payout, uint64 submittedAt, uint64 claimableAt, uint64 rejectedAt, uint8 status, bytes32 workHash, string summary)[])",
  "event TaskPaid(uint256 indexed jobId, uint256 indexed taskId, address indexed agent, uint256 payout, bytes32 workHash, string summary)",
  "event DisputeResolved(uint256 indexed jobId, uint256 indexed taskId, bool agentWon, uint256 slashed)",
  "event RejectionFinalized(uint256 indexed jobId, uint256 indexed taskId, uint256 slashed)",
];

let fail = 0;
const ok = (c, label, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};
const f = (w) => ethers.formatEther(w);

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const addr = process.env.ESCROW_V4_ADDRESS;
  const c = new ethers.Contract(addr, ABI, provider);
  const from = 16938018;
  console.log(`QA AgentEscrowV4 ${addr}\n`);
  ok((await provider.getCode(addr)) !== "0x", "contract bytecode exists");

  const n = Number(await c.nextJobId());
  let sumFree = 0n, sumReserved = 0n, sumStake = 0n, paidExpected = 0n;
  for (let i = 0; i < n; i++) {
    const j = await c.jobs(i);
    const tasks = await c.getTasks(i, 0, 500);
    const held = tasks.filter((t) => [0, 2, 3].includes(Number(t.status))).length; // reserved holders
    const paid = tasks.filter((t) => Number(t.status) === 1).length;
    ok(j.reserved === BigInt(held) * j.ratePerTask, `job #${i}: reserved == (pending+proposed+disputed)*rate`, `${f(j.reserved)} / ${held}`);
    ok(j.unresolved === BigInt(held), `job #${i}: unresolved == non-final task count`, `${j.unresolved}`);
    ok(BigInt(paid) === j.tasksPaid, `job #${i}: tasksPaid == Paid count`, `${paid}`);
    sumFree += j.balance;
    sumReserved += j.reserved;
    sumStake += j.stake;
    paidExpected += j.tasksPaid * j.ratePerTask;
    console.log(`   job #${i}: arbiter ${j.arbiter.slice(0, 8)} stake ${f(j.stake)} paid=${paid} held=${held}`);
  }

  const bal = await provider.getBalance(addr);
  ok(bal === sumFree + sumReserved + sumStake, "conservation: balance == Σ(free + reserved + stake)", `${f(bal)} == ${f(sumFree + sumReserved + sumStake)}`);

  const paidEv = await c.queryFilter(c.filters.TaskPaid(), from, "latest");
  ok(paidEv.reduce((s, e) => s + e.args.payout, 0n) === paidExpected, "Σ TaskPaid == Σ(tasksPaid*rate)", `${f(paidExpected)}`);

  // arbitration: agent-won disputes burn nothing; client-won + finalized burn
  const resolved = await c.queryFilter(c.filters.DisputeResolved(), from, "latest");
  const finalized = await c.queryFilter(c.filters.RejectionFinalized(), from, "latest");
  const agentWins = resolved.filter((e) => e.args.agentWon);
  ok(agentWins.every((e) => e.args.slashed === 0n), "arbiter ruling FOR AGENT slashes nothing (the fix)", `${agentWins.length} agent win(s)`);
  const slashFromResolve = resolved.reduce((s, e) => s + e.args.slashed, 0n);
  const slashFromFinal = finalized.reduce((s, e) => s + e.args.slashed, 0n);
  const totalBurned = await c.totalBurned();
  ok(slashFromResolve + slashFromFinal === totalBurned, "Σ slashed (resolve+finalize) == totalBurned()", `${f(totalBurned)}`);
  ok((await provider.getBalance(BURN)) >= totalBurned, "burn address holds >= totalBurned");
  console.log(`   ${resolved.length} dispute(s) resolved (${agentWins.length} for agent), ${finalized.length} finalized, ${f(totalBurned)} burned`);

  console.log(`\n${fail === 0 ? "✅ ALL V4 ON-CHAIN CHECKS PASSED" : `❌ ${fail} FAILED`}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
