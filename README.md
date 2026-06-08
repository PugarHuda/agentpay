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
| Contract (V4 · + neutral arbitration) | [`0xB03b27Eb3Cb66Bf3a1104b0521671d946AcBd143`](https://liteforge.explorer.caldera.xyz/address/0xB03b27Eb3Cb66Bf3a1104b0521671d946AcBd143) |
| Contract (V3 · optimistic + stake/slash) | [`0x7ECD0AEFCF141464776C09b78735a72aE9ED748a`](https://liteforge.explorer.caldera.xyz/address/0x7ECD0AEFCF141464776C09b78735a72aE9ED748a) |
| Contract (V2 · optimistic) | [`0x0B63bEdEf745545DC7847b2A07Cf5F59B2C14191`](https://liteforge.explorer.caldera.xyz/address/0x0B63bEdEf745545DC7847b2A07Cf5F59B2C14191) |
| Contract (V1 · instant-pay) | [`0xDea6Da93265871d828B20cace2BADd5F5e70209d`](https://liteforge.explorer.caldera.xyz/address/0xDea6Da93265871d828B20cace2BADd5F5e70209d) |

## Trust model — optimistic escrow + stake & slashing (V3, live)

The economic story evolved through an adversarial self-audit:

- **V1** paid the agent the instant it submitted *any* hash → a lazy/malicious
  agent could drain escrow doing zero work. "Proof-of-work" was unenforced.
- **V2** made payment *optimistic* — submit reserves, the client can approve or
  reject within a dispute window, and the agent claims if the client stays
  silent. Fixes pay-for-nothing, client-bears-all-risk, and close-front-running.
- **V3 (live)** adds **skin in the game**: the agent locks a **stake** to accept
  a job, and every task the client **rejects burns `slashPerReject` from that
  stake**. The slash is burned (not paid to the client) so the client can't farm
  false rejections. Now garbage work is **-EV** for the agent.

```
acceptJob()   → agent locks a STAKE to take the job
submitTask()  → records deliverable + RESERVES the payout (no money moves)
approveTask() → client accepts → agent paid
rejectTask()  → escrow returned to client AND slashPerReject BURNED from stake
claimTask()   → client silent past the dispute window → agent claims
withdrawStake() → agent reclaims remaining stake (no pending tasks)
```

This is the same trio real systems use to answer "did the work happen?":
acceptance (Upwork), challenge window (optimistic rollups), staked collateral
(oracles). A neutral arbiter/oracle for the residual "who judges quality"
question is the documented next step.

A second adversarial audit of V3 found that the stake floor was agent-chosen, so
an agent could nullify slashing with a dust stake. Fixed: the client sets a
required **`minStake` (≥ `slashPerReject` > 0)** at `createJob`, enforced in
`acceptJob` — slashing now always has teeth. (`pendingCount` also replaced an
O(n) task scan.)

- **V4 (live)** closes the last hole the audits surfaced: **the client was the
  sole judge of quality**, so a malicious client could reject good work, reclaim
  the escrow, and burn an honest agent's stake. V4 adds a **neutral arbiter**
  both sides agree to up front (the client names it at `createJob`; the agent
  consents by staking to accept). Rejection becomes a *proposal*:

```
rejectTask()       → PROPOSES a rejection (funds held, nothing slashed yet)
disputeRejection() → agent escalates to the neutral arbiter
resolveDispute()   → arbiter rules: agent wins → paid, no slash;
                     client wins → slash + refund
finalizeRejection()→ agent didn't dispute in time → rejection stands (slash)
```

  So a **false rejection no longer pays the client**: the agent disputes, the
  arbiter overturns it, and the agent is paid with stake intact (proven on-chain
  in `scripts/seed-v4.js`). In production the arbiter would be a decentralized
  court / oracle committee (e.g. Kleros).

**Tests:** 84 passing (V1 + V2 optimistic + V3 stake/slash + V4 arbitration, incl.
reentrancy, "garbage spam is -EV", the dust-stake attack, and "arbiter overturns
a false rejection"). `node scripts/qa-v3.js` / `verify-concept.js` check the
economic invariants on-chain.

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
