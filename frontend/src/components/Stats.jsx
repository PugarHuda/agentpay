import { CHAIN } from "../config.js";

function Stat({ k, icon, value, unit, mint, loading }) {
  return (
    <div className={`stat${mint ? " mint" : ""}`}>
      <div className="k">
        {icon} {k}
      </div>
      {loading ? (
        <div className="skel" />
      ) : (
        <div className="v">
          {value}
          {unit && <span className="u"> {unit}</span>}
        </div>
      )}
    </div>
  );
}

export default function Stats({
  totalPaid,
  totalTasks,
  totalJobs,
  activeJobs,
  loading,
}) {
  return (
    <div className="stats">
      <Stat
        k="Paid to agents"
        icon="💸"
        value={totalPaid}
        unit={CHAIN.symbol}
        mint
        loading={loading}
      />
      <Stat k="Tasks completed" icon="✅" value={totalTasks} loading={loading} />
      <Stat k="Total jobs" icon="💼" value={totalJobs} loading={loading} />
      <Stat k="Active jobs" icon="⚡" value={activeJobs} loading={loading} />
    </div>
  );
}
