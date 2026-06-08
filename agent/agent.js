/**
 * AgentPay autonomous worker — job-aware AI agent
 *
 * One agent binary that can work ANY job: it reads the job's `spec` straight
 * from the on-chain escrow and uses it as its task instructions. So the same
 * code does a "DeFi Sentinel" job differently from a "NewsDigest" job — the
 * contract itself tells the agent what to do.
 *
 *   1. Reads the job spec + live chain state from LiteForge
 *   2. Asks an LLM (via OpenRouter) to do the work described by the spec
 *   3. Hashes the output (keccak256) as verifiable proof-of-work
 *   4. Calls AgentEscrow.completeTask() — and gets paid zkLTC instantly
 *
 * Every task it completes is a real transaction on LiteForge, visible at
 * https://liteforge.explorer.caldera.xyz — watch the agent's balance grow.
 *
 * Usage: node agent/agent.js <jobId> [intervalSeconds]
 */
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = "https://liteforge.rpc.caldera.xyz/http";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";

const ESCROW_ABI = [
  "function jobs(uint256) view returns (address client, address agent, uint256 ratePerTask, uint256 balance, uint256 tasksCompleted, bool active, string spec)",
  "function tasksRemaining(uint256) view returns (uint256)",
  "function completeTask(uint256 jobId, bytes32 workHash, string summary)",
  "event TaskCompleted(uint256 indexed jobId, address indexed agent, uint256 taskIndex, uint256 payout, bytes32 workHash, string summary)",
];

async function getChainSnapshot(provider) {
  const [block, feeData, network] = await Promise.all([
    provider.getBlock("latest", true),
    provider.getFeeData(),
    provider.getNetwork(),
  ]);
  const lookback = Math.min(100, block.number);
  const prevBlock = await provider.getBlock(block.number - lookback);
  const blockTime = prevBlock
    ? (block.timestamp - prevBlock.timestamp) / Math.max(lookback, 1)
    : 0;
  return {
    chainId: Number(network.chainId),
    blockNumber: block.number,
    timestamp: new Date(block.timestamp * 1000).toISOString(),
    txCountLatestBlock: block.transactions.length,
    gasUsed: block.gasUsed.toString(),
    gasPriceGwei: ethers.formatUnits(feeData.gasPrice ?? 0n, "gwei"),
    avgBlockTimeSec: blockTime.toFixed(2),
  };
}

/** Do the work described by the job's on-chain spec, using live chain data. */
async function askLLM(spec, snapshot, taskIndex) {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "x-title": "AgentPay Agent",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content:
            "You are an autonomous AI agent earning zkLTC wages on AgentPay, running on LitVM LiteForge (Litecoin's first EVM rollup, chain ID 4441). " +
            "You have been hired for a specific job. Perform EXACTLY the task described in your job spec, using the live chain data provided. " +
            "Be concise, concrete and professional. End with one actionable takeaway. Keep it under 150 words.\n\n" +
            `YOUR JOB SPEC:\n"${spec}"`,
        },
        {
          role: "user",
          content: `Deliverable #${taskIndex}. Live LiteForge chain data:\n${JSON.stringify(snapshot, null, 2)}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`OpenRouter returned no content: ${JSON.stringify(data).slice(0, 300)}`);
  return text;
}

/** A short agent label derived from the job spec (text before the first colon). */
function agentLabel(spec) {
  const m = (spec || "").match(/^\s*([^:]{1,40}):/);
  return m ? m[1].trim() : "Agent";
}

async function main() {
  const jobId = process.argv[2];
  let intervalSec = Number(process.argv[3] ?? 30);
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) intervalSec = 30;
  if (jobId === undefined) {
    console.error("Usage: node agent/agent.js <jobId> [intervalSeconds]");
    process.exit(1);
  }
  for (const k of ["AGENT_PRIVATE_KEY", "OPENROUTER_API_KEY", "ESCROW_ADDRESS"]) {
    if (!process.env[k]) {
      console.error(`Missing ${k} in .env`);
      process.exit(1);
    }
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const escrow = new ethers.Contract(process.env.ESCROW_ADDRESS, ESCROW_ABI, wallet);
  const outDir = path.join(__dirname, "outputs");
  fs.mkdirSync(outDir, { recursive: true });

  // read the job once up front so we can announce what this agent will do
  const initialJob = await escrow.jobs(jobId);
  const label = agentLabel(initialJob.spec);
  console.log(`🤖 ${label} online — agent wallet ${wallet.address}`);
  console.log(`   Job #${jobId} on escrow ${process.env.ESCROW_ADDRESS}`);
  console.log(`   Spec: "${initialJob.spec}"\n`);
  if (initialJob.agent.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(
      `❌ This wallet is not the agent for job #${jobId} (job agent: ${initialJob.agent}). completeTask would revert.`
    );
    process.exit(1);
  }

  // keep running until the escrow runs dry — the agent works for as long as
  // it's paid, and shrugs off transient RPC/LLM failures instead of dying
  let consecutiveFailures = 0;
  for (;;) {
    try {
      const done = await runOneTask(provider, escrow, jobId, outDir);
      consecutiveFailures = 0;
      if (done) break;
    } catch (err) {
      consecutiveFailures++;
      const backoff = Math.min(intervalSec * 2 ** consecutiveFailures, 300);
      console.error(`⚠️  Task attempt failed (${err.message?.slice(0, 140)}) — retry in ${backoff}s (failure ${consecutiveFailures})`);
      await new Promise((r) => setTimeout(r, backoff * 1000));
      continue;
    }
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}

/** Runs one work-and-get-paid cycle. Returns true when the job is done. */
async function runOneTask(provider, escrow, jobId, outDir) {
  const remaining = await escrow.tasksRemaining(jobId);
  if (remaining === 0n) {
    console.log("💤 Escrow exhausted or job closed — agent stops working. Top up to resume.");
    return true;
  }

  const job = await escrow.jobs(jobId);
  const taskIndex = Number(job.tasksCompleted) + 1;
  const label = agentLabel(job.spec);
  console.log(`📊 ${label} task #${taskIndex} — gathering live chain data...`);
  const snapshot = await getChainSnapshot(provider);

  console.log(`🧠 Working the job spec via ${MODEL}...`);
  const report = await askLLM(job.spec, snapshot, taskIndex);
  const workHash = ethers.keccak256(ethers.toUtf8Bytes(report));

  const summary = `${label} deliverable #${taskIndex} @ block ${snapshot.blockNumber}`;
  console.log(`⛓️  Submitting completeTask (workHash ${workHash.slice(0, 18)}…)...`);
  const tx = await escrow.completeTask(jobId, workHash, summary);
  const receipt = await tx.wait();

  const outFile = path.join(outDir, `report-${taskIndex}.md`);
  fs.writeFileSync(
    outFile,
    `# ${summary}\n\n- tx: https://liteforge.explorer.caldera.xyz/tx/${receipt.hash}\n- workHash: ${workHash}\n\n${report}\n`
  );

  const agentAddress = await escrow.runner.getAddress();
  const balance = await provider.getBalance(agentAddress);
  console.log(`✅ Paid ${ethers.formatEther(job.ratePerTask)} zkLTC — tx ${receipt.hash}`);
  console.log(`💰 Agent balance: ${ethers.formatEther(balance)} zkLTC | report saved: ${outFile}\n`);
  return false;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
