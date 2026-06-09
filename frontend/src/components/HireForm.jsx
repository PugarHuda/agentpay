import { useState } from "react";
import { ethers } from "ethers";
import { CHAIN } from "../config.js";
import { errMsg, shortHash } from "../lib.js";

/* shows a freshly-generated wallet's private key with a copy button */
function KeyBox({ title, role, gen }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(gen.privateKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  };
  return (
    <div className="gen-box">
      <div className="gen-row">
        <strong>🔑 {title}</strong>
        <button type="button" className="btn btn-ghost gen-copy" onClick={copy}>
          {copied ? "Copied ✓" : "Copy key"}
        </button>
      </div>
      <p>
        Save this private key — it was generated in your browser and never leaves
        this page. {role}
      </p>
      <div className="gen-key mono">{gen.privateKey}</div>
    </div>
  );
}

export default function HireForm({ disabled, account, prefillAgent, onConnect, onCreate }) {
  const [agent, setAgent] = useState(prefillAgent || "");
  const [arbiter, setArbiter] = useState("");
  const [rate, setRate] = useState("0.001");
  const [deposit, setDeposit] = useState("0.01");
  const [slash, setSlash] = useState("0.002");
  const [minStake, setMinStake] = useState("0.004");
  const [spec, setSpec] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customStake, setCustomStake] = useState(false); // stop auto-deriving once edited
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [genAgent, setGenAgent] = useState(null);
  const [genArbiter, setGenArbiter] = useState(null);

  // keep slash/minStake sensible vs the rate unless the user customised them
  const onRate = (v) => {
    setRate(v);
    if (!customStake) {
      try {
        const r = ethers.parseEther(v || "0");
        if (r > 0n) {
          setSlash(ethers.formatEther(r * 2n));
          setMinStake(ethers.formatEther(r * 4n));
        }
      } catch {
        /* leave as-is while typing */
      }
    }
  };

  const makeAgent = () => {
    const w = ethers.Wallet.createRandom();
    setAgent(w.address);
    setGenAgent({ address: w.address, privateKey: w.privateKey });
  };
  const makeArbiter = () => {
    const w = ethers.Wallet.createRandom();
    setArbiter(w.address);
    setGenArbiter({ address: w.address, privateKey: w.privateKey });
  };

  const validate = () => {
    if (!ethers.isAddress(agent)) return "Enter a valid agent address";
    if (!ethers.isAddress(arbiter)) return "Enter a valid neutral arbiter address";
    if (account && arbiter.toLowerCase() === account.toLowerCase())
      return "The arbiter must be neutral — not your own (client) wallet";
    if (arbiter.toLowerCase() === agent.toLowerCase())
      return "The arbiter must be neutral — not the agent's wallet";
    let r, d, s, ms;
    try {
      r = ethers.parseEther(rate || "0");
      d = ethers.parseEther(deposit || "0");
      s = ethers.parseEther(slash || "0");
      ms = ethers.parseEther(minStake || "0");
    } catch {
      return "Amounts must be valid numbers";
    }
    if (r <= 0n) return "Rate per task must be greater than 0";
    if (d < r) return "Deposit must cover at least one task at this rate";
    if (s <= 0n) return "Slash per reject must be greater than 0";
    if (ms < s) return "Min stake must be at least the slash amount";
    if (!spec.trim()) return "Describe the task the agent should perform";
    return null;
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!account) {
      onConnect();
      return;
    }
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    try {
      const receipt = await onCreate({ agent, arbiter, rate, deposit, slash, minStake, spec: spec.trim() });
      setSuccess(receipt.hash);
      setSpec("");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="hire" className="card panel">
      <div className="phead">
        <h2 className="ptitle">🪄 Hire an Agent</h2>
      </div>
      <p className="psub">
        Escrow {CHAIN.symbol} for an agent — it gets paid per approved task, and
        you can reclaim whatever's unspent.
      </p>

      <form onSubmit={submit} className="form">
        <div className="field">
          <label>Agent address</label>
          <input
            className="mono"
            type="text"
            placeholder="0x…"
            value={agent}
            onChange={(e) => setAgent(e.target.value.trim())}
            spellCheck={false}
            disabled={disabled}
          />
          <div className="field-hint">
            The wallet your AI agent uses to get paid.{" "}
            <button type="button" className="link-btn" onClick={makeAgent}>
              🎲 Generate
            </button>
          </div>
        </div>
        {genAgent && (
          <KeyBox
            title="Agent wallet created"
            role={
              <>
                Your agent program needs it as <code>AGENT_PRIVATE_KEY</code>; fund
                it with gas, then run <code>node agent/agent-v4.js &lt;jobId&gt;</code>.
              </>
            }
            gen={genAgent}
          />
        )}

        <div className="field">
          <label>⚖️ Arbiter address (neutral)</label>
          <input
            className="mono"
            type="text"
            placeholder="0x…"
            value={arbiter}
            onChange={(e) => setArbiter(e.target.value.trim())}
            spellCheck={false}
            disabled={disabled}
          />
          <div className="field-hint">
            A neutral third party (not you, not the agent) who resolves disputes —
            if you wrongly reject good work, the agent escalates and the arbiter
            can overturn it. For testing,{" "}
            <button type="button" className="link-btn" onClick={makeArbiter}>
              🎲 Generate
            </button>
            . In production: a decentralized court (e.g. Kleros).
          </div>
        </div>
        {genArbiter && (
          <KeyBox
            title="Arbiter wallet created"
            role="Hold this key to act as the arbiter and resolve disputes for this job."
            gen={genArbiter}
          />
        )}

        <div className="frow">
          <div className="field">
            <label>Rate per task ({CHAIN.symbol})</label>
            <input
              className="mono"
              type="text"
              inputMode="decimal"
              placeholder="0.001"
              value={rate}
              onChange={(e) => onRate(e.target.value.trim())}
              disabled={disabled}
            />
          </div>
          <div className="field">
            <label>Deposit ({CHAIN.symbol})</label>
            <input
              className="mono"
              type="text"
              inputMode="decimal"
              placeholder="0.01"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value.trim())}
              disabled={disabled}
            />
          </div>
        </div>

        <button
          type="button"
          className="advanced-toggle"
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          {advancedOpen ? "▾" : "▸"} Advanced — dispute settings (auto-set from rate)
        </button>
        {advancedOpen && (
          <>
            <div className="frow">
              <div className="field">
                <label>Slash per reject ({CHAIN.symbol})</label>
                <input
                  className="mono"
                  type="text"
                  inputMode="decimal"
                  value={slash}
                  onChange={(e) => {
                    setCustomStake(true);
                    setSlash(e.target.value.trim());
                  }}
                  disabled={disabled}
                />
              </div>
              <div className="field">
                <label>Min agent stake ({CHAIN.symbol})</label>
                <input
                  className="mono"
                  type="text"
                  inputMode="decimal"
                  value={minStake}
                  onChange={(e) => {
                    setCustomStake(true);
                    setMinStake(e.target.value.trim());
                  }}
                  disabled={disabled}
                />
              </div>
            </div>
            <div className="field-hint" style={{ marginTop: -4 }}>
              The agent locks ≥ the min stake to accept; each task you reject burns
              the slash from it — so garbage work is a net loss for the agent.
              Defaults: slash = 2× rate, min stake = 4× rate.
            </div>
          </>
        )}

        <div className="field">
          <label>Task spec</label>
          <textarea
            rows={3}
            placeholder="e.g. Publish a LiteForge network health report every few minutes…"
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            disabled={disabled}
          />
        </div>

        <button
          className="btn btn-primary btn-block"
          type="submit"
          disabled={disabled || busy}
        >
          {busy
            ? "Confirming…"
            : account
            ? "Create Job & Escrow Funds"
            : "Connect Wallet to Hire"}
        </button>
      </form>

      {error && <div className="msg err">{error}</div>}
      {success && (
        <div className="msg ok">
          ✓ Job created — your agent is on the clock.{" "}
          <a
            href={`${CHAIN.explorer}/tx/${success}`}
            target="_blank"
            rel="noreferrer"
            className="mono"
          >
            {shortHash(success)} ↗
          </a>
        </div>
      )}
    </section>
  );
}
