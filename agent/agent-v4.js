/**
 * AgentPay V4 autonomous worker — optimistic escrow + stake + arbitration,
 * powered by REAL LiteForge ecosystem data.
 *
 *   1. acceptJob() — lock the required stake (skin in the game)
 *   2. each cycle: claim any of its own claimable tasks (optimistic payout),
 *      then pull live LiteForge data (RPC + Blockscout indexer) and do the
 *      job's spec via an LLM,
 *   3. submitTask() — records the deliverable + keccak256 proof-of-work.
 *
 * The client may approve (instant pay), reject (→ dispute → neutral arbiter),
 * and the agent claims optimistically if the client stays silent.
 *
 * Usage: node agent/agent-v4.js <jobId> [intervalSeconds]
 * Env: ESCROW_V4_ADDRESS, AGENT_PRIVATE_KEY, OPENROUTER_API_KEY, [STAKE]
 */
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = "https://liteforge.rpc.caldera.xyz/http";
const EXPLORER_API = "https://liteforge.explorer.caldera.xyz/api/v2";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";

const ABI = [
  "function jobs(uint256) view returns (address client, address agent, address arbiter, uint256 ratePerTask, uint256 balance, uint256 reserved, uint256 tasksPaid, uint256 stake, uint256 slashPerReject, uint256 minStake, uint256 unresolved, uint64 lastSubmitAt, bool active, bool accepted, string spec)",
  "function tasksRemaining(uint256) view returns (uint256)",
  "function taskCount(uint256) view returns (uint256)",
  "function getTasks(uint256,uint256,uint256) view returns (tuple(address agent,uint256 payout,uint64 submittedAt,uint64 claimableAt,uint64 rejectedAt,uint64 disputedAt,uint8 status,bytes32 workHash,string summary)[])",
  "function isClaimable(uint256,uint256) view returns (bool)",
  "function acceptJob(uint256) payable",
  "function submitTask(uint256 jobId, bytes32 workHash, string summary) returns (uint256)",
  "function claimTask(uint256 jobId, uint256 taskId)",
];

/** Real LiteForge ecosystem data from the Blockscout indexer (best-effort). */
async function fetchLiteForgeStats() {
  const out = {};
  try {
    const s = await (await fetch(`${EXPLORER_API}/stats`, { headers: { accept: "application/json" } })).json();
    out.totalTxns = s.total_transactions;
    out.totalAddresses = s.total_addresses;
    out.txnsToday = s.transactions_today;
    out.avgBlockTimeMs = s.average_block_time;
    out.gasPricesGwei = s.gas_prices;
    out.networkUtilizationPct = s.network_utilization_percentage;
  } catch { /* ignore */ }
  try {
    const b = await (await fetch(`${EXPLORER_API}/blocks?type=block`, { headers: { accept: "application/json" } })).json();
    out.recentBlocks = (b.items || []).slice(0, 5).map((x) => ({
      height: x.height,
      txCount: x.transaction_count,
      gasUsedPct: typeof x.gas_used_percentage === "number" ? Number(x.gas_used_percentage.toFixed(4)) : x.gas_used_percentage,
    }));
  } catch { /* ignore */ }
  return out;
}

async function snapshot(provider) {
  const [block, fee, net] = await Promise.all([
    provider.getBlock("latest"),
    provider.getFeeData(),
    provider.getNetwork(),
  ]);
  const explorer = await fetchLiteForgeStats();
  return {
    chainId: Number(net.chainId),
    blockNumber: block.number,
    timestamp: new Date(block.timestamp * 1000).toISOString(),
    txCountLatestBlock: block.transactions.length,
    gasPriceGwei: ethers.formatUnits(fee.gasPrice ?? 0n, "gwei"),
    liteforge: explorer, // real indexer data
  };
}

