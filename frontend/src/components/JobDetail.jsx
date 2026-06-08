import { useState } from "react";
import { CHAIN } from "../config.js";
import { agentStatus, errMsg, fmt, short, shortHash, timeAgo } from "../lib.js";

/* cumulative-earnings bar chart (hand-rolled SVG, neobrutalist) */
function EarningsChart({ entries, rate }) {
  // entries are newest-first; walk oldest-first to build cumulative total
  const ordered = [...entries].sort((a, b) => a.taskIndex - b.taskIndex);
  if (ordered.length === 0) return null;

  const W = 520;
  const H = 150;
  const pad = { l: 12, r: 12, t: 14, b: 26 };
  const n = ordered.length;
  const gap = 10;
  const bw = Math.max(
    14,
    (W - pad.l - pad.r - gap * (n - 1)) / n
  );
  let cum = 0n;
  const bars = ordered.map((e, i) => {
    cum += e.payout;
    return { i, cum, taskIndex: e.taskIndex };
  });
  const maxCum = Number(fmt(bars[bars.length - 1].cum)) || 1;
  const chartH = H - pad.t - pad.b;

  return (
    <svg className="earn-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative earnings">
      {bars.map((b) => {
        const val = Number(fmt(b.cum));
        const h = Math.max(4, (val / maxCum) * chartH);
        const x = pad.l + b.i * (bw + gap);
        const y = pad.t + (chartH - h);
        return (
          <g key={b.i}>
            <rect x={x} y={y} width={bw} height={h} className="earn-bar" />
            <text x={x + bw / 2} y={H - 9} className="earn-x" textAnchor="middle">
              #{b.taskIndex}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function JobDetail({ job, entries, account, lastTask, onBack, onFund, onClose, notify }) {
  if (!job) {
    return (
      <main className="container">
        <div className="detail-back">
          <a className="btn btn-ghost" href="#/">
            ← Back to dashboard
          </a>
        </div>
        <div className="empty">
          <div className="big">🤷</div>
          Job not found. It may not have loaded yet.
        </div>
      </main>
    );
  }

  const earned = entries.reduce((a, e) => a + e.payout, 0n);
  const isClient = account && account.toLowerCase() === job.client.toLowerCase();
  const status = agentStatus(job.active, lastTask);

  return (
    <main className="container">
      <div className="detail-back">
        <a className="btn btn-ghost" href="#/">
          ← Back to dashboard
        </a>
      </div>

      <section className="card panel detail-head">
        <div className="detail-top">
          <h1 className="detail-id">Job #{job.id}</h1>
          <span className={`badge ${job.active ? "on" : "off"}`}>
            {job.active ? "● Active" : "Closed"}
          </span>
          {job.active && (
            <span className={`agent-status ${status.key}`}>
              <span className={`as-dot ${status.key}`} />
              {status.working ? "Agent working" : status.label}
            </span>
          )}
        </div>
        <p className="detail-spec">{job.spec || <em>No spec provided</em>}</p>

        <div className="detail-stats">
          <div className="dstat lime">
            <div className="k">Earned so far</div>
            <div className="v">
              {fmt(earned)} <span className="u">{CHAIN.symbol}</span>
            </div>
          </div>
          <div className="dstat blue">
            <div className="k">Tasks done</div>
            <div className="v">{job.tasksCompleted}</div>
          </div>
          <div className="dstat pink">
            <div className="k">Tasks left</div>
            <div className="v">{job.remaining}</div>
          </div>
          <div className="dstat yellow">
            <div className="k">Escrow left</div>
            <div className="v">
              {fmt(job.balance)} <span className="u">{CHAIN.symbol}</span>
            </div>
          </div>
        </div>

        <div className="detail-meta">
          <div className="cell">
            <span className="k">Agent</span>
            <a
              className="vv"
              href={`${CHAIN.explorer}/address/${job.agent}`}
              target="_blank"
              rel="noreferrer"
              title={job.agent}
            >
              {short(job.agent)} ↗
            </a>
          </div>
          <div className="cell">
            <span className="k">Client</span>
            <a
              className="vv"
              href={`${CHAIN.explorer}/address/${job.client}`}
              target="_blank"
              rel="noreferrer"
              title={job.client}
            >
              {short(job.client)} ↗
            </a>
          </div>
          <div className="cell">
            <span className="k">Rate / task</span>
            <span className="vv">
              {fmt(job.ratePerTask)} {CHAIN.symbol}
            </span>
          </div>
        </div>
      </section>

      <div className="grid">
        <div className="col">
          <section className="card panel">
            <div className="phead">
              <h2 className="ptitle">📈 Cumulative earnings</h2>
            </div>
            {entries.length === 0 ? (
              <div className="empty">No tasks completed for this job yet.</div>
            ) : (
              <EarningsChart entries={entries} rate={job.ratePerTask} />
            )}
          </section>

          {isClient && job.active && (
            <ClientControls job={job} onFund={onFund} onClose={onClose} notify={notify} />
          )}
        </div>

        <div className="col">
          <section className="card panel stream">
            <div className="phead">
              <h2 className="ptitle">
                <span className="dot" /> Task log
              </h2>
              <span className="count">{entries.length}</span>
            </div>
            <p className="psub">Every paid task this agent has delivered.</p>
            {entries.length === 0 ? (
              <div className="empty">
                <div className="big">📡</div>
                No tasks yet for this job.
              </div>
            ) : (
              <ul className="stream-list">
                {entries.map((e) => (
                  <li key={e.key} className="entry">
                    <div className="entry-top">
                      <span className="entry-title">Task #{e.taskIndex} completed</span>
                      <span className="payout">
                        +{fmt(e.payout)} {CHAIN.symbol}
                      </span>
                    </div>
                    {e.summary && <p className="entry-sum">{e.summary}</p>}
                    <div className="entry-meta">
                      <span className="proof" title={`proof-of-work hash: ${e.workHash}`}>
                        🔏 {shortHash(e.workHash)}
                      </span>
                      <span className="sep">•</span>
                      <span>{timeAgo(e.timestamp)}</span>
                      <span className="sep">•</span>
                      <a
                        href={`${CHAIN.explorer}/tx/${e.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        tx ↗
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function ClientControls({ job, onFund, onClose, notify }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(null);

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
    <section className="card panel">
      <div className="phead">
        <h2 className="ptitle">🔧 Manage job</h2>
      </div>
      <p className="psub">You're the client — top up the escrow or close and reclaim it.</p>
      <div className="job-actions" style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }}>
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
    </section>
  );
}
