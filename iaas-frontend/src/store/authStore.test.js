import { describe, it, expect, beforeEach } from 'vitest'
import useAuthStore, { roleRanks } from './authStore'

// Reset store state between tests
beforeEach(() => {
  useAuthStore.setState({ user: null })
})

describe('roleRanks', () => {
  it('CLIENT has the lowest rank', () => {
    expect(roleRanks.CLIENT).toBe(1)
  })

  it('ADMIN has the highest rank', () => {
    expect(roleRanks.ADMIN).toBe(7)
  })

  it('rank order is CLIENT < PANELIST < RECRUITER < SR_RECRUITER < M_RECRUITER < QC < ADMIN', () => {
    expect(roleRanks.CLIENT).toBeLessThan(roleRanks.PANELIST)
    expect(roleRanks.PANELIST).toBeLessThan(roleRanks.RECRUITER)
    expect(roleRanks.RECRUITER).toBeLessThan(roleRanks.SR_RECRUITER)
    expect(roleRanks.SR_RECRUITER).toBeLessThan(roleRanks.M_RECRUITER)
    expect(roleRanks.M_RECRUITER).toBeLessThan(roleRanks.QC)
    expect(roleRanks.QC).toBeLessThan(roleRanks.ADMIN)
  })
})

describe('useAuthStore — setUser / logout', () => {
  it('initialises with user as null', () => {
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('setUser stores the user object', () => {
    const mockUser = { id: 1, email: 'admin@test.com', role: 'ADMIN' }
    useAuthStore.getState().setUser(mockUser)
    expect(useAuthStore.getState().user).toEqual(mockUser)
  })

  it('logout clears the user', () => {
    useAuthStore.getState().setUser({ id: 1, email: 'x@test.com', role: 'RECRUITER' })
    useAuthStore.getState().logout()
    expect(useAuthStore.getState().user).toBeNull()
  })
})

describe('useAuthStore — hasRoleAccess', () => {
  it('returns false when no user is set', () => {
    expect(useAuthStore.getState().hasRoleAccess(['ADMIN'])).toBe(false)
  })

  it('returns true when allowedRoles is empty and user is set', () => {
    useAuthStore.getState().setUser({ id: 1, role: 'RECRUITER' })
    expect(useAuthStore.getState().hasRoleAccess([])).toBe(true)
  })

  it('returns false when allowedRoles is empty and user is null', () => {
    expect(useAuthStore.getState().hasRoleAccess([])).toBe(false)
  })

  it('ADMIN has access to ADMIN-only routes', () => {
    useAuthStore.getState().setUser({ id: 1, role: 'ADMIN' })
    expect(useAuthStore.getState().hasRoleAccess(['ADMIN'])).toBe(true)
  })

  it('RECRUITER does not have access to ADMIN-only routes', () => {
    useAuthStore.getState().setUser({ id: 1, role: 'RECRUITER' })
    expect(useAuthStore.getState().hasRoleAccess(['ADMIN'])).toBe(false)
  })

  it('ADMIN has access to routes requiring RECRUITER or above', () => {
    useAuthStore.getState().setUser({ id: 1, role: 'ADMIN' })
    expect(useAuthStore.getState().hasRoleAccess(['RECRUITER', 'ADMIN'])).toBe(true)
  })

  it('M_RECRUITER has access to routes requiring SR_RECRUITER or above', () => {
    useAuthStore.getState().setUser({ id: 1, role: 'M_RECRUITER' })
    expect(useAuthStore.getState().hasRoleAccess(['SR_RECRUITER'])).toBe(true)
  })

  it('CLIENT does not have access to RECRUITER routes', () => {
    useAuthStore.getState().setUser({ id: 1, role: 'CLIENT' })
    expect(useAuthStore.getState().hasRoleAccess(['RECRUITER'])).toBe(false)
  })

  it('returns false for unknown role', () => {
    useAuthStore.getState().setUser({ id: 1, role: 'GHOST' })
    expect(useAuthStore.getState().hasRoleAccess(['RECRUITER'])).toBe(false)
  })

  it('uses minimum rank when multiple allowedRoles provided', () => {
    // PANELIST (rank 2) should pass if CLIENT (rank 1) is in allowedRoles
    useAuthStore.getState().setUser({ id: 1, role: 'PANELIST' })
    expect(useAuthStore.getState().hasRoleAccess(['CLIENT', 'PANELIST'])).toBe(true)
  })
})
