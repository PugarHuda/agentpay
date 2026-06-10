# LiteForge Hackathon Submission — AgentPay

**Track:** AI Agents & Agentic Apps

---

## ✅ Discord submission message (copy-paste to #liteforge-hackathon)

> **App name:** AgentPay
>
> **Description:** AgentPay puts AI agents on a hard-money payroll — autonomous agents do real work on LitVM and earn native zkLTC per task through an optimistic on-chain escrow with staking, slashing, and neutral arbitration, so payment is trustless in both directions and every task's proof-of-work is logged forever on LiteForge.
>
> **Live app:** https://agentpay-xi-ten.vercel.app
>
> **GitHub:** https://github.com/PugarHuda/agentpay
>
> **Demo video:** `<X_VIDEO_LINK>`  ← *paste your X link here after recording*

*(The five lines above are exactly the fields the submission form requires.)*

---

## 🎥 Demo video script (≤90 seconds) — show it live on LiteForge

1. **Hook (5s):** "AI agents are about to run the economy. What money will they use? Hard money." — open the AgentPay dashboard, the live "N agents working now" bar ticking.
2. **Hire an agent (15s):** Connect MetaMask (one click auto-adds/switches to LiteForge, Chain 4441) → **Hire** tab → pick an agent from the on-chain marketplace (or generate one) → set rate / arbiter → `createJob` escrows zkLTC. Show the tx on the LiteForge explorer.
3. **The agent works (35s):** Terminal beside the dashboard. Run `node agent/agent-v4.js`. The agent **acceptJob + stakes** → pulls **real live LiteForge chain data** (Blockscout indexer: total/today tx, gas tiers, utilization, recent blocks) → the LLM writes a genuine report → `submitTask` posts a keccak256 work-proof on-chain → client `approveTask` (or the agent **optimistically claims** after the window if the client is silent) → the **WebSocket live feed pops "+zkLTC"** and the agent's earnings grow. Show 2–3 paid cycles + the workHash matching the saved report.
4. **Trustless both ways (20s):** Show the dispute path — a client `rejectTask` only *proposes*; the agent `disputeRejection` → the **neutral arbiter** `resolveDispute(agentWon)` overturns a false rejection (stake intact) or slashes a bad actor (burned, not paid to the client → no false-rejection farming). "No invoice, no blind trust, no middleman — and neither side can cheat."
5. **Close (15s):** Explorer page with the agent's real tx history + the escrow draining per task. "When the money runs out, the agent stops. Machine-to-machine commerce on LTC-backed money. AgentPay — built on LitVM LiteForge."

---

## 🐦 X post caption (attach the demo video to the FIRST tweet)

**Main tweet (the one you submit — must show the app live on LiteForge):**

> 🤖💸 Meet AgentPay: AI agents on a hard-money payroll.
>
> Autonomous agents do real work on @LitecoinVM and earn native zkLTC per task — through an optimistic on-chain escrow with staking, slashing & neutral arbitration. Trustless both ways. Every proof-of-work logged forever on LiteForge.
>
> Live 👇 #LiteForge #Litecoin #zkLTC
> https://agentpay-xi-ten.vercel.app

**Optional thread (reply tweets for extra credit):**

> 2/ The agent doesn't fake it. It pulls REAL live LiteForge chain data (Blockscout: tx volume, gas tiers, utilization), the LLM writes a genuine report, and a keccak256 proof-of-work is posted on-chain. Watch the wage hit over WebSocket in real time.

> 3/ Trustless in BOTH directions: a client can't rug a finished job (false rejections go to a neutral arbiter; bad stake is *burned*, not paid out), and an agent can't get paid for nothing. 94 tests, 3 adversarial audit rounds, all verified on LiteForge.

> 4/ Agents even hire each other via an on-chain marketplace. This is what a machine-to-machine economy on hard money looks like.
> Built for the #LiteForge Hackathon w/ @LitecoinVM × @Dappit 🚀
> Code: https://github.com/PugarHuda/agentpay

*Tag the official @LitecoinVM and @Dappit handles (and @Litecoin) so the judges see it.*

---

## 🧱 What's deployed (all live + verified on LiteForge, Chain 4441)

| Contract | Address |
|---|---|
| AgentEscrowV4 (optimistic + stake/slash + arbitration + liveness) | `0x95D0e3c0250d9B4839bB3F7881740b7e6bb0f50D` |
| AgentRegistry (on-chain agent marketplace) | `0x2aE3A667Aa70D23a365eB8310656d06B7c30183E` |

- **Worker:** `agent/agent-v4.js` — accept+stake, real LiteForge data, LLM report, submit, optimistic claim.
- **94 unit tests passing**; `scripts/qa-v4.js` on-chain QA passes (conservation, slash-burn accounting, arbiter-for-agent, no double-pay).

## 🏆 Judging-criteria mapping

- **Innovation:** first agent-wage escrow on Litecoin's EVM — agents that literally earn a living, hire *each other* via an on-chain marketplace, and settle disputes through neutral arbitration.
- **Hard Money Web3 alignment:** every wage is native zkLTC (LTC-backed); directly serves LitVM's mission (new LTC use cases + an AI-agent economy on hard money).
- **Technical quality:** Solidity 0.8.24 (custom errors, `viaIR`), optimistic-escrow + staking/slashing + neutral arbitration + liveness fallback, on-chain keccak256 proof-of-work, agents consume **real** Blockscout chain data, WebSocket event-driven UI. Hardened across **3 adversarial audit rounds**.
- **UX:** neobrutalism multi-page app, one-click chain add/switch, works read-only with no wallet, in-browser agent/arbiter wallet generation, real-time animated work feed.

## ☑️ Pre-submission checklist

- [x] Contract deployed + **verified** on LiteForge (V4 + Registry)
- [x] Demo jobs created; agent ran multiple **paid** tasks on-chain (real txs on explorer)
- [x] Frontend hosted on Vercel — live link works in incognito
- [x] README has deployed addresses + live link
- [x] Repo public on GitHub, fully pushed
- [ ] **Demo video posted on X** showing the app live on LiteForge ← *only remaining step (human)*
- [ ] **Submit in #liteforge-hackathon before June 10, 2026** (paste the message above with your X link)
