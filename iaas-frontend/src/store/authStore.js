import { create } from 'zustand'

export const roleRanks = {
  CLIENT: 1,
  PANELIST: 2,
  RECRUITER: 3,
  SR_RECRUITER: 4,
  M_RECRUITER: 5,
  QC: 6,
  ADMIN: 7,
}

const useAuthStore = create((set, get) => ({
  user: null,
  setUser: (user) => set({ user }),
  logout: () =>
    set({
      user: null,
    }),
  hasRoleAccess: (allowedRoles = []) => {
    const { user } = get()
    if (!allowedRoles.length) {
      return Boolean(user)
    }

    if (!user?.role || roleRanks[user.role] == null) {
      return false
    }

    const minimumRank = Math.min(...allowedRoles.map((role) => roleRanks[role] ?? Number.POSITIVE_INFINITY))
    return roleRanks[user.role] >= minimumRank
  },
}))

export default useAuthStore
