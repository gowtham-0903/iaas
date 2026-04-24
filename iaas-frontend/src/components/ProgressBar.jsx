export default function ProgressBar({ label, value, fillWidth, fillColor }) {
  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-sm text-slate-600 font-medium">{label}</span>
        <span className="text-sm font-semibold text-slate-800">{value}</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: fillWidth,
            background: fillColor || '#2563eb',
          }}
        />
      </div>
    </div>
  )
}
