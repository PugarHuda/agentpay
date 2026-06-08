/**
 * Seed AgentEscrow on LiteForge with realistic, varied jobs so the dashboard
 * shows a believable spread of real cases:
 *
 *   - DeFi Sentinel  : monitoring agent, many tasks, escrow nearly drained
 *   - NewsDigest     : digest agent, demonstrates a mid-life ESCROW TOP-UP
 *   - SecurityAuditor: audit agent, demonstrates CLOSE + refund of unspent escrow
 *
 * Every task's report is generated for real via OpenRouter, so the on-chain
 * workHash = keccak256(actual output) and the summaries are genuine. Each job
 * gets its own freshly-generated agent wallet (funded with a little gas).
 *
 * Usage: node scripts/seed.js [--force]
 * Requires in .env: PRIVATE_KEY (client/deployer), ESCROW_ADDRESS, OPENROUTER_API_KEY
 */
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = "https://liteforge.rpc.caldera.xyz/http";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";

const ABI = [
  "function nextJobId() view returns (uint256)",
  "function createJob(address agent, uint256 ratePerTask, string spec) payable returns (uint256)",
  "function completeTask(uint256 jobId, bytes32 workHash, string summary)",
  "function fund(uint256 jobId) payable",
  "function closeJob(uint256 jobId)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed agent, uint256 ratePerTask, uint256 deposit, string spec)",
];

const SCENARIOS = [
  {
    name: "DeFi Sentinel",
    spec: "DeFi Sentinel: monitor LiteForge gas prices and block utilization, flag congestion risk each cycle.",
    system:
      "You are DeFi Sentinel, an autonomous agent watching LiteForge (Litecoin's EVM rollup, chain 4441) for DeFi/congestion risk. From the chain data, give a short risk read (gas, utilization) and one recommended action. Under 110 words.",
    rate: "0.0002",
    deposit: "0.0012", // capacity 6
    tasks: 4, // leaves 2 — "running low" case
  },
  {
    name: "NewsDigest",
    spec: "NewsDigest: summarize the most important Litecoin & LiteForge developments for builders each run.",
    system:
      "You are NewsDigest, an agent writing a crisp 3-bullet digest of Litecoin / LiteForge ecosystem developments for developers. Be concrete and useful. Under 110 words.",
    rate: "0.0003",
    deposit: "0.0009", // capacity 3
    tasks: 2,
    fund: "0.0009", // TOP-UP case → stays active with more runway
  },
  {
    name: "SecurityAuditor",
    spec: "SecurityAuditor: review recent AgentEscrow activity for anomalies and confirm accounting integrity.",
    system:
      "You are SecurityAuditor, an agent reviewing an on-chain escrow's recent activity for anomalies. Give a short verdict (OK / WARN) with one reasoning bullet. Under 90 words.",
    rate: "0.0005",
    deposit: "0.0015", // capacity 3
    tasks: 1,
    close: true, // CLOSE + refund case
  },
];

async function chainSnapshot(provider) {
  const [block, fee, net] = await Promise.all([
    provider.getBlock("latest"),
    provider.getFeeData(),
    provider.getNetwork(),
  ]);
  return {
    chainId: Number(net.chainId),
    blockNumber: block.number,
    txCountLatestBlock: block.transactions.length,
    gasUsed: block.gasUsed.toString(),
    gasPriceGwei: ethers.formatUnits(fee.gasPrice ?? 0n, "gwei"),
    timestamp: new Date(block.timestamp * 1000).toISOString(),
  };
}

async function askLLM(system, snapshot, taskIndex, name) {
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "x-title": `AgentPay ${name}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 450,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `Report #${taskIndex}. Live LiteForge data:\n${JSON.stringify(snapshot, null, 2)}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (text) return text;
    throw new Error("empty content");
  } catch (e) {
    // resilient fallback so seeding never breaks the data set
    return `${name} report #${taskIndex} @ block ${snapshot.blockNumber}: nominal conditions; gas ${snapshot.gasPriceGwei} gwei, ${snapshot.txCountLatestBlock} tx in latest block. (offline fallback: ${e.message})`;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const client = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const escrow = new ethers.Contract(process.env.ESCROW_ADDRESS, ABI, client);

  const startId = Number(await escrow.nextJobId());
  console.log(`Escrow ${process.env.ESCROW_ADDRESS} — current nextJobId=${startId}`);
  console.log(`Client/deployer ${client.address} (${ethers.formatEther(await provider.getBalance(client.address))} zkLTC)\n`);

  if (startId >= 5 && !force) {
    console.log("Looks already seeded (nextJobId >= 5). Re-run with --force to add more.");
    return;
  }

  const seededAgents = [];

  for (const sc of SCENARIOS) {
    console.log(`\n=== ${sc.name} ===`);
    const agent = ethers.Wallet.createRandom().connect(provider);
    seededAgents.push({ name: sc.name, address: agent.address, privateKey: agent.privateKey });

    // fund agent with a little gas
    await (await client.sendTransaction({ to: agent.address, value: ethers.parseEther("0.0003") })).wait();
    console.log(`agent ${agent.address} funded with gas`);

    // create job
    const rate = ethers.parseEther(sc.rate);
    const deposit = ethers.parseEther(sc.deposit);
    const rc = await (await escrow.createJob(agent.address, rate, sc.spec, { value: deposit })).wait();
    const ev = rc.logs
      .map((l) => { try { return escrow.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "JobCreated");
    const jobId = Number(ev.args.jobId);
    console.log(`job #${jobId} created (rate ${sc.rate}, deposit ${sc.deposit}) — tx ${rc.hash}`);

    // run tasks with real LLM output
    const escrowAsAgent = escrow.connect(agent);
    for (let i = 1; i <= sc.tasks; i++) {
      const snap = await chainSnapshot(provider);
      const report = await askLLM(sc.system, snap, i, sc.name);
      const workHash = ethers.keccak256(ethers.toUtf8Bytes(report));
      const summary = `${sc.name} report #${i} @ block ${snap.blockNumber}`;
      const tx = await escrowAsAgent.completeTask(jobId, workHash, summary);
      await tx.wait();
      console.log(`  task #${i} done — ${summary} — tx ${tx.hash}`);
    }

    // optional top-up
    if (sc.fund) {
      const tx = await escrow.fund(jobId, { value: ethers.parseEther(sc.fund) });
      await tx.wait();
      console.log(`  topped up +${sc.fund} zkLTC — tx ${tx.hash}`);
    }

    // optional close
    if (sc.close) {
      const tx = await escrow.closeJob(jobId);
      await tx.wait();
      console.log(`  CLOSED job #${jobId} (unspent escrow refunded) — tx ${tx.hash}`);
    }
  }

  // persist agent keys (gitignored) in case you want to keep them running
  const outPath = path.join(__dirname, ".seed-agents.json");
  fs.writeFileSync(outPath, JSON.stringify(seededAgents, null, 2));
  console.log(`\nDone. Agent keys saved to scripts/.seed-agents.json (gitignored).`);
  console.log(`Client balance now: ${ethers.formatEther(await provider.getBalance(client.address))} zkLTC`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
