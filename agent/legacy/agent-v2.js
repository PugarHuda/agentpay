/**
 * AgentPay V2 autonomous worker — optimistic escrow
 *
 * Under V2 the agent isn't paid on submit. It:
 *   1. claims any of its own pending tasks whose dispute window has elapsed
 *      (optimistic release — paid unless the client rejected in time),
 *   2. reads the job spec and does the work via an LLM,
 *   3. submitTask() — records the deliverable + reserves the payout,
 *   4. repeats; the client may approve (instant pay) or reject (no pay).
 *
 * Usage: node agent/agent-v2.js <jobId> [intervalSeconds]
 * Env: ESCROW_V2_ADDRESS, AGENT_PRIVATE_KEY, OPENROUTER_API_KEY
 */
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = "https://liteforge.rpc.caldera.xyz/http";
const EXPLORER_API = "https://liteforge.explorer.caldera.xyz/api/v2";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";

/** Pull real LiteForge ecosystem data from the Blockscout indexer (best-effort). */
async function fetchLiteForgeStats() {
  const out = {};
  try {
    const s = await (await fetch(`${EXPLORER_API}/stats`, { headers: { accept: "application/json" } })).json();
    out.totalTxns = s.total_transactions;
    out.totalAddresses = s.total_addresses;
    out.totalBlocks = s.total_blocks;
    out.txnsToday = s.transactions_today;
    out.avgBlockTimeMs = s.average_block_time;
    out.gasPrices = s.gas_prices; // { slow, average, fast } in gwei
    out.networkUtilizationPct = s.network_utilization_percentage;
  } catch { /* indexer may rate-limit; the RPC snapshot still carries the essentials */ }
  try {
    const b = await (await fetch(`${EXPLORER_API}/blocks?type=block`, { headers: { accept: "application/json" } })).json();
    out.recentBlocks = (b.items || []).slice(0, 5).map((x) => ({
      height: x.height,
      txCount: x.transaction_count ?? x.tx_count,
      gasUsedPct: x.gas_used_percentage,
    }));
  } catch { /* ignore */ }
  return out;
}

const ABI = [
  "function jobs(uint256) view returns (address client, address agent, uint256 ratePerTask, uint256 balance, uint256 reserved, uint256 tasksPaid, uint64 lastSubmitAt, bool active, string spec)",
  "function tasksRemaining(uint256) view returns (uint256)",
  "function taskCount(uint256) view returns (uint256)",
  "function getTasks(uint256 jobId, uint256 offset, uint256 limit) view returns (tuple(address agent, uint256 payout, uint64 submittedAt, uint64 claimableAt, uint8 status, bytes32 workHash, string summary)[])",
  "function isClaimable(uint256, uint256) view returns (bool)",
  "function submitTask(uint256 jobId, bytes32 workHash, string summary) returns (uint256)",
  "function claimTask(uint256 jobId, uint256 taskId)",
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
  const explorer = await fetchLiteForgeStats();
  return {
    chainId: Number(network.chainId),
    blockNumber: block.number,
    timestamp: new Date(block.timestamp * 1000).toISOString(),
    txCountLatestBlock: block.transactions.length,
    gasUsed: block.gasUsed.toString(),
    gasPriceGwei: ethers.formatUnits(feeData.gasPrice ?? 0n, "gwei"),
    avgBlockTimeSec: blockTime.toFixed(2),
    // real ecosystem data from the LiteForge Blockscout indexer:
    explorer,
  };
}

