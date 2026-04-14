import axiosInstance from './axiosInstance'

export function getUsers() {
  return axiosInstance.get('/api/users')
}
