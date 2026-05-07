import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { getCandidates } from '../api/candidatesApi'
import { getClients } from '../api/clientsApi'
import { getInterviews, createInterview, updateInterviewStatus } from '../api/interviewsApi'
import { getJDs } from '../api/jdApi'
import { getUsers } from '../api/usersApi'
import useAuthStore from '../store/authStore'
import AppShell from '../components/AppShell'
import RescheduleCountdownBadge from '../components/RescheduleCountdownBadge'
import {
  AlertBanner,
  Badge,
  Card,
  CardTitle,
  DataTable,
  EmailTagSelect,
  EmptyState,
  FormField,
  FormInput,
  FormTextarea,
  LoadingState,
  ModalOverlay,
  PrimaryBtn,
  SearchSelect,
  SecondaryBtn,
  TableCell,
  TableRow,
} from '../components/ui'
import { getRescheduleDaysLeft } from '../utils/rescheduleWindow'

const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern Time (ET) — New York' },
  { value: 'America/Chicago', label: 'Central Time (CT) — Chicago' },
  { value: 'America/Denver', label: 'Mountain Time (MT) — Denver' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT) — Los Angeles' },
  { value: 'America/Phoenix', label: 'Arizona Time (No DST)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
  { value: 'Asia/Kolkata', label: 'India Standard Time (IST)' },
  { value: 'UTC', label: 'UTC' },
]

const DEFAULT_FORM = {
  candidate_id: '',
  candidate_email: '',
  jd_id: '',
  scheduled_date: '',
  scheduled_time: '',
  timezone: 'America/New_York',
  duration_minutes: 60,
  mode: 'virtual',
  panelist_ids: [],
  notes: '',
  additional_emails: [],
}

const CANDIDATE_STATUS_VARIANTS = {
  APPLIED: 'gray',
  SHORTLISTED: 'blue',
  INTERVIEWED: 'amber',
  SELECTED: 'green',
  NOT_SELECTED: 'red',
}

const INTERVIEW_STATUS_VARIANTS = {
  SCHEDULED: 'blue',
  IN_PROGRESS: 'amber',
  COMPLETED: 'green',
  CANCELLED: 'red',
  ABSENT: 'amber',
}

const OUTCOME_VARIANTS = {
  SELECTED: 'green',
  NOT_SELECTED: 'red',
}

