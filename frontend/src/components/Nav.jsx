import { CHAIN } from "../config.js";
import { fmt, short } from "../lib.js";

export default function Nav({ account, balance, onConnect }) {
  return (
    <nav className="nav">
      <div className="container nav-inner">
        <div className="brand">
          <div className="brand-mark">🤖</div>
          <div>
            <div className="brand-name">
              Agent<b>Pay</b>
            </div>
            <div className="brand-tag">AI agents earning hard money</div>
          </div>
        </div>

        <div className="nav-right">
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
