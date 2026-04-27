import { useEffect, useState } from 'react'

import AppShell from '../components/AppShell'
import { getQCDashboard, getQCInterviews, getQCReview, updateQCReview } from '../api/qcApi'
import useAuthStore from '../store/authStore'
import {
  AlertBanner,
  Badge,
  Card,
  CardTitle,
  DataTable,
  EmptyState,
  FormField,
  FormInput,
  FormSelect,
  FormTextarea,
  LoadingState,
  PrimaryBtn,
  SecondaryBtn,
  TableCell,
  TableRow,
} from '../components/ui'

const RECOMMENDATIONS = ['STRONG_HIRE', 'HIRE', 'MAYBE', 'NO_HIRE']

const RECOMMENDATION_BADGES = {
  STRONG_HIRE: 'green',
  HIRE: 'blue',
  MAYBE: 'amber',
  NO_HIRE: 'red',
}

const QC_STATUS_BADGES = {
  PENDING: 'amber',
  VALIDATED: 'green',
}

function formatDateTime(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRecommendation(value) {
  return String(value || 'UNKNOWN').replaceAll('_', ' ')
}

function getScoreTone(score) {
  if (score == null) return 'text-slate-400'
  if (score >= 7) return 'text-emerald-600'
  if (score >= 5) return 'text-amber-600'
  return 'text-red-500'
}

function StatCard({ label, value, valueClassName = 'text-slate-900', subtext }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="text-xs font-medium text-slate-500 mb-3">{label}</div>
      <div className={`text-3xl font-bold leading-none ${valueClassName}`}>{value}</div>
      {subtext ? <div className="mt-2 text-xs text-slate-400">{subtext}</div> : null}
    </div>
  )
}

