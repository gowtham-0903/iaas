import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'

import { getCurrentUser, refreshSession } from '../api/authApi'
import useAuthStore from '../store/authStore'

export default function ProtectedRoute({ children }) {
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const logout = useAuthStore((state) => state.logout)
  const [isChecking, setIsChecking] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(Boolean(user))

  useEffect(() => {
    let isMounted = true

    async function checkSession() {
      try {
        const meResponse = await getCurrentUser()
        if (!isMounted) {
          return
        }
        setUser(meResponse.data)
        setIsAuthenticated(true)
      } catch (_meError) {
        try {
          await refreshSession()
          const meAfterRefresh = await getCurrentUser()
          if (!isMounted) {
            return
          }
          setUser(meAfterRefresh.data)
          setIsAuthenticated(true)
        } catch (_refreshError) {
          if (!isMounted) {
            return
          }
          logout()
          setIsAuthenticated(false)
        }
      } finally {
        if (isMounted) {
          setIsChecking(false)
        }
      }
    }

    checkSession()

    return () => {
      isMounted = false
    }
  }, [logout, setUser])

  if (isChecking) {
    return (
      <div className="flex items-center justify-center gap-2.5 min-h-screen text-slate-500 text-sm">
        <span className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full spin" aria-label="Checking session" />
        Checking session...
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return children ?? <Outlet />
}
