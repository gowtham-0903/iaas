import axiosInstance from './axiosInstance'

export const listPanelists = (search = '') =>
  axiosInstance.get('/api/panelists', { params: search ? { search } : {} })

export const createPanelist = (data) =>
  axiosInstance.post('/api/panelists', data)

export const createBulkPanelists = (panelists) =>
  axiosInstance.post('/api/panelists/bulk', { panelists })

// formData is a pre-built FormData (caller reads file as ArrayBuffer first to avoid ERR_UPLOAD_FILE_CHANGED)
export const uploadPanelistExcel = (formData) =>
  axiosInstance.post('/api/panelists/excel-upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

export const updatePanelist = (id, data) =>
  axiosInstance.put(`/api/panelists/${id}`, data)

export const deletePanelist = (id) =>
  axiosInstance.delete(`/api/panelists/${id}`)
