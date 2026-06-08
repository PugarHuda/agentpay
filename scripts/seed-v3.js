/**
 * Seed AgentEscrowV3 (stake & slashing) with the full lifecycle:
 *   - AuditBot   : agent stakes, 1 task APPROVED + 1 garbage task REJECTED → SLASHED
 *   - TrendScout : agent stakes, 1 task CLAIMED after window + 1 left PENDING
 *
 * Shows on-chain: acceptJob (stake), approve, reject+slash(burn), claim, pending.
 * Usage: node scripts/seed-v3.js [--force]
 * Env: PRIVATE_KEY (client), ESCROW_V3_ADDRESS, OPENROUTER_API_KEY
 */
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC = "https://liteforge.rpc.caldera.xyz/http";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";

const ABI = [
  "function disputeWindow() view returns (uint64)",
  "function nextJobId() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "function createJob(address agent, uint256 ratePerTask, uint256 slashPerReject, uint256 minStake, string spec) payable returns (uint256)",
  "function acceptJob(uint256 jobId) payable",
  "function submitTask(uint256 jobId, bytes32 workHash, string summary) returns (uint256)",
  "function approveTask(uint256 jobId, uint256 taskId)",
  "function rejectTask(uint256 jobId, uint256 taskId, string reason)",
  "function claimTask(uint256 jobId, uint256 taskId)",
  "function isClaimable(uint256, uint256) view returns (bool)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed agent, uint256 ratePerTask, uint256 deposit, uint256 slashPerReject, uint256 minStake, string spec)",
  "event TaskSubmitted(uint256 indexed jobId, uint256 indexed taskId, address indexed agent, uint256 payout, bytes32 workHash, string summary, uint64 claimableAt)",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function work(provider, spec, n, name) {
  const block = await provider.getBlock("latest");
  const snap = { blockNumber: block.number, gasUsed: block.gasUsed.toString() };
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "x-title": `AgentPay ${name}` },
      body: JSON.stringify({ model: MODEL, max_tokens: 380, messages: [
        { role: "system", content: `You are ${name} on AgentPay (LiteForge). Do exactly: "${spec}". Under 100 words, end with a takeaway.` },
        { role: "user", content: `Deliverable #${n}. Chain: ${JSON.stringify(snap)}` }] }),
    });
    if (res.ok) { const d = await res.json(); const t = d.choices?.[0]?.message?.content; if (t) return t; }
    throw new Error("llm");
  } catch { return `${name} deliverable #${n} @ block ${snap.blockNumber} (fallback)`; }
}

