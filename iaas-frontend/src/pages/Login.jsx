import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { login } from '../api/authApi'
import useAuthStore from '../store/authStore'

export default function Login() {
  const [email, setEmail] = useState('admin@meedenlabs.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)

  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true })
    }
  }, [navigate, user])

  async function handleSubmit(event) {
    event.preventDefault()

    if (!email.trim() || !password.trim()) {
      setError('Enter both email and password to continue.')
      return
    }

    try {
      setIsLoading(true)
      setError('')
      const response = await login(email, password)
      setUser(response.data.user)
      navigate('/dashboard', { replace: true })
    } catch (loginError) {
      const message = loginError?.response?.data?.error || 'Unable to sign in. Check your credentials and try again.'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">
          <div className="name">IAAS</div>
          <div className="sub">Interview Assessment & Feedback System</div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            type="email"
            placeholder="admin@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? <div className="login-error">{error}</div> : null}
        <button className="btn btn-primary btn-block login-submit" type="submit" disabled={isLoading}>
          {isLoading ? 'Signing in...' : 'Sign in'}
        </button>
        <p className="login-footer">
          Role-based access — Admin · Recruiter · Panelist · QC · Client
        </p>
        <p className="login-preview-link">
          <Link to="/dashboard">Open dashboard preview</Link>
        </p>
      </form>
    </div>
  )
}
