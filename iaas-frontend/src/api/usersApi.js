import axiosInstance from './axiosInstance'

export function getUsers() {
  return axiosInstance.get('/api/users')
}

export function createUser(userData) {
  return axiosInstance.post('/api/users', userData)
}

export function updateUser(userId, userData) {
  return axiosInstance.put(`/api/users/${userId}`, userData)
}

export function deleteUser(userId) {
  return axiosInstance.delete(`/api/users/${userId}`)
}