async function askLLM(spec, snap, n) {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "x-title": "AgentPay V4 Agent" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      messages: [
        { role: "system", content:
          "You are an autonomous AI agent earning zkLTC on AgentPay (LitVM LiteForge, chain 4441). " +
          "You are given REAL LiteForge network data (RPC + Blockscout indexer: totals, today's tx count, gas prices, recent blocks). " +
          "Perform EXACTLY your job spec using that real data — cite concrete numbers. Concise, under 150 words, end with one actionable takeaway.\n\n" +
          `JOB SPEC:\n"${spec}"` },
        { role: "user", content: `Deliverable #${n}. Live LiteForge data:\n${JSON.stringify(snap, null, 2)}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const d = await res.json();
  const t = d.choices?.[0]?.message?.content;
  if (!t) throw new Error("OpenRouter returned no content");
  return t;
}

const label = (spec) => ((spec || "").match(/^\s*([^:]{1,40}):/) || [, "Agent"])[1].trim();

async function main() {
  const jobId = process.argv[2];
  let interval = Number(process.argv[3] ?? 30);
  if (!Number.isFinite(interval) || interval <= 0) interval = 30;
  if (jobId === undefined) { console.error("Usage: node agent/agent-v4.js <jobId> [intervalSeconds]"); process.exit(1); }
  for (const k of ["AGENT_PRIVATE_KEY", "OPENROUTER_API_KEY", "ESCROW_V4_ADDRESS"]) {
    if (!process.env[k]) { console.error(`Missing ${k} in .env`); process.exit(1); }
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const escrow = new ethers.Contract(process.env.ESCROW_V4_ADDRESS, ABI, wallet);
  const outDir = path.join(__dirname, "outputs-v4");
  fs.mkdirSync(outDir, { recursive: true });

  let job = await escrow.jobs(jobId);
  const name = label(job.spec);
  console.log(`🤖 ${name} (V4) online — ${wallet.address}\n   Job #${jobId}: "${job.spec}"`);
  if (job.agent.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(`❌ Not the agent for job #${jobId} (${job.agent}).`); process.exit(1);
  }
  // accept (stake) if needed
  if (!job.accepted) {
    const stake = process.env.STAKE ? ethers.parseEther(process.env.STAKE) : job.minStake;
    console.log(`🔒 accepting — staking ${ethers.formatEther(stake)} zkLTC...`);
    await (await escrow.acceptJob(jobId, { value: stake })).wait();
  }

  let fails = 0;
  for (;;) {
    try {
      // claim any of my claimable tasks
      const count = Number(await escrow.taskCount(jobId));
      for (let i = 0; i < count; i++) {
        if (await escrow.isClaimable(jobId, i)) {
          const t = (await escrow.getTasks(jobId, i, 1))[0];
          if (t.agent.toLowerCase() === wallet.address.toLowerCase()) {
            const tx = await escrow.claimTask(jobId, i);
            await tx.wait();
            console.log(`💰 claimed task #${i} (window elapsed) — tx ${tx.hash}`);
          }
        }
      }
      job = await escrow.jobs(jobId);
      const remaining = await escrow.tasksRemaining(jobId);
      if (remaining > 0n) {
        const n = Number(await escrow.taskCount(jobId)) + 1;
        console.log(`📊 ${name} gathering REAL LiteForge data for deliverable #${n}...`);
        const snap = await snapshot(provider);
        const report = await askLLM(job.spec, snap, n);
        const workHash = ethers.keccak256(ethers.toUtf8Bytes(report));
        const tx = await escrow.submitTask(jobId, workHash, `${name} deliverable @ block ${snap.blockNumber}`);
        const rc = await tx.wait();
        fs.writeFileSync(path.join(outDir, `deliverable-${n}.md`),
          `# ${name} deliverable #${n}\n\n- tx: https://liteforge.explorer.caldera.xyz/tx/${rc.hash}\n- workHash: ${workHash}\n\n${report}\n`);
        console.log(`📤 submitted (reserved, awaiting approve/claim) — tx ${rc.hash}`);
      } else if (!job.active) {
        console.log("💤 job closed and no free escrow — stopping."); break;
      }
      fails = 0;
    } catch (err) {
      fails++;
      const backoff = Math.min(interval * 2 ** fails, 300);
      console.error(`⚠️  ${err.message?.slice(0, 140)} — retry in ${backoff}s`);
      await new Promise((r) => setTimeout(r, backoff * 1000));
      continue;
    }
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
