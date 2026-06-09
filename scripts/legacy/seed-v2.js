/**
 * Seed AgentEscrowV2 with the full optimistic lifecycle so the dashboard shows
 * every state:
 *   - DocBot     : 2 tasks, both APPROVED by the client (paid on acceptance)
 *   - DataMiner  : 2 tasks, 1 APPROVED + 1 REJECTED (client refused bad work)
 *   - ReportGen  : 1 task left PENDING (in dispute window) + 1 CLAIMED after the
 *                  window elapsed (optimistic release, client stayed silent)
 *
 * Usage: node scripts/seed-v2.js [--force]
 * Env: PRIVATE_KEY (client), ESCROW_V2_ADDRESS, OPENROUTER_API_KEY
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
  "function jobs(uint256) view returns (address client, address agent, uint256 ratePerTask, uint256 balance, uint256 reserved, uint256 tasksPaid, uint64 lastSubmitAt, bool active, string spec)",
  "function createJob(address agent, uint256 ratePerTask, string spec) payable returns (uint256)",
  "function submitTask(uint256 jobId, bytes32 workHash, string summary) returns (uint256)",
  "function approveTask(uint256 jobId, uint256 taskId)",
  "function rejectTask(uint256 jobId, uint256 taskId, string reason)",
  "function claimTask(uint256 jobId, uint256 taskId)",
  "function isClaimable(uint256, uint256) view returns (bool)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed agent, uint256 ratePerTask, uint256 deposit, string spec)",
  "event TaskSubmitted(uint256 indexed jobId, uint256 indexed taskId, address indexed agent, uint256 payout, bytes32 workHash, string summary, uint64 claimableAt)",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function work(provider, spec, n, name) {
  const block = await provider.getBlock("latest");
  const snap = { blockNumber: block.number, gasUsed: block.gasUsed.toString(), ts: new Date(block.timestamp * 1000).toISOString() };
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "x-title": `AgentPay ${name}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 420,
        messages: [
          { role: "system", content: `You are ${name}, an AI agent on AgentPay (LiteForge). Do exactly this: "${spec}". Under 110 words, concrete, end with a takeaway.` },
          { role: "user", content: `Deliverable #${n}. Chain data: ${JSON.stringify(snap)}` },
        ],
      }),
    });
    if (res.ok) {
      const d = await res.json();
      const t = d.choices?.[0]?.message?.content;
      if (t) return t;
    }
    throw new Error("llm");
  } catch {
    return `${name} deliverable #${n} @ block ${snap.blockNumber}: completed per spec "${spec}". (fallback)`;
  }
}

async function submit(provider, escrowAsAgent, jobId, spec, n, name) {
  const report = await work(provider, spec, n, name);
  const workHash = ethers.keccak256(ethers.toUtf8Bytes(report));
  const tx = await escrowAsAgent.submitTask(jobId, workHash, `${name} deliverable #${n}`);
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return escrowAsAgent.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TaskSubmitted");
  console.log(`   submitted task #${Number(ev.args.taskId)} (${name} #${n}) — tx ${rc.hash}`);
  return Number(ev.args.taskId);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const client = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const escrow = new ethers.Contract(process.env.ESCROW_V2_ADDRESS, ABI, client);
  const win = Number(await escrow.disputeWindow());
  const start = Number(await escrow.nextJobId());
  console.log(`AgentEscrowV2 ${process.env.ESCROW_V2_ADDRESS} (disputeWindow ${win}s) nextJobId=${start}`);
  if (start >= 3 && !process.argv.includes("--force")) {
    console.log("Already seeded (nextJobId >= 3). Use --force to add more.");
    return;
  }

  const saved = [];
  const mkAgent = async (name) => {
    const w = ethers.Wallet.createRandom().connect(provider);
    saved.push({ name, address: w.address, privateKey: w.privateKey });
    await (await client.sendTransaction({ to: w.address, value: ethers.parseEther("0.0004") })).wait();
    return w;
  };
  const createJob = async (agent, rate, deposit, spec) => {
    const rc = await (await escrow.createJob(agent.address, ethers.parseEther(rate), spec, { value: ethers.parseEther(deposit) })).wait();
    const ev = rc.logs.map((l) => { try { return escrow.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "JobCreated");
    console.log(`job #${Number(ev.args.jobId)} created (${spec.split(":")[0]}) — tx ${rc.hash}`);
    return Number(ev.args.jobId);
  };

  // ---- start the CLAIM-demo task first so its window elapses while we do the rest
  console.log(`\n=== ReportGen (pending + optimistic claim) ===`);
  const repAgent = await mkAgent("ReportGen");
  const repSpec = "ReportGen: compile a concise LiteForge ecosystem status report";
  const repJob = await createJob(repAgent, "0.0004", "0.0016", repSpec);
  const repClaimTaskId = await submit(provider, escrow.connect(repAgent), repJob, repSpec, 1, "ReportGen"); // will be CLAIMED
  const claimDeadline = Date.now() + (win + 8) * 1000;

  // ---- DocBot: both approved
  console.log(`\n=== DocBot (both approved) ===`);
  const docAgent = await mkAgent("DocBot");
  const docSpec = "DocBot: generate developer API notes from recent contract activity";
  const docJob = await createJob(docAgent, "0.0003", "0.0012", docSpec);
  for (let i = 1; i <= 2; i++) {
    const tid = await submit(provider, escrow.connect(docAgent), docJob, docSpec, i, "DocBot");
    await (await escrow.approveTask(docJob, tid)).wait();
    console.log(`   ✅ client APPROVED task #${tid} — agent paid`);
  }

  // ---- DataMiner: approve one, reject one
  console.log(`\n=== DataMiner (approve + reject) ===`);
  const dmAgent = await mkAgent("DataMiner");
  const dmSpec = "DataMiner: extract and structure on-chain activity metrics";
  const dmJob = await createJob(dmAgent, "0.0003", "0.0012", dmSpec);
  const dmT1 = await submit(provider, escrow.connect(dmAgent), dmJob, dmSpec, 1, "DataMiner");
  await (await escrow.approveTask(dmJob, dmT1)).wait();
  console.log(`   ✅ client APPROVED task #${dmT1}`);
  const dmT2 = await submit(provider, escrow.connect(dmAgent), dmJob, dmSpec, 2, "DataMiner");
  await (await escrow.rejectTask(dmJob, dmT2, "incomplete — missing gas histogram")).wait();
  console.log(`   ❌ client REJECTED task #${dmT2} — refunded, agent unpaid`);

  // ---- ReportGen: leave one PENDING (in window), then CLAIM the first after window
  const repPendingTaskId = await submit(provider, escrow.connect(repAgent), repJob, repSpec, 2, "ReportGen");
  console.log(`   ⏳ task #${repPendingTaskId} left PENDING (awaiting review, in dispute window)`);

  const waitMs = claimDeadline - Date.now();
  if (waitMs > 0) {
    console.log(`\n⏲️  waiting ${Math.ceil(waitMs / 1000)}s for ReportGen task #${repClaimTaskId} dispute window to elapse...`);
    await sleep(waitMs);
  }
  if (await escrow.isClaimable(repJob, repClaimTaskId)) {
    await (await escrow.connect(repAgent).claimTask(repJob, repClaimTaskId)).wait();
    console.log(`   💰 agent CLAIMED task #${repClaimTaskId} after window — optimistic release, paid`);
  } else {
    console.log(`   (task #${repClaimTaskId} not yet claimable — window not elapsed)`);
  }

  fs.writeFileSync(path.join(__dirname, ".seed-agents-v2.json"), JSON.stringify(saved, null, 2));
  console.log(`\nDone. Client balance: ${ethers.formatEther(await provider.getBalance(client.address))} zkLTC`);
}

main().catch((e) => { console.error(e); process.exit(1); });
