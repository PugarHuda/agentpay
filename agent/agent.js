/**
 * AgentPay autonomous worker — "ChainAnalyst"
 *
 * An AI agent that earns its living in zkLTC on LitVM LiteForge:
 *   1. Reads live chain state from the LiteForge RPC (blocks, gas, activity)
 *   2. Asks an LLM (via OpenRouter) to write a concise on-chain analyst report
 *   3. Hashes the report (keccak256) as verifiable proof-of-work
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
  const prevBlock = await provider.getBlock(block.number - 100);
  const blockTime = (block.timestamp - prevBlock.timestamp) / 100;
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

async function askLLM(snapshot, taskIndex) {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "x-title": "AgentPay ChainAnalyst",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content:
            "You are ChainAnalyst, an autonomous on-chain analyst agent working for zkLTC wages on LitVM LiteForge (Litecoin's first EVM rollup, chain ID 4441). Write a concise, professional network health report from the data provided. End with one actionable observation. Keep it under 150 words.",
        },
        {
          role: "user",
          content: `Report #${taskIndex}. Live LiteForge chain data:\n${JSON.stringify(snapshot, null, 2)}`,
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

async function main() {
  const jobId = process.argv[2];
  const intervalSec = Number(process.argv[3] ?? 30);
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

  console.log(`🤖 ChainAnalyst online — agent wallet ${wallet.address}`);
  console.log(`   Job #${jobId} on escrow ${process.env.ESCROW_ADDRESS}\n`);

  // keep running until the escrow runs dry — the agent works for as long as it's paid
  for (;;) {
    const remaining = await escrow.tasksRemaining(jobId);
    if (remaining === 0n) {
      console.log("💤 Escrow exhausted or job closed — agent stops working. Top up to resume.");
      break;
    }

    const job = await escrow.jobs(jobId);
    const taskIndex = Number(job.tasksCompleted) + 1;
    console.log(`📊 Task #${taskIndex} — gathering live chain data...`);
    const snapshot = await getChainSnapshot(provider);

    console.log(`🧠 Asking the LLM (${MODEL}) for the analyst report...`);
    const report = await askLLM(snapshot, taskIndex);
    const workHash = ethers.keccak256(ethers.toUtf8Bytes(report));

    const summary = `LiteForge health report #${taskIndex} @ block ${snapshot.blockNumber}`;
    console.log(`⛓️  Submitting completeTask (workHash ${workHash.slice(0, 18)}…)...`);
    const tx = await escrow.completeTask(jobId, workHash, summary);
    const receipt = await tx.wait();

    const outFile = path.join(outDir, `report-${taskIndex}.md`);
    fs.writeFileSync(
      outFile,
      `# ${summary}\n\n- tx: https://liteforge.explorer.caldera.xyz/tx/${receipt.hash}\n- workHash: ${workHash}\n\n${report}\n`
    );

    const balance = await provider.getBalance(wallet.address);
    console.log(`✅ Paid ${ethers.formatEther(job.ratePerTask)} zkLTC — tx ${receipt.hash}`);
    console.log(`💰 Agent balance: ${ethers.formatEther(balance)} zkLTC | report saved: ${outFile}\n`);

    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
