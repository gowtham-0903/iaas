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

export function uploadResume(candidateId, file) {
  const formData = new FormData()
  formData.append('resume', file)
  return axiosInstance.post(`/api/candidates/${candidateId}/resume`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
}

export function extractResume(candidateId) {
  return axiosInstance.post(`/api/candidates/${candidateId}/extract-resume`)
}

export function downloadResume(candidateId) {
  return axiosInstance.get(`/api/candidates/${candidateId}/resume`, { responseType: 'blob' })
}
