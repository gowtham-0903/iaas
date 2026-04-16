import useAuthStore from '../store/authStore'
import platformLogo from '../../MEEDENLABS_LOGO_WITH_FONT_TradeMark_1.jpg'

function getInitials(name) {
  if (!name) {
    return 'IA'
  }

  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export default function PlatformHeader() {
  const user = useAuthStore((state) => state.user)
  const initials = getInitials(user?.full_name)

  return (
    <header className="platform-header">
      <div className="header-brand" aria-label="Platform logo">
        <img className="header-logo-image" src={platformLogo} alt="MEEDENLABS" />
      </div>

      <div className="header-actions">
        <button className="header-notification" type="button" aria-label="Notifications">
          <span className="header-notification-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
              <path d="M12 21.25a2.75 2.75 0 0 0 2.67-2.1H9.33A2.75 2.75 0 0 0 12 21.25Zm7.18-5.5-1.43-1.43V10a5.75 5.75 0 1 0-11.5 0v4.32L4.82 15.75v1h14.36v-1Zm-3.33-1.43H8.15V10a3.85 3.85 0 1 1 7.7 0v4.32Z" />
            </svg>
          </span>
          <span className="header-notification-badge">1</span>
        </button>

        <div className="header-profile">
          <div className="header-profile-copy">
            <div className="header-profile-name">{user?.full_name || 'Admin'}</div>
            <div className="header-profile-role">{user?.role || 'ADMIN'}</div>
          </div>
          <div className="header-profile-avatar" aria-label={user?.full_name || 'Profile'}>
            {initials}
            <span className="header-profile-status" aria-hidden="true" />
          </div>
        </div>
      </div>
    </header>
  )
}