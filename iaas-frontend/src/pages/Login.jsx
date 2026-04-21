import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { login } from '../api/authApi'
import useAuthStore from '../store/authStore'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
    <div
      className="login-wrap"
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh'
      }}
    >
      <form
        className="login-card"
        style={{ width: '420px', padding: '32px' }}
        onSubmit={handleSubmit}
      >
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
            placeholder="admin@meedenlabs.com"
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
            type={showPassword ? 'text' : 'password'}
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div style={{ marginTop: '6px' }}>
            <label style={{ fontSize: '12px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showPassword}
                onChange={() => setShowPassword((prev) => !prev)}
                style={{ marginRight: '6px' }}
              />
              Show password
            </label>
          </div>
        </div>
        {error ? <div className="login-error">{error}</div> : null}
        <button className="btn btn-primary btn-block login-submit" type="submit" disabled={isLoading}>
          {isLoading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
