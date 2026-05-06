import axiosInstance from './axiosInstance'

export function getQCDashboard() {
  return axiosInstance.get('/api/qc/dashboard')
}

export function getQCInterviews(params) {
  return axiosInstance.get('/api/qc/interviews', { params })
}

export function getQCReview(interviewId) {
  return axiosInstance.get(`/api/qc/interviews/${interviewId}/review`)
}

export function updateQCReview(interviewId, data) {
  return axiosInstance.put(`/api/qc/interviews/${interviewId}/review`, data)
}
