import { CHAIN, ESCROW_ADDRESS } from "../config.js";
import { fmt, short, shortHash, timeAgo } from "../lib.js";

function FeedEntry({ entry }) {
  return (
    <li className={`feed-entry${entry.isNew ? " feed-new" : ""}`}>
      <div className="feed-top">
        <span className="feed-title">
          Task <span className="mono">#{entry.taskIndex}</span> completed
          <span className="feed-job mono"> · job #{entry.jobId}</span>
        </span>
        <span className="payout mono">+{fmt(entry.payout)} {CHAIN.symbol}</span>
      </div>

      {entry.summary && <p className="feed-summary">{entry.summary}</p>}

      <div className="feed-meta mono">
        <a
          href={`${CHAIN.explorer}/address/${entry.agent}`}
          target="_blank"
          rel="noreferrer"
          title={entry.agent}
        >
          {short(entry.agent)}
        </a>
        <span className="meta-sep">·</span>
        <span title={entry.workHash}>{shortHash(entry.workHash)}</span>
        <span className="meta-sep">·</span>
        <span>{timeAgo(entry.timestamp)}</span>
        <span className="meta-sep">·</span>
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
    <section className="card feed-panel">
      <div className="feed-head">
        <h2 className="panel-title">
          <span className="live-dot" /> Live Work Feed
        </h2>
        <span className="feed-sub">agents getting paid in real time</span>
      </div>

      {!ESCROW_ADDRESS ? (
        <div className="empty">Waiting for contract deployment…</div>
      ) : loading ? (
        <div className="empty">Scanning chain for completed tasks…</div>
      ) : feed.length === 0 ? (
        <div className="empty">
          No tasks completed yet — the feed lights up the moment an agent
          delivers work.
        </div>
      ) : (
        <ul className="feed-list">
          {feed.map((entry) => (
            <FeedEntry key={entry.key} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}
