import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { generateAiScore } from '../api/scoringApi'
import {
  distributeReport,
  getQCDashboard,
  getQCInterviews,
  getQCReview,
  updateQCReview,
} from '../api/qcApi'
import useAuthStore from '../store/authStore'
import AppShell from '../components/AppShell'
import {
  Badge,
  Card,
  CardTitle,
  DataTable,
  EmptyState,
  FormField,
  FormSelect,
  FormTextarea,
  LoadingState,
  PrimaryBtn,
  SecondaryBtn,
  TableCell,
  TableRow,
} from '../components/ui'

// ─── Constants ────────────────────────────────────────────────────────────────

const RECOMMENDATIONS = ['STRONG_HIRE', 'HIRE', 'MAYBE', 'NO_HIRE']
const REC_BADGE = { STRONG_HIRE: 'green', HIRE: 'blue', MAYBE: 'amber', NO_HIRE: 'red' }
const REC_LABEL = { STRONG_HIRE: 'Strong Hire', HIRE: 'Hire', MAYBE: 'Maybe', NO_HIRE: 'No Hire' }
const AI_STATUS_BADGE = { GENERATED: 'green', PENDING: 'amber', FAILED: 'red' }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(val) {
  if (!val) return '—'
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDate(val) {
  if (!val) return '—'
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtRec(rec) {
  return REC_LABEL[rec] || String(rec || '—').replace(/_/g, ' ')
}

function scoreTone(score) {
  if (score == null) return 'text-slate-400'
  if (score >= 3.5) return 'text-emerald-600 font-semibold'
  if (score >= 2.5) return 'text-amber-600 font-semibold'
  return 'text-red-500 font-semibold'
}

// ─── Toast hook ───────────────────────────────────────────────────────────────

let _toastSeq = 0

function useToasts() {
  const [toasts, setToasts] = useState([])

  const add = useCallback((type, message) => {
    const id = ++_toastSeq
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 5000)
  }, [])

  const remove = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, add, remove }
}

// ─── Toast container ──────────────────────────────────────────────────────────

const TOAST_STYLES = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  warn: 'bg-amber-50 border-amber-200 text-amber-800',
}

