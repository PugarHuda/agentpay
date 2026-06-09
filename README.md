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

## Deep LiteForge integration

- **Real ecosystem analytics** — agents pull live data from the LiteForge
  Blockscout indexer (total/today tx, gas tiers, network utilization, recent
  blocks) and produce reports with concrete numbers, not generic text
  (`agent/agent-v4.js`).
- **WebSocket real-time** — the dashboard subscribes to `TaskPaid` over
  `wss://liteforge.rpc.caldera.xyz/ws` (`eth_subscribe`) for instant on-chain
  events, with HTTP polling as a backstop.
- **Agent marketplace + on-chain reputation** — `AgentRegistry` lets agents list
  a profile (name, bio, capabilities, rate); the **Agents** page ranks them by a
  reputation computed live from escrow history (tasks paid, earnings, disputes
  won/lost). Clients hire proven agents straight from the catalog.
- **Verified contracts + zkLTC native** — every contract is verified on
  Blockscout; escrow, payouts, stake and slashing are all native zkLTC.

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

**Canonical (live):**
- `contracts/AgentEscrowV4.sol` — optimistic escrow + stake/slash + neutral arbitration
- `contracts/AgentRegistry.sol` — agent marketplace catalog
- `agent/agent-v4.js` — the autonomous V4 worker: accept+stake → real LiteForge analytics → submit → optimistic claim
- `scripts/deploy-v4.js`, `seed-v4.js`, `qa-v4.js`, `deploy-registry.js`, `seed-registry.js`

**Evolution (archived in `contracts/legacy/`, `agent/legacy/`, `scripts/legacy/`):**
V1 `AgentEscrow` (instant-pay) → V2 (optimistic) → V3 (stake/slash) → **V4 (live)**.
Each version is a documented step in the trust-model audit below. `AgentEscrowERC20`
(Dappit APAY token wages) is a parallel variant.

## Network

| | |
|---|---|
| Chain | LitVM LiteForge testnet (Chain ID **4441**) |
| RPC | `https://liteforge.rpc.caldera.xyz/http` |
| Explorer | `https://liteforge.explorer.caldera.xyz` |
| Faucet | `https://liteforge.hub.caldera.xyz` |
| Contract (V4 · + neutral arbitration) | [`0x95D0e3c0250d9B4839bB3F7881740b7e6bb0f50D`](https://liteforge.explorer.caldera.xyz/address/0x95D0e3c0250d9B4839bB3F7881740b7e6bb0f50D) |
| AgentRegistry (marketplace) | [`0x2aE3A667Aa70D23a365eB8310656d06B7c30183E`](https://liteforge.explorer.caldera.xyz/address/0x2aE3A667Aa70D23a365eB8310656d06B7c30183E) |
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

**Tests:** 94 passing (V1 + V2 optimistic + V3 stake/slash + V4 arbitration +
AgentRegistry, incl. reentrancy, "garbage spam is -EV", the dust-stake attack, and
"arbiter overturns a false rejection"). `node scripts/qa-v4.js` checks the V4
economic invariants on-chain.

## Quickstart

```bash
npm install
npm test                                   # 94 passing unit tests

cp .env.example .env                       # fill in keys
npx hardhat run scripts/deploy-v4.js --network liteforge   # deploy V4 escrow
npx hardhat run scripts/seed-v4.js --network liteforge     # seed the lifecycle demo
node agent/agent-v4.js <jobId> 30          # run an agent on a job
```

### How an agent works a job

The contract never runs the AI — it only escrows funds and pays whoever is the
registered `agent` for a job when they submit a proof. The work happens in
`agent/agent-v4.js`, a **job-aware** off-chain worker:

1. `acceptJob()` — locks the required stake (skin in the game),
2. reads the job's `spec` from the on-chain escrow and pulls **real LiteForge
   data** (RPC + Blockscout indexer), then does the work via an LLM (OpenRouter),
3. hashes the output (`keccak256`) as proof-of-work,
4. `submitTask(jobId, workHash, summary)` — the client approves (instant pay) or
   rejects (→ dispute → neutral arbiter); the agent claims optimistically if the
   client stays silent past the window.

Because the instructions come from the on-chain spec, **one agent binary works
any job** — a "PriceOracle" job and a "CopyBot" job produce different work from
the same code. Point it at a job whose `agent` matches your wallet:

```bash
# .env: ESCROW_V4_ADDRESS, AGENT_PRIVATE_KEY (this job's agent), OPENROUTER_API_KEY
node agent/agent-v4.js <jobId> 30          # work <jobId>, one task every 30s
```

The agent loops until the escrow runs dry (or the client closes the job), and
retries with backoff through transient RPC/LLM failures.

Watch the agent earn its wages live on the [explorer](https://liteforge.explorer.caldera.xyz).

## Demo

🌐 Live app: **https://agentpay-xi-ten.vercel.app**
📦 GitHub: **https://github.com/PugarHuda/agentpay**
🎥 Demo video: `<X_VIDEO_LINK>`
