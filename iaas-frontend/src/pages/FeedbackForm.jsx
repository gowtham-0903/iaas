import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import axiosInstance from '../api/axiosInstance'
import platformLogo from '../../logo/MEEDENLABS_LOGO_WITH_FONT_TradeMark_1.jpg'

// ─── Constants ───────────────────────────────────────────────────────────────

const SKILL_BADGE = {
  primary:   { bg: 'bg-cyan-50 text-cyan-700 border border-cyan-200',    dot: 'bg-cyan-400'    },
  secondary: { bg: 'bg-slate-100 text-slate-600 border border-slate-200', dot: 'bg-slate-400'  },
  soft:      { bg: 'bg-emerald-50 text-emerald-700 border border-emerald-200', dot: 'bg-emerald-400' },
}

const RECOMMENDATIONS = [
  { value: 'STRONG_HIRE', label: 'Strong Hire', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  { value: 'HIRE',        label: 'Hire',         color: 'text-cyan-700 bg-cyan-50 border-cyan-200'         },
  { value: 'MAYBE',       label: 'Maybe',        color: 'text-amber-700 bg-amber-50 border-amber-200'      },
  { value: 'NO_HIRE',     label: 'No Hire',      color: 'text-red-700 bg-red-50 border-red-200'            },
]

const COMMENT_MIN = { primary: 1000, secondary: 250, soft: 250 }
const OVERALL_MIN = 500
const CODING_COMMENT_MIN = 1000

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(isoString, tz) {
  if (!isoString) return 'TBD'
  try {
    return new Date(isoString + 'Z').toLocaleString('en-US', {
      timeZone: tz || 'UTC',
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    })
  } catch { return isoString }
}

function scoreColor(v) {
  if (!v) return 'text-slate-400'
  if (v <= 1) return 'text-red-500'
  if (v <= 3) return 'text-amber-500'
  return 'text-emerald-600'
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StarRating({ value, onChange, size = 'md' }) {
  const szClass = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange?.(star)}
          className={`focus:outline-none transition-transform duration-100 ${onChange ? 'hover:scale-110' : 'cursor-default'}`}
        >
          <svg
            className={szClass}
            viewBox="0 0 24 24"
            fill={star <= (value || 0) ? '#02c0fa' : 'none'}
            stroke={star <= (value || 0) ? '#02c0fa' : '#cbd5e1'}
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
            />
          </svg>
        </button>
      ))}
    </div>
  )
}

function CharCounter({ current, min }) {
  const ok = current >= min
  return (
    <span className={`text-xs font-medium tabular-nums ${ok ? 'text-slate-400' : 'text-red-500'}`}>
      {current} / {min} min
    </span>
  )
}

function StatusScreen({ icon, title, message, accent }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f0f4f8' }}>
      <Header />
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-10 max-w-sm w-full text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: accent || 'linear-gradient(135deg,#02c0fa,#0090d4)', boxShadow: '0 4px 14px rgba(2,192,250,0.25)' }}
          >
            {icon}
          </div>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">{title}</h2>
          <p className="text-sm text-slate-500 leading-relaxed">{message}</p>
        </div>
      </div>
      <Footer />
    </div>
  )
}

function Header({ panelistName, panelistEmail }) {
  return (
    <header className="bg-white border-b border-slate-200 h-[60px] px-6 flex items-center justify-between gap-4 flex-shrink-0 sticky top-0 z-30">
      <img src={platformLogo} alt="Meeden Labs" className="h-8 w-auto" />
      {panelistName && (
        <div className="hidden sm:flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm font-semibold text-slate-800 leading-tight">{panelistName}</div>
            <div className="text-xs text-slate-500 truncate max-w-[220px]">{panelistEmail}</div>
          </div>
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#02c0fa,#0090d4)' }}
          >
            {panelistName?.charAt(0)?.toUpperCase() || 'P'}
          </div>
        </div>
      )}
    </header>
  )
}

