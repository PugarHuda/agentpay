import { useState } from "react";
import { ethers } from "ethers";
import { CHAIN } from "../config.js";
import { errMsg, shortHash } from "../lib.js";

export default function HireForm({ disabled, account, onConnect, onCreate }) {
  const [agent, setAgent] = useState("");
  const [rate, setRate] = useState("0.001");
  const [deposit, setDeposit] = useState("0.01");
  const [spec, setSpec] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const validate = () => {
    if (!ethers.isAddress(agent)) return "Enter a valid agent address";
    let r, d;
    try {
      r = ethers.parseEther(rate || "0");
      d = ethers.parseEther(deposit || "0");
    } catch {
      return "Rate and deposit must be valid numbers";
    }
    if (r <= 0n) return "Rate per task must be greater than 0";
    if (d < r) return "Deposit must cover at least one task at this rate";
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
      const receipt = await onCreate({ agent, rate, deposit, spec: spec.trim() });
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
        Escrow {CHAIN.symbol} for an agent — it gets paid automatically per
        completed task, and you can reclaim whatever's unspent.
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
        </div>

        <div className="frow">
          <div className="field">
            <label>Rate per task ({CHAIN.symbol})</label>
            <input
              className="mono"
              type="text"
              inputMode="decimal"
              placeholder="0.001"
              value={rate}
              onChange={(e) => setRate(e.target.value.trim())}
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
