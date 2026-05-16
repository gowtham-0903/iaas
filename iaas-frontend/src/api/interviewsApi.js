import axiosInstance from './axiosInstance'

export function createInterview(data) {
  return axiosInstance.post('/api/interviews', data)
}

export function getInterviews(params) {
  return axiosInstance.get('/api/interviews', { params })
}

export function getInterviewDetail(id) {
  return axiosInstance.get(`/api/interviews/${id}`)
}

export function getPanelistAvailability(params) {
  return axiosInstance.get('/api/interviews/panelist-availability', { params })
}

export function createPanelistAvailability(data) {
  return axiosInstance.post('/api/interviews/panelist-availability', data)
}

export function updateInterviewStatus(id, status, outcome = undefined) {
  const body = { status }
  if (outcome) body.outcome = outcome
  return axiosInstance.put(`/api/interviews/${id}/status`, body)
}
