import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import platformLogo from '../../logo/MEEDENLABS_LOGO_WITH_FONT_TradeMark_1.jpg'

import { logout as logoutRequest } from '../api/authApi'
import useAuthStore from '../store/authStore'

const navigationSections = [
  {
    heading: 'Main',
    items: [
      {
        label: 'Dashboard',
        to: '/dashboard',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        ),
      },
      {
        label: 'Clients',
        to: '/clients',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        ),
      },
      {
        label: 'Job Descriptions',
        to: '/jd',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },
      {
        label: 'AI Skill Extraction',
        to: '/skill-extraction',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        ),
      },
      {
        label: 'Candidates',
        to: '/candidates',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
    ],
  },
  {
    heading: 'Interviews',
    items: [
      {
        label: 'Schedule',
        to: '/schedule',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        label: 'Feedback',
        to: '/feedback',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        ),
      },
    ],
  },
  {
    heading: 'Reports',
    items: [
      {
        label: 'Score Reports',
        to: '/report',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
      },
      {
        label: 'Users',
        to: '/users',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        ),
      },
    ],
  },
]

function isActiveRoute(pathname, to) {
  return pathname === to || (to === '/dashboard' && pathname === '/')
}

export default function Sidebar({ logoSubtitle = 'Admin Panel' }) {
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const [mobileOpen, setMobileOpen] = useState(false)

  function canViewItem(item) {
    if (item.to === '/users') {
      return [
        'ADMIN',
        'M_RECRUITER',
        'SR_RECRUITER',
      ].includes(user?.role)
    }
    return true
  }

  async function handleLogout() {
    try {
      await logoutRequest()
    } catch (_error) {
      // no-op
    } finally {
      logout()
      navigate('/login', { replace: true })
    }
  }

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="fixed top-4 left-4 z-50 md:hidden bg-white text-slate-700 p-2 rounded-lg shadow-md border border-slate-200"
        onClick={() => setMobileOpen((prev) => !prev)}
        type="button"
        aria-label="Toggle menu"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          {mobileOpen
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          }
        </svg>
      </button>

      {/* Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — white glassmorphic */}
      <aside
        className={`
          fixed top-0 left-0 h-full z-40 w-64 flex flex-col
          bg-white/80 backdrop-blur-xl border-r border-slate-200/70
          shadow-[4px_0_24px_rgba(0,0,0,0.06)]
          transform transition-transform duration-300 ease-in-out
          md:static md:translate-x-0 md:flex-shrink-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-100 flex justify-center">
          <img src={platformLogo} alt="Meeden Labs" className="h-10 w-auto" />
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
          {navigationSections.map((section) => (
            <div key={section.heading}>
              <div className="text-slate-400 text-[10px] font-semibold uppercase tracking-widest px-3 mb-1.5">
                {section.heading}
              </div>
              <div className="space-y-0.5">
                {section.items.filter(canViewItem).map((item) => {
                  const active = isActiveRoute(location.pathname, item.to)
                  return (
                    <Link
                      key={item.label}
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      className={`
                        flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
                        ${active
                          ? 'text-white shadow-sm'
                          : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/80'
                        }
                      `}
                      style={active ? {
                        background: 'linear-gradient(135deg, #02c0fa 0%, #00a8e0 100%)',
                        boxShadow: '0 4px 12px rgba(2, 192, 250, 0.30)',
                      } : {}}
                    >
                      <span className={active ? 'text-white' : 'text-slate-400'}>
                        {item.icon}
                      </span>
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-100 p-4 space-y-3">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 text-xs font-medium transition-colors"
            type="button"
            onClick={handleLogout}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        </div>
      </aside>
    </>
  )
}
