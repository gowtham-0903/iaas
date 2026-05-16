// useReportData.js — data fetching hook for InterviewReport
import { useEffect, useState } from 'react'
import { getAiScore, generateAiScore } from '../api/scoringApi'
import { getQCReview } from '../api/qcApi'
import { safeJson } from '../utils/reportUtils'

export default function useReportData(interviewId) {
  const [state, setState] = useState({
    loading: true,
    error: null,
    noScore: false,
    aiScore: null,
    qcReview: null,
    skillBreakdown: [],
    aiSuggestion: null,
  })

  useEffect(() => {
    if (!interviewId) return
    let cancelled = false

    async function load() {
      setState(s => ({ ...s, loading: true, error: null }))
      try {
        const [aiRes, qcRes] = await Promise.allSettled([
          getAiScore(interviewId),
          getQCReview(interviewId),
        ])

        if (cancelled) return

        if (aiRes.status === 'rejected') {
          const status = aiRes.reason?.response?.status
          if (status === 404) {
            setState(s => ({ ...s, loading: false, noScore: true }))
            return
          }
          throw aiRes.reason
        }

        const aiScore = aiRes.value.data.ai_score
        const qcReview = qcRes.status === 'fulfilled' ? qcRes.value.data : null

        const skillBreakdown = safeJson(aiScore.skill_breakdown, [])
        const aiSuggestion = safeJson(aiScore.ai_suggestion, null)

        setState({
          loading: false,
          error: null,
          noScore: false,
          aiScore,
          qcReview,
          skillBreakdown,
          aiSuggestion,
        })
      } catch (err) {
        if (!cancelled) {
          setState(s => ({ ...s, loading: false, error: err.message || 'Failed to load report' }))
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [interviewId])

  async function handleGenerate() {
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      await generateAiScore(interviewId)
      // re-load
      const aiRes = await getAiScore(interviewId)
      const aiScore = aiRes.data.ai_score
      const skillBreakdown = safeJson(aiScore.skill_breakdown, [])
      const aiSuggestion = safeJson(aiScore.ai_suggestion, null)
      setState({ loading: false, error: null, noScore: false, aiScore, qcReview: null, skillBreakdown, aiSuggestion })
    } catch (err) {
      setState(s => ({ ...s, loading: false, error: err.message || 'Generation failed' }))
    }
  }

  return { ...state, handleGenerate }
}
