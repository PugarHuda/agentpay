import { useState } from "react";
import { CHAIN, ESCROW_ADDRESS } from "../config.js";
import { errMsg, fmt, short } from "../lib.js";

function AddrLink({ addr, label }) {
  return (
    <a
      className="mono addr-link"
      href={`${CHAIN.explorer}/address/${addr}`}
      target="_blank"
      rel="noreferrer"
      title={addr}
    >
      {label || short(addr)}
    </a>
  );
}

function JobCard({ job, isClient, onFund, onClose, notify }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(null); // "fund" | "close"

  const fund = async () => {
    if (!amount || Number(amount) <= 0) {
      notify("error", "Enter a top-up amount");
      return;
    }
    setBusy("fund");
    try {
      await onFund(job.id, amount);
      setAmount("");
    } catch (e) {
      notify("error", errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const close = async () => {
    setBusy("close");
    try {
      await onClose(job.id);
    } catch (e) {
      notify("error", errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className={`card job-card${job.active ? "" : " job-closed"}`}>
      <div className="job-head">
        <span className="job-id mono">Job #{job.id}</span>
        <span className={`badge ${job.active ? "badge-active" : "badge-closed"}`}>
          {job.active ? "Active" : "Closed"}
        </span>
      </div>

      <p className="job-spec">{job.spec || <em>No spec provided</em>}</p>

      <div className="job-grid">
        <div className="job-cell">
          <span className="cell-label">Client</span>
          <AddrLink addr={job.client} />
        </div>
        <div className="job-cell">
          <span className="cell-label">Agent</span>
          <AddrLink addr={job.agent} />
        </div>
        <div className="job-cell">
          <span className="cell-label">Rate / task</span>
          <span className="mono">
            {fmt(job.ratePerTask)} <span className="unit">{CHAIN.symbol}</span>
          </span>
        </div>
        <div className="job-cell">
          <span className="cell-label">Escrow balance</span>
          <span className="mono">
            {fmt(job.balance)} <span className="unit">{CHAIN.symbol}</span>
          </span>
        </div>
        <div className="job-cell">
          <span className="cell-label">Tasks done</span>
          <span className="mono">{job.tasksCompleted}</span>
        </div>
        <div className="job-cell">
          <span className="cell-label">Tasks remaining</span>
          <span className="mono">{job.remaining}</span>
        </div>
      </div>

      {isClient && job.active && (
        <div className="job-actions">
          <input
            className="mono fund-input"
            type="text"
            inputMode="decimal"
            placeholder={`Amount (${CHAIN.symbol})`}
            value={amount}
            onChange={(e) => setAmount(e.target.value.trim())}
          />
          <button
            className="btn btn-secondary"
            onClick={fund}
            disabled={busy !== null}
          >
            {busy === "fund" ? "Funding…" : "Fund"}
          </button>
          <button
            className="btn btn-danger"
            onClick={close}
            disabled={busy !== null}
          >
            {busy === "close" ? "Closing…" : "Close"}
          </button>
        </div>
      )}
    </article>
  );
}

export default function JobsList({ jobs, account, loading, onFund, onClose, notify }) {
  return (
    <section className="jobs-section">
      <h2 className="section-title">
        Jobs <span className="count-pill mono">{jobs.length}</span>
      </h2>

      {!ESCROW_ADDRESS ? (
        <div className="empty">Deploy the contract to start hiring agents.</div>
      ) : loading ? (
        <div className="empty">Loading jobs from chain…</div>
      ) : jobs.length === 0 ? (
        <div className="empty">
          No jobs yet — be the first to put an agent to work.
        </div>
      ) : (
        <div className="jobs-list">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              isClient={
                account && account.toLowerCase() === job.client.toLowerCase()
              }
              onFund={onFund}
              onClose={onClose}
              notify={notify}
            />
          ))}
        </div>
      )}
    </section>
  );
}
