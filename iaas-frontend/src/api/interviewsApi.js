import axiosInstance from './axiosInstance'

export function createInterview(data) {
  return axiosInstance.post('/api/interviews', data)
}

export function getInterviews(params) {
  return axiosInstance.get('/api/interviews', { params })
}

export function getPanelistAvailability(params) {
  return axiosInstance.get('/api/interviews/panelist-availability', { params })
}

export function createPanelistAvailability(data) {
  return axiosInstance.post('/api/interviews/panelist-availability', data)
}