async function submit(provider, escrowAsAgent, jobId, spec, n, name) {
  const report = await work(provider, spec, n, name);
  const workHash = ethers.keccak256(ethers.toUtf8Bytes(report));
  const rc = await (await escrowAsAgent.submitTask(jobId, workHash, `${name} deliverable #${n}`)).wait();
  const ev = rc.logs.map((l) => { try { return escrowAsAgent.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TaskSubmitted");
  console.log(`   submitted task #${Number(ev.args.taskId)} (${name} #${n})`);
  return Number(ev.args.taskId);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const client = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const escrow = new ethers.Contract(process.env.ESCROW_V3_ADDRESS, ABI, client);
  const win = Number(await escrow.disputeWindow());
  const start = Number(await escrow.nextJobId());
  console.log(`AgentEscrowV3 ${process.env.ESCROW_V3_ADDRESS} (window ${win}s) nextJobId=${start}`);
  if (start >= 2 && !process.argv.includes("--force")) { console.log("Already seeded. Use --force."); return; }

  const saved = [];
  // fund the agent with its stake + a little gas (the stake is paid from the agent wallet)
  const mkAgent = async (name, stake) => {
    const w = ethers.Wallet.createRandom().connect(provider);
    saved.push({ name, address: w.address, privateKey: w.privateKey });
    const value = ethers.parseEther(stake) + ethers.parseEther("0.0004");
    await (await client.sendTransaction({ to: w.address, value })).wait();
    return w;
  };
  const createJob = async (agent, rate, slash, minStake, deposit, spec) => {
    const rc = await (await escrow.createJob(agent.address, ethers.parseEther(rate), ethers.parseEther(slash), ethers.parseEther(minStake), spec, { value: ethers.parseEther(deposit) })).wait();
    const ev = rc.logs.map((l) => { try { return escrow.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "JobCreated");
    console.log(`job #${Number(ev.args.jobId)} created (${spec.split(":")[0]}, slash ${slash})`);
    return Number(ev.args.jobId);
  };

  // ---- TrendScout first (its claim task needs the window to elapse)
  console.log(`\n=== TrendScout (stake → claim + pending) ===`);
  const tsAgent = await mkAgent("TrendScout", "0.002");
  const tsSpec = "TrendScout: surface notable LiteForge on-chain trends for builders";
  const tsJob = await createJob(tsAgent, "0.0003", "0.0006", "0.0006", "0.0012", tsSpec);
  await (await escrow.connect(tsAgent).acceptJob(tsJob, { value: ethers.parseEther("0.002") })).wait();
  console.log(`   🔒 agent STAKED 0.002 zkLTC (acceptJob)`);
  const tsClaim = await submit(provider, escrow.connect(tsAgent), tsJob, tsSpec, 1, "TrendScout");
  const claimDeadline = Date.now() + (win + 8) * 1000;

  // ---- AuditBot: stake → approve one, reject (slash) one
  console.log(`\n=== AuditBot (stake → approve + REJECT/SLASH) ===`);
  const abAgent = await mkAgent("AuditBot", "0.003");
  const abSpec = "AuditBot: review recent contract events and flag anomalies";
  const abJob = await createJob(abAgent, "0.0004", "0.0008", "0.0008", "0.0016", abSpec);
  await (await escrow.connect(abAgent).acceptJob(abJob, { value: ethers.parseEther("0.003") })).wait();
  console.log(`   🔒 agent STAKED 0.003 zkLTC`);
  const abGood = await submit(provider, escrow.connect(abAgent), abJob, abSpec, 1, "AuditBot");
  await (await escrow.approveTask(abJob, abGood)).wait();
  console.log(`   ✅ client APPROVED task #${abGood} — agent paid`);
  const abBad = await submit(provider, escrow.connect(abAgent), abJob, abSpec, 2, "AuditBot");
  const burnBefore = await escrow.totalBurned();
  await (await escrow.rejectTask(abJob, abBad, "fabricated finding — slashing")).wait();
  const burnAfter = await escrow.totalBurned();
  console.log(`   ❌ client REJECTED task #${abBad} → SLASHED & BURNED ${ethers.formatEther(burnAfter - burnBefore)} zkLTC from stake`);

  // ---- TrendScout: leave a pending task, then claim the first after window
  await submit(provider, escrow.connect(tsAgent), tsJob, tsSpec, 2, "TrendScout");
  console.log(`   ⏳ TrendScout task left PENDING`);
  const waitMs = claimDeadline - Date.now();
  if (waitMs > 0) { console.log(`\n⏲️  waiting ${Math.ceil(waitMs / 1000)}s for TrendScout claim window...`); await sleep(waitMs); }
  if (await escrow.isClaimable(tsJob, tsClaim)) {
    await (await escrow.connect(tsAgent).claimTask(tsJob, tsClaim)).wait();
    console.log(`   💰 agent CLAIMED task #${tsClaim} after window (optimistic)`);
  }

  fs.writeFileSync(path.join(__dirname, ".seed-agents-v3.json"), JSON.stringify(saved, null, 2));
  console.log(`\nDone. totalBurned: ${ethers.formatEther(await escrow.totalBurned())} zkLTC | client: ${ethers.formatEther(await provider.getBalance(client.address))} zkLTC`);
}

main().catch((e) => { console.error(e); process.exit(1); });
