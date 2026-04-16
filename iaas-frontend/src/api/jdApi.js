import axiosInstance from './axiosInstance'

export function getJDs(status) {
  const params = {}
  if (status) {
    params.status = status
  }
  return axiosInstance.get('/api/jds', { params })
}

export function getJD(id) {
  return axiosInstance.get(`/api/jds/${id}`)
}

export function createJD(data) {
  return axiosInstance.post('/api/jds', data)
}

export function updateJDStatus(id, status) {
  return axiosInstance.put(`/api/jds/${id}/status`, { status })
}

export function uploadJDFile(id, file) {
  const formData = new FormData()
  formData.append('file', file)
  return axiosInstance.post(`/api/jds/${id}/upload`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
}

export function extractSkills(id) {
  return axiosInstance.post(`/api/jds/${id}/extract-skills`)
}

export function getSkills(id) {
  return axiosInstance.get(`/api/jds/${id}/skills`)
}

export function updateSkill(jdId, skillId, data) {
  return axiosInstance.put(`/api/jds/${jdId}/skills/${skillId}`, data)
}

export function deleteSkill(jdId, skillId) {
  return axiosInstance.delete(`/api/jds/${jdId}/skills/${skillId}`)
}

export function addSkill(jdId, data) {
  return axiosInstance.post(`/api/jds/${jdId}/skills`, data)
}

export function downloadJDFile(id) {
  return axiosInstance.get(`/api/jds/${id}/download`, { responseType: 'blob' })
}
