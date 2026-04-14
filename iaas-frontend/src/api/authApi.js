import axiosInstance from './axiosInstance'

export function login(email, password) {
  return axiosInstance.post('/api/auth/login', { email, password })
}
