import Sidebar from './Sidebar'

export default function AppShell({ children, logoSubtitle }) {
  return (
    <div className="app-shell">
      <Sidebar logoSubtitle={logoSubtitle} />
      <div className="main">{children}</div>
    </div>
  )
}
