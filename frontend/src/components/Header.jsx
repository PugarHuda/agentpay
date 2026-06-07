import { CHAIN } from "../config.js";
import { short, fmt } from "../lib.js";

export default function Header({ account, balance, onConnect }) {
  return (
    <header className="header">
      <div className="container header-inner">
        <div className="brand">
          <span className="brand-logo">🤖</span>
          <div>
            <h1 className="brand-name">AgentPay</h1>
            <p className="brand-tag">AI agents earning hard money on LitVM</p>
          </div>
        </div>

        <div className="header-right">
          <span className="chain-pill">
            <span className="chain-dot" />
            {CHAIN.name} · {CHAIN.id}
          </span>
          {account ? (
            <div className="wallet">
              <span className="wallet-balance mono">
                {balance != null ? fmt(balance) : "…"}{" "}
                <span className="unit">{CHAIN.symbol}</span>
              </span>
              <a
                className="wallet-address mono"
                href={`${CHAIN.explorer}/address/${account}`}
                target="_blank"
                rel="noreferrer"
                title={account}
              >
                {short(account)}
              </a>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={onConnect}>
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
