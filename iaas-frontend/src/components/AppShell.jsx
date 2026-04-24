import Sidebar from './Sidebar'
import PlatformHeader from './PlatformHeader'

export default function AppShell({ children, logoSubtitle, pageTitle, pageSubtitle }) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#f0f4f8' }}>
      <Sidebar logoSubtitle={logoSubtitle} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <PlatformHeader pageTitle={pageTitle} pageSubtitle={pageSubtitle} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
