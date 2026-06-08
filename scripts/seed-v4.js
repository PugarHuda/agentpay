/**
 * Seed AgentEscrowV4 (arbitration) showing the fix to the malicious-client issue:
 *   - PriceOracle: agent does GOOD work, client WRONGLY rejects, agent disputes,
 *     neutral arbiter rules FOR THE AGENT → agent paid, stake intact (THE FIX).
 *   - CopyBot: agent submits garbage, client rejects, agent disputes, arbiter
 *     rules FOR THE CLIENT → slashed (arbitration also upholds honest rejections).
 *   plus an approved task and a pending one for variety.
 *
 * Usage: node scripts/seed-v4.js [--force]
 * Env: PRIVATE_KEY (client), ESCROW_V4_ADDRESS, OPENROUTER_API_KEY
 */
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC = "https://liteforge.rpc.caldera.xyz/http";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";

const ABI = [
  "function nextJobId() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "function createJob(address agent, address arbiter, uint256 ratePerTask, uint256 slashPerReject, uint256 minStake, string spec) payable returns (uint256)",
  "function acceptJob(uint256 jobId) payable",
  "function submitTask(uint256 jobId, bytes32 workHash, string summary) returns (uint256)",
  "function approveTask(uint256 jobId, uint256 taskId)",
  "function rejectTask(uint256 jobId, uint256 taskId, string reason)",
  "function disputeRejection(uint256 jobId, uint256 taskId)",
  "function resolveDispute(uint256 jobId, uint256 taskId, bool agentWon)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed agent, address arbiter, uint256 ratePerTask, uint256 deposit, uint256 slashPerReject, uint256 minStake, string spec)",
  "event TaskSubmitted(uint256 indexed jobId, uint256 indexed taskId, address indexed agent, uint256 payout, bytes32 workHash, string summary, uint64 claimableAt)",
];

