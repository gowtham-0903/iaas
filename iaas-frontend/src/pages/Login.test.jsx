import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Login from './Login'
import useAuthStore from '../store/authStore'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../api/authApi', () => ({
  login: vi.fn(),
}))

// Mock the logo image import so Jest/Vitest doesn't choke on binary assets
vi.mock('../../logo/MEEDENLABS_LOGO_WITH_FONT_TradeMark_1.jpg', () => ({ default: 'logo.jpg' }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

import { login } from '../api/authApi'

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null })
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Login page — rendering', () => {
  it('renders email and password inputs', () => {
    renderLogin()
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('renders sign-in button', () => {
    renderLogin()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('does not show an error on initial render', () => {
    renderLogin()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Login page — validation', () => {
  it('shows error when email is empty on submit', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(screen.getByText(/enter both email and password/i)).toBeInTheDocument()
    })
  })

  it('shows error when password is empty on submit', async () => {
    renderLogin()
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'user@test.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(screen.getByText(/enter both email and password/i)).toBeInTheDocument()
    })
  })
})

describe('Login page — successful login', () => {
  it('calls login API with email and password', async () => {
    login.mockResolvedValueOnce({ data: { user: { id: 1, role: 'ADMIN', email: 'admin@test.com' } } })
    renderLogin()

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'admin@test.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Admin@1234' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('admin@test.com', 'Admin@1234')
    })
  })

  it('navigates to /dashboard for non-CLIENT roles after login', async () => {
    login.mockResolvedValueOnce({ data: { user: { id: 1, role: 'ADMIN', email: 'admin@test.com' } } })
    renderLogin()

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'admin@test.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Admin@1234' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true })
    })
  })

  it('navigates to /client-dashboard for CLIENT role after login', async () => {
    login.mockResolvedValueOnce({ data: { user: { id: 2, role: 'CLIENT', email: 'client@test.com' } } })
    renderLogin()

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'client@test.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Pass@1234' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/client-dashboard', { replace: true })
    })
  })
})

describe('Login page — failed login', () => {
  it('shows API error message on 401', async () => {
    login.mockRejectedValueOnce({
      response: { data: { error: 'Invalid credentials' } },
    })
    renderLogin()

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'bad@test.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument()
    })
  })

  it('shows fallback error when API returns no message', async () => {
    login.mockRejectedValueOnce(new Error('Network Error'))
    renderLogin()

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'bad@test.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByText(/unable to sign in/i)).toBeInTheDocument()
    })
  })
})
