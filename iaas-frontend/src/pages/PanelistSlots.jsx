import { useEffect, useMemo, useState } from 'react'

import AppShell from '../components/AppShell'
import { createPanelistAvailability, getInterviews, getPanelistAvailability } from '../api/interviewsApi'
import { getSkills } from '../api/jdApi'
import { submitInterviewScores, uploadInterviewTranscript } from '../api/scoringApi'
import {
  AlertBanner,
  Badge,
  Card,
  CardTitle,
  DataTable,
  EmptyState,
  FormField,
  FormInput,
  FormTextarea,
  LoadingState,
  PrimaryBtn,
  SecondaryBtn,
  TableCell,
} from '../components/ui'

const SCORE_DEFAULT = {
  technical_score: 5,
  communication_score: 5,
  problem_solving_score: 5,
  comments: '',
}

const STATUS_VARIANTS = {
  SCHEDULED: 'blue',
  IN_PROGRESS: 'amber',
  COMPLETED: 'green',
  CANCELLED: 'red',
}

const RECOMMENDATION_VARIANTS = {
  STRONG_HIRE: 'green',
  HIRE: 'blue',
  MAYBE: 'amber',
  NO_HIRE: 'red',
}

const TRANSCRIPT_TABS = [
  { id: 'file', label: 'Upload File' },
  { id: 'text', label: 'Paste Text' },
]

function ScoreSlider({ label, value, onChange }) {
  const pct = ((value - 1) / 9) * 100
  const color = value >= 8 ? 'text-emerald-600' : value >= 5 ? 'text-amber-600' : 'text-red-500'

  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
          <span className="text-xs text-slate-400">/10</span>
        </div>
      </div>
      <input
        type="range"
        min="1"
        max="10"
        value={value}
        onChange={onChange}
        style={{ '--range-pct': `${pct}%` }}
      />
      <div className="flex justify-between mt-1">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <span key={n} className={`text-[10px] ${value === n ? 'text-blue-600 font-semibold' : 'text-slate-300'}`}>
            {n}
          </span>
        ))}
      </div>
    </div>
  )
}

