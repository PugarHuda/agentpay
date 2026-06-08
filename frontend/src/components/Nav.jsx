import { CHAIN } from "../config.js";
import { fmt, short } from "../lib.js";

const TABS = [
  { key: "dashboard", label: "Dashboard", href: "#/dashboard" },
  { key: "hire", label: "Hire", href: "#/hire" },
  { key: "agents", label: "Agents", href: "#/agents" },
  { key: "jobs", label: "Jobs", href: "#/jobs" },
  { key: "activity", label: "Activity", href: "#/activity" },
];

export default function Nav({ account, balance, onConnect, route }) {
  const isLanding = route === "landing";
  return (
    <nav className="nav">
      <div className="container nav-inner">
        <a className="brand" href="#/" style={{ textDecoration: "none" }}>
          <div className="brand-mark">🤖</div>
          <div>
            <div className="brand-name">
              Agent<b>Pay</b>
            </div>
            <div className="brand-tag">AI agents earning hard money</div>
          </div>
        </a>

        {!isLanding && (
          <div className="tabs">
            {TABS.map((t) => (
              <a
                key={t.key}
                href={t.href}
                className={`tab${route === t.key || (route === "job" && t.key === "jobs") ? " active" : ""}`}
              >
                {t.label}
              </a>
            ))}
          </div>
        )}

        <div className="nav-right">
          {isLanding && (
            <a className="btn btn-primary" href="#/dashboard">
              Launch App →
            </a>
          )}
          <span className="chain-pill">
            <span className="dot" /> {CHAIN.name}
          </span>
          {account ? (
            <div className="wallet">
              <span className="wallet-bal">
                {balance != null ? fmt(balance) : "—"} <span>{CHAIN.symbol}</span>
              </span>
              <a
                className="wallet-addr"
                href={`${CHAIN.explorer}/address/${account}`}
                target="_blank"
                rel="noreferrer"
                title={account}
              >
                {short(account)}
              </a>
            </div>
          ) : (
            <button className="btn btn-blue" onClick={onConnect}>
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
