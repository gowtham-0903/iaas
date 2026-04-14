export default function ProgressBar({ label, value, fillWidth, fillColor }) {
  return (
    <div className="bar-row">
      <div className="bar-label">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: fillWidth, background: fillColor }}
        />
      </div>
    </div>
  )
}
