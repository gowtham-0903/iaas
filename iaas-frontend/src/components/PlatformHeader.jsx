import useAuthStore from '../store/authStore'
import platformLogo from '../../logo/MEEDENLABS_LOGO_WITH_FONT_TradeMark_1.jpg'

function getInitials(name) {
  if (!name) return 'IA'
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export default function PlatformHeader({ pageTitle, pageSubtitle }) {
  const user = useAuthStore((state) => state.user)
  const initials = getInitials(user?.full_name)

  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <header className="bg-white border-b border-slate-200 px-6 h-[60px] flex items-center justify-between gap-4 flex-shrink-0">
      {/* Left: Page title + subtitle */}
      <div className="min-w-0">
        {pageTitle ? (
          <div>
            <h1 className="text-base font-semibold text-slate-900 leading-tight truncate">{pageTitle}</h1>
            {pageSubtitle && (
              <p className="text-xs text-slate-500 mt-0.5 truncate hidden sm:block">{pageSubtitle}</p>
            )}
          </div>
        ) : (
          <div className="flex items-center" aria-label="Platform logo">
            <img
              className="h-7 w-auto max-w-[180px] object-contain"
              src={platformLogo}
              alt="MEEDENLABS"
            />
          </div>
        )}
      </div>

      {/* Right: Date + Notification + Profile */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {/* Date badge */}
        <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {dateStr}
        </div>

        {/* Notifications */}
        <button
          type="button"
          aria-label="Notifications"
          className="relative w-9 h-9 rounded-full border border-slate-200 bg-white flex items-center justify-center hover:bg-slate-50 transition-colors"
        >
          <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-white text-[9px] font-semibold flex items-center justify-center border-2 border-white" style={{ background: '#02c0fa' }}>
            1
          </span>
        </button>

        {/* Profile */}
        <div className="flex items-center gap-2.5 pl-3 border-l border-slate-200">
          <div className="hidden sm:block text-right">
            <div className="text-sm font-medium text-slate-900 leading-tight">{user?.full_name || 'Admin'}</div>
            <div className="text-xs text-slate-500 capitalize">{user?.role?.toLowerCase().replace('_', ' ') || 'admin'}</div>
          </div>
          <div className="relative w-9 h-9 rounded-full text-white flex items-center justify-center text-sm font-semibold border-2 border-white shadow-sm ring-1 ring-slate-200 flex-shrink-0" style={{ background: 'linear-gradient(135deg, #02c0fa 0%, #0090d4 100%)' }}>
            {initials}
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" />
          </div>
        </div>
      </div>
    </header>
  )
}