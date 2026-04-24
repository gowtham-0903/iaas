import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { login } from '../api/authApi'
import useAuthStore from '../store/authStore'
import platformLogo from '../../logo/MEEDENLABS_LOGO_WITH_FONT_TradeMark_1.jpg'

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
    if (user) navigate('/dashboard', { replace: true })
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
      const message =
        loginError?.response?.data?.error ||
        'Unable to sign in. Check your credentials and try again.'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* ── LEFT — Form Panel ──────────────────────────────── */}
      <div className="flex-1 flex flex-col justify-center px-10 py-12 max-w-[480px] mx-auto w-full">
        {/* Logo / brand */}
        <div className="mb-8">
          <img src={platformLogo} alt="Meeden Labs" className="h-10 w-auto" />
          <h1 className="text-2xl font-bold text-slate-900 mt-6 mb-1">Sign in</h1>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-5 flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Email */}
          <div>
            <label htmlFor="email" className="block text-xs font-semibold text-slate-600 mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <input
                id="email"
                type="email"
                placeholder="Johndoe@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#02c0fa] focus:ring-2 focus:ring-[#02c0fa]/20 transition-all bg-white"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-xs font-semibold text-slate-600 mb-1.5">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-12 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#02c0fa] focus:ring-2 focus:ring-[#02c0fa]/20 transition-all bg-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600"
              >
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full text-white font-semibold py-3 rounded-xl text-sm transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            style={{ background: 'linear-gradient(135deg, #02c0fa 0%, #0090d4 100%)', boxShadow: '0 4px 16px rgba(2, 192, 250, 0.35)' }}
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin" />
                Signing in...
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>
      </div>

      {/* ── RIGHT — Dark Brand Panel ────────────────────────── */}
      <div
        className="hidden lg:flex flex-1 flex-col justify-between relative overflow-hidden rounded-l-[32px] m-2"
        style={{
          background: 'linear-gradient(160deg, #0a0f1e 0%, #0d1b35 40%, #0a0f1e 100%)',
        }}
      >
        {/* Glow blobs */}
        <div
          className="absolute top-0 left-0 w-72 h-72 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(2,192,250,0.18) 0%, transparent 70%)',
            transform: 'translate(-30%, -30%)',
          }}
        />
        <div
          className="absolute bottom-0 right-0 w-96 h-96 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(2,192,250,0.10) 0%, transparent 70%)',
            transform: 'translate(30%, 30%)',
          }}
        />

        {/* Decorative geometric lines */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
          <div
            className="absolute"
            style={{
              top: '35%',
              left: '15%',
              width: '260px',
              height: '260px',
              border: '1px solid rgba(2,192,250,0.5)',
              borderRadius: '20px',
              transform: 'rotate(20deg)',
            }}
          />
          <div
            className="absolute"
            style={{
              top: '25%',
              left: '25%',
              width: '200px',
              height: '200px',
              border: '1px solid rgba(2,192,250,0.3)',
              borderRadius: '20px',
              transform: 'rotate(35deg)',
            }}
          />
        </div>

        {/* Top area */}
        <div className="relative z-10 p-10">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
              style={{ background: 'rgba(2,192,250,0.25)', border: '1px solid rgba(2,192,250,0.4)' }}
            >
              IA
            </div>
            <span className="text-white font-bold text-sm opacity-90">IAAS</span>
          </div>
        </div>

        {/* Middle — main brand message */}
        <div className="relative z-10 px-10 py-8">
          <p className="text-[#02c0fa] text-xs font-semibold uppercase tracking-widest mb-3 opacity-80">
            Interview Assessment & Feedback
          </p>
          <h2 className="text-white text-3xl font-bold leading-tight mb-4">
            Welcome to IAAS
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
            Streamline your recruitment pipeline — from job descriptions and AI skill extraction to candidate evaluation and scoring reports.
          </p>
        </div>

      </div>
    </div>
  )
}
