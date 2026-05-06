import axiosInstance from './axiosInstance'

export function getPanelistAssignments(params) {
  return axiosInstance.get('/api/panelist-assignments', { params })
}

export function createPanelistAssignment(data) {
  return axiosInstance.post('/api/panelist-assignments', data)
}

export function deletePanelistAssignment(id) {
  return axiosInstance.delete(`/api/panelist-assignments/${id}`)
}

export function importPanelistAssignments(file) {
  const formData = new FormData()
  formData.append('file', file)
  return axiosInstance.post('/api/panelist-assignments/import', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
}
