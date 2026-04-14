import axiosInstance from './axiosInstance'

export function loginRequest(email, password) {
  return axiosInstance.post('/api/auth/login', { email, password })
}

export function fetchCurrentUser() {
  return axiosInstance.get('/api/auth/me')
}

export function logoutRequest() {
  return axiosInstance.post('/api/auth/logout')
}
