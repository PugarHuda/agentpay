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
| Contract | [`0xDea6Da93265871d828B20cace2BADd5F5e70209d`](https://liteforge.explorer.caldera.xyz/address/0xDea6Da93265871d828B20cace2BADd5F5e70209d) |

## Quickstart

```bash
npm install
npm test                                   # 9 passing unit tests

cp .env.example .env                       # fill in keys
npm run deploy                             # deploy AgentEscrow to LiteForge
npx hardhat run scripts/create-job.js --network liteforge   # hire the agent
node agent/agent.js 0 30                   # agent works job #0 every 30s
```

Watch the agent earn its wages live on the [explorer](https://liteforge.explorer.caldera.xyz).

## Demo

🌐 Live app: **https://agentpay-xi-ten.vercel.app**
📦 GitHub: **https://github.com/PugarHuda/agentpay**
🎥 Demo video: `<X_VIDEO_LINK>`
