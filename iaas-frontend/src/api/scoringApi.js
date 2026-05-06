import axiosInstance from './axiosInstance'

export function submitInterviewScores(interviewId, data) {
  return axiosInstance.post(`/api/scoring/interviews/${interviewId}/scores`, data)
}

export function uploadInterviewTranscript(interviewId, payload) {
  if (payload instanceof FormData) {
    return axiosInstance.post(`/api/scoring/interviews/${interviewId}/transcript`, payload, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  }
  return axiosInstance.post(`/api/scoring/interviews/${interviewId}/transcript`, payload)
}