function ToastContainer({ toasts, onRemove }) {
  if (!toasts.length) return null
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium pointer-events-auto ${TOAST_STYLES[t.type] || TOAST_STYLES.error}`}
        >
          <span className="flex-1 leading-relaxed">{t.message}</span>
          <button
            type="button"
            onClick={() => onRemove(t.id)}
            className="shrink-0 opacity-60 hover:opacity-100 text-base leading-none"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, valueClass = 'text-slate-900', subtext }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="text-xs font-medium text-slate-500 mb-3 uppercase tracking-wide">{label}</div>
      <div className={`text-3xl font-bold leading-none ${valueClass}`}>{value}</div>
      {subtext && <div className="mt-2 text-xs text-slate-400">{subtext}</div>}
    </div>
  )
}

// ─── Collapsible section ──────────────────────────────────────────────────────

function CollapsibleSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-sm font-semibold text-slate-700"
      >
        <span>{title}</span>
        <span className="text-slate-400 text-xs ml-2">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="p-4 space-y-3">{children}</div>}
    </div>
  )
}

// ─── Skills table (per-panelist columns + QC override) ────────────────────────

function SkillsTable({ reviewData, overrideValues, onOverrideChange, canEdit, initialRawScores }) {
  const skills = reviewData.combined_scores?.skills || []
  const panelists = reviewData.panelists || []

  const panelistSkillMap = useMemo(() => {
    const map = {}
    for (const p of panelists) {
      map[p.panelist_id] = {}
      for (const s of p.scores) {
        const nums = [s.technical_score, s.communication_score, s.problem_solving_score].filter(v => v != null)
        // Magic-link feedback saves overall_score (1-5); JWT path saves three sub-scores (1-10)
        map[p.panelist_id][s.skill_id] = nums.length > 0
          ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
          : s.overall_score != null ? s.overall_score : null
      }
    }
    return map
  }, [panelists])

  if (!skills.length) {
    return <div className="text-sm text-slate-400 text-center py-8">No skill data available</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-50 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
            <th className="px-3 py-2 text-left border-b border-slate-200 whitespace-nowrap">Skill</th>
            <th className="px-3 py-2 text-left border-b border-slate-200 whitespace-nowrap">Type</th>
            {panelists.map(p => (
              <th key={p.panelist_id} className="px-3 py-2 text-center border-b border-slate-200 whitespace-nowrap" title={p.panelist_name}>
                {(p.panelist_name || `P${p.panelist_id}`).slice(0, 12)}
              </th>
            ))}
            <th className="px-3 py-2 text-center border-b border-slate-200 whitespace-nowrap">AI Score</th>
            <th className="px-3 py-2 text-center border-b border-slate-200 whitespace-nowrap">QC Override</th>
          </tr>
        </thead>
        <tbody>
          {skills.map(skill => {
            const currentVal = overrideValues[skill.skill_id] ?? ''
            const initialRaw = initialRawScores[skill.skill_id]
            const isChanged = currentVal !== '' && initialRaw != null &&
              Math.abs(Number(currentVal) - Number(initialRaw)) > 0.001

            return (
              <tr key={skill.skill_id} className="border-b border-slate-100 hover:bg-slate-50/50">
                <td className="px-3 py-2 font-medium text-slate-900 whitespace-nowrap">{skill.skill_name}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                    skill.skill_type === 'primary' ? 'bg-blue-100 text-blue-700' :
                    skill.skill_type === 'secondary' ? 'bg-purple-100 text-purple-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {skill.skill_type}
                  </span>
                </td>
                {panelists.map(p => {
                  const score = panelistSkillMap[p.panelist_id]?.[skill.skill_id]
                  return (
                    <td key={p.panelist_id} className={`px-3 py-2 tabular-nums text-center ${scoreTone(score)}`}>
                      {score != null ? score.toFixed(1) : '—'}
                    </td>
                  )
                })}
                <td className={`px-3 py-2 tabular-nums text-center ${scoreTone(skill.ai_score)}`}>
                  {skill.ai_score != null ? skill.ai_score.toFixed(1) : '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="number"
                    min="1"
                    max="10"
                    step="0.1"
                    disabled={!canEdit}
                    value={currentVal}
                    onChange={e => onOverrideChange(skill.skill_id, e.target.value)}
                    className={`w-20 rounded-lg border px-2 py-1 text-sm text-center tabular-nums transition-colors
                      ${isChanged ? 'border-amber-400 ring-1 ring-amber-400 bg-amber-50 text-amber-900' : 'border-slate-300 bg-white text-slate-700'}
                      ${!canEdit ? 'opacity-60 cursor-not-allowed bg-slate-50' : ''}
                      focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── AI Narrative section ─────────────────────────────────────────────────────

function AiNarrativeSection({ aiReview }) {
  const sug = aiReview?.ai_suggestion || null
  const strengths = aiReview?.strengths || []
  const concerns = aiReview?.concerns || []
  const screeningQA = sug?.screening_question_analysis || []
  const softSkills = sug?.soft_skill_analysis || null
  const analytical = sug?.analytical_skills || null
  const finalRemarks = sug?.final_remarks || null
  const resumeSummary = sug?.resume_summary || null
  const hasContent = resumeSummary || strengths.length || concerns.length || finalRemarks || screeningQA.length

  if (!hasContent) {
    return <div className="text-sm text-slate-400 text-center py-6">No AI narrative available</div>
  }

  return (
    <div className="space-y-4">
      {resumeSummary && (
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Resume Summary</div>
          <p className="text-sm text-slate-700 leading-relaxed">{resumeSummary}</p>
        </div>
      )}

      {strengths.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-1">Strengths</div>
          <ul className="list-disc list-inside space-y-1">
            {strengths.map((s, i) => <li key={i} className="text-sm text-slate-700">{s}</li>)}
          </ul>
        </div>
      )}

      {concerns.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1">Concerns</div>
          <ul className="list-disc list-inside space-y-1">
            {concerns.map((c, i) => <li key={i} className="text-sm text-slate-700">{c}</li>)}
          </ul>
        </div>
      )}

      {finalRemarks?.strengths_paragraph && (
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Detailed Assessment</div>
          <p className="text-sm text-slate-700 leading-relaxed">{finalRemarks.strengths_paragraph}</p>
        </div>
      )}

      {finalRemarks?.conclusion && (
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Conclusion</div>
          <p className="text-sm text-slate-700 leading-relaxed">{finalRemarks.conclusion}</p>
        </div>
      )}

      {screeningQA.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Screening Q&A</div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                  <th className="px-3 py-2 text-left border-b border-slate-200">Question</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">Panelist Notes</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">AI Assessment</th>
                  <th className="px-3 py-2 text-center border-b border-slate-200">Score</th>
                </tr>
              </thead>
              <tbody>
                {screeningQA.map((qa, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-slate-700 align-top">{qa.question}</td>
                    <td className="px-3 py-2 text-slate-600 align-top">{qa.panelist_notes || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 align-top">{qa.ai_assessment || '—'}</td>
                    <td className={`px-3 py-2 text-center tabular-nums align-top ${scoreTone(qa.score)}`}>{qa.score ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {softSkills && (
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Soft Skills</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Object.entries(softSkills).map(([key, val]) => (
              <div key={key} className="bg-slate-50 rounded-lg p-3">
                <div className="text-xs text-slate-500 capitalize mb-1">{key.replace(/_/g, ' ')}</div>
                <div className="text-sm font-semibold text-slate-800">{val?.rating || '—'}</div>
                {val?.observation && <div className="text-xs text-slate-500 mt-1 leading-relaxed">{val.observation}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {analytical && (
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Analytical Skills</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Object.entries(analytical).map(([key, val]) => (
              <div key={key} className="bg-slate-50 rounded-lg p-3">
                <div className="text-xs text-slate-500 capitalize mb-1">{key.replace(/_/g, ' ')}</div>
                <div className="text-sm font-semibold text-slate-800">{val?.rating || '—'}</div>
                {val?.observation && <div className="text-xs text-slate-500 mt-1 leading-relaxed">{val.observation}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Panelist feedback section ────────────────────────────────────────────────

function PanelistFeedbackSection({ panelFeedback }) {
  if (!panelFeedback?.length) {
    return <div className="text-sm text-slate-400 text-center py-6">No panelist feedback submitted</div>
  }
  return (
    <div className="space-y-4">
      {panelFeedback.map(pf => (
        <div key={pf.panelist_id} className="bg-slate-50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-slate-900 text-sm">{pf.panelist_name}</div>
            {pf.recommendation && (
              <Badge variant={REC_BADGE[pf.recommendation] || 'gray'}>{fmtRec(pf.recommendation)}</Badge>
            )}
          </div>

          {pf.overall_comments && (
            <div className="mb-3">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Overall Comments</div>
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{pf.overall_comments}</p>
            </div>
          )}

          {pf.no_coding_round ? (
            <div className="text-xs text-slate-400 italic mt-2">No coding round conducted</div>
          ) : (
            <>
              {pf.coding_score != null && (
                <div className="text-xs text-slate-500 mb-2">
                  Coding Score:{' '}
                  <span className={`font-semibold ${scoreTone(pf.coding_score)}`}>{pf.coding_score}/5</span>
                </div>
              )}
              {pf.coding_comments && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Coding Comments</div>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{pf.coding_comments}</p>
                </div>
              )}
              {Array.isArray(pf.coding_qa) && pf.coding_qa.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Coding Q&A</div>
                  <div className="space-y-2">
                    {pf.coding_qa.map((qa, i) => (
                      <div key={i} className="bg-white rounded-lg p-3 border border-slate-200">
                        <div className="text-xs font-medium text-slate-700 mb-1">Q: {qa.question}</div>
                        <div className="text-xs text-slate-500">A: {qa.answer || '—'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Review side panel ────────────────────────────────────────────────────────

function ReviewPanel({ interviewId, onClose, onRefresh, addToast, canApprove, canDistributeManual }) {
  const [reviewData, setReviewData] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formRec, setFormRec] = useState('MAYBE')
  const [formNotes, setFormNotes] = useState('')
  const [overrideValues, setOverrideValues] = useState({})
  const [initialRawScores, setInitialRawScores] = useState({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const res = await getQCReview(interviewId)
        if (cancelled) return
        const data = res.data
        setReviewData(data)

        setFormRec(data.review?.final_recommendation || data.review?.current_recommendation || 'MAYBE')
        setFormNotes(data.review?.qc_notes || '')

        const initOverrides = {}
        const initRaw = {}
        for (const skill of data.combined_scores?.skills || []) {
          const displayVal = skill.final_score ?? skill.raw_combined_score
          initOverrides[skill.skill_id] = displayVal != null ? String(displayVal) : ''
          initRaw[skill.skill_id] = skill.raw_combined_score
        }
        setOverrideValues(initOverrides)
        setInitialRawScores(initRaw)
      } catch {
        if (!cancelled) addToast('error', 'Failed to load review data.')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [interviewId])

  function handleOverrideChange(skillId, value) {
    setOverrideValues(prev => ({ ...prev, [skillId]: value }))
  }

  async function handleSubmit(approved) {
    const notesLen = formNotes.trim().length
    if (!approved && notesLen === 0) {
      addToast('warn', 'QC notes are required when requesting revision.')
      return
    }
    if (notesLen > 0 && notesLen < 50) {
      addToast('warn', `QC notes need ${50 - notesLen} more characters.`)
      return
    }

    const normalizedOverrides = []
    for (const [skillId, val] of Object.entries(overrideValues)) {
      const num = Number(val)
      if (Number.isFinite(num) && num >= 1 && num <= 10) {
        normalizedOverrides.push({ skill_id: Number(skillId), final_score: Math.round(num * 10) / 10 })
      }
    }

    try {
      setIsSubmitting(true)
      await updateQCReview(interviewId, {
        final_recommendation: formRec,
        qc_notes: formNotes.trim(),
        skill_overrides: normalizedOverrides,
        approved,
      })
      addToast(approved ? 'success' : 'warn', approved
        ? 'Approved — report distributed to recruiter hierarchy.'
        : 'Flagged for revision.')
      onRefresh()
      onClose()
    } catch (err) {
      addToast('error', err?.response?.data?.error || 'Failed to submit QC review.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleManualDistribute() {
    try {
      setIsSubmitting(true)
      await distributeReport(interviewId)
      addToast('success', 'Report re-distributed successfully.')
      onRefresh()
      onClose()
    } catch (err) {
      addToast('error', err?.response?.data?.error || 'Failed to distribute report.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const alreadyApproved = reviewData?.review?.approved === true
  const skillCount = reviewData?.combined_scores?.skills?.length || 0
  const feedbackCount = reviewData?.panel_feedback?.length || 0

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-screen w-full md:w-[780px] bg-white z-50 shadow-2xl flex flex-col overflow-hidden">

        {/* Panel header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200 bg-white shrink-0">
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-900 truncate">
              {isLoading ? 'Loading…' : (reviewData?.candidate?.full_name || 'Review')}
            </div>
            {!isLoading && reviewData && (
              <div className="text-xs text-slate-500 mt-0.5 truncate">
                {reviewData.jd?.title}
                {reviewData.jd?.job_code ? ` · ${reviewData.jd.job_code}` : ''}
                {' · '}
                {formatDate(reviewData.interview_date)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isLoading && reviewData?.ai_review?.recommendation && (
              <Badge variant={REC_BADGE[reviewData.ai_review.recommendation] || 'gray'}>
                {fmtRec(reviewData.ai_review.recommendation)}
              </Badge>
            )}
            {alreadyApproved && !isLoading && <Badge variant="green">Approved</Badge>}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {isLoading ? (
            <LoadingState label="Loading review…" />
          ) : reviewData == null ? (
            <div className="text-sm text-slate-400 text-center py-12">
              Review data unavailable. AI score may not be generated yet.
            </div>
          ) : (
            <>
              {/* Info strip */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 rounded-xl p-4">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Client</div>
                  <div className="text-sm font-medium text-slate-800">{reviewData.candidate?.client_name || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Email</div>
                  <div className="text-sm text-slate-700 truncate">{reviewData.candidate?.email || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">AI Score</div>
                  <div className="text-xl font-bold text-slate-900">
                    {reviewData.ai_review?.overall_score != null
                      ? `${reviewData.ai_review.overall_score}/100`
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Skill Match</div>
                  <div className="text-sm text-slate-700 leading-relaxed">
                    {reviewData.ai_review?.primary_match != null
                      ? <><span className="font-semibold">{reviewData.ai_review.primary_match.toFixed(0)}%</span><span className="text-slate-400 text-xs"> primary</span></>
                      : <span className="text-slate-400">—</span>}
                    {'  '}
                    {reviewData.ai_review?.secondary_match != null
                      ? <><span className="font-semibold">{reviewData.ai_review.secondary_match.toFixed(0)}%</span><span className="text-slate-400 text-xs"> secondary</span></>
                      : null}
                  </div>
                </div>
              </div>

              {/* Skills */}
              <CollapsibleSection title={`Skills (${skillCount})`} defaultOpen>
                <SkillsTable
                  reviewData={reviewData}
                  overrideValues={overrideValues}
                  onOverrideChange={handleOverrideChange}
                  canEdit={canApprove && !alreadyApproved}
                  initialRawScores={initialRawScores}
                />
              </CollapsibleSection>

              {/* AI Narrative */}
              <CollapsibleSection title="AI Narrative" defaultOpen={false}>
                <AiNarrativeSection aiReview={reviewData.ai_review} />
              </CollapsibleSection>

              {/* Panelist Feedback */}
              <CollapsibleSection title={`Panelist Feedback (${feedbackCount})`} defaultOpen={false}>
                <PanelistFeedbackSection panelFeedback={reviewData.panel_feedback} />
              </CollapsibleSection>

              {/* QC Decision */}
              <CollapsibleSection title="QC Decision" defaultOpen>
                {!canApprove && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700 mb-4">
                    View only for ADMIN. QC users can submit the final decision.
                  </div>
                )}

                {alreadyApproved && canApprove && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700 mb-4 flex items-center justify-between gap-3">
                    <span>Already approved and distributed.</span>
                    {canDistributeManual && (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={handleManualDistribute}
                        className="shrink-0 text-xs font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-900 disabled:opacity-50"
                      >
                        Re-send Report
                      </button>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <FormField label="Final Recommendation" htmlFor="qc_rec">
                    <FormSelect
                      id="qc_rec"
                      value={formRec}
                      disabled={!canApprove || alreadyApproved}
                      onChange={e => setFormRec(e.target.value)}
                    >
                      {RECOMMENDATIONS.map(r => (
                        <option key={r} value={r}>{fmtRec(r)}</option>
                      ))}
                    </FormSelect>
                  </FormField>
                  <div className="bg-slate-50 rounded-xl border border-slate-200 px-4 py-3 flex flex-col justify-center">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Weighted Score</div>
                    <div className="text-2xl font-bold text-slate-900">
                      {reviewData.combined_scores?.overall_score != null
                        ? reviewData.combined_scores.overall_score.toFixed(2)
                        : '—'}
                    </div>
                  </div>
                </div>

                <FormField label="QC Notes" htmlFor="qc_notes">
                  <FormTextarea
                    id="qc_notes"
                    rows={4}
                    disabled={!canApprove || alreadyApproved}
                    placeholder="Validation notes, corrections, or revision feedback (min 50 chars)…"
                    value={formNotes}
                    onChange={e => setFormNotes(e.target.value)}
                  />
                  {formNotes.trim().length > 0 && formNotes.trim().length < 50 && (
                    <div className="text-xs text-red-500 mt-1">
                      {50 - formNotes.trim().length} more characters required
                    </div>
                  )}
                </FormField>

                {canApprove && !alreadyApproved && (
                  <div className="flex flex-wrap gap-3 mt-4">
                    <PrimaryBtn onClick={() => handleSubmit(true)} loading={isSubmitting}>
                      Approve &amp; Distribute
                    </PrimaryBtn>
                    <SecondaryBtn onClick={() => handleSubmit(false)} disabled={isSubmitting}>
                      Request Revision
                    </SecondaryBtn>
                  </div>
                )}
              </CollapsibleSection>
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function QCReview() {
  const user = useAuthStore(state => state.user)
  const canApprove = user?.role === 'QC'
  const canGenerate = ['QC', 'ADMIN'].includes(user?.role)
  const canDistribute = ['QC', 'ADMIN'].includes(user?.role)

  const { toasts, add: addToast, remove: removeToast } = useToasts()

  const [dashboard, setDashboard] = useState(null)
  const [queue, setQueue] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [generatingIds, setGeneratingIds] = useState(new Set())
  const [distributingIds, setDistributingIds] = useState(new Set())

  async function loadData() {
    setIsLoading(true)
    try {
      const [dashRes, queueRes] = await Promise.all([getQCDashboard(), getQCInterviews()])
      setDashboard(dashRes.data || null)
      setQueue(queueRes.data?.interviews || [])
    } catch {
      addToast('error', 'Failed to load QC data.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  async function handleGenerate(interviewId) {
    setGeneratingIds(prev => new Set([...prev, interviewId]))
    try {
      await generateAiScore(interviewId)
      addToast('success', 'AI score generated.')
      loadData()
    } catch (err) {
      const status = err?.response?.status
      const msg = err?.response?.data?.error || 'AI scoring failed.'
      addToast(status === 400 ? 'warn' : 'error', msg)
    } finally {
      setGeneratingIds(prev => { const n = new Set(prev); n.delete(interviewId); return n })
    }
  }

  async function handleDistribute(interviewId) {
    setDistributingIds(prev => new Set([...prev, interviewId]))
    try {
      await distributeReport(interviewId)
      addToast('success', 'Report distributed successfully.')
      loadData()
    } catch (err) {
      addToast('error', err?.response?.data?.error || 'Failed to distribute report.')
    } finally {
      setDistributingIds(prev => { const n = new Set(prev); n.delete(interviewId); return n })
    }
  }

  function getRowStatus(row) {
    if (row.report_distributed) return { label: 'Distributed', variant: 'green' }
    if (row.approved) return { label: 'Approved', variant: 'blue' }
    if (row.ai_score_status === 'GENERATED') return { label: 'Pending QC', variant: 'amber' }
    if (row.ai_score_status === 'FAILED') return { label: 'Score Failed', variant: 'red' }
    if (row.ai_score_status === 'PENDING') return { label: 'Scoring…', variant: 'amber' }
    return { label: 'No Score', variant: 'gray' }
  }

  function TranscriptBadge({ row }) {
    if (!row.transcript_available) return <span className="text-slate-300 text-xs">—</span>
    if (row.transcript_source === 'teams_fetch') {
      return <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">Teams</span>
    }
    return <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">Upload</span>
  }

  return (
    <AppShell>
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {selectedId !== null && (
        <ReviewPanel
          interviewId={selectedId}
          onClose={() => setSelectedId(null)}
          onRefresh={loadData}
          addToast={addToast}
          canApprove={canApprove}
          canDistributeManual={canDistribute}
        />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard
          label="Pending Review"
          value={isLoading ? '—' : (dashboard?.pending_reviews ?? 0)}
          valueClass="text-amber-600"
        />
        <StatCard
          label="Approved Today"
          value={isLoading ? '—' : (dashboard?.approved_today ?? 0)}
          valueClass="text-emerald-600"
        />
        <StatCard
          label="Distributed"
          value={isLoading ? '—' : (dashboard?.distributed_count ?? 0)}
          valueClass="text-blue-600"
        />
        <StatCard
          label="Failed Scoring"
          value={isLoading ? '—' : (dashboard?.failed_count ?? 0)}
          valueClass="text-red-500"
        />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <CardTitle>All Completed Interviews</CardTitle>
          <button
            type="button"
            onClick={loadData}
            disabled={isLoading}
            className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
        <DataTable
          headers={['Candidate', 'JD', 'Client', 'Date', 'Panel / Scored', 'Transcript', 'AI Score', 'Status', 'Actions']}
          loading={isLoading}
          loadingLabel="Loading interviews…"
        >
          {!isLoading && queue.length === 0 ? (
            <tr><td colSpan={9}><EmptyState message="No completed interviews found" /></td></tr>
          ) : (
            queue.map(row => {
              const rowStatus = getRowStatus(row)
              const isGenerating = generatingIds.has(row.id)
              const isDistributing = distributingIds.has(row.id)
              const showGenerate = canGenerate && (
                !row.ai_score_status || row.ai_score_status === 'PENDING' || row.ai_score_status === 'FAILED'
              )
              const canReview = row.ai_score_status === 'GENERATED'
              const showDistribute = canDistribute && row.approved && !row.report_distributed

              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium text-slate-900">{row.candidate_name || '—'}</div>
                    <div className="text-xs text-slate-400">{row.candidate_email || ''}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-slate-800">{row.jd_title || '—'}</div>
                    {row.job_code && <div className="text-xs text-slate-400">{row.job_code}</div>}
                  </TableCell>
                  <TableCell className="text-slate-700">{row.client_name || '—'}</TableCell>
                  <TableCell>
                    <span className="text-xs text-slate-600 whitespace-nowrap">{formatDateTime(row.interview_date)}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-slate-600">
                      {row.panelist_count ?? 0} / {row.feedback_count ?? 0}
                    </span>
                  </TableCell>
                  <TableCell>
                    <TranscriptBadge row={row} />
                  </TableCell>
                  <TableCell>
                    {row.ai_score_status ? (
                      <div className="space-y-1">
                        <Badge variant={AI_STATUS_BADGE[row.ai_score_status] || 'gray'}>
                          {row.ai_score_status}
                        </Badge>
                        {row.overall_score != null && (
                          <div className="text-xs text-slate-500">{row.overall_score.toFixed(0)}/100</div>
                        )}
                        {row.ai_recommendation && (
                          <Badge variant={REC_BADGE[row.ai_recommendation] || 'gray'}>
                            {fmtRec(row.ai_recommendation)}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <Badge variant="gray">No Score</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={rowStatus.variant}>{rowStatus.label}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {showGenerate && (
                        <button
                          type="button"
                          disabled={isGenerating}
                          onClick={() => handleGenerate(row.id)}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 font-medium transition-colors whitespace-nowrap disabled:opacity-50"
                        >
                          {isGenerating ? 'Generating…' : row.ai_score_status === 'FAILED' ? 'Retry Score' : 'Generate Score'}
                        </button>
                      )}
                      {canReview && (
                        <button
                          type="button"
                          onClick={() => setSelectedId(row.id)}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-medium transition-colors whitespace-nowrap"
                        >
                          {row.report_distributed ? 'View Report' : 'Review'}
                        </button>
                      )}
                      {showDistribute && (
                        <button
                          type="button"
                          disabled={isDistributing}
                          onClick={() => handleDistribute(row.id)}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 font-medium transition-colors whitespace-nowrap disabled:opacity-50"
                        >
                          {isDistributing ? 'Sending…' : 'Send Report'}
                        </button>
                      )}
                      {canReview && (
                        <a
                          href={`/report/${row.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Download Report"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </DataTable>
      </Card>
    </AppShell>
  )
}
