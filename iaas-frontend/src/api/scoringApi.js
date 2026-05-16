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

export function getAiScore(interviewId) {
  return axiosInstance.get(`/api/scoring/interviews/${interviewId}/ai-score`)
}

export function generateAiScore(interviewId, regenerate = false) {
  return axiosInstance.post(
    `/api/scoring/interviews/${interviewId}/generate-score${regenerate ? '?regenerate=true' : ''}`
  )
}

export function fetchTranscriptFromTeams(interviewId) {
  return axiosInstance.post(`/api/scoring/interviews/${interviewId}/fetch-transcript`)
}

export function getTranscriptInfo(interviewId) {
  return axiosInstance.get(`/api/scoring/interviews/${interviewId}/transcript-info`)
}

export function getInterviewScores(interviewId) {
  return axiosInstance.get(`/api/scoring/interviews/${interviewId}/scores`)
}
