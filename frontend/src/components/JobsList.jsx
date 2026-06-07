import { useState } from "react";
import { CHAIN, ESCROW_ADDRESS } from "../config.js";
import { errMsg, fmt, short } from "../lib.js";

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

function JobCard({ job, isClient, onFund, onClose, notify }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(null);

  // escrow consumed vs original (paid + remaining), for the progress bar
  const paid = BigInt(job.tasksCompleted) * job.ratePerTask;
  const total = paid + job.balance;
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
        <span className={`badge ${job.active ? "on" : "off"}`}>
          {job.active ? "● Active" : "Closed"}
        </span>
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
          <span className="k">Tasks done</span>
          <span className="vv">{job.tasksCompleted}</span>
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

export default function JobsList({ jobs, account, loading, onFund, onClose, notify }) {
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
        <div className="jobs">
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