export default function QCReview() {
  const userRole = useAuthStore((state) => state.user?.role)
  const canEdit = userRole === 'QC'

  const [dashboard, setDashboard] = useState(null)
  const [queue, setQueue] = useState([])
  const [selectedReview, setSelectedReview] = useState(null)
  const [formState, setFormState] = useState({ final_recommendation: 'MAYBE', qc_notes: '', skill_overrides: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingReview, setIsLoadingReview] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  function syncForm(review) {
    const skills = review?.combined_scores?.skills || []
    setFormState({
      final_recommendation: review?.review?.final_recommendation || review?.review?.current_recommendation || 'MAYBE',
      qc_notes: review?.review?.qc_notes || '',
      skill_overrides: skills.map((skill) => ({
        skill_id: skill.skill_id,
        skill_name: skill.skill_name,
        final_score: String(skill.final_score ?? skill.raw_combined_score ?? ''),
      })),
    })
  }

  async function loadQueueData() {
    try {
      setIsLoading(true)
      setError('')

      const [dashboardResponse, queueResponse] = await Promise.all([
        getQCDashboard(),
        getQCInterviews(),
      ])

      setDashboard(dashboardResponse.data || null)
      setQueue(queueResponse.data?.interviews || [])
    } catch (_loadError) {
      setError('Failed to load QC dashboard data.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadQueueData()
  }, [])

  async function handleOpenReview(interviewId) {
    try {
      setIsLoadingReview(true)
      setError('')
      setSuccess('')

      const response = await getQCReview(interviewId)
      const review = response.data
      setSelectedReview(review)
      syncForm(review)
    } catch (_reviewError) {
      setError('Failed to load review details.')
    } finally {
      setIsLoadingReview(false)
    }
  }

  function handleOverrideChange(skillId, value) {
    setFormState((previous) => ({
      ...previous,
      skill_overrides: previous.skill_overrides.map((item) => (
        item.skill_id === skillId ? { ...item, final_score: value } : item
      )),
    }))
  }

  async function handleSubmitReview(approved) {
    if (!selectedReview) return

    if (!canEdit) {
      setError('Only QC users can edit and submit this review.')
      return
    }

    if (!formState.qc_notes.trim() && !approved) {
      setError('QC notes are required when flagging for revision.')
      return
    }

    const normalizedOverrides = formState.skill_overrides
      .map((item) => ({
        skill_id: item.skill_id,
        final_score: Number(item.final_score),
      }))
      .filter((item) => Number.isFinite(item.final_score))

    if (normalizedOverrides.some((item) => item.final_score < 1 || item.final_score > 10)) {
      setError('Each skill override must be between 1 and 10.')
      return
    }

    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')

      const response = await updateQCReview(selectedReview.interview_id, {
        final_recommendation: formState.final_recommendation,
        qc_notes: formState.qc_notes.trim(),
        skill_overrides: normalizedOverrides,
        approved,
      })

      const updatedReview = response.data
      setSelectedReview(updatedReview)
      syncForm(updatedReview)
      await loadQueueData()
      setSuccess(approved ? 'Result approved and sent to client dashboard' : 'Review flagged for revision.')
    } catch (submitError) {
      setError(submitError?.response?.data?.error || 'Failed to update QC review.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AppShell pageTitle="QC Review" pageSubtitle="Validate completed interviews before results are shared downstream">
      <AlertBanner type="error" message={error} />
      <AlertBanner type="success" message={success} />

      {!selectedReview ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <StatCard
              label="Pending Reviews"
              value={isLoading ? '—' : dashboard?.pending_reviews ?? 0}
              valueClassName="text-amber-600"
            />
            <StatCard
              label="Approved Today"
              value={isLoading ? '—' : dashboard?.approved_today ?? 0}
              valueClassName="text-emerald-600"
            />
            <StatCard
              label="Average AI Score"
              value={isLoading ? '—' : dashboard?.average_ai_score ?? 0}
              valueClassName="text-blue-600"
              subtext="Across all completed interviews in QC scope"
            />
          </div>

          <Card>
            <CardTitle>QC Queue</CardTitle>
            <DataTable
              headers={['Candidate', 'JD', 'Client', 'Interview Date', 'Panelists', 'AI Recommendation', 'QC Status', 'Action']}
              loading={isLoading}
              loadingLabel="Loading QC queue..."
            >
              {queue.length === 0 && !isLoading ? (
                <tr><td colSpan={8}><EmptyState message="No interviews waiting for QC review" /></td></tr>
              ) : (
                queue.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.candidate_name || '—'}</TableCell>
                    <TableCell>{item.jd_title || '—'}</TableCell>
                    <TableCell>{item.client_name || '—'}</TableCell>
                    <TableCell>{formatDateTime(item.interview_date)}</TableCell>
                    <TableCell>{item.panelist_count ?? 0}</TableCell>
                    <TableCell>
                      <Badge variant={RECOMMENDATION_BADGES[item.ai_recommendation] || 'gray'}>
                        {formatRecommendation(item.ai_recommendation)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={QC_STATUS_BADGES[item.qc_status] || 'amber'}>
                        {item.qc_status === 'VALIDATED' ? 'Approved' : 'Pending'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <PrimaryBtn onClick={() => handleOpenReview(item.id)} className="px-3 py-2 text-xs" loading={isLoadingReview}>
                        Review
                      </PrimaryBtn>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </DataTable>
          </Card>
        </>
      ) : isLoadingReview ? (
        <Card>
          <LoadingState label="Loading review detail..." />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <SecondaryBtn onClick={() => { setSelectedReview(null); setSuccess(''); setError('') }}>
              Back
            </SecondaryBtn>
            <Badge variant={RECOMMENDATION_BADGES[selectedReview.review?.current_recommendation] || 'gray'}>
              {formatRecommendation(selectedReview.review?.current_recommendation)}
            </Badge>
          </div>

          <Card>
            <CardTitle>Candidate Information</CardTitle>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Candidate</div>
                <div className="text-sm font-semibold text-slate-900">{selectedReview.candidate?.full_name || '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Email</div>
                <div className="text-sm text-slate-700">{selectedReview.candidate?.email || '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Phone</div>
                <div className="text-sm text-slate-700">{selectedReview.candidate?.phone || '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">JD Title</div>
                <div className="text-sm text-slate-700">{selectedReview.jd?.title || '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Interview Date</div>
                <div className="text-sm text-slate-700">{formatDateTime(selectedReview.interview_date)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Client</div>
                <div className="text-sm text-slate-700">{selectedReview.candidate?.client_name || '—'}</div>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
            <Card className="mb-0">
              <CardTitle>Skill Comparison</CardTitle>
              <DataTable
                headers={['Skill Name', 'Panelist Avg Score', 'AI Score', 'Combined Score']}
                allowHorizontalScroll
              >
                {(selectedReview.combined_scores?.skills || []).length === 0 ? (
                  <tr><td colSpan={4}><EmptyState message="No skill comparison data available" /></td></tr>
                ) : (
                  (selectedReview.combined_scores?.skills || []).map((skill) => (
                    <TableRow key={skill.skill_id}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{skill.skill_name}</div>
                      </TableCell>
                      <TableCell className={`font-semibold tabular-nums ${getScoreTone(skill.panelist_average_score)}`}>
                        {skill.panelist_average_score ?? '—'}
                      </TableCell>
                      <TableCell className={`font-semibold tabular-nums ${getScoreTone(skill.ai_score)}`}>
                        {skill.ai_score ?? '—'}
                      </TableCell>
                      <TableCell className={`font-semibold tabular-nums ${getScoreTone(skill.raw_combined_score)}`}>
                        {skill.raw_combined_score ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </DataTable>
            </Card>

            <div className="xl:sticky xl:top-6 space-y-4">
              <Card className="mb-0">
                <CardTitle>AI Summary</CardTitle>
                <div className="space-y-4">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Current Recommendation</div>
                    <Badge variant={RECOMMENDATION_BADGES[selectedReview.review?.current_recommendation] || 'gray'}>
                      {formatRecommendation(selectedReview.review?.current_recommendation)}
                    </Badge>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">AI Strengths</div>
                    <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
                      {(selectedReview.ai_review?.strengths || []).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                      {(selectedReview.ai_review?.strengths || []).length === 0 ? <li>No strengths listed</li> : null}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">AI Concerns</div>
                    <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
                      {(selectedReview.ai_review?.concerns || []).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                      {(selectedReview.ai_review?.concerns || []).length === 0 ? <li>No concerns listed</li> : null}
                    </ul>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <Card>
            <CardTitle>QC Decision</CardTitle>
            {!canEdit ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-600 mb-4">
                This section is view-only for ADMIN users. QC users can submit the final decision.
              </div>
            ) : null}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <FormField label="Final Recommendation" htmlFor="final_recommendation">
                <FormSelect
                  id="final_recommendation"
                  value={formState.final_recommendation}
                  disabled={!canEdit}
                  onChange={(event) => setFormState((previous) => ({ ...previous, final_recommendation: event.target.value }))}
                >
                  {RECOMMENDATIONS.map((item) => (
                    <option key={item} value={item}>{formatRecommendation(item)}</option>
                  ))}
                </FormSelect>
              </FormField>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 h-fit">
                <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Weighted Overall Score</div>
                <div className={`text-2xl font-bold ${getScoreTone(selectedReview.combined_scores?.overall_score)}`}>
                  {selectedReview.combined_scores?.overall_score ?? '—'}
                </div>
              </div>
            </div>

            <FormField label="QC Notes" htmlFor="qc_notes">
              <FormTextarea
                id="qc_notes"
                rows={5}
                disabled={!canEdit}
                placeholder="Add validation notes, corrections, or revision feedback..."
                value={formState.qc_notes}
                onChange={(event) => setFormState((previous) => ({ ...previous, qc_notes: event.target.value }))}
              />
            </FormField>

            <div className="mb-5">
              <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Skill Score Overrides</div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {formState.skill_overrides.map((item) => (
                  <div key={item.skill_id} className="rounded-xl border border-slate-200 p-4">
                    <div className="text-sm font-semibold text-slate-900 mb-2">{item.skill_name}</div>
                    <FormInput
                      type="number"
                      min="1"
                      max="10"
                      step="0.1"
                      disabled={!canEdit}
                      value={item.final_score}
                      onChange={(event) => handleOverrideChange(item.skill_id, event.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <PrimaryBtn onClick={() => handleSubmitReview(true)} loading={isSubmitting} disabled={!canEdit}>
                Approve
              </PrimaryBtn>
              <SecondaryBtn onClick={() => handleSubmitReview(false)} disabled={!canEdit || isSubmitting}>
                Flag for Revision
              </SecondaryBtn>
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  )
}
