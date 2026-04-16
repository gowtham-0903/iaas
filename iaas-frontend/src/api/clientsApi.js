import axiosInstance from './axiosInstance'

export function getClients() {
  return axiosInstance.get('/api/clients')
}

export function getClient(id) {
  return axiosInstance.get(`/api/clients/${id}`)
}

export function createClient(data) {
  return axiosInstance.post('/api/clients', data)
}

export function updateClient(id, data) {
  return axiosInstance.put(`/api/clients/${id}`, data)
}

export function deleteClient(id) {
  return axiosInstance.delete(`/api/clients/${id}`)
}