async function askLLM(spec, snapshot, taskIndex) {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "x-title": "AgentPay V2 Agent",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content:
            "You are an autonomous AI agent earning zkLTC on AgentPay (LitVM LiteForge, chain 4441). " +
            "Perform EXACTLY the task in your job spec using the live chain data. Concise, concrete, under 150 words, end with one actionable takeaway.\n\n" +
            `YOUR JOB SPEC:\n"${spec}"`,
        },
        {
          role: "user",
          content: `Deliverable #${taskIndex}. Live LiteForge data:\n${JSON.stringify(snapshot, null, 2)}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter returned no content");
  return text;
}

function agentLabel(spec) {
  const m = (spec || "").match(/^\s*([^:]{1,40}):/);
  return m ? m[1].trim() : "Agent";
}

/** Claim any of this agent's pending tasks whose window has elapsed. */
async function claimReady(escrow, jobId, wallet) {
  const count = Number(await escrow.taskCount(jobId));
  let claimed = 0;
  for (let i = 0; i < count; i++) {
    if (await escrow.isClaimable(jobId, i)) {
      const t = (await escrow.getTasks(jobId, i, 1))[0];
      if (t.agent.toLowerCase() !== wallet.address.toLowerCase()) continue;
      const tx = await escrow.claimTask(jobId, i);
      await tx.wait();
      claimed++;
      console.log(`💰 Claimed task #${i} (window elapsed) — paid ${ethers.formatEther(t.payout)} zkLTC — tx ${tx.hash}`);
    }
  }
  return claimed;
}

async function main() {
  const jobId = process.argv[2];
  let intervalSec = Number(process.argv[3] ?? 30);
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) intervalSec = 30;
  if (jobId === undefined) {
    console.error("Usage: node agent/agent-v2.js <jobId> [intervalSeconds]");
    process.exit(1);
  }
  for (const k of ["AGENT_PRIVATE_KEY", "OPENROUTER_API_KEY", "ESCROW_V2_ADDRESS"]) {
    if (!process.env[k]) {
      console.error(`Missing ${k} in .env`);
      process.exit(1);
    }
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const escrow = new ethers.Contract(process.env.ESCROW_V2_ADDRESS, ABI, wallet);
  const outDir = path.join(__dirname, "outputs-v2");
  fs.mkdirSync(outDir, { recursive: true });

  const job0 = await escrow.jobs(jobId);
  const label = agentLabel(job0.spec);
  console.log(`🤖 ${label} (V2 optimistic) online — ${wallet.address}`);
  console.log(`   Job #${jobId} · spec: "${job0.spec}"\n`);
  if (job0.agent.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(`❌ This wallet is not the agent for job #${jobId} (${job0.agent}).`);
    process.exit(1);
  }

  let fails = 0;
  for (;;) {
    try {
      await claimReady(escrow, jobId, wallet);

      const job = await escrow.jobs(jobId);
      const remaining = await escrow.tasksRemaining(jobId);
      if (!job.active && remaining === 0n) {
        // nothing left to submit; keep claiming until no pending remain
        const count = Number(await escrow.taskCount(jobId));
        let anyPending = false;
        for (let i = 0; i < count; i++) {
          const t = (await escrow.getTasks(jobId, i, 1))[0];
          if (Number(t.status) === 0) anyPending = true;
        }
        if (!anyPending) {
          console.log("💤 Job closed and all tasks resolved — agent stops.");
          break;
        }
      } else if (remaining > 0n) {
        const taskIndex = Number(await escrow.taskCount(jobId)) + 1;
        console.log(`📊 ${label} working deliverable #${taskIndex}...`);
        const snapshot = await getChainSnapshot(provider);
        const report = await askLLM(job.spec, snapshot, taskIndex);
        const workHash = ethers.keccak256(ethers.toUtf8Bytes(report));
        const summary = `${label} deliverable @ block ${snapshot.blockNumber}`;
        const tx = await escrow.submitTask(jobId, workHash, summary);
        const rc = await tx.wait();
        fs.writeFileSync(
          path.join(outDir, `deliverable-${taskIndex}.md`),
          `# ${summary}\n\n- tx: https://liteforge.explorer.caldera.xyz/tx/${rc.hash}\n- workHash: ${workHash}\n\n${report}\n`
        );
        console.log(`📤 Submitted (reserved, awaiting approve/claim) — tx ${rc.hash}`);
      }
      fails = 0;
    } catch (err) {
      fails++;
      const backoff = Math.min(intervalSec * 2 ** fails, 300);
      console.error(`⚠️  ${err.message?.slice(0, 140)} — retry in ${backoff}s`);
      await new Promise((r) => setTimeout(r, backoff * 1000));
      continue;
    }
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
