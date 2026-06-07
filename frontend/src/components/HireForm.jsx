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
  const [success, setSuccess] = useState(null); // tx hash

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
      const receipt = await onCreate({
        agent,
        rate,
        deposit,
        spec: spec.trim(),
      });
      setSuccess(receipt.hash);
      setSpec("");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card panel">
      <h2 className="panel-title">Hire an Agent</h2>
      <p className="panel-sub">
        Escrow {CHAIN.symbol} for an agent — it gets paid automatically per
        completed task.
      </p>

      <form onSubmit={submit} className="hire-form">
        <label className="field">
          <span>Agent address</span>
          <input
            className="mono"
            type="text"
            placeholder="0x…"
            value={agent}
            onChange={(e) => setAgent(e.target.value.trim())}
            spellCheck={false}
            disabled={disabled}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Rate per task ({CHAIN.symbol})</span>
            <input
              className="mono"
              type="text"
              inputMode="decimal"
              placeholder="0.001"
              value={rate}
              onChange={(e) => setRate(e.target.value.trim())}
              disabled={disabled}
            />
          </label>
          <label className="field">
            <span>Deposit ({CHAIN.symbol})</span>
            <input
              className="mono"
              type="text"
              inputMode="decimal"
              placeholder="0.01"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value.trim())}
              disabled={disabled}
            />
          </label>
        </div>

        <label className="field">
          <span>Task spec</span>
          <textarea
            rows={3}
            placeholder="e.g. Summarize the top Litecoin news every hour…"
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            disabled={disabled}
          />
        </label>

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

      {error && <div className="form-msg form-error">{error}</div>}
      {success && (
        <div className="form-msg form-success">
          ✓ Job created — agent is on the clock.{" "}
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
