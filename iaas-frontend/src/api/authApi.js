import axiosInstance from './axiosInstance'

export function login(email, password) {
  return axiosInstance.post('/api/auth/login', { email, password })
}

export function getCurrentUser() {
  return axiosInstance.get('/api/auth/me')
}

export function refreshSession() {
  return axiosInstance.post('/api/auth/refresh')
}

export function logout() {
  return axiosInstance.post('/api/auth/logout')
}
