export default function MetricCard({ label, value, sub, subClassName = '', valueClassName = '' }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className={`metric-val ${valueClassName}`.trim()}>{value}</div>
      {sub ? <div className={`metric-sub ${subClassName}`.trim()}>{sub}</div> : null}
    </div>
  )
}
