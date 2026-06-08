import { useState } from "react";
import { CHAIN, ESCROW_ADDRESS } from "../config.js";
import { agentStatus, errMsg, fmt, short } from "../lib.js";

function AddrLink({ addr }) {
  return (
    <a
      className="mono"
      href={`${CHAIN.explorer}/address/${addr}`}
      target="_blank"
      rel="noreferrer"
      title={addr}
    >
      {short(addr)}
    </a>
  );
}

function JobCard({ job, isClient, lastTs, onFund, onClose, notify }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(null);
  const status = agentStatus(job.active, lastTs);

  // escrow consumed vs total (paid + free + reserved), for the progress bar
  const paid = BigInt(job.tasksPaid) * job.ratePerTask;
  const total = paid + job.balance + (job.reserved || 0n);
  const pct = total > 0n ? Number((paid * 100n) / total) : 0;

  const fund = async () => {
    if (!amount || Number(amount) <= 0) {
      notify("err", "Enter a top-up amount");
      return;
    }
    setBusy("fund");
    try {
      await onFund(job.id, amount);
      setAmount("");
    } catch (e) {
      notify("err", errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const close = async () => {
    setBusy("close");
    try {
      await onClose(job.id);
    } catch (e) {
      notify("err", errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className={`job${job.active ? "" : " closed"}`}>
      <div className="job-top">
        <span className="job-id">Job #{job.id}</span>
        <div className="job-top-right">
          <span className={`badge ${job.active ? "on" : "off"}`}>
            {job.active ? "● Active" : "Closed"}
          </span>
          <a className="view-link" href={`#/job/${job.id}`}>
            View →
          </a>
        </div>
      </div>

      <div className="job-status-row">
        {job.active && (
          <span className={`agent-status ${status.key}`}>
            <span className={`as-dot ${status.key}`} />
            {status.working ? "Agent working" : status.label}
          </span>
        )}
        {job.pending > 0 && (
          <span className="agent-status pending-pill">
            ⏳ {job.pending} pending review
          </span>
        )}
      </div>

      <p className="job-spec">{job.spec || <em>No spec provided</em>}</p>

      <div className="job-grid">
        <div className="cell">
          <span className="k">Agent</span>
          <span className="vv">
            <AddrLink addr={job.agent} />
          </span>
        </div>
        <div className="cell">
          <span className="k">Rate / task</span>
          <span className="vv">{fmt(job.ratePerTask)}</span>
        </div>
        <div className="cell">
          <span className="k">Escrow left</span>
          <span className="vv">{fmt(job.balance)}</span>
        </div>
        <div className="cell">
          <span className="k">Tasks paid</span>
          <span className="vv">{job.tasksPaid}</span>
        </div>
        <div className="cell">
          <span className="k">Tasks left</span>
          <span className="vv">{job.remaining}</span>
        </div>
        <div className="cell">
          <span className="k">Client</span>
          <span className="vv">
            <AddrLink addr={job.client} />
          </span>
        </div>
      </div>

      <div className="bar" title={`${pct}% of escrow paid out`}>
        <i style={{ width: `${pct}%` }} />
      </div>

      {isClient && job.active && (
        <div className="job-actions">
          <input
            className="mono fund-input"
            type="text"
            inputMode="decimal"
            placeholder={`Top up (${CHAIN.symbol})`}
            value={amount}
            onChange={(e) => setAmount(e.target.value.trim())}
          />
          <button className="btn btn-ghost" onClick={fund} disabled={busy !== null}>
            {busy === "fund" ? "Funding…" : "Fund"}
          </button>
          <button className="btn btn-danger" onClick={close} disabled={busy !== null}>
            {busy === "close" ? "Closing…" : "Close"}
          </button>
        </div>
      )}
    </article>
  );
}

export default function JobsList({ jobs, account, loading, grid, lastTaskByJob = {}, onFund, onClose, notify }) {
  return (
    <section className="card panel">
      <div className="phead">
        <h2 className="ptitle">💼 Jobs</h2>
        <span className="count">{jobs.length}</span>
      </div>
      <p className="psub">Every agent on the AgentPay payroll.</p>

      {!ESCROW_ADDRESS ? (
        <div className="empty">Deploy the contract to start hiring agents.</div>
      ) : loading ? (
        <div className="empty">Loading jobs from chain…</div>
      ) : jobs.length === 0 ? (
        <div className="empty">
          <div className="big">💼</div>
          No jobs yet — be the first to put an agent to work.
        </div>
      ) : (
        <div className={grid ? "jobs jobs-grid" : "jobs"}>
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              isClient={
                account && account.toLowerCase() === job.client.toLowerCase()
              }
              lastTs={lastTaskByJob[job.id]}
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
