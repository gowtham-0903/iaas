import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { getCandidates } from '../api/candidatesApi'
import { getClients } from '../api/clientsApi'
import { getJDs } from '../api/jdApi'
import { createInterview, getInterviews } from '../api/interviewsApi'
import { getUsers } from '../api/usersApi'
import useAuthStore from '../store/authStore'
import AppShell from '../components/AppShell'
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
  LoadingState,
  PrimaryBtn,
  TableCell,
  TableRow,
} from '../components/ui'

const DEFAULT_FORM = {
  candidate_id: '',
  jd_id: '',
  scheduled_at: '',
  duration_minutes: 60,
  mode: 'virtual',
  meeting_link: '',
  panelist_ids: [],
  notes: '',
}

const STATUS_VARIANTS = {
  SCHEDULED: 'blue',
  IN_PROGRESS: 'amber',
  COMPLETED: 'green',
  CANCELLED: 'red',
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

export default function Interviews() {
  const [searchParams] = useSearchParams()
  const preselectedCandidateId = searchParams.get('candidateId') || ''
  const user = useAuthStore((state) => state.user)
  const canViewPendingScheduling = ['OPERATOR', 'ADMIN'].includes(user?.role)
  const scheduleFormRef = useRef(null)

  const [candidates, setCandidates] = useState([])
  const [jds, setJDs] = useState([])
  const [clients, setClients] = useState([])
  const [panelists, setPanelists] = useState([])
  const [interviews, setInterviews] = useState([])
  const [pendingSchedulingCandidates, setPendingSchedulingCandidates] = useState([])
  const [formData, setFormData] = useState({ ...DEFAULT_FORM, candidate_id: preselectedCandidateId })
  const [isLoading, setIsLoading] = useState(true)
  const [isPendingSchedulingLoading, setIsPendingSchedulingLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const jdMap = useMemo(() => new Map(jds.map((jd) => [String(jd.id), jd])), [jds])
  const clientMap = useMemo(() => new Map(clients.map((client) => [String(client.id), client.name])), [clients])

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => String(candidate.id) === String(formData.candidate_id)),
    [candidates, formData.candidate_id],
  )

  useEffect(() => {
    let active = true

    async function loadData() {
      try {
        setIsLoading(true)
        setError('')

        const [candidatesResponse, jdsResponse, clientsResponse, usersResponse, interviewsResponse] = await Promise.all([
          getCandidates(),
          getJDs(),
          getClients(),
          getUsers(),
          getInterviews(),
        ])

        if (!active) return

        const nextCandidates = candidatesResponse.data?.candidates || []
        const nextJds = jdsResponse.data?.jds || []
        const nextClients = clientsResponse.data?.clients || []
        const nextUsers = Array.isArray(usersResponse.data) ? usersResponse.data : usersResponse.data?.users || []

        setCandidates(nextCandidates)
        setJDs(nextJds)
        setClients(nextClients)
        setPanelists(nextUsers.filter((user) => user.role === 'PANELIST'))
        setInterviews(interviewsResponse.data?.interviews || [])

        if (canViewPendingScheduling) {
          setIsPendingSchedulingLoading(true)

          const shortlistedCandidates = nextCandidates.filter((candidate) => candidate.status === 'SHORTLISTED')
          const interviewChecks = await Promise.all(
            shortlistedCandidates.map(async (candidate) => {
              try {
                const response = await getInterviews({ candidate_id: candidate.id })
                const candidateInterviews = response.data?.interviews || []
                return {
                  candidate,
                  hasInterview: candidateInterviews.length > 0,
                }
              } catch (_candidateInterviewError) {
                return {
                  candidate,
                  hasInterview: true,
                }
              }
            }),
          )

          if (active) {
            setPendingSchedulingCandidates(
              interviewChecks
                .filter((check) => !check.hasInterview)
                .map((check) => check.candidate),
            )
          }
        } else {
          setPendingSchedulingCandidates([])
        }
      } catch (_loadError) {
        if (active) setError('Failed to load interview scheduling data.')
      } finally {
        if (active) setIsPendingSchedulingLoading(false)
        if (active) setIsLoading(false)
      }
    }

    loadData()

    return () => {
      active = false
    }
  }, [canViewPendingScheduling])

  useEffect(() => {
    if (!selectedCandidate) return
    setFormData((previous) => ({
      ...previous,
      jd_id: String(selectedCandidate.jd_id || ''),
    }))
  }, [selectedCandidate])

  function togglePanelist(panelistId) {
    setFormData((previous) => {
      const exists = previous.panelist_ids.includes(panelistId)
      const nextIds = exists
        ? previous.panelist_ids.filter((id) => id !== panelistId)
        : [...previous.panelist_ids, panelistId].slice(0, 3)

      return {
        ...previous,
        panelist_ids: nextIds,
      }
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()

    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')

      const response = await createInterview({
        candidate_id: Number(formData.candidate_id),
        jd_id: Number(formData.jd_id),
        scheduled_at: new Date(formData.scheduled_at).toISOString(),
        duration_minutes: Number(formData.duration_minutes),
        mode: formData.mode,
        meeting_link: formData.meeting_link || null,
        panelist_ids: formData.panelist_ids,
        notes: formData.notes || null,
      })

      setInterviews((previous) => [response.data?.interview, ...previous].filter(Boolean))
      if (canViewPendingScheduling) {
        setPendingSchedulingCandidates((previous) => (
          previous.filter((candidate) => String(candidate.id) !== String(formData.candidate_id))
        ))
      }
      setSuccess('Interview scheduled successfully.')
      setFormData({ ...DEFAULT_FORM, candidate_id: preselectedCandidateId, jd_id: selectedCandidate?.jd_id ? String(selectedCandidate.jd_id) : '' })
    } catch (submitError) {
      setError(submitError?.response?.data?.error || submitError?.response?.data?.message || 'Failed to schedule interview.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleScheduleNow(candidate) {
    setFormData((previous) => ({
      ...previous,
      candidate_id: String(candidate.id),
      jd_id: String(candidate.jd_id || ''),
    }))

    scheduleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <AppShell pageTitle="Interviews" pageSubtitle="Schedule interviews and review upcoming sessions">
      <AlertBanner type="error" message={error} />
      <AlertBanner type="success" message={success} />

      {canViewPendingScheduling && (
        <Card>
          <CardTitle>Pending Scheduling</CardTitle>
          {isPendingSchedulingLoading ? (
            <LoadingState label="Loading pending scheduling queue..." />
          ) : pendingSchedulingCandidates.length === 0 ? (
            <EmptyState message="No shortlisted candidates are pending scheduling" />
          ) : (
            <div className="space-y-3">
              {pendingSchedulingCandidates.map((candidate) => {
                const candidateJd = jdMap.get(String(candidate.jd_id))
                const clientName =
                  candidate.client_name ||
                  clientMap.get(String(candidate.client_id || candidateJd?.client_id)) ||
                  '—'

                return (
                  <div key={candidate.id} className="border border-slate-200 rounded-xl p-4 bg-slate-50/50">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-sm font-semibold text-slate-900">{candidate.full_name || '—'}</div>
                        <div className="text-sm text-slate-600">{candidate.email || '—'}</div>
                        <div className="text-xs text-slate-500">
                          JD: {candidate.jd_title || candidateJd?.title || '—'}
                        </div>
                        <div className="text-xs text-slate-500">Client: {clientName}</div>
                      </div>
                      <div>
                        <PrimaryBtn onClick={() => handleScheduleNow(candidate)}>
                          Schedule Now
                        </PrimaryBtn>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      <Card>
        <div ref={scheduleFormRef} />
        <CardTitle>Schedule Interview</CardTitle>
        {isLoading ? (
          <LoadingState label="Loading scheduling form..." />
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Candidate" htmlFor="interview_candidate">
                <FormSelect
                  id="interview_candidate"
                  value={formData.candidate_id}
                  onChange={(event) => setFormData((previous) => ({ ...previous, candidate_id: event.target.value }))}
                  required
                >
                  <option value="">Select candidate</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.full_name}</option>
                  ))}
                </FormSelect>
              </FormField>
              <FormField label="JD" htmlFor="interview_jd">
                <FormSelect id="interview_jd" value={formData.jd_id} disabled required>
                  <option value="">Select JD</option>
                  {jds.map((jd) => (
                    <option key={jd.id} value={jd.id}>{jd.title}</option>
                  ))}
                </FormSelect>
              </FormField>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField label="Date & Time" htmlFor="interview_scheduled_at">
                <FormInput
                  id="interview_scheduled_at"
                  type="datetime-local"
                  value={formData.scheduled_at}
                  onChange={(event) => setFormData((previous) => ({ ...previous, scheduled_at: event.target.value }))}
                  required
                />
              </FormField>
              <FormField label="Duration (Minutes)" htmlFor="interview_duration">
                <FormInput
                  id="interview_duration"
                  type="number"
                  min="15"
                  step="15"
                  value={formData.duration_minutes}
                  onChange={(event) => setFormData((previous) => ({ ...previous, duration_minutes: event.target.value }))}
                  required
                />
              </FormField>
              <FormField label="Mode" htmlFor="interview_mode">
                <FormSelect
                  id="interview_mode"
                  value={formData.mode}
                  onChange={(event) => setFormData((previous) => ({ ...previous, mode: event.target.value }))}
                >
                  <option value="virtual">virtual</option>
                  <option value="in_person">in_person</option>
                </FormSelect>
              </FormField>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Meeting Link" htmlFor="interview_meeting_link">
                <FormInput
                  id="interview_meeting_link"
                  type="url"
                  placeholder="https://meet.example.com/..."
                  value={formData.meeting_link}
                  onChange={(event) => setFormData((previous) => ({ ...previous, meeting_link: event.target.value }))}
                />
              </FormField>
              <FormField label="Notes" htmlFor="interview_notes">
                <FormInput
                  id="interview_notes"
                  type="text"
                  placeholder="Optional notes"
                  value={formData.notes}
                  onChange={(event) => setFormData((previous) => ({ ...previous, notes: event.target.value }))}
                />
              </FormField>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
                Panelists
              </label>
              {panelists.length === 0 ? (
                <div className="text-sm text-slate-500">No panelists available from the current user scope.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {panelists.map((panelist) => {
                    const checked = formData.panelist_ids.includes(panelist.id)
                    return (
                      <label key={panelist.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm ${checked ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePanelist(panelist.id)}
                        />
                        <span>{panelist.full_name}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <PrimaryBtn type="submit" loading={isSubmitting} disabled={formData.panelist_ids.length === 0}>
              {isSubmitting ? 'Scheduling...' : 'Schedule Interview'}
            </PrimaryBtn>
          </form>
        )}
      </Card>

      <Card>
        <CardTitle>Scheduled Interviews</CardTitle>
        <DataTable headers={['Candidate', 'JD', 'Date', 'Mode', 'Status']} loading={isLoading} loadingLabel="Loading interviews...">
          {interviews.length === 0 && !isLoading ? (
            <tr><td colSpan={5}><EmptyState message="No interviews found" /></td></tr>
          ) : (
            interviews.map((interview) => (
              <TableRow key={interview.id}>
                <TableCell>{interview.candidate_name || '—'}</TableCell>
                <TableCell>{interview.jd_title || '—'}</TableCell>
                <TableCell>{formatDateTime(interview.scheduled_at)}</TableCell>
                <TableCell>{interview.mode || '—'}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANTS[interview.status] || 'gray'}>{interview.status || 'UNKNOWN'}</Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </DataTable>
      </Card>
    </AppShell>
  )
}
