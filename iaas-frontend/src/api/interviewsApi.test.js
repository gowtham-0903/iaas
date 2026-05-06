import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createInterview,
  getInterviews,
  getPanelistAvailability,
  createPanelistAvailability,
  updateInterviewStatus,
} from './interviewsApi'

// Mock the shared axios instance so no real HTTP calls are made
vi.mock('./axiosInstance', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}))

import axiosInstance from './axiosInstance'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getInterviews', () => {
  it('calls GET /api/interviews', async () => {
    axiosInstance.get.mockResolvedValueOnce({ data: { interviews: [] } })
    await getInterviews()
    expect(axiosInstance.get).toHaveBeenCalledWith('/api/interviews', { params: undefined })
  })

  it('passes query params when provided', async () => {
    axiosInstance.get.mockResolvedValueOnce({ data: { interviews: [] } })
    await getInterviews({ jd_id: 5 })
    expect(axiosInstance.get).toHaveBeenCalledWith('/api/interviews', { params: { jd_id: 5 } })
  })
})

describe('createInterview', () => {
  it('calls POST /api/interviews with the payload', async () => {
    const payload = { candidate_id: 1, jd_id: 2, scheduled_at: '2026-08-01T10:00:00' }
    axiosInstance.post.mockResolvedValueOnce({ data: { id: 10 } })
    const result = await createInterview(payload)
    expect(axiosInstance.post).toHaveBeenCalledWith('/api/interviews', payload)
    expect(result.data.id).toBe(10)
  })
})

describe('updateInterviewStatus', () => {
  it('calls PUT /api/interviews/:id/status with the status', async () => {
    axiosInstance.put.mockResolvedValueOnce({ data: { status: 'CANCELLED' } })
    await updateInterviewStatus(42, 'CANCELLED')
    expect(axiosInstance.put).toHaveBeenCalledWith('/api/interviews/42/status', { status: 'CANCELLED' })
  })

  it('calls PUT with COMPLETED status', async () => {
    axiosInstance.put.mockResolvedValueOnce({ data: { status: 'COMPLETED' } })
    await updateInterviewStatus(7, 'COMPLETED')
    expect(axiosInstance.put).toHaveBeenCalledWith('/api/interviews/7/status', { status: 'COMPLETED' })
  })
})

describe('getPanelistAvailability', () => {
  it('calls GET /api/interviews/panelist-availability', async () => {
    axiosInstance.get.mockResolvedValueOnce({ data: { slots: [] } })
    await getPanelistAvailability({ panelist_id: 3 })
    expect(axiosInstance.get).toHaveBeenCalledWith(
      '/api/interviews/panelist-availability',
      { params: { panelist_id: 3 } }
    )
  })
})

describe('createPanelistAvailability', () => {
  it('calls POST /api/interviews/panelist-availability', async () => {
    const slot = { available_date: '2026-09-01', start_time: '09:00', end_time: '17:00' }
    axiosInstance.post.mockResolvedValueOnce({ data: { id: 1 } })
    await createPanelistAvailability(slot)
    expect(axiosInstance.post).toHaveBeenCalledWith('/api/interviews/panelist-availability', slot)
  })
})
