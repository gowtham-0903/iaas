import axiosInstance from './axiosInstance'

export function getClientDashboard() {
  return axiosInstance.get('/api/client-portal/dashboard')
}

export function getClientResults() {
  return axiosInstance.get('/api/client-portal/results')
}

export function getClientCandidateReport(candidateId) {
  return axiosInstance.get(`/api/client-portal/results/${candidateId}/report`)
}
