# 🤖 AgentPay — AI Agents Earning Hard Money

**Autonomous AI agents that get paid in zkLTC per completed task, on LitVM LiteForge.**

> *The machine economy needs hard money. AgentPay puts AI agents on a zkLTC payroll —
> every task they complete is paid, proven, and permanently logged on Litecoin's first EVM rollup.*

**Track:** AI Agents & Agentic Apps · **LiteForge Hackathon 2026**

## What it does

1. A **client** opens a job on the `AgentEscrow` contract, escrowing native **zkLTC** and setting a per-task wage.
2. The **ChainAnalyst agent** (LLM-powered via OpenRouter) autonomously does real work — it reads live LiteForge chain data and writes network health reports.
3. For each completed task the agent submits `completeTask(jobId, keccak256(workOutput), summary)` — an **on-chain, verifiable work log** — and is **paid instantly** from escrow.
4. When the escrow runs dry, the agent stops working. Top it up and it resumes. **No invoice, no trust, no middleman — just hard money for honest work.**

Agents can also hire *other* agents through the same contract: agent-to-agent commerce settled in LTC-backed money.

## Built with both hackathon tooling tracks

The brief says *"Build with Dappit, or bring your own EVM tooling."* AgentPay does **both**:
- **Own EVM tooling** (ethers v6 / Hardhat) → `AgentEscrow` native zkLTC wages + the autonomous agent.
- **Dappit (no-code)** → the **APAY reward token** is deployed via [dappit.io](https://dappit.io), then escrowed by `AgentEscrowERC20` so agents can also be paid in APAY. See [`DAPPIT.md`](./DAPPIT.md).

## Why it matters for Hard Money Web3

- **New demand for LTC** — every agent wage is paid in zkLTC, 1:1 backed by LTC.
- **New use case** — Litecoin's cheap, fast payments DNA is exactly what machine-to-machine micropayments need.
- **AI ecosystem** — directly serves LitVM's stated mission of an LTC-powered ecosystem focused on yield, RWA **and AI**.

## Architecture

```
┌────────┐  createJob(+zkLTC)  ┌──────────────┐  completeTask(workHash)  ┌─────────────┐
│ Client │ ──────────────────▶ │ AgentEscrow  │ ◀──────────────────────  │ ChainAnalyst│
│  (UI)  │  closeJob → refund  │  (LiteForge) │  ──── zkLTC payout ────▶ │ (Claude AI) │
└────────┘                     └──────────────┘                          └─────────────┘
                                      │ events: JobCreated / TaskCompleted / JobFunded
                                      ▼
                               Live dashboard + explorer work log
```

- `contracts/AgentEscrow.sol` — escrow, per-task payouts, on-chain proof-of-work log
- `agent/agent.js` — the autonomous worker: reads chain → asks Claude → submits proof → gets paid
- `scripts/` — deploy & demo job creation

## Network

| | |
|---|---|
| Chain | LitVM LiteForge testnet (Chain ID **4441**) |
| RPC | `https://liteforge.rpc.caldera.xyz/http` |
| Explorer | `https://liteforge.explorer.caldera.xyz` |
| Faucet | `https://liteforge.hub.caldera.xyz` |
| Contract (V2, optimistic) | [`0x0B63bEdEf745545DC7847b2A07Cf5F59B2C14191`](https://liteforge.explorer.caldera.xyz/address/0x0B63bEdEf745545DC7847b2A07Cf5F59B2C14191) |
| Contract (V1, instant-pay) | [`0xDea6Da93265871d828B20cace2BADd5F5e70209d`](https://liteforge.explorer.caldera.xyz/address/0xDea6Da93265871d828B20cace2BADd5F5e70209d) |

## Trust model — optimistic escrow (V2)

V1 paid the agent the instant it submitted any hash, so a lazy/malicious agent
could drain escrow doing zero real work ("proof-of-work" was unenforced). **V2
(`AgentEscrowV2`) fixes this with an optimistic model** borrowed from Upwork
(acceptance), optimistic rollups (challenge window) and staked oracles:

```
submitTask()  → records the deliverable + RESERVES the payout (no money moves)
approveTask() → client accepts → agent paid immediately
rejectTask()  → client rejects bad work → escrow returned, agent unpaid
claimTask()   → client silent past the dispute window → agent claims (optimistic)
```

A per-job **cooldown** blocks mempool-spam draining, and `closeJob` can only
reclaim *free* (unreserved) escrow — so a client can't rug a pending agent, and
an agent can't front-run a close. This closes the worst conceptual holes: pay-
for-nothing, client-bears-all-risk, and close-job front-running. Run
`node scripts/verify-concept.js` to check the economic invariants on-chain, and
`agent/agent-v2.js` is the V2 worker (submit → claim-after-window).

## Quickstart

```bash
npm install
npm test                                   # passing unit tests

cp .env.example .env                       # fill in keys
npm run deploy                             # deploy AgentEscrow to LiteForge
npx hardhat run scripts/create-job.js --network liteforge   # hire the agent
node agent/agent.js 0 30                   # agent works job #0 every 30s
```

### How an agent works a job

The contract never runs the AI — it only escrows funds and pays whoever is the
registered `agent` for a job when they submit a proof. The work happens in
`agent/agent.js`, a **job-aware** off-chain worker:

1. reads the job's `spec` straight from the on-chain escrow,
2. uses that spec as its instructions and does the work via an LLM (OpenRouter),
3. hashes the output (`keccak256`) as proof-of-work,
4. calls `completeTask(jobId, workHash, summary)` and is paid `ratePerTask` zkLTC.

Because the instructions come from the on-chain spec, **one agent binary works
any job** — a "DeFi Sentinel" job and a "NewsDigest" job produce different work
from the same code. Point it at a job whose `agent` matches your wallet:

```bash
# .env: ESCROW_ADDRESS, AGENT_PRIVATE_KEY (this job's agent), OPENROUTER_API_KEY
node agent/agent.js <jobId> 20             # work <jobId>, one task every 20s
```

The agent loops until the escrow runs dry (or the client closes the job), and
retries with backoff through transient RPC/LLM failures.

Watch the agent earn its wages live on the [explorer](https://liteforge.explorer.caldera.xyz).

## Demo

🌐 Live app: **https://agentpay-xi-ten.vercel.app**
📦 GitHub: **https://github.com/PugarHuda/agentpay**
🎥 Demo video: `<X_VIDEO_LINK>`
