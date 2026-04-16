import axios from 'axios'

import useAuthStore from '../store/authStore'

const axiosInstance = axios.create({
  baseURL: 'http://localhost:5001',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

axiosInstance.defaults.withCredentials = true

function getCookie(name) {
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) {
    return parts.pop().split(';').shift()
  }
  return null
}

axiosInstance.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase()
  const requiresCsrf = ['post', 'put', 'patch', 'delete'].includes(method)

  if (requiresCsrf) {
    const isRefreshCall = config.url?.includes('/api/auth/refresh')
    const csrfCookieName = isRefreshCall ? 'csrf_refresh_token' : 'csrf_access_token'
    const csrfToken = getCookie(csrfCookieName)

    if (csrfToken) {
      config.headers = config.headers ?? {}
      config.headers['X-CSRF-TOKEN'] = csrfToken
    }
  }

  if (config.withCredentials !== true) {
    config.withCredentials = true
  }

  return config
})

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && !error?.config?.url?.includes('/api/auth/login')) {
      useAuthStore.getState().logout()
    }

    return Promise.reject(error)
  },
)

export default axiosInstance
