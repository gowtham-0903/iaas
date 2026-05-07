export const RESCHEDULE_WINDOW_DAYS = 60
const DAY_IN_MS = 24 * 60 * 60 * 1000

export function getRescheduleDaysLeft(anchorDate, currentTimeMs = Date.now()) {
  if (!anchorDate) return null

  const anchorTime = new Date(anchorDate).getTime()
  if (Number.isNaN(anchorTime)) return null

  const remainingMs = anchorTime + (RESCHEDULE_WINDOW_DAYS * DAY_IN_MS) - currentTimeMs
  if (remainingMs <= 0) return 0

  return Math.ceil(remainingMs / DAY_IN_MS)
}
