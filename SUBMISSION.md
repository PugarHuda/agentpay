# LiteForge Hackathon Submission — AgentPay

**Track:** AI Agents & Agentic Apps

## Discord submission message (copy-paste to #liteforge-hackathon)

---

**App name:** AgentPay

**Description:** AgentPay puts AI agents on a hard-money payroll — autonomous Claude-powered agents do real work on LitVM and are paid native zkLTC per completed task through an on-chain escrow, with every task's proof-of-work logged forever on LiteForge.

**Live app:** https://agentpay-xi-ten.vercel.app

**GitHub:** https://github.com/PugarHuda/agentpay

**Demo video:** `<X_VIDEO_LINK>`

---

## Demo video script (≤90 seconds)

1. **Hook (5s):** "AI agents are about to run the economy. What money will they use? Hard money." — show AgentPay dashboard.
2. **Hire (15s):** Connect MetaMask (auto-switches to LiteForge 4441) → fill "Hire an Agent" → escrow zkLTC → tx confirms, show it on the LiteForge explorer.
3. **The agent works (40s):** Terminal side-by-side with dashboard. Run `node agent/agent.js 0`. ChainAnalyst reads live LiteForge chain data → Claude writes the report → `completeTask` lands on-chain → **live feed pops "+0.001 zkLTC"** and agent balance grows. Show 2–3 task cycles + the workHash matching keccak256 of the saved report.
4. **Hard money angle (20s):** Show escrow draining per task — "no invoice, no trust, no middleman; when the money runs out, the agent stops. Machine-to-machine commerce on LTC-backed money."
5. **Close (10s):** Explorer page with the agent's tx history. "AgentPay — AI agents earning hard money. Built on LitVM LiteForge."

## Judging criteria mapping

- **Innovation:** first agent-wage escrow on Litecoin's EVM — agents that literally earn their living, incl. agent-to-agent hiring.
- **Hard Money Web3 alignment:** every wage is zkLTC (LTC-backed); directly serves LitVM's stated mission pillars (new LTC use cases + AI ecosystem).
- **Technical quality:** 9/9 unit tests, custom-error Solidity 0.8.24, on-chain keccak256 proof-of-work log, live event-driven UI.
- **UX:** one-click chain add/switch, works read-only without a wallet, real-time animated work feed.

## Pre-submission checklist

- [ ] Contract deployed to LiteForge, address in README + frontend/.env (`VITE_ESCROW_ADDRESS`)
- [ ] Demo job created, agent run ≥3 paid tasks on-chain (real txs on explorer)
- [ ] Frontend hosted (Vercel/Netlify) — live link works in incognito
- [ ] README updated with deployed address + live link + video link
- [ ] Repo pushed to GitHub (public)
- [ ] Demo video posted on X, shows the app live on LiteForge
- [ ] Submitted in #liteforge-hackathon before **June 10, 2026**
