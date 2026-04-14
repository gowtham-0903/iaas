import { useEffect, useState } from 'react'

import AppShell from '../components/AppShell'
import MetricCard from '../components/MetricCard'
import ProgressBar from '../components/ProgressBar'
import { getUsers } from '../api/usersApi'

function LoadingSpinner() {
  return <div className="loading-spinner" aria-label="Loading users" />
}

export default function Dashboard() {
  const [users, setUsers] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadUsers() {
      try {
        setIsLoading(true)
        setError('')
        const response = await getUsers()
        const payload = response.data
        const nextUsers = Array.isArray(payload) ? payload : payload.users ?? []

        if (isMounted) {
          setUsers(nextUsers)
        }
      } catch (fetchError) {
        if (isMounted) {
          const message = fetchError?.response?.data?.message || 'Unable to load users.'
          setError(message)
          setUsers([])
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadUsers()

    return () => {
      isMounted = false
    }
  }, [])

  return (
    <AppShell>
      <div className="topbar">
        <h1>Dashboard</h1>
        <button className="btn">+ New JD</button>
      </div>

      <div className="metric-grid">
        <MetricCard label="Active JDs" value="12" sub="+2 this week" />
        <MetricCard label="Candidates" value="48" sub="+7 this week" />
        <MetricCard label="Interviews" value="9" sub="3 this week" />
        <MetricCard label="Pending QC" value="5" sub="needs review" />
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-title">Users</div>
          {error ? <div className="login-error">{error}</div> : null}
          {isLoading ? (
            <div className="loading-state">
              <LoadingSpinner />
              <span>Loading users...</span>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Full Name</th>
                  <th>Email</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.full_name}</td>
                    <td>{user.email}</td>
                    <td>{user.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-title">Pipeline overview</div>
          <ProgressBar label="Applied" value="24" fillWidth="100%" />
          <ProgressBar label="Shortlisted" value="14" fillWidth="58%" />
          <ProgressBar label="Interviewed" value="9" fillWidth="37%" />
          <ProgressBar label="Offered" value="3" fillWidth="12%" fillColor="#1D9E75" />
          <ProgressBar label="Rejected" value="5" fillWidth="20%" fillColor="#E24B4A" />
        </div>
      </div>
    </AppShell>
  )
}
