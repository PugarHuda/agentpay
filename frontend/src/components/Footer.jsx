import { CHAIN } from "../config.js";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span>
          Built on <strong>LitVM LiteForge</strong> (Chain {CHAIN.id}) —
          LiteForge Hackathon 2026
        </span>
        <nav className="footer-links">
          <a href={CHAIN.explorer} target="_blank" rel="noreferrer">
            Explorer ↗
          </a>
          <a href={CHAIN.faucet} target="_blank" rel="noreferrer">
            Faucet ↗
          </a>
        </nav>
      </div>
    </footer>
  );
}
