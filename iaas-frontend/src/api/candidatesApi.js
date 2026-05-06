import axiosInstance from './axiosInstance'

export function getCandidates(params) {
  return axiosInstance.get('/api/candidates', { params })
}

export function createCandidate(data) {
  return axiosInstance.post('/api/candidates', data)
}

export function createCandidateWithResume(formData) {
  return axiosInstance.post('/api/candidates', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
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

export function bulkUploadResumes(jdId, clientId, files) {
  const formData = new FormData()
  formData.append('jd_id', jdId)
  formData.append('client_id', clientId)
  files.forEach((file) => formData.append('resumes', file))
  return axiosInstance.post('/api/candidates/bulk-upload-resumes', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export function notifyOperators(jdId, clientId, candidateCount) {
  return axiosInstance.post('/api/candidates/notify-operators', {
    jd_id: jdId,
    client_id: clientId,
    candidate_count: candidateCount,
  })
}