function formatDate(isoString) {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

function formatTime(isoString) {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getSkillBadgeVariant(skillType) {
  return String(skillType || '').toLowerCase() === 'primary' ? 'blue' : 'amber'
}

function getScoreSummary(skills, scoreMap) {
  if (!skills.length) return { average: '—', primaryCount: 0, secondaryCount: 0 }

  let total = 0
  let count = 0

  skills.forEach((skill) => {
    const values = scoreMap[skill.id] || SCORE_DEFAULT
    total += Number(values.technical_score) + Number(values.communication_score) + Number(values.problem_solving_score)
    count += 3
  })

  return {
    average: count ? (total / count).toFixed(1) : '—',
    primaryCount: skills.filter((skill) => String(skill.skill_type || '').toLowerCase() === 'primary').length,
    secondaryCount: skills.filter((skill) => String(skill.skill_type || '').toLowerCase() !== 'primary').length,
  }
}

export default function PanelistSlots() {
  const [availabilityForm, setAvailabilityForm] = useState({ date: '', start_time: '', end_time: '' })
  const [availabilitySlots, setAvailabilitySlots] = useState([])
  const [interviews, setInterviews] = useState([])
  const [expandedInterviewId, setExpandedInterviewId] = useState(null)
  const [skillsByInterview, setSkillsByInterview] = useState({})
  const [scoreFormsByInterview, setScoreFormsByInterview] = useState({})
  const [submittedScorePanels, setSubmittedScorePanels] = useState({})
  const [transcriptModeByInterview, setTranscriptModeByInterview] = useState({})
  const [transcriptFileByInterview, setTranscriptFileByInterview] = useState({})
  const [transcriptTextByInterview, setTranscriptTextByInterview] = useState({})
  const [aiResultByInterview, setAiResultByInterview] = useState({})

  const [isLoading, setIsLoading] = useState(true)
  const [isSavingAvailability, setIsSavingAvailability] = useState(false)
  const [submittingScoresInterviewId, setSubmittingScoresInterviewId] = useState(null)
  const [uploadingTranscriptInterviewId, setUploadingTranscriptInterviewId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const flattenedAvailability = useMemo(() => {
    const list = []
    availabilitySlots.forEach((panelist) => {
      ;(panelist.slots || []).forEach((slot) => {
        list.push({
          panelist_name: panelist.panelist_name,
          ...slot,
        })
      })
    })
    return list
  }, [availabilitySlots])

  async function loadDashboardData() {
    try {
      setIsLoading(true)
      setError('')

      const [availabilityResponse, interviewsResponse] = await Promise.all([
        getPanelistAvailability({}),
        getInterviews({}),
      ])

      setAvailabilitySlots(availabilityResponse.data?.panelists || [])
      setInterviews(interviewsResponse.data?.interviews || [])
    } catch (_error) {
      setError('Failed to load panelist dashboard data.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadDashboardData()
  }, [])

  async function handleAddAvailabilitySlot(event) {
    event.preventDefault()

    if (!availabilityForm.date || !availabilityForm.start_time || !availabilityForm.end_time) {
      setError('Please fill date, start time, and end time.')
      return
    }

    try {
      setIsSavingAvailability(true)
      setError('')
      setSuccess('')

      await createPanelistAvailability({
        slots: [
          {
            date: availabilityForm.date,
            start_time: availabilityForm.start_time,
            end_time: availabilityForm.end_time,
          },
        ],
      })

      setAvailabilityForm({ date: '', start_time: '', end_time: '' })
      setSuccess('Availability slot added.')
      await loadDashboardData()
    } catch (saveError) {
      setError(saveError?.response?.data?.error || 'Failed to add availability slot.')
    } finally {
      setIsSavingAvailability(false)
    }
  }

  async function handleToggleInterviewPanel(interview) {
    if (expandedInterviewId === interview.id) {
      setExpandedInterviewId(null)
      return
    }

    setExpandedInterviewId(interview.id)

    if (skillsByInterview[interview.id]) {
      return
    }

    try {
      setError('')
      const skillsResponse = await getSkills(interview.jd_id)
      const skills = skillsResponse.data?.skills || []

      setSkillsByInterview((previous) => ({
        ...previous,
        [interview.id]: skills,
      }))

      const initialScoreForm = {}
      skills.forEach((skill) => {
        initialScoreForm[skill.id] = { ...SCORE_DEFAULT }
      })

      setScoreFormsByInterview((previous) => ({
        ...previous,
        [interview.id]: initialScoreForm,
      }))
    } catch (_skillsError) {
      setError('Failed to load JD skills for scoring.')
    }
  }

  function renderAiList(items, emptyLabel) {
    if (!items || items.length === 0) {
      return (
        <ul className="list-disc list-inside text-sm text-slate-600">
          <li>{emptyLabel}</li>
        </ul>
      )
    }

    return (
      <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
        {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </ul>
    )
  }

  function updateSkillScore(interviewId, skillId, field, value) {
    setScoreFormsByInterview((previous) => {
      const interviewScores = previous[interviewId] || {}
      const currentSkill = interviewScores[skillId] || { ...SCORE_DEFAULT }

      return {
        ...previous,
        [interviewId]: {
          ...interviewScores,
          [skillId]: {
            ...currentSkill,
            [field]: field === 'comments' ? value.slice(0, 500) : Number(value),
          },
        },
      }
    })
  }

  async function handleSubmitScores(interview) {
    const interviewId = interview.id
    const scoreMap = scoreFormsByInterview[interviewId] || {}
    const skills = skillsByInterview[interviewId] || []

    if (skills.length === 0) {
      setError('No skills available for this interview.')
      return
    }

    const payloadScores = skills.map((skill) => {
      const values = scoreMap[skill.id] || { ...SCORE_DEFAULT }
      return {
        skill_id: skill.id,
        technical_score: Number(values.technical_score),
        communication_score: Number(values.communication_score),
        problem_solving_score: Number(values.problem_solving_score),
        comments: values.comments || '',
      }
    })

    try {
      setSubmittingScoresInterviewId(interviewId)
      setError('')
      setSuccess('')

      await submitInterviewScores(interviewId, { scores: payloadScores })
      setSubmittedScorePanels((previous) => ({ ...previous, [interviewId]: true }))
      setSuccess('Scores submitted successfully.')
    } catch (submitError) {
      setError(submitError?.response?.data?.error || 'Failed to submit interview scores.')
    } finally {
      setSubmittingScoresInterviewId(null)
    }
  }

  function handleTranscriptFileChange(interviewId, file) {
    if (!file) {
      setTranscriptFileByInterview((previous) => ({ ...previous, [interviewId]: null }))
      return
    }

    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!['docx', 'txt'].includes(extension || '')) {
      setError('Only .docx and .txt files are allowed.')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Transcript file must be 5MB or less.')
      return
    }

    setTranscriptFileByInterview((previous) => ({ ...previous, [interviewId]: file }))
  }

  async function handleSubmitTranscript(interview) {
    const interviewId = interview.id
    const mode = transcriptModeByInterview[interviewId] || 'file'

    try {
      setUploadingTranscriptInterviewId(interviewId)
      setError('')
      setSuccess('')

      if (mode === 'file') {
        const file = transcriptFileByInterview[interviewId]
        if (!file) {
          setError('Please choose a transcript file.')
          return
        }

        const formData = new FormData()
        formData.append('file', file)

        const response = await uploadInterviewTranscript(interviewId, formData)
        setAiResultByInterview((previous) => ({ ...previous, [interviewId]: response.data?.ai_score || null }))
      } else {
        const text = transcriptTextByInterview[interviewId] || ''
        if (!text.trim()) {
          setError('Please paste transcript text.')
          return
        }

        const response = await uploadInterviewTranscript(interviewId, { raw_text: text.trim() })
        setAiResultByInterview((previous) => ({ ...previous, [interviewId]: response.data?.ai_score || null }))
      }

      setSuccess('Transcript submitted successfully.')
    } catch (transcriptError) {
      setError(transcriptError?.response?.data?.error || 'Failed to submit transcript.')
    } finally {
      setUploadingTranscriptInterviewId(null)
    }
  }

  return (
    <AppShell pageTitle="Slots & Interviews" pageSubtitle="Manage your availability, interviews, and scoring">
      <AlertBanner type="error" message={error} />
      <AlertBanner type="success" message={success} />

      {/* Section 1 */}
      <Card>
        <CardTitle>My Availability</CardTitle>
        <form onSubmit={handleAddAvailabilitySlot}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Date" htmlFor="availability_date">
              <FormInput
                id="availability_date"
                type="date"
                value={availabilityForm.date}
                onChange={(event) => setAvailabilityForm((previous) => ({ ...previous, date: event.target.value }))}
                required
              />
            </FormField>
            <FormField label="Start Time" htmlFor="availability_start_time">
              <FormInput
                id="availability_start_time"
                type="time"
                value={availabilityForm.start_time}
                onChange={(event) => setAvailabilityForm((previous) => ({ ...previous, start_time: event.target.value }))}
                required
              />
            </FormField>
            <FormField label="End Time" htmlFor="availability_end_time">
              <FormInput
                id="availability_end_time"
                type="time"
                value={availabilityForm.end_time}
                onChange={(event) => setAvailabilityForm((previous) => ({ ...previous, end_time: event.target.value }))}
                required
              />
            </FormField>
          </div>
          <PrimaryBtn type="submit" loading={isSavingAvailability}>
            {isSavingAvailability ? 'Adding...' : 'Add Slot'}
          </PrimaryBtn>
        </form>

        <div className="mt-5 border-t border-slate-100 pt-4">
          {isLoading ? (
            <LoadingState label="Loading availability..." />
          ) : flattenedAvailability.length === 0 ? (
            <EmptyState message="No availability slots found" />
          ) : (
            <div className="space-y-2">
              {flattenedAvailability.map((slot) => (
                <div key={slot.id} className="flex flex-wrap items-center gap-3 bg-slate-50 rounded-xl px-3 py-2">
                  <span className="text-sm font-medium text-slate-700">{slot.date}</span>
                  <span className="text-sm text-slate-500">{slot.start_time} - {slot.end_time}</span>
                  <Badge variant="blue">Available</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Section 2 + Section 3 */}
      <Card>
        <CardTitle>My Interviews</CardTitle>
        <DataTable
          headers={['Candidate', 'JD Title', 'Date', 'Time', 'Mode', 'Meeting Link', 'Status', 'Scores']}
          loading={isLoading}
          loadingLabel="Loading interviews..."
        >
          {interviews.length === 0 && !isLoading ? (
            <tr><td colSpan={8}><EmptyState message="No interviews assigned" /></td></tr>
          ) : (
            interviews.map((interview) => {
              const isExpanded = expandedInterviewId === interview.id
              const skills = skillsByInterview[interview.id] || []
              const scoreMap = scoreFormsByInterview[interview.id] || {}
              const isScoresSubmitted = Boolean(submittedScorePanels[interview.id])
              const transcriptMode = transcriptModeByInterview[interview.id] || 'file'
              const aiResult = aiResultByInterview[interview.id]
              const isUploading = uploadingTranscriptInterviewId === interview.id
              const scoreSummary = getScoreSummary(skills, scoreMap)

              return (
                <tbody key={interview.id}>
                  <tr
                    className={`border-b border-slate-50 transition-colors last:border-0 cursor-pointer ${
                      isExpanded ? 'bg-blue-50/40' : 'hover:bg-slate-50/60'
                    }`}
                    onClick={() => handleToggleInterviewPanel(interview)}
                    aria-expanded={isExpanded}
                  >
                    <TableCell>{interview.candidate_name || '—'}</TableCell>
                    <TableCell>{interview.jd_title || '—'}</TableCell>
                    <TableCell>{formatDate(interview.scheduled_at)}</TableCell>
                    <TableCell>{formatTime(interview.scheduled_at)}</TableCell>
                    <TableCell className="capitalize">{String(interview.mode || '').replace('_', ' ') || '—'}</TableCell>
                    <TableCell className="max-w-[220px] truncate">{interview.meeting_link || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[interview.status] || 'gray'}>{interview.status || 'UNKNOWN'}</Badge>
                    </TableCell>
                    <TableCell>
                      <SecondaryBtn
                        onClick={(event) => {
                          event.stopPropagation()
                          handleToggleInterviewPanel(interview)
                        }}
                      >
                        {isExpanded ? 'Hide Panel' : 'Open Panel'}
                      </SecondaryBtn>
                    </TableCell>
                  </tr>

                  {isExpanded ? (
                    <tr className="bg-slate-50/40">
                      <td colSpan={8} className="px-5 py-4">
                        <div className="space-y-4">
                          <div className="bg-white rounded-xl border border-slate-200 p-4">
                            <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-start md:justify-between">
                              <div>
                                <h3 className="text-sm font-semibold text-slate-900">Section 3 — Submit Interview Scores</h3>
                                <p className="text-xs text-slate-500 mt-1">Part A — Skill Scores</p>
                              </div>
                              {skills.length > 0 ? (
                                <div className="grid grid-cols-3 gap-3 sm:min-w-[280px]">
                                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center">
                                    <div className="text-lg font-bold text-slate-900">{scoreSummary.average}</div>
                                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Avg Score</div>
                                  </div>
                                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center">
                                    <div className="text-lg font-bold text-blue-700">{scoreSummary.primaryCount}</div>
                                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Primary</div>
                                  </div>
                                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center">
                                    <div className="text-lg font-bold text-amber-600">{scoreSummary.secondaryCount}</div>
                                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Secondary</div>
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            {skills.length === 0 ? (
                              <LoadingState label="Loading JD skills..." />
                            ) : (
                              <>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                  {skills.map((skill) => {
                                    const values = scoreMap[skill.id] || { ...SCORE_DEFAULT }
                                    return (
                                      <div key={skill.id} className="border border-slate-200 rounded-xl p-4">
                                        <div className="flex items-center justify-between mb-3">
                                          <h4 className="text-sm font-semibold text-slate-900">{skill.skill_name}</h4>
                                          <Badge variant={getSkillBadgeVariant(skill.skill_type)}>
                                            {(skill.skill_type || 'secondary').toLowerCase()}
                                          </Badge>
                                        </div>
                                        <ScoreSlider
                                          label="Technical Depth"
                                          value={Number(values.technical_score)}
                                          onChange={(event) => updateSkillScore(interview.id, skill.id, 'technical_score', event.target.value)}
                                        />
                                        <ScoreSlider
                                          label="Communication Clarity"
                                          value={Number(values.communication_score)}
                                          onChange={(event) => updateSkillScore(interview.id, skill.id, 'communication_score', event.target.value)}
                                        />
                                        <ScoreSlider
                                          label="Problem Solving"
                                          value={Number(values.problem_solving_score)}
                                          onChange={(event) => updateSkillScore(interview.id, skill.id, 'problem_solving_score', event.target.value)}
                                        />
                                        <FormField label="Comments" htmlFor={`comments_${interview.id}_${skill.id}`}>
                                          <FormTextarea
                                            id={`comments_${interview.id}_${skill.id}`}
                                            rows={3}
                                            maxLength={500}
                                            placeholder="Optional comments"
                                            value={values.comments}
                                            onChange={(event) => updateSkillScore(interview.id, skill.id, 'comments', event.target.value)}
                                          />
                                          <div className="mt-1 text-right text-[11px] text-slate-400">
                                            {values.comments.length}/500
                                          </div>
                                        </FormField>
                                      </div>
                                    )
                                  })}
                                </div>
                                <div className="mt-4">
                                  <PrimaryBtn
                                    onClick={() => handleSubmitScores(interview)}
                                    loading={submittingScoresInterviewId === interview.id}
                                  >
                                    {submittingScoresInterviewId === interview.id ? 'Submitting...' : 'Submit All Scores'}
                                  </PrimaryBtn>
                                </div>
                              </>
                            )}
                          </div>

                          {isScoresSubmitted ? (
                            <div className="bg-white rounded-xl border border-slate-200 p-4">
                              <div className="mb-4">
                                <h3 className="text-sm font-semibold text-slate-900">Part B — Transcript Upload</h3>
                                <p className="text-xs text-slate-500 mt-1">Upload a file or paste the interview transcript for AI analysis.</p>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 mb-4">
                                {TRANSCRIPT_TABS.map((tab) => (
                                  <button
                                    key={tab.id}
                                    type="button"
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                      transcriptMode === tab.id
                                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                    }`}
                                    onClick={() => setTranscriptModeByInterview((previous) => ({ ...previous, [interview.id]: tab.id }))}
                                  >
                                    {tab.label}
                                  </button>
                                ))}
                              </div>

                              {transcriptMode === 'file' ? (
                                <FormField label="Transcript File (.docx, .txt)" htmlFor={`transcript_file_${interview.id}`}>
                                  <FormInput
                                    id={`transcript_file_${interview.id}`}
                                    type="file"
                                    accept=".docx,.txt"
                                    onChange={(event) => handleTranscriptFileChange(interview.id, event.target.files?.[0])}
                                  />
                                  <p className="mt-1 text-xs text-slate-400">Accepted formats: `.docx`, `.txt` up to 5MB.</p>
                                </FormField>
                              ) : (
                                <FormField label="Transcript Text" htmlFor={`transcript_text_${interview.id}`}>
                                  <FormTextarea
                                    id={`transcript_text_${interview.id}`}
                                    rows={8}
                                    placeholder="Paste full interview transcript here"
                                    value={transcriptTextByInterview[interview.id] || ''}
                                    onChange={(event) => setTranscriptTextByInterview((previous) => ({ ...previous, [interview.id]: event.target.value }))}
                                  />
                                </FormField>
                              )}

                              <PrimaryBtn
                                onClick={() => handleSubmitTranscript(interview)}
                                loading={isUploading}
                                disabled={isUploading}
                              >
                                {isUploading ? 'AI is analysing transcript...' : 'Upload/Submit Transcript'}
                              </PrimaryBtn>

                              {isUploading ? (
                                <div className="flex items-center gap-2.5 text-sm text-slate-600 mt-4">
                                  <span className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full spin" />
                                  AI is analysing transcript...
                                </div>
                              ) : null}

                              {aiResult?.report_status === 'GENERATED' ? (
                                <div className="mt-5 border-t border-slate-100 pt-4">
                                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 mb-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <div>
                                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-1">Overall AI Score</div>
                                        <div className="text-4xl font-bold text-slate-900">{aiResult.overall_score ?? '—'}</div>
                                      </div>
                                      <Badge variant={RECOMMENDATION_VARIANTS[aiResult.recommendation] || 'gray'}>
                                        {aiResult.recommendation || 'UNKNOWN'}
                                      </Badge>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                                    <div>
                                      <h4 className="text-sm font-semibold text-slate-900 mb-2">Strengths</h4>
                                      {renderAiList(aiResult.strengths, 'No strengths provided')}
                                    </div>
                                    <div>
                                      <h4 className="text-sm font-semibold text-slate-900 mb-2">Concerns</h4>
                                      {renderAiList(aiResult.concerns, 'No concerns provided')}
                                    </div>
                                  </div>

                                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                                    <table className="w-full min-w-[420px] text-sm bg-white">
                                      <thead>
                                        <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-widest text-slate-400">
                                          <th className="px-3 py-2">Skill</th>
                                          <th className="px-3 py-2">Score</th>
                                          <th className="px-3 py-2">Reasoning</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {(aiResult.skill_scores || []).map((item) => (
                                          <tr key={`${item.skill_id}-${item.skill_name}`} className="border-b border-slate-50">
                                            <td className="px-3 py-2 text-slate-800">{item.skill_name}</td>
                                            <td className="px-3 py-2 font-semibold text-slate-900">{item.score}</td>
                                            <td className="px-3 py-2 text-slate-600">{item.reasoning}</td>
                                          </tr>
                                        ))}
                                        {(!aiResult.skill_scores || aiResult.skill_scores.length === 0) ? (
                                          <tr>
                                            <td colSpan={3} className="px-3 py-3 text-slate-400">No per-skill AI scores available</td>
                                          </tr>
                                        ) : null}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              )
            })
          )}
        </DataTable>
      </Card>
    </AppShell>
  )
}
