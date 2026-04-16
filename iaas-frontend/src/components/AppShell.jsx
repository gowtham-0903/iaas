import Sidebar from './Sidebar'
import PlatformHeader from './PlatformHeader'

export default function AppShell({ children, logoSubtitle }) {
  return (
    <div className="app-shell">
      <Sidebar logoSubtitle={logoSubtitle} />
      <div className="app-shell-content">
        <PlatformHeader />
        <div className="main">{children}</div>
      </div>
    </div>
  )
}
