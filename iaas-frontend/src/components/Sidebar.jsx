import { Link, useLocation, useNavigate } from 'react-router-dom'

import { logoutRequest } from '../api/auth'
import useAuthStore from '../store/authStore'

const navigationSections = [
  {
    heading: 'Main',
    items: [
      { label: 'Dashboard', to: '/dashboard' },
      { label: 'Clients', to: '/dashboard' },
      { label: 'Job Descriptions', to: '/jd' },
      { label: 'AI Skill Extraction', to: '/skill-extraction' },
      { label: 'Candidates', to: '/candidates' },
    ],
  },
  {
    heading: 'Interviews',
    items: [
      { label: 'Schedule', to: '/dashboard' },
      { label: 'Feedback', to: '/feedback' },
    ],
  },
  {
    heading: 'Reports',
    items: [
      { label: 'Score Reports', to: '/report' },
      { label: 'Users', to: '/dashboard' },
    ],
  },
]

function isActiveRoute(pathname, to) {
  return pathname === to || (to === '/dashboard' && pathname === '/')
}

export default function Sidebar({ logoSubtitle = 'Admin panel' }) {
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)

  async function handleLogout() {
    try {
      await logoutRequest()
    } catch (_error) {
      // Clear local state even if the revocation call fails.
    } finally {
      logout()
      navigate('/login', { replace: true })
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-name">IAAS</div>
        <div className="logo-sub">{logoSubtitle}</div>
      </div>
      {navigationSections.map((section) => (
        <div key={section.heading}>
          <div className="nav-section">{section.heading}</div>
          {section.items.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className={`nav-item ${isActiveRoute(location.pathname, item.to) ? 'active' : ''}`}
            >
              <div className="icon" />
              {item.label}
            </Link>
          ))}
        </div>
      ))}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-name">{user?.full_name || 'Signed in user'}</div>
          <div className="sidebar-user-meta">{user?.role || 'No role'}</div>
        </div>
        <button className="btn sidebar-logout" type="button" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </aside>
  )
}
