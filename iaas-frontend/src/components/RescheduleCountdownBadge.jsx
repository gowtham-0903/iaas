function LockIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  )
}

function RefreshIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

export default function RescheduleCountdownBadge({ daysLeft, onClick, className = '' }) {
  const isReady = daysLeft === 0
  const canClick = isReady && typeof onClick === 'function'
  const sublabel = daysLeft == null
    ? 'Reschedule'
    : isReady
      ? '0 days left'
      : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`

  const sharedClassName = `inline-flex items-center rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
    isReady
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : 'border-slate-200 bg-slate-50 text-slate-600'
  } ${className}`.trim()

  const iconClassName = isReady ? 'text-blue-700' : 'text-slate-500'
  const content = (
    <span className="inline-flex items-center gap-1.5">
      {isReady ? <RefreshIcon className={`w-3.5 h-3.5 ${iconClassName}`} /> : <LockIcon className={`w-3.5 h-3.5 ${iconClassName}`} />}
      <span>{sublabel}</span>
    </span>
  )

  if (canClick) {
    return (
      <button type="button" onClick={onClick} className={`${sharedClassName} hover:bg-blue-100`}>
        {content}
      </button>
    )
  }

  return (
    <span className={sharedClassName} title={!isReady ? 'Candidate can be re-scheduled after the 60-day cooling period.' : undefined}>
      {content}
    </span>
  )
}