async function work(provider, spec, n, name) {
  const block = await provider.getBlock("latest");
  const snap = { blockNumber: block.number };
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "x-title": `AgentPay ${name}` },
      body: JSON.stringify({ model: MODEL, max_tokens: 360, messages: [
        { role: "system", content: `You are ${name} on AgentPay (LiteForge). Do exactly: "${spec}". Under 100 words.` },
        { role: "user", content: `Deliverable #${n}. Chain: ${JSON.stringify(snap)}` }] }),
    });
    if (res.ok) { const d = await res.json(); const t = d.choices?.[0]?.message?.content; if (t) return t; }
    throw 0;
  } catch { return `${name} deliverable #${n} @ block ${snap.blockNumber} (fallback)`; }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const client = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const escrow = new ethers.Contract(process.env.ESCROW_V4_ADDRESS, ABI, client);
  if (Number(await escrow.nextJobId()) >= 2 && !process.argv.includes("--force")) {
    return console.log("Already seeded. Use --force.");
  }

  // a single neutral arbiter for the demo (persisted + gas-funded)
  const arbiter = ethers.Wallet.createRandom().connect(provider);
  await (await client.sendTransaction({ to: arbiter.address, value: ethers.parseEther("0.0006") })).wait();
  console.log(`⚖️  neutral arbiter: ${arbiter.address}`);

  const saved = [{ name: "arbiter", address: arbiter.address, privateKey: arbiter.privateKey }];
  const mkAgent = async (name, stake) => {
    const w = ethers.Wallet.createRandom().connect(provider);
    saved.push({ name, address: w.address, privateKey: w.privateKey });
    await (await client.sendTransaction({ to: w.address, value: ethers.parseEther(stake) + ethers.parseEther("0.0004") })).wait();
    return w;
  };
  const createJob = async (agent, rate, slash, minStake, deposit, spec) => {
    const rc = await (await escrow.createJob(agent.address, arbiter.address, ethers.parseEther(rate), ethers.parseEther(slash), ethers.parseEther(minStake), spec, { value: ethers.parseEther(deposit) })).wait();
    const ev = rc.logs.map((l) => { try { return escrow.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "JobCreated");
    console.log(`job #${Number(ev.args.jobId)} created (${spec.split(":")[0]})`);
    return Number(ev.args.jobId);
  };
  const submit = async (escAgent, jobId, spec, n, name) => {
    const report = await work(provider, spec, n, name);
    const rc = await (await escAgent.submitTask(jobId, ethers.keccak256(ethers.toUtf8Bytes(report)), `${name} deliverable #${n}`)).wait();
    const ev = rc.logs.map((l) => { try { return escAgent.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TaskSubmitted");
    return Number(ev.args.taskId);
  };

  // ===== PriceOracle: THE FIX — good work wrongly rejected, arbiter saves the agent
  console.log(`\n=== PriceOracle (false rejection → arbiter rules FOR AGENT) ===`);
  const po = await mkAgent("PriceOracle", "0.002");
  const poSpec = "PriceOracle: report a sanity-checked LiteForge gas/price summary";
  const poJob = await createJob(po, "0.0004", "0.0008", "0.0008", "0.0016", poSpec);
  await (await escrow.connect(po).acceptJob(poJob, { value: ethers.parseEther("0.002") })).wait();
  console.log(`   🔒 staked 0.002`);
  const t1 = await submit(escrow.connect(po), poJob, poSpec, 1, "PriceOracle");
  await (await escrow.approveTask(poJob, t1)).wait();
  console.log(`   ✅ task #${t1} APPROVED (good)`);
  const t2 = await submit(escrow.connect(po), poJob, poSpec, 2, "PriceOracle");
  await (await escrow.rejectTask(poJob, t2, "client claims it's wrong (but it isn't)")).wait();
  console.log(`   ❌ task #${t2} REJECTED by client (bogus)`);
  await (await escrow.connect(po).disputeRejection(poJob, t2)).wait();
  console.log(`   ⚖️  agent DISPUTED → escalated to arbiter`);
  await (await escrow.connect(arbiter).resolveDispute(poJob, t2, true)).wait();
  console.log(`   🏆 arbiter ruled FOR AGENT → agent PAID, stake intact (false rejection failed)`);
  await submit(escrow.connect(po), poJob, poSpec, 3, "PriceOracle");
  console.log(`   ⏳ task left PENDING`);

  // ===== CopyBot: garbage → rejected → disputed → arbiter upholds → slash
  console.log(`\n=== CopyBot (garbage → arbiter rules FOR CLIENT → slash) ===`);
  const cb = await mkAgent("CopyBot", "0.003");
  const cbSpec = "CopyBot: summarize recent LiteForge blocks for builders";
  const cbJob = await createJob(cb, "0.0004", "0.0008", "0.0008", "0.0016", cbSpec);
  await (await escrow.connect(cb).acceptJob(cbJob, { value: ethers.parseEther("0.003") })).wait();
  console.log(`   🔒 staked 0.003`);
  const c1 = await submit(escrow.connect(cb), cbJob, cbSpec, 1, "CopyBot");
  await (await escrow.rejectTask(cbJob, c1, "low-effort copy")).wait();
  await (await escrow.connect(cb).disputeRejection(cbJob, c1)).wait();
  const burnBefore = await escrow.totalBurned();
  await (await escrow.connect(arbiter).resolveDispute(cbJob, c1, false)).wait();
  const burnAfter = await escrow.totalBurned();
  console.log(`   ⚖️  arbiter ruled FOR CLIENT → SLASHED ${ethers.formatEther(burnAfter - burnBefore)} zkLTC`);

  fs.writeFileSync(path.join(__dirname, ".seed-agents-v4.json"), JSON.stringify(saved, null, 2));
  console.log(`\nDone. totalBurned ${ethers.formatEther(await escrow.totalBurned())} | client ${ethers.formatEther(await provider.getBalance(client.address))} zkLTC`);
}
main().catch((e) => { console.error(e); process.exit(1); });
