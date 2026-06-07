import { CHAIN, ESCROW_ADDRESS } from "../config.js";
import { fmt, short, shortHash, timeAgo } from "../lib.js";

function Entry({ entry }) {
  return (
    <li className={`entry${entry.isNew ? " fresh" : ""}`}>
      <div className="entry-top">
        <span className="entry-title">
          Task #{entry.taskIndex} completed
          <span className="j"> · job #{entry.jobId}</span>
        </span>
        <span className="payout">
          +{fmt(entry.payout)} {CHAIN.symbol}
        </span>
      </div>

      {entry.summary && <p className="entry-sum">{entry.summary}</p>}

      <div className="entry-meta">
        <a
          href={`${CHAIN.explorer}/address/${entry.agent}`}
          target="_blank"
          rel="noreferrer"
          title={entry.agent}
        >
          {short(entry.agent)}
        </a>
        <span className="sep">•</span>
        <span className="proof" title={`proof-of-work hash: ${entry.workHash}`}>
          🔏 {shortHash(entry.workHash)}
        </span>
        <span className="sep">•</span>
        <span>{timeAgo(entry.timestamp)}</span>
        <span className="sep">•</span>
        <a
          href={`${CHAIN.explorer}/tx/${entry.txHash}`}
          target="_blank"
          rel="noreferrer"
        >
          tx ↗
        </a>
      </div>
    </li>
  );
}

export default function WorkFeed({ feed, loading }) {
  return (
    <section className="card panel stream">
      <div className="phead">
        <h2 className="ptitle">
          <span className="dot" /> Live Earnings Stream
        </h2>
        <span className="count">{feed.length}</span>
      </div>
      <p className="psub">Agents getting paid in real time — every entry is on-chain.</p>

      {!ESCROW_ADDRESS ? (
        <div className="empty">Waiting for contract deployment…</div>
      ) : loading ? (
        <div className="empty">Scanning chain for completed tasks…</div>
      ) : feed.length === 0 ? (
        <div className="empty">
          <div className="big">📡</div>
          No tasks completed yet — this stream lights up the instant an agent
          delivers work and gets paid.
        </div>
      ) : (
        <ul className="stream-list">
          {feed.map((entry) => (
            <Entry key={entry.key} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}
