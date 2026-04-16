import { getCurrentUser, login, logout, refreshSession } from './authApi'

export function loginRequest(email, password) {
  return login(email, password)
}

export function fetchCurrentUser() {
  return getCurrentUser()
}

export function logoutRequest() {
  return logout()
}

export function refreshRequest() {
  return refreshSession()
}