function ProgressBar({ scored, total }) {
  const pct = total === 0 ? 0 : Math.round((scored / total) * 100)
  return (
    <div className="bg-white border-b border-slate-200 px-6 py-3 sticky top-[60px] z-20">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-slate-500">Completion</span>
          <span className="text-xs font-semibold" style={{ color: '#02c0fa' }}>{pct}%</span>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg,#02c0fa,#0090d4)',
              boxShadow: pct > 0 ? '0 0 8px rgba(2,192,250,0.4)' : 'none',
            }}
          />
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          {scored} of {total} {total === 1 ? 'item' : 'items'} completed
        </p>
      </div>
    </div>
  )
}

function Footer() {
  return (
    <footer className="text-center py-5 text-xs text-slate-400 border-t border-slate-200 bg-white">
      Powered by <span className="font-semibold text-slate-500">Meeden Labs</span>
      {' '}· This link can only be used once
    </footer>
  )
}

function ConfirmModal({
  formData, scores, overallComments, recommendation,
  noCodingRound, codingPairs, codingScore,
  onConfirm, onCancel, submitting
}) {
  const rec = RECOMMENDATIONS.find((r) => r.value === recommendation)
  const validPairs = codingPairs.filter(p => p.question.trim() && p.answer.trim())
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#02c0fa,#0090d4)' }}>
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-800">Review your feedback</h3>
              <p className="text-xs text-slate-500">Please confirm before submitting — this cannot be changed.</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Candidate strip */}
          <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3 border border-slate-100">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#02c0fa,#0090d4)' }}>
              {formData.candidate_name?.charAt(0)?.toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">{formData.candidate_name}</div>
              <div className="text-xs text-slate-500">{formData.jd_title} · {formData.job_code}</div>
            </div>
          </div>

          {/* Skill scores */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Skill Scores</p>
            <div className="space-y-2">
              {formData.skills.map((skill) => {
                const s = scores[skill.id]
                const badge = SKILL_BADGE[skill.skill_type] || SKILL_BADGE.secondary
                return (
                  <div key={skill.id} className="flex items-center justify-between gap-3 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${badge.bg} flex-shrink-0`}>
                        {skill.skill_type}
                      </span>
                      <span className="text-sm text-slate-700 truncate">{skill.skill_name}</span>
                    </div>
                    <div className="flex-shrink-0">
                      <StarRating value={s} size="sm" />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Recommendation */}
          {rec && (
            <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
              <span className="text-sm text-slate-600 font-medium">Recommendation</span>
              <span className={`text-sm font-semibold px-3 py-1 rounded-lg border ${rec.color}`}>{rec.label}</span>
            </div>
          )}

          {/* Coding round preview */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Coding Round</p>
            {noCodingRound ? (
              <span className="text-xs font-semibold text-slate-500 bg-slate-200 px-2 py-1 rounded-md">No coding round</span>
            ) : (
              <div className="space-y-1">
                <div className="text-xs text-slate-600">
                  {validPairs.length} Q&A pair(s) · Score:{' '}
                  <span className={`font-semibold ${scoreColor(codingScore)}`}>{codingScore}/5</span>
                </div>
                {validPairs[0]?.question && (
                  <p className="text-xs text-slate-500 italic line-clamp-2">
                    &ldquo;{validPairs[0].question.length > 80 ? validPairs[0].question.slice(0, 80) + '…' : validPairs[0].question}&rdquo;
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Overall comments preview */}
          {overallComments && (
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Overall Comments</p>
              <p className="text-sm text-slate-700 leading-relaxed line-clamp-3">{overallComments}</p>
            </div>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 border border-slate-200 text-slate-600 text-sm font-medium py-2.5 rounded-xl hover:bg-slate-50 transition-colors"
          >
            Go back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="flex-1 text-white text-sm font-semibold py-2.5 rounded-xl transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#02c0fa,#0090d4)', boxShadow: '0 4px 12px rgba(2,192,250,0.3)' }}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Submitting…
              </span>
            ) : 'Confirm & Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FeedbackForm() {
  const { token } = useParams()

  const [state, setState] = useState('loading')
  const [formData, setFormData] = useState(null)
  const [scores, setScores] = useState({})
  const [skillComments, setSkillComments] = useState({})
  const [overallComments, setOverallComments] = useState('')
  const [recommendation, setRecommendation] = useState('')
  const [noCodingRound, setNoCodingRound] = useState(false)
  const [codingPairs, setCodingPairs] = useState([{ question: '', answer: '' }])
  const [codingScore, setCodingScore] = useState(null)
  const [codingComments, setCodingComments] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) { setState('not_found'); return }
    axiosInstance.get(`/api/feedback/${token}`)
      .then((res) => { setFormData(res.data); setState('form') })
      .catch((err) => {
        const s = err?.response?.status
        if (s === 404) setState('not_found')
        else if (s === 409) setState('already_submitted')
        else if (s === 410) setState('expired')
        else if (s === 425) {
          const availableFrom = err?.response?.data?.available_from
          setFormData({ available_from: availableFrom })
          setState('not_yet_available')
        }
        else setState('error')
      })
  }, [token])

  const totalItems = (formData?.skills?.length ?? 0) + 1
  const scoredSkills = formData?.skills?.filter((sk) => scores[sk.id] !== undefined).length ?? 0
  const completedItems = scoredSkills + (recommendation ? 1 : 0)
  const allSkillsRated = formData?.skills?.length > 0 && scoredSkills === formData.skills.length

  const skillCommentOk = formData?.skills?.every(
    (s) => (skillComments[s.id] || '').trim().length >= (COMMENT_MIN[s.skill_type] || 0)
  ) ?? false
  const overallOk = (overallComments || '').trim().length >= OVERALL_MIN
  const validCodingPairs = codingPairs.filter((p) => p.question.trim() && p.answer.trim())
  const codingOk = noCodingRound
    ? true
    : validCodingPairs.length > 0
      && codingScore !== null
      && (codingComments || '').trim().length >= CODING_COMMENT_MIN

  const canSubmit = allSkillsRated && !!recommendation && skillCommentOk && overallOk && codingOk

  function handleScoreClick(skillId, val) {
    setScores((prev) => ({ ...prev, [skillId]: val }))
  }

  function addCodingPair() {
    setCodingPairs((prev) => [...prev, { question: '', answer: '' }])
  }

  function removeCodingPair(idx) {
    setCodingPairs((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateCodingPair(idx, field, value) {
    setCodingPairs((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)))
  }

  async function handleConfirmedSubmit() {
    setSubmitting(true)
    try {
      await axiosInstance.post(`/api/feedback/${token}`, {
        scores: formData.skills.map((sk) => ({
          skill_id: sk.id,
          skill_name: sk.skill_name,
          skill_type: sk.skill_type,
          score: scores[sk.id],
          comments: skillComments[sk.id] || '',
        })),
        overall_comments: overallComments,
        recommendation,
        no_coding_round: noCodingRound,
        coding_qa: noCodingRound ? [] : validCodingPairs,
        coding_score: noCodingRound ? null : codingScore,
        coding_comments: noCodingRound ? '' : codingComments,
      })
      setShowConfirm(false)
      setState('success')
    } catch (err) {
      const s = err?.response?.status
      setShowConfirm(false)
      if (s === 409) setState('already_submitted')
      else if (s === 410) setState('expired')
      else alert(err?.response?.data?.error || 'Failed to submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Status screens ──────────────────────────────────────────────────────────

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#f0f4f8' }}>
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full border-4 border-slate-200 border-t-cyan-400 animate-spin" />
            <p className="text-sm text-slate-500">Loading feedback form…</p>
          </div>
        </div>
      </div>
    )
  }

  if (state === 'not_found')
    return <StatusScreen
      icon={<svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" /></svg>}
      title="Link not found"
      message="This feedback link is invalid or does not exist. Please check your email for the correct link."
    />
  if (state === 'expired')
    return <StatusScreen
      icon={<svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>}
      title="Link expired"
      message="This feedback link has expired (links are valid for 7 days after the interview). Please contact the interview coordinator."
      accent="linear-gradient(135deg,#f59e0b,#d97706)"
    />
  if (state === 'already_submitted')
    return <StatusScreen
      icon={<svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>}
      title="Already submitted"
      message="Feedback has already been submitted for this interview. Thank you for your time!"
      accent="linear-gradient(135deg,#10b981,#059669)"
    />
  if (state === 'success')
    return <StatusScreen
      icon={<svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>}
      title="Thank you!"
      message="Your feedback has been received and recorded successfully. We appreciate your time and evaluation."
      accent="linear-gradient(135deg,#10b981,#059669)"
    />
  if (state === 'not_yet_available') {
    const availableFrom = formData?.available_from
    let availableMsg = 'The feedback window opens once the interview has ended.'
    if (availableFrom) {
      try {
        const d = new Date(availableFrom + 'Z')
        availableMsg = `The feedback window opens after ${d.toLocaleString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
        })}.`
      } catch { /* keep default */ }
    }
    return <StatusScreen
      icon={<svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>}
      title="Not yet available"
      message={availableMsg}
      accent="linear-gradient(135deg,#6366f1,#4f46e5)"
    />
  }

  if (state === 'error' || !formData)
    return <StatusScreen
      icon={<svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
      title="Something went wrong"
      message="An unexpected error occurred. Please try again later."
      accent="linear-gradient(135deg,#ef4444,#dc2626)"
    />

  const { candidate_name, jd_title, job_code, interview_scheduled_at, interview_timezone, skills } = formData

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f0f4f8' }}>
      <Header panelistName={formData.panelist_name} panelistEmail={formData.panelist_email} />
      <ProgressBar scored={completedItems} total={totalItems} />

      {showConfirm && (
        <ConfirmModal
          formData={formData}
          scores={scores}
          overallComments={overallComments}
          recommendation={recommendation}
          noCodingRound={noCodingRound}
          codingPairs={codingPairs}
          codingScore={codingScore}
          submitting={submitting}
          onConfirm={handleConfirmedSubmit}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      <main className="flex-1 py-6 px-4">
        <div className="max-w-2xl mx-auto space-y-5">

          {/* Interview info card */}
          <div
            className="rounded-2xl p-5 text-white"
            style={{ background: 'linear-gradient(135deg,#02c0fa 0%,#0078b8 100%)', boxShadow: '0 8px 24px rgba(2,192,250,0.25)' }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest opacity-80 mb-2">Interview Feedback</p>
            <h1 className="text-xl font-bold leading-tight">{candidate_name}</h1>
            <p className="text-sm opacity-90 mt-0.5">{jd_title}</p>
            {job_code && <p className="text-[11px] opacity-70 mt-0.5">{job_code}</p>}
            <div className="mt-4 pt-3 border-t border-white/20 flex items-center gap-2">
              <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-[11px] opacity-80">{formatDate(interview_scheduled_at, interview_timezone)}</p>
            </div>
          </div>

          {/* ── Skill Ratings ──────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 px-1">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Skill Ratings</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          {skills.map((skill) => {
            const badge = SKILL_BADGE[skill.skill_type] || SKILL_BADGE.secondary
            const selected = scores[skill.id]
            const rated = selected !== undefined
            const commentVal = skillComments[skill.id] || ''
            const minLen = COMMENT_MIN[skill.skill_type] || 0
            const commentTooShort = commentVal.length > 0 && commentVal.trim().length < minLen
            return (
              <div
                key={skill.id}
                className="bg-white rounded-2xl border transition-all duration-200"
                style={{
                  borderColor: rated ? 'rgba(2,192,250,0.4)' : '#e2e8f0',
                  boxShadow: rated ? '0 4px 16px rgba(2,192,250,0.10)' : '0 1px 4px rgba(0,0,0,0.04)',
                }}
              >
                <div className="px-5 pt-4 pb-4">
                  {/* Skill header */}
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className={`w-1 h-8 rounded-full flex-shrink-0 ${badge.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-800">{skill.skill_name}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.bg}`}>
                          {skill.skill_type}
                        </span>
                        <StarRating value={selected} onChange={(val) => handleScoreClick(skill.id, val)} />
                        {rated && (
                          <span className={`text-xs font-bold ${scoreColor(selected)}`}>{selected}/5</span>
                        )}
                      </div>
                      {(() => {
                        const subs = Array.isArray(skill.subtopics)
                          ? skill.subtopics
                          : typeof skill.subtopics === 'string'
                          ? (() => { try { return JSON.parse(skill.subtopics) } catch { return [] } })()
                          : []
                        return subs.length > 0 ? (
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                            {subs.slice(0, 4).join(' · ')}
                          </p>
                        ) : null
                      })()}
                    </div>
                  </div>

                  {/* Skill comment */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-slate-600">
                        Comments <span className="text-red-400">*</span>
                      </span>
                      <CharCounter current={commentVal.trim().length} min={minLen} />
                    </div>
                    <textarea
                      value={commentVal}
                      onChange={(e) => setSkillComments((p) => ({ ...p, [skill.id]: e.target.value }))}
                      placeholder={`Minimum ${minLen} characters required…`}
                      rows={4}
                      className={`w-full text-sm border rounded-xl px-3.5 py-2.5 resize-none text-slate-700 placeholder-slate-400 focus:outline-none bg-slate-50 transition-colors ${
                        commentTooShort ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200'
                      }`}
                      onFocus={(e) => { if (!commentTooShort) e.target.style.boxShadow = '0 0 0 3px rgba(2,192,250,0.15)' }}
                      onBlur={(e) => { e.target.style.boxShadow = 'none' }}
                    />
                  </div>
                </div>
              </div>
            )
          })}

          {/* ── Coding Round ───────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 px-1">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Coding Round</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            {/* No coding toggle */}
            <button
              type="button"
              onClick={() => setNoCodingRound((v) => !v)}
              className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all duration-150 ${
                noCodingRound
                  ? 'bg-amber-50 border-amber-300 text-amber-700'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className={`w-4 h-4 rounded flex items-center justify-center border-2 flex-shrink-0 ${
                noCodingRound ? 'bg-amber-500 border-amber-500' : 'border-slate-400'
              }`}>
                {noCodingRound && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              No coding rounds in this interview
            </button>

            {!noCodingRound && (
              <>
                {/* Q&A pairs */}
                {codingPairs.map((pair, idx) => (
                  <div key={idx} className="border border-slate-100 rounded-xl p-4 bg-slate-50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Q&A Pair {idx + 1}
                      </span>
                      {codingPairs.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeCodingPair(idx)}
                          className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Coding Question <span className="text-red-400">*</span>
                      </label>
                      <textarea
                        value={pair.question}
                        onChange={(e) => updateCodingPair(idx, 'question', e.target.value)}
                        placeholder="Enter the coding question asked…"
                        rows={3}
                        className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 resize-none text-slate-700 placeholder-slate-400 focus:outline-none bg-white"
                        onFocus={(e) => { e.target.style.boxShadow = '0 0 0 3px rgba(2,192,250,0.15)' }}
                        onBlur={(e) => { e.target.style.boxShadow = 'none' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Candidate&apos;s Answer / Code <span className="text-red-400">*</span>
                      </label>
                      <textarea
                        value={pair.answer}
                        onChange={(e) => updateCodingPair(idx, 'answer', e.target.value)}
                        placeholder="Enter the candidate's answer or code…"
                        rows={4}
                        className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 resize-none text-slate-700 placeholder-slate-400 focus:outline-none bg-white font-mono"
                        onFocus={(e) => { e.target.style.boxShadow = '0 0 0 3px rgba(2,192,250,0.15)' }}
                        onBlur={(e) => { e.target.style.boxShadow = 'none' }}
                      />
                    </div>
                  </div>
                ))}

                {/* Add Q&A button */}
                <button
                  type="button"
                  onClick={addCodingPair}
                  className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border border-dashed border-slate-300 text-slate-500 hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50 transition-all duration-150 w-full justify-center"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add Another Q&A Pair
                </button>

                {/* Coding review */}
                <div className="border-t border-slate-200 pt-4 space-y-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Coding Review</p>

                  {/* Coding score */}
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-semibold text-slate-600">
                      Coding Score (1–5) <span className="text-red-400">*</span>
                    </label>
                    <StarRating value={codingScore} onChange={setCodingScore} />
                    {codingScore && (
                      <span className={`text-xs font-bold ${scoreColor(codingScore)}`}>{codingScore}/5</span>
                    )}
                  </div>

                  {/* Coding assessment */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-slate-600">
                        Assessment <span className="text-red-400">*</span>
                      </span>
                      <CharCounter current={(codingComments || '').trim().length} min={CODING_COMMENT_MIN} />
                    </div>
                    <textarea
                      value={codingComments}
                      onChange={(e) => setCodingComments(e.target.value)}
                      placeholder={`Minimum ${CODING_COMMENT_MIN} characters — describe the candidate's coding approach, logic, efficiency, and edge case handling…`}
                      rows={5}
                      className={`w-full text-sm border rounded-xl px-3.5 py-2.5 resize-none text-slate-700 placeholder-slate-400 focus:outline-none bg-slate-50 transition-colors ${
                        codingComments.length > 0 && (codingComments || '').trim().length < CODING_COMMENT_MIN
                          ? 'border-red-300 ring-1 ring-red-200'
                          : 'border-slate-200'
                      }`}
                      onFocus={(e) => { e.target.style.boxShadow = '0 0 0 3px rgba(2,192,250,0.15)' }}
                      onBlur={(e) => { e.target.style.boxShadow = 'none' }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── Overall Assessment ─────────────────────────────────────────── */}
          <div className="flex items-center gap-2 px-1">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Overall Assessment</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          {/* Overall comments */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-slate-700">
                Overall Comments <span className="text-red-400">*</span>
              </label>
              <CharCounter current={(overallComments || '').trim().length} min={OVERALL_MIN} />
            </div>
            <textarea
              value={overallComments}
              onChange={(e) => setOverallComments(e.target.value)}
              placeholder="Share your overall impression — strengths, areas to improve, cultural fit…"
              rows={4}
              className={`w-full text-sm border rounded-xl px-3.5 py-2.5 resize-none text-slate-700 placeholder-slate-400 focus:outline-none bg-slate-50 transition-colors ${
                overallComments.length > 0 && (overallComments || '').trim().length < OVERALL_MIN
                  ? 'border-red-300 ring-1 ring-red-200'
                  : 'border-slate-200'
              }`}
              onFocus={(e) => { e.target.style.boxShadow = '0 0 0 3px rgba(2,192,250,0.15)' }}
              onBlur={(e) => { e.target.style.boxShadow = 'none' }}
            />
          </div>

          {/* Recommendation */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <label className="block text-sm font-semibold text-slate-700 mb-3">
              Recommendation <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {RECOMMENDATIONS.map((r) => {
                const active = recommendation === r.value
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRecommendation(r.value)}
                    className={`py-3 px-4 rounded-xl border text-sm font-semibold text-left transition-all duration-150 ${
                      active ? r.color + ' ring-2 ring-offset-1' : 'border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100'
                    }`}
                    style={active ? { '--tw-ring-color': '#02c0fa' } : {}}
                  >
                    {r.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Submit */}
          <div className="pb-8">
            {!canSubmit && (
              <p className="text-xs text-slate-400 text-center mb-2">
                {!allSkillsRated
                  ? 'Rate all skills to continue'
                  : !skillCommentOk
                  ? 'All skill comments must meet the minimum character requirement'
                  : !codingOk
                  ? 'Complete the coding round section or mark it as not applicable'
                  : !overallOk
                  ? `Overall comments must be at least ${OVERALL_MIN} characters`
                  : 'Select a recommendation to continue'}
              </p>
            )}
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => setShowConfirm(true)}
              className="w-full text-white text-sm font-semibold py-3.5 rounded-2xl transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              style={
                canSubmit
                  ? { background: 'linear-gradient(135deg,#02c0fa,#0090d4)', boxShadow: '0 6px 18px rgba(2,192,250,0.35)' }
                  : { background: '#cbd5e1' }
              }
            >
              Review & Submit Feedback
            </button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
