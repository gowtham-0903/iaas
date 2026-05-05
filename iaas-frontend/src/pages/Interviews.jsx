import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { getCandidates } from '../api/candidatesApi'
import { getClients } from '../api/clientsApi'
import { getInterviews, createInterview } from '../api/interviewsApi'
import { getJDs } from '../api/jdApi'
import { getUsers } from '../api/usersApi'
import useAuthStore from '../store/authStore'
import AppShell from '../components/AppShell'
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
  PrimaryBtn,
  SearchSelect,
  SecondaryBtn,
  TableCell,
  TableRow,
} from '../components/ui'

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

export default function Interviews() {
  const user = useAuthStore((state) => state.user)
  const canSchedule = ['OPERATOR', 'ADMIN', 'M_RECRUITER', 'SR_RECRUITER'].includes(user?.role)
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
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const jdOptions = useMemo(() => jds.map((jd) => ({ value: String(jd.id), label: jd.title })), [jds])

  useEffect(() => {
    let active = true

    async function loadBaseData() {
      try {
        setIsLoading(true)
        setError('')

        const requests = [getJDs(), getClients(), getInterviews()]
        if (canSchedule) {
          requests.push(getUsers())
        }

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
    return () => {
      active = false
    }
  }, [canSchedule])

  // Auto-select JD + candidate when arriving from the Candidates page
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
        setFormData((prev) => ({ ...DEFAULT_FORM, jd_id: preselectedJdId }))
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

  async function handleJdSelect(jdId) {
    setSelectedJdId(jdId)
    setFormData((previous) => ({
      ...DEFAULT_FORM,
      jd_id: jdId,
    }))
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

  function getCandidateInterviewStatus(candidateId) {
    return jdInterviews.find(
      (interview) => interview.candidate_id === candidateId && interview.status !== 'CANCELLED',
    ) || null
  }

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
      setFormData((previous) => ({
        ...DEFAULT_FORM,
        jd_id: previous.jd_id,
      }))
      scheduledInterviewsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (submitError) {
      setError(submitError?.response?.data?.error || submitError?.response?.data?.message || 'Failed to schedule interview.')
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
    <AppShell pageTitle="Interviews" pageSubtitle="Schedule and review virtual interview sessions">
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
                      const interview = getCandidateInterviewStatus(candidate.id)
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
                            {interview ? (
                              <div>
                                <Badge variant="blue">Scheduled</Badge>
                                <div className="text-xs text-slate-500 mt-1">
                                  {formatLocalDateTime(interview.scheduled_at_local || interview.scheduled_at, interview.timezone)}
                                </div>
                              </div>
                            ) : (
                              <Badge variant="gray">Not Scheduled</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {!interview ? (
                              <PrimaryBtn onClick={() => selectCandidateForScheduling(candidate)}>
                                Schedule
                              </PrimaryBtn>
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
                  <p className="text-xs text-slate-500 mt-1">Press Enter after each email — added to Teams meeting and notified via email.</p>
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

      <Card>
        <div ref={scheduledInterviewsRef} />
        <CardTitle>Scheduled Interviews</CardTitle>
        <DataTable
          headers={['Candidate Email', 'Candidate Name', 'JD', 'Date & Time', 'Timezone', 'Mode', 'Panelists', 'Status']}
          loading={isLoading}
          loadingLabel="Loading interviews..."
        >
          {interviews.length === 0 && !isLoading ? (
            <tr><td colSpan={8}><EmptyState message="No interviews found" /></td></tr>
          ) : (
            interviews.map((interview) => (
              <TableRow key={interview.id}>
                <TableCell className="font-medium">{interview.candidate_email || '—'}</TableCell>
                <TableCell>{interview.candidate_name || '—'}</TableCell>
                <TableCell>{interview.jd_title || '—'}</TableCell>
                <TableCell>{formatLocalDateTime(interview.scheduled_at_local || interview.scheduled_at, interview.timezone)}</TableCell>
                <TableCell>{interview.timezone || 'America/New_York'}</TableCell>
                <TableCell>{interview.mode || 'virtual'}</TableCell>
                <TableCell>{(interview.panelists || []).map((panelist) => panelist.email).join(', ') || '—'}</TableCell>
                <TableCell>
                  <Badge variant={INTERVIEW_STATUS_VARIANTS[interview.status] || 'gray'}>{interview.status || 'UNKNOWN'}</Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </DataTable>
      </Card>
    </AppShell>
  )
}
