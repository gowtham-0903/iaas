import axiosInstance from './axiosInstance'

export function getCandidates(params) {
  return axiosInstance.get('/api/candidates', { params })
}

export function createCandidate(data) {
  return axiosInstance.post('/api/candidates', data)
}

export function updateCandidate(id, data) {
  return axiosInstance.put(`/api/candidates/${id}`, data)
}

export function deleteCandidate(id) {
  return axiosInstance.delete(`/api/candidates/${id}`)
}
