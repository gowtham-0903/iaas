export default function MetricCard({ label, value, sub, subClassName = '', valueClassName = '', icon }) {
  return (
    <div className="bg-white rounded-2xl shadow-card p-5 flex flex-col gap-3 hover:shadow-card-hover transition-shadow duration-200">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
        {icon && (
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
            {icon}
          </div>
        )}
      </div>
      <div className={`text-3xl font-bold text-slate-900 leading-none ${valueClassName}`}>
        {value}
      </div>
      {sub && (
        <div className={`text-xs font-medium flex items-center gap-1 ${subClassName || 'text-emerald-600'}`}>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
          {sub}
        </div>
      )}
    </div>
  )
}
