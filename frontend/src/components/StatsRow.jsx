import { CHAIN } from "../config.js";

function StatCard({ label, value, accent, loading }) {
  return (
    <div className={`card stat-card${accent ? " stat-accent" : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value mono">{loading ? "…" : value}</span>
    </div>
  );
}

export default function StatsRow({ totalJobs, totalTasks, totalPaid, loading }) {
  return (
    <section className="stats-row">
      <StatCard label="Total Jobs" value={totalJobs} loading={loading} />
      <StatCard label="Tasks Completed" value={totalTasks} loading={loading} />
      <StatCard
        label={`${CHAIN.symbol} Paid to Agents`}
        value={totalPaid}
        accent
        loading={loading}
      />
    </section>
  );
}
