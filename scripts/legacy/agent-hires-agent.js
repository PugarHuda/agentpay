/**
 * Agent-to-agent commerce demo — the flagship AgentPay claim, proven on-chain.
 *
 * ChainAnalyst (agent #1) takes the zkLTC wages it EARNED and uses them to
 * hire a second agent ("PeerReviewer") through the same escrow contract:
 *   1. agent1 creates a job, escrowing its own earned zkLTC, naming agent2
 *   2. agent2 (a fresh wallet) peer-reviews agent1's latest report via the LLM
 *   3. agent2 submits completeTask and is paid by agent1's escrow
 *
 * Machine-to-machine commerce, settled in LTC-backed hard money, no human in
 * the payment loop.
 *
 * Usage: node scripts/agent-hires-agent.js
 * NOTE: stop agent/agent.js before running this — both sign with AGENT_PRIVATE_KEY
 * and concurrent txs from the same key can race on the nonce.
 */
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = "https://liteforge.rpc.caldera.xyz/http";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";

const ABI = [
  "function createJob(address agent, uint256 ratePerTask, string spec) payable returns (uint256)",
  "function completeTask(uint256 jobId, bytes32 workHash, string summary)",
  "function jobs(uint256) view returns (address client, address agent, uint256 ratePerTask, uint256 balance, uint256 tasksCompleted, bool active, string spec)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed agent, uint256 ratePerTask, uint256 deposit, string spec)",
];

async function askLLM(systemPrompt, userPrompt) {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "x-title": "AgentPay PeerReviewer",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter returned no content");
  return text;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const agent1 = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

  // agent2: create once, persist in .env
  let agent2;
  if (process.env.AGENT2_PRIVATE_KEY) {
    agent2 = new ethers.Wallet(process.env.AGENT2_PRIVATE_KEY, provider);
  } else {
    agent2 = ethers.Wallet.createRandom().connect(provider);
    const envPath = path.join(__dirname, "..", ".env");
    fs.appendFileSync(envPath, `\n# Second agent (hired BY agent #1 — agent-to-agent demo)\nAGENT2_PRIVATE_KEY=${agent2.privateKey}\n`);
    console.log(`Created PeerReviewer agent wallet: ${agent2.address}`);
  }

  const escrow1 = new ethers.Contract(process.env.ESCROW_ADDRESS, ABI, agent1);
  const escrow2 = escrow1.connect(agent2);

  const rate = ethers.parseEther("0.0005");
  const deposit = ethers.parseEther("0.002");

  console.log(`🤖 Agent #1 (ChainAnalyst) balance: ${ethers.formatEther(await provider.getBalance(agent1.address))} zkLTC (earned wages)`);
  console.log(`🤖 Agent #1 is hiring Agent #2 (PeerReviewer, ${agent2.address}) with its OWN earnings...\n`);

  // 1. agent1 escrows its earned zkLTC for agent2
  const tx1 = await escrow1.createJob(
    agent2.address,
    rate,
    "PeerReviewer: independently review ChainAnalyst's latest network report for accuracy. Hired BY an AI agent, paid FROM its on-chain earnings.",
    { value: deposit }
  );
  const receipt1 = await tx1.wait();
  const ev = receipt1.logs
    .map((l) => { try { return escrow1.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "JobCreated");
  if (!ev) throw new Error(`JobCreated event not found in receipt ${receipt1.hash}`);
  const jobId = ev.args.jobId;
  console.log(`💼 Job #${jobId} created by AGENT #1 — tx ${receipt1.hash}`);

  // 2. gas money for agent2 (one-time)
  if ((await provider.getBalance(agent2.address)) === 0n) {
    const gasTx = await agent1.sendTransaction({ to: agent2.address, value: ethers.parseEther("0.001") });
    await gasTx.wait();
    console.log(`⛽ Agent #1 sent gas money to Agent #2 — tx ${gasTx.hash}`);
  }

  // 3. agent2 does real LLM work: peer-review the latest report
  const outDir = path.join(__dirname, "..", "agent", "outputs");
  const reports = fs.existsSync(outDir)
    ? fs
        .readdirSync(outDir)
        .filter((f) => /^report-\d+\.md$/.test(f))
        .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10))
    : [];
  if (reports.length === 0) {
    throw new Error("No ChainAnalyst reports found in agent/outputs — run agent/agent.js first.");
  }
  const latestReport = fs.readFileSync(path.join(outDir, reports[reports.length - 1]), "utf8");

  console.log(`\n🧠 Agent #2 peer-reviewing "${reports[reports.length - 1]}" via ${MODEL}...`);
  const review = await askLLM(
    "You are PeerReviewer, an autonomous QA agent hired by another AI agent (ChainAnalyst) to independently review its network report. Assess accuracy, clarity, and internal consistency. Give a verdict (APPROVED/NEEDS-REVISION) with 2-3 bullet points. Under 120 words.",
    latestReport
  );
  const workHash = ethers.keccak256(ethers.toUtf8Bytes(review));

  const tx2 = await escrow2.completeTask(jobId, workHash, "Peer review of ChainAnalyst report — agent-to-agent task");
  const receipt2 = await tx2.wait();

  fs.writeFileSync(
    path.join(outDir, "peer-review-1.md"),
    `# Peer review (agent-to-agent) — job #${jobId}\n\n- hired by: agent #1 ${agent1.address} (from its earned wages)\n- worker: agent #2 ${agent2.address}\n- tx: https://liteforge.explorer.caldera.xyz/tx/${receipt2.hash}\n- workHash: ${workHash}\n\n${review}\n`
  );

  console.log(`✅ Agent #2 PAID by Agent #1's escrow — tx ${receipt2.hash}`);
  console.log(`💰 Agent #2 balance: ${ethers.formatEther(await provider.getBalance(agent2.address))} zkLTC`);
  console.log(`\n🔗 Full machine-to-machine economy on-chain:`);
  console.log(`   human → agent1 (job #0) → agent2 (job #${jobId}) — all in LTC-backed zkLTC.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
