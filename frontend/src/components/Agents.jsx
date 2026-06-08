import { CHAIN, REGISTRY_ADDRESS } from "../config.js";
import { fmt, short } from "../lib.js";

/* Build each agent's on-chain reputation from escrow history:
   - tasks paid + total earned  ← TaskPaid feed (per agent)
   - disputes won / lost         ← DisputeResolved events joined to each job's agent
   - active jobs                 ← jobs list                                        */
function reputationFor(addr, feed, jobs, disputes) {
  const a = addr.toLowerCase();
  const paid = feed.filter((e) => e.agent?.toLowerCase() === a);
  const earned = paid.reduce((s, e) => s + e.payout, 0n);
  const agentJobs = jobs.filter((j) => j.agent?.toLowerCase() === a);
  const jobIds = new Set(agentJobs.map((j) => j.id));
  let won = 0,
    lost = 0;
  for (const d of disputes) {
    if (jobIds.has(d.jobId)) d.agentWon ? won++ : lost++;
  }
  return {
    tasksPaid: paid.length,
    earned,
    jobs: agentJobs.length,
    activeJobs: agentJobs.filter((j) => j.active).length,
    disputesWon: won,
    disputesLost: lost,
  };
}

export default function Agents({ agents, feed, jobs, disputes, loading }) {
  const rows = agents
    .map((ag) => ({ ...ag, rep: reputationFor(ag.addr, feed, jobs, disputes) }))
    .sort((x, y) => (y.rep.earned > x.rep.earned ? 1 : y.rep.earned < x.rep.earned ? -1 : 0));

  return (
    <section className="card panel">
      <div className="phead">
        <h2 className="ptitle">🧑‍💻 Registered agents</h2>
        <span className="count">{agents.length}</span>
      </div>
      <p className="psub">
        On-chain catalog ranked by earnings. Reputation is computed live from the
        escrow's task &amp; dispute history — proven agents rise to the top.
      </p>

      {!REGISTRY_ADDRESS ? (
        <div className="empty">Registry not configured.</div>
      ) : loading ? (
        <div className="empty">Loading the agent catalog…</div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <div className="big">🧑‍💻</div>
          No agents registered yet. Agents list themselves via the AgentRegistry
          contract.
        </div>
      ) : (
        <div className="agent-grid">
          {rows.map((ag, i) => (
            <article key={ag.addr} className="agent-card">
              <div className="agent-top">
                <span className="agent-rank">#{i + 1}</span>
                <span className="agent-name">{ag.name || "Unnamed agent"}</span>
                {!ag.active && <span className="badge off">inactive</span>}
              </div>
              {ag.bio && <p className="agent-bio">{ag.bio}</p>}
              {ag.capabilities && (
                <div className="agent-tags">
                  {ag.capabilities.split(",").filter(Boolean).map((t) => (
                    <span key={t} className="tag">{t.trim()}</span>
                  ))}
                </div>
              )}
              <div className="agent-rep">
                <div className="rep">
                  <span className="rep-v mono">{fmt(ag.rep.earned)}</span>
                  <span className="rep-k">{CHAIN.symbol} earned</span>
                </div>
                <div className="rep">
                  <span className="rep-v mono">{ag.rep.tasksPaid}</span>
                  <span className="rep-k">tasks paid</span>
                </div>
                <div className="rep">
                  <span className="rep-v mono">
                    {ag.rep.disputesWon}/{ag.rep.disputesWon + ag.rep.disputesLost}
                  </span>
                  <span className="rep-k">disputes won</span>
                </div>
                <div className="rep">
                  <span className="rep-v mono">{ag.rep.activeJobs}</span>
                  <span className="rep-k">active jobs</span>
                </div>
              </div>
              <div className="agent-foot">
                <a
                  className="mono agent-addr"
                  href={`${CHAIN.explorer}/address/${ag.addr}`}
                  target="_blank"
                  rel="noreferrer"
                  title={ag.addr}
                >
                  {short(ag.addr)} ↗
                </a>
                <span className="agent-rate mono">
                  ~{fmt(ag.suggestedRate)} {CHAIN.symbol}/task
                </span>
                <a className="btn btn-primary agent-hire" href={`#/hire/${ag.addr}`}>
                  Hire →
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