function formatLocalDateTime(isoString, timezone) {
  if (!isoString) return '—'
  try {
    return new Date(isoString).toLocaleString('en-US', {
      timeZone: timezone || 'America/New_York',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return isoString
  }
}

function formatISTDateTime(isoString) {
  if (!isoString) return '—'
  try {
    return new Date(isoString).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' IST'
  } catch {
    return isoString
  }
}

function getCandidateRescheduleDaysLeft(candidate, lastInterview, currentTimeMs) {
  return getRescheduleDaysLeft(
    candidate?.status_updated_at || lastInterview?.scheduled_at_local || lastInterview?.scheduled_at,
    currentTimeMs
  )
}

// ─── Outcome Modal ─────────────────────────────────────────────────────────────
function OutcomeModal({ interview, onConfirm, onClose, isSubmitting }) {
  const [outcome, setOutcome] = useState('')

  return (
    <ModalOverlay onClose={onClose}>
      <div className="p-6">
        <div className="flex items-start gap-4 mb-6">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Mark Interview as Completed</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {interview.candidate_name} · {interview.jd_title}
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-600 mb-5">
          Select the outcome for this interview. This will update the candidate's status and lock in
          the result.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            type="button"
            onClick={() => setOutcome('SELECTED')}
            className={`relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all focus:outline-none ${
              outcome === 'SELECTED'
                ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200'
                : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/50'
            }`}
          >
            {outcome === 'SELECTED' && (
              <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                  <path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </span>
            )}
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="font-semibold text-slate-900 text-sm">Selected</div>
              <div className="text-xs text-slate-500 mt-0.5">Candidate passed</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setOutcome('NOT_SELECTED')}
            className={`relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all focus:outline-none ${
              outcome === 'NOT_SELECTED'
                ? 'border-red-500 bg-red-50 ring-2 ring-red-200'
                : 'border-slate-200 bg-white hover:border-red-300 hover:bg-red-50/50'
            }`}
          >
            {outcome === 'NOT_SELECTED' && (
              <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                  <path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </span>
            )}
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <div className="font-semibold text-slate-900 text-sm">Not Selected</div>
              <div className="text-xs text-slate-500 mt-0.5">60-day re-apply lock</div>
            </div>
          </button>
        </div>

        {outcome === 'NOT_SELECTED' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 flex gap-3">
            <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-amber-800">
              Marking as <strong>Not Selected</strong> will start a 60-day cooling period from the
              interview date. The candidate cannot be re-added to this JD during this period.
            </p>
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <SecondaryBtn onClick={onClose} disabled={isSubmitting}>
            Cancel
          </SecondaryBtn>
          <PrimaryBtn
            onClick={() => outcome && onConfirm(outcome)}
            disabled={!outcome || isSubmitting}
            loading={isSubmitting}
          >
            {isSubmitting ? 'Saving…' : 'Confirm Outcome'}
          </PrimaryBtn>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ─── Absent Confirm Modal ──────────────────────────────────────────────────────
function AbsentModal({ interview, onConfirm, onClose, isSubmitting }) {
  return (
    <ModalOverlay onClose={onClose}>
      <div className="p-6">
        <div className="flex items-start gap-4 mb-6">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Mark as No-Show / Absent</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {interview.candidate_name} · {interview.jd_title}
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-600 mb-4">
          The candidate did not attend this interview. You can reschedule them for a new date after
          marking them absent.
        </p>

        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-6 flex gap-3">
          <svg className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-blue-800">
            No cooling period applies. You can schedule a new interview for this candidate
            immediately after marking them absent.
          </p>
        </div>

        <div className="flex gap-3 justify-end">
          <SecondaryBtn onClick={onClose} disabled={isSubmitting}>
            Cancel
          </SecondaryBtn>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Saving…' : 'Mark Absent'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ─── Action Menu for interview rows ───────────────────────────────────────────
function InterviewActions({ interview, canSchedule, onCancel, onMarkOutcome, onMarkAbsent, onReschedule, cancellingId, currentTimeMs }) {
  const isActive = ['SCHEDULED', 'IN_PROGRESS'].includes(interview.status)
  const isAbsent = interview.status === 'ABSENT'
  const isCompletedNotSelected = interview.status === 'COMPLETED' && interview.outcome === 'NOT_SELECTED'
  const isCancelling = cancellingId === interview.id
  const rescheduleDaysLeft = isCompletedNotSelected
    ? getRescheduleDaysLeft(interview.scheduled_at_local || interview.scheduled_at, currentTimeMs)
    : null

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {interview.meeting_link && (
        <CopyLinkButton meetingLink={interview.meeting_link} />
      )}

      {canSchedule && isActive && (
        <>
          <button
            type="button"
            onClick={() => onMarkOutcome(interview)}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 font-medium transition-colors whitespace-nowrap"
          >
            Attended
          </button>
          <button
            type="button"
            onClick={() => onMarkAbsent(interview)}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 font-medium transition-colors whitespace-nowrap"
          >
            Absent
          </button>
          <button
            type="button"
            onClick={() => onCancel(interview.id)}
            disabled={isCancelling}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {isCancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        </>
      )}

      {canSchedule && isAbsent && (
        <button
          type="button"
          onClick={() => onReschedule(interview)}
          className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-medium transition-colors whitespace-nowrap"
        >
          Reschedule
        </button>
      )}

      {canSchedule && isCompletedNotSelected && (
        <RescheduleCountdownBadge
          daysLeft={rescheduleDaysLeft}
          onClick={rescheduleDaysLeft === 0 ? () => onReschedule(interview) : undefined}
        />
      )}
    </div>
  )
}

function CopyLinkButton({ meetingLink }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(meetingLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy meeting link"
      className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 font-medium transition-colors whitespace-nowrap"
    >
      {copied ? '✓ Copied' : 'Copy Link'}
    </button>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function Interviews() {
  const user = useAuthStore((state) => state.user)
  const canSchedule = ['OPERATOR', 'ADMIN', 'M_RECRUITER', 'SR_RECRUITER'].includes(user?.role)
  const isRecruiterScopedRole = ['RECRUITER', 'SR_RECRUITER', 'M_RECRUITER'].includes(user?.role)
  const scheduleFormRef = useRef(null)
  const scheduledInterviewsRef = useRef(null)
  const [searchParams] = useSearchParams()
  const preselectedJdId = searchParams.get('jd_id') || ''
  const preselectedCandidateId = searchParams.get('candidate_id') || ''

  const [clients, setClients] = useState([])
  const [jds, setJDs] = useState([])
  const [panelists, setPanelists] = useState([])
  const [interviews, setInterviews] = useState([])
  const [selectedJdId, setSelectedJdId] = useState('')
  const [jdCandidates, setJdCandidates] = useState([])
  const [jdInterviews, setJdInterviews] = useState([])
  const [formData, setFormData] = useState(DEFAULT_FORM)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingJdData, setIsLoadingJdData] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [cancellingId, setCancellingId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modal state
  const [outcomeModal, setOutcomeModal] = useState(null)   // interview object
  const [absentModal, setAbsentModal] = useState(null)      // interview object
  const [isModalSubmitting, setIsModalSubmitting] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now())

  const jdOptions = useMemo(() => {
    const visibleJds = isRecruiterScopedRole
      ? jds.filter((jd) => String(jd.client_id) === String(user?.client_id) && jd.status === 'ACTIVE')
      : jds.filter((jd) => jd.status === 'ACTIVE')
    return visibleJds.map((jd) => ({ value: String(jd.id), label: jd.title }))
  }, [jds, isRecruiterScopedRole, user?.client_id])

  const filteredInterviews = useMemo(() => {
    if (!isRecruiterScopedRole) return interviews
    const clientJdIds = new Set(
      jds.filter((jd) => String(jd.client_id) === String(user?.client_id)).map((jd) => jd.id)
    )
    return interviews.filter((iv) => clientJdIds.has(iv.jd_id))
  }, [interviews, jds, isRecruiterScopedRole, user?.client_id])

  function getClientNameForInterview(interview) {
    const jd = jds.find((j) => j.id === interview.jd_id)
    if (!jd) return null
    const client = clients.find((c) => c.id === jd.client_id)
    return client?.name || null
  }

  useEffect(() => {
    const intervalId = window.setInterval(() => setCurrentTimeMs(Date.now()), 60 * 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    let active = true

    async function loadBaseData() {
      try {
        setIsLoading(true)
        setError('')

        const requests = [getJDs(), getClients(), getInterviews()]
        if (canSchedule) requests.push(getUsers())

        const [jdsResponse, clientsResponse, interviewsResponse, usersResponse] = await Promise.all(requests)
        if (!active) return

        const nextJds = jdsResponse.data?.jds || []
        const nextClients = clientsResponse.data?.clients || []
        const nextInterviews = interviewsResponse.data?.interviews || []
        const nextUsers = Array.isArray(usersResponse?.data)
          ? usersResponse.data
          : usersResponse?.data?.users || []

        setJDs(nextJds)
        setClients(nextClients)
        setInterviews(nextInterviews)
        setPanelists(nextUsers.filter((entry) => entry.role === 'PANELIST'))
      } catch (_loadError) {
        if (active) setError('Failed to load interview scheduling data.')
      } finally {
        if (active) setIsLoading(false)
      }
    }

    loadBaseData()
    return () => { active = false }
  }, [canSchedule])

  useEffect(() => {
    if (!preselectedJdId || isLoading || !canSchedule) return

    async function autoSelect() {
      try {
        setIsLoadingJdData(true)
        setError('')
        const [candidatesResponse, interviewsResponse] = await Promise.all([
          getCandidates({ jd_id: Number(preselectedJdId) }),
          getInterviews({ jd_id: Number(preselectedJdId) }),
        ])
        const candidates = candidatesResponse.data?.candidates || []
        const jdInterviewList = interviewsResponse.data?.interviews || []

        setSelectedJdId(preselectedJdId)
        setFormData({ ...DEFAULT_FORM, jd_id: preselectedJdId })
        setJdCandidates(candidates)
        setJdInterviews(jdInterviewList)

        if (preselectedCandidateId) {
          const match = candidates.find((c) => String(c.id) === String(preselectedCandidateId))
          if (match) {
            setFormData((prev) => ({
              ...prev,
              candidate_id: String(match.id),
              candidate_email: match.email,
              jd_id: preselectedJdId,
            }))
            setTimeout(() => scheduleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
          }
        }
      } catch (_err) {
        setError('Failed to load selected JD data.')
      } finally {
        setIsLoadingJdData(false)
      }
    }

    autoSelect()
  }, [preselectedJdId, preselectedCandidateId, isLoading, canSchedule])

  async function refreshInterviews() {
    const response = await getInterviews()
    setInterviews(response.data?.interviews || [])
  }

  async function refreshJdInterviews() {
    if (!selectedJdId) return
    const response = await getInterviews({ jd_id: Number(selectedJdId) })
    setJdInterviews(response.data?.interviews || [])
  }

  async function handleJdSelect(jdId) {
    setSelectedJdId(jdId)
    setFormData({ ...DEFAULT_FORM, jd_id: jdId })
    setJdCandidates([])
    setJdInterviews([])
    if (!jdId) return

    try {
      setIsLoadingJdData(true)
      setError('')
      const [candidatesResponse, interviewsResponse] = await Promise.all([
        getCandidates({ jd_id: Number(jdId) }),
        getInterviews({ jd_id: Number(jdId) }),
      ])
      setJdCandidates(candidatesResponse.data?.candidates || [])
      setJdInterviews(interviewsResponse.data?.interviews || [])
    } catch (_jdLoadError) {
      setError('Failed to load candidates for the selected JD.')
    } finally {
      setIsLoadingJdData(false)
    }
  }

  function getActiveInterviewForCandidate(candidateId) {
    return jdInterviews.find(
      (iv) => iv.candidate_id === candidateId && ['SCHEDULED', 'IN_PROGRESS'].includes(iv.status)
    ) || null
  }

  function getLastInterviewForCandidate(candidateId) {
    return jdInterviews.find((iv) => iv.candidate_id === candidateId) || null
  }

  function togglePanelist(panelistId) {
    setFormData((previous) => {
      const exists = previous.panelist_ids.includes(panelistId)
      const nextIds = exists
        ? previous.panelist_ids.filter((id) => id !== panelistId)
        : [...previous.panelist_ids, panelistId].slice(0, 3)
      return { ...previous, panelist_ids: nextIds }
    })
  }

  async function handleCancelInterview(interviewId) {
    if (!window.confirm('Cancel this interview? The Teams meeting will also be cancelled.')) return
    try {
      setCancellingId(interviewId)
      setError('')
      await updateInterviewStatus(interviewId, 'CANCELLED')
      await Promise.all([refreshInterviews(), refreshJdInterviews()])
      setSuccess('Interview cancelled successfully.')
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to cancel interview.')
    } finally {
      setCancellingId(null)
    }
  }

  async function handleConfirmOutcome(outcome) {
    if (!outcomeModal) return
    try {
      setIsModalSubmitting(true)
      setError('')
      await updateInterviewStatus(outcomeModal.id, 'COMPLETED', outcome)
      await Promise.all([refreshInterviews(), refreshJdInterviews()])
      setSuccess(`Interview marked as Completed — candidate ${outcome === 'SELECTED' ? 'Selected' : 'Not Selected'}.`)
      setOutcomeModal(null)
    } catch (err) {
      setError(err?.response?.data?.error || err?.response?.data?.errors?.outcome?.[0] || 'Failed to update interview.')
      setOutcomeModal(null)
    } finally {
      setIsModalSubmitting(false)
    }
  }

  async function handleConfirmAbsent() {
    if (!absentModal) return
    try {
      setIsModalSubmitting(true)
      setError('')
      await updateInterviewStatus(absentModal.id, 'ABSENT')
      await Promise.all([refreshInterviews(), refreshJdInterviews()])
      setSuccess('Interview marked as Absent. You can now reschedule the candidate.')
      setAbsentModal(null)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to update interview.')
      setAbsentModal(null)
    } finally {
      setIsModalSubmitting(false)
    }
  }

  function handleReschedule(interview) {
    // Pre-fill the scheduling form for this candidate
    const jdId = String(interview.jd_id)
    setSelectedJdId(jdId)
    setFormData({
      ...DEFAULT_FORM,
      jd_id: jdId,
      candidate_id: String(interview.candidate_id),
      candidate_email: interview.candidate_email,
    })
    // If on same JD, refresh; otherwise load fresh
    handleJdSelect(jdId)
    setTimeout(() => scheduleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (!formData.scheduled_date || !formData.scheduled_time) {
      setError('Date and time are required.')
      return
    }

    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')

      const additionalEmails = (formData.additional_emails || []).map((e) => String(e).trim().toLowerCase())

      const payload = {
        candidate_id: Number(formData.candidate_id),
        jd_id: Number(formData.jd_id),
        scheduled_at: `${formData.scheduled_date}T${formData.scheduled_time}:00`,
        timezone: formData.timezone,
        duration_minutes: Number(formData.duration_minutes),
        mode: 'virtual',
        panelist_ids: formData.panelist_ids,
        notes: formData.notes || null,
        additional_emails: additionalEmails,
      }

      await createInterview(payload)
      await Promise.all([refreshInterviews(), handleJdSelect(selectedJdId)])
      setSuccess('Interview scheduled successfully.')
      setFormData((previous) => ({ ...DEFAULT_FORM, jd_id: previous.jd_id }))
      scheduledInterviewsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (submitError) {
      setError(
        submitError?.response?.data?.error ||
        submitError?.response?.data?.message ||
        'Failed to schedule interview.'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  function selectCandidateForScheduling(candidate) {
    setFormData((previous) => ({
      ...previous,
      candidate_id: String(candidate.id),
      candidate_email: candidate.email,
      jd_id: String(selectedJdId),
    }))
    scheduleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function clearCandidateSelection() {
    setFormData((previous) => ({
      ...previous,
      candidate_id: '',
      candidate_email: '',
      scheduled_date: '',
      scheduled_time: '',
      panelist_ids: [],
      notes: '',
      additional_emails: [],
    }))
  }

  return (
    <AppShell>
      {/* Modals */}
      {outcomeModal && (
        <OutcomeModal
          interview={outcomeModal}
          onConfirm={handleConfirmOutcome}
          onClose={() => setOutcomeModal(null)}
          isSubmitting={isModalSubmitting}
        />
      )}
      {absentModal && (
        <AbsentModal
          interview={absentModal}
          onConfirm={handleConfirmAbsent}
          onClose={() => setAbsentModal(null)}
          isSubmitting={isModalSubmitting}
        />
      )}

      <AlertBanner type="error" message={error} />
      <AlertBanner type="success" message={success} />

      {canSchedule && (
        <>
          <Card>
            <CardTitle>Step 1 — Select Job Description</CardTitle>
            {isLoading ? (
              <LoadingState label="Loading job descriptions..." />
            ) : (
              <FormField label="Job Description" htmlFor="schedule_jd">
                <SearchSelect
                  inputId="schedule_jd"
                  options={jdOptions}
                  value={selectedJdId}
                  onChange={(val) => handleJdSelect(val || '')}
                  placeholder="Search and select a JD..."
                  isClearable
                />
              </FormField>
            )}
          </Card>

          {selectedJdId && (
            <Card>
              <div className="flex items-center justify-between gap-3 mb-4">
                <CardTitle>Candidates under this JD</CardTitle>
                <Badge variant="gray">{jdCandidates.length} total</Badge>
              </div>
              {isLoadingJdData ? (
                <LoadingState label="Loading candidates..." />
              ) : (
                <DataTable headers={['Email', 'Name', 'Phone', 'Status', 'Interview Status', 'Action']}>
                  {jdCandidates.length === 0 ? (
                    <tr><td colSpan={6}><EmptyState message="No candidates found under this JD" /></td></tr>
                  ) : (
                    jdCandidates.map((candidate) => {
                      const activeInterview = getActiveInterviewForCandidate(candidate.id)
                      const lastInterview = getLastInterviewForCandidate(candidate.id)
                      const canScheduleThis = !activeInterview
                      const shouldShowReschedule = canScheduleThis && (
                        candidate.status === 'NOT_SELECTED' ||
                        lastInterview?.outcome === 'NOT_SELECTED'
                      )
                      const rescheduleDaysLeft = shouldShowReschedule
                        ? getCandidateRescheduleDaysLeft(candidate, lastInterview, currentTimeMs)
                        : null

                      return (
                        <TableRow key={candidate.id}>
                          <TableCell className="font-medium">{candidate.email || '—'}</TableCell>
                          <TableCell>{candidate.full_name || '—'}</TableCell>
                          <TableCell>{candidate.phone || '—'}</TableCell>
                          <TableCell>
                            <Badge variant={CANDIDATE_STATUS_VARIANTS[candidate.status] || 'gray'}>
                              {candidate.status || 'UNKNOWN'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {activeInterview ? (
                              <div>
                                <Badge variant="blue">Scheduled</Badge>
                                <div className="text-xs text-slate-500 mt-1">
                                  {formatLocalDateTime(activeInterview.scheduled_at_local || activeInterview.scheduled_at, activeInterview.timezone)}
                                </div>
                              </div>
                            ) : lastInterview ? (
                              <div>
                                <Badge variant={INTERVIEW_STATUS_VARIANTS[lastInterview.status] || 'gray'}>
                                  {lastInterview.status}
                                </Badge>
                                {lastInterview.outcome && (
                                  <div className="mt-1">
                                    <Badge variant={OUTCOME_VARIANTS[lastInterview.outcome] || 'gray'}>
                                      {lastInterview.outcome === 'SELECTED' ? 'Selected' : 'Not Selected'}
                                    </Badge>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <Badge variant="gray">Not Scheduled</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {canScheduleThis ? (
                              shouldShowReschedule ? (
                                <RescheduleCountdownBadge
                                  daysLeft={rescheduleDaysLeft}
                                  onClick={rescheduleDaysLeft === 0 ? () => selectCandidateForScheduling(candidate) : undefined}
                                />
                              ) : (
                                <PrimaryBtn onClick={() => selectCandidateForScheduling(candidate)}>
                                  Schedule
                                </PrimaryBtn>
                              )
                            ) : (
                              <SecondaryBtn onClick={() => scheduledInterviewsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                                View
                              </SecondaryBtn>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </DataTable>
              )}
            </Card>
          )}

          {formData.candidate_id && (
            <Card>
              <div ref={scheduleFormRef} />
              <CardTitle>Step 2 — Schedule Interview</CardTitle>
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs text-blue-600 font-semibold uppercase tracking-wide mb-1">Scheduling for</div>
                  <div className="text-sm font-bold text-blue-900">{formData.candidate_email}</div>
                  <div className="text-sm font-bold text-blue-900">
                    {jds.find((jd) => String(jd.id) === String(formData.jd_id))?.title || ''}
                  </div>
                </div>
                <SecondaryBtn onClick={clearCandidateSelection}>Change</SecondaryBtn>
              </div>

              <form onSubmit={handleSubmit}>
                <FormField label="Timezone" htmlFor="interview_timezone">
                  <SearchSelect
                    inputId="interview_timezone"
                    options={TIMEZONE_OPTIONS}
                    value={formData.timezone}
                    onChange={(val) => setFormData((previous) => ({ ...previous, timezone: val || 'America/New_York' }))}
                    placeholder="Select timezone"
                  />
                </FormField>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField label="Date" htmlFor="interview_date">
                    <FormInput
                      id="interview_date"
                      type="date"
                      value={formData.scheduled_date}
                      onChange={(event) => setFormData((previous) => ({ ...previous, scheduled_date: event.target.value }))}
                      required
                    />
                  </FormField>
                  <FormField
                    label={`Time (${TIMEZONE_OPTIONS.find((entry) => entry.value === formData.timezone)?.label.split('—')[0].trim() || formData.timezone})`}
                    htmlFor="interview_time"
                  >
                    <FormInput
                      id="interview_time"
                      type="time"
                      value={formData.scheduled_time}
                      onChange={(event) => setFormData((previous) => ({ ...previous, scheduled_time: event.target.value }))}
                      required
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField label="Duration (minutes)" htmlFor="interview_duration">
                    <SearchSelect
                      inputId="interview_duration"
                      options={[
                        { label: '30 minutes', value: 30 },
                        { label: '45 minutes', value: 45 },
                        { label: '60 minutes', value: 60 },
                        { label: '90 minutes', value: 90 },
                      ]}
                      value={formData.duration_minutes}
                      onChange={(val) => setFormData((previous) => ({ ...previous, duration_minutes: Number(val) || 60 }))}
                      placeholder="Select duration"
                    />
                  </FormField>
                  <FormField label="Mode" htmlFor="interview_mode">
                    <SearchSelect
                      inputId="interview_mode"
                      options={[{ label: 'Virtual (Teams)', value: 'virtual' }]}
                      value="virtual"
                      onChange={() => {}}
                      isDisabled
                    />
                  </FormField>
                </div>

                <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-4 text-sm text-blue-700">
                  A unique Microsoft Teams meeting link will be auto-generated and emailed to the candidate and all selected panelists.
                </div>

                <FormField label={`Panelists (${formData.panelist_ids.length}/3 selected)`} htmlFor="interview_panelists">
                  <SearchSelect
                    inputId="interview_panelists"
                    options={panelists.map((p) => ({ label: `${p.full_name} — ${p.email}`, value: p.id }))}
                    value={formData.panelist_ids}
                    onChange={(vals) => setFormData((previous) => ({ ...previous, panelist_ids: vals.slice(0, 3) }))}
                    isMulti
                    placeholder="Search and select panelists (max 3)..."
                    noOptionsMessage="No panelists available"
                  />
                  {formData.panelist_ids.length === 3 && (
                    <p className="text-xs text-amber-600 mt-1">Maximum 3 panelists reached.</p>
                  )}
                </FormField>

                <FormField label="Additional Recipients (optional)" htmlFor="interview_additional_emails">
                  <EmailTagSelect
                    inputId="interview_additional_emails"
                    value={formData.additional_emails}
                    onChange={(emails) => setFormData((previous) => ({ ...previous, additional_emails: emails }))}
                    placeholder="Type an email and press Enter to add..."
                  />
                  <p className="text-xs text-slate-500 mt-1">Press Enter after each email — they will receive an interview notification email with the Teams join link.</p>
                </FormField>

                <FormField label="Notes (optional)" htmlFor="interview_notes">
                  <FormTextarea
                    id="interview_notes"
                    rows={3}
                    value={formData.notes}
                    onChange={(event) => setFormData((previous) => ({ ...previous, notes: event.target.value }))}
                    placeholder="Additional interview notes..."
                  />
                </FormField>

                <PrimaryBtn type="submit" loading={isSubmitting} disabled={formData.panelist_ids.length === 0}>
                  {isSubmitting ? 'Scheduling...' : 'Schedule Interview'}
                </PrimaryBtn>
              </form>
            </Card>
          )}
        </>
      )}

      {/* ─── Interviews Table ─────────────────────────────────────────────── */}
      <Card>
        <div ref={scheduledInterviewsRef} />
        <div className="flex items-center justify-between gap-3 mb-4">
          <CardTitle>Scheduled Interviews ({filteredInterviews.length})</CardTitle>
        </div>
        <DataTable
          headers={['Candidate', 'JD', 'Date & Time (IST)', 'Mode', 'Panelists', 'Status', 'Actions']}
          loading={isLoading}
          loadingLabel="Loading interviews..."
        >
          {filteredInterviews.length === 0 && !isLoading ? (
            <tr><td colSpan={7}><EmptyState message="No interviews found" /></td></tr>
          ) : (
            filteredInterviews.map((interview) => (
              <TableRow key={interview.id}>
                <TableCell>
                  <div className="font-medium text-slate-900">{interview.candidate_name || '—'}</div>
                  <div className="text-xs text-slate-500">{interview.candidate_email || ''}</div>
                </TableCell>
                <TableCell>{interview.jd_title || '—'}</TableCell>
                <TableCell>
                  {isRecruiterScopedRole && getClientNameForInterview(interview) && (
                    <div className="text-xs text-slate-500 mb-0.5">{getClientNameForInterview(interview)}</div>
                  )}
                  <div className="text-sm">{formatISTDateTime(interview.scheduled_at_local || interview.scheduled_at)}</div>
                </TableCell>
                <TableCell className="capitalize">{interview.mode || 'virtual'}</TableCell>
                <TableCell>
                  <div className="text-sm">
                    {(interview.panelists || []).map((p) => p.full_name || p.email).join(', ') || '—'}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge variant={INTERVIEW_STATUS_VARIANTS[interview.status] || 'gray'}>
                      {interview.status || 'UNKNOWN'}
                    </Badge>
                    {interview.outcome && (
                      <Badge variant={OUTCOME_VARIANTS[interview.outcome] || 'gray'}>
                        {interview.outcome === 'SELECTED' ? 'Selected' : 'Not Selected'}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <InterviewActions
                    interview={interview}
                    canSchedule={canSchedule}
                    cancellingId={cancellingId}
                    currentTimeMs={currentTimeMs}
                    onCancel={handleCancelInterview}
                    onMarkOutcome={(iv) => setOutcomeModal(iv)}
                    onMarkAbsent={(iv) => setAbsentModal(iv)}
                    onReschedule={handleReschedule}
                  />
                </TableCell>
              </TableRow>
            ))
          )}
        </DataTable>
      </Card>
    </AppShell>
  )
}
