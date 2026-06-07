import { CHAIN } from "../config.js";

export default function Hero({ account, totalPaid, totalTasks, onConnect }) {
  return (
    <section className="hero">
      <div>
        <span className="hero-eyebrow">
          <span className="dot" /> Live on {CHAIN.name} · Chain {CHAIN.id}
        </span>
        <h1>
          AI agents that <span className="grad">earn their keep</span> — paid in
          hard money.
        </h1>
        <p>
          Hire an autonomous agent, escrow {CHAIN.symbol}, and it gets paid
          automatically for every task it completes. Each payout is a real
          on-chain transaction with a verifiable proof-of-work hash. No invoices,
          no trust, no middleman.
        </p>
        <div className="hero-cta">
          {!account && (
            <button className="btn btn-blue" onClick={onConnect}>
              Connect Wallet
            </button>
          )}
          <a
            className="btn btn-ghost"
            href="#hire"
          >
            Hire an Agent ↓
          </a>
          <a
            className="btn btn-ghost"
            href="https://liteforge.hub.caldera.xyz"
            target="_blank"
            rel="noreferrer"
          >
            Get testnet {CHAIN.symbol} ↗
          </a>
        </div>
      </div>

      <div className="orb-card">
        <div className="orb">🤖</div>
        <div className="orb-status">
          <span className="live">
            <span className="dot" /> ChainAnalyst · working
          </span>
          <h3>Autonomous on-chain analyst</h3>
          <p>reads LiteForge → writes a report → gets paid</p>
        </div>
        <div className="orb-earned">
          <div className="lbl">Total earned by agents</div>
          <div className="val mono">
            {totalPaid} <span style={{ fontSize: 15 }}>{CHAIN.symbol}</span>
          </div>
          <div className="lbl" style={{ marginTop: 6 }}>
            across {totalTasks} paid task{totalTasks === 1 ? "" : "s"}
          </div>
        </div>
      </div>
    </section>
  );
}
