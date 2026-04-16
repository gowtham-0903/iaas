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
    return <div className="loading-state"><div className="loading-spinner" aria-label="Checking session" /><span>Checking session...</span></div>
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return children ?? <Outlet />
}
