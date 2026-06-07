import { CHAIN, ESCROW_ADDRESS } from "../config.js";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div>
          Built on <b>{CHAIN.name}</b> (Chain {CHAIN.id}) · LiteForge Hackathon 2026
        </div>
        <div className="footer-links">
          {ESCROW_ADDRESS && (
            <a
              href={`${CHAIN.explorer}/address/${ESCROW_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
            >
              Contract ↗
            </a>
          )}
          <a href={CHAIN.explorer} target="_blank" rel="noreferrer">
            Explorer ↗
          </a>
          <a href={CHAIN.faucet} target="_blank" rel="noreferrer">
            Faucet ↗
          </a>
        </div>
      </div>
    </footer>
  );
}
