import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useAuthStore from '../store/authStore'

import {
  createCandidate,
  deleteCandidate,
  downloadResume,
  extractResume,
  getCandidates,
  updateCandidate,
  uploadResume,
} from '../api/candidatesApi'
import { getClients } from '../api/clientsApi'
import { getInterviews } from '../api/interviewsApi'
import { getJDs } from '../api/jdApi'
import AppShell from '../components/AppShell'
import {
  AlertBanner, Avatar, Badge, Card, CardTitle, DataTable,
  EmptyState, FormField, FormInput, FormSelect, LoadingState,
  PrimaryBtn, SecondaryBtn, TableCell, TableRow,
} from '../components/ui'

const CANDIDATE_STATUSES = ['APPLIED', 'SHORTLISTED', 'INTERVIEWED', 'SELECTED', 'NOT_SELECTED']

const STATUS_VARIANTS = {
  SELECTED: 'green',
  NOT_SELECTED: 'red',
  INTERVIEWED: 'amber',
  SHORTLISTED: 'blue',
  APPLIED: 'gray',
}

const DEFAULT_FORM = {
  client_id: '',
  jd_id: '',
  full_name: '',
  email: '',
  status: 'APPLIED',
}

export default function Candidates() {
  const [searchParams] = useSearchParams()
  const initialClientId = searchParams.get('clientId') || ''
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const isPanelist = user?.role === 'PANELIST'

  const [clients, setClients] = useState([])
  const [jds, setJDs] = useState([])
  const [candidates, setCandidates] = useState([])
  const [selectedClientId, setSelectedClientId] = useState(initialClientId)
  const [selectedJdId, setSelectedJdId] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createStep, setCreateStep] = useState('form')
  const [formData, setFormData] = useState({ ...DEFAULT_FORM, client_id: initialClientId })
  const [createdCandidate, setCreatedCandidate] = useState(null)
  const [resumeFile, setResumeFile] = useState(null)
  const [resumeError, setResumeError] = useState('')
  const [isResumeProcessing, setIsResumeProcessing] = useState(false)
  const [extractedForm, setExtractedForm] = useState({ full_name: '', email: '', phone: '' })
  const [showExtractedEditor, setShowExtractedEditor] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [interviewCounts, setInterviewCounts] = useState({})

  const jdMap = useMemo(() => new Map(jds.map((jd) => [jd.id, jd])), [jds])
  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients])

  const filteredJds = useMemo(() => {
    if (!selectedClientId) return jds
    return jds.filter((jd) => String(jd.client_id) === String(selectedClientId))
  }, [jds, selectedClientId])

  const jdsForForm = useMemo(() => {
    if (!formData.client_id) return []
    return jds.filter((jd) => String(jd.client_id) === String(formData.client_id))
  }, [jds, formData.client_id])

  async function loadData() {
    try {
      setIsLoading(true)
      setError('')

      const [clientsResponse, jdsResponse] = await Promise.all([getClients(), getJDs()])
      const nextClients = clientsResponse.data?.clients ?? []
      const nextJds = jdsResponse.data?.jds ?? []

      setClients(nextClients)
      setJDs(nextJds)

      const candidateParams = {}
      if (selectedClientId) candidateParams.client_id = Number(selectedClientId)
      if (selectedJdId) candidateParams.jd_id = Number(selectedJdId)

      const [candidatesResponse, interviewsResponse] = await Promise.all([
        getCandidates(candidateParams),
        getInterviews(candidateParams),
      ])
      const nextCandidates = candidatesResponse.data?.candidates ?? []
      const nextInterviews = interviewsResponse.data?.interviews ?? []

      setCandidates(nextCandidates)
      setInterviewCounts(
        nextInterviews.reduce((counts, interview) => {
          counts[interview.candidate_id] = (counts[interview.candidate_id] || 0) + 1
          return counts
        }, {}),
      )
    } catch (_loadError) {
      setError('Unable to load candidates data.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId, selectedJdId])

  function resetForm() {
    setFormData({ ...DEFAULT_FORM, client_id: selectedClientId || '' })
    setCreateStep('form')
    setCreatedCandidate(null)
    setResumeFile(null)
    setResumeError('')
    setIsResumeProcessing(false)
    setExtractedForm({ full_name: '', email: '', phone: '' })
    setShowExtractedEditor(false)
    setShowCreateForm(false)
  }

  async function handleCreateCandidate(event) {
    event.preventDefault()

    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')

      const createResponse = await createCandidate({
        client_id: Number(formData.client_id),
        jd_id: Number(formData.jd_id),
        full_name: formData.full_name,
        email: formData.email,
        status: formData.status,
      })

      await loadData()
      const nextCandidate = createResponse?.data?.candidate
      setCreatedCandidate(nextCandidate || null)
      setCreateStep('resume')
      setResumeFile(null)
      setResumeError('')
      setShowExtractedEditor(false)
      setExtractedForm({
        full_name: nextCandidate?.full_name || formData.full_name,
        email: nextCandidate?.email || formData.email,
        phone: nextCandidate?.phone || '',
      })
      setSuccess('Candidate created successfully. Upload resume to auto-fill details.')
    } catch (createError) {
      setError(createError?.response?.data?.error || 'Failed to create candidate.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleResumeFileChange(event) {
    const file = event.target.files?.[0]
    setResumeError('')
    setShowExtractedEditor(false)

    if (!file) {
      setResumeFile(null)
      return
    }

    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!['pdf', 'docx'].includes(extension || '')) {
      setResumeFile(null)
      setResumeError('Only .pdf and .docx files are supported')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      setResumeFile(null)
      setResumeError('File must be under 2MB')
      return
    }

    setResumeFile(file)
  }

  async function handleUploadAndExtractResume() {
    if (!createdCandidate?.id) {
      setResumeError('Candidate context not found. Please create again.')
      return
    }
    if (!resumeFile) {
      setResumeError('Please choose a resume file first.')
      return
    }

    try {
      setIsResumeProcessing(true)
      setResumeError('')
      setSuccess('')

      await uploadResume(createdCandidate.id, resumeFile)
      const extractResponse = await extractResume(createdCandidate.id)
      const extracted = extractResponse?.data?.extracted || {}
      const updatedCandidate = extractResponse?.data?.candidate

      setExtractedForm({
        full_name: extracted.full_name || updatedCandidate?.full_name || '',
        email: extracted.email || updatedCandidate?.email || '',
        phone: extracted.phone || updatedCandidate?.phone || '',
      })
      setShowExtractedEditor(true)

      if (updatedCandidate) {
        setCreatedCandidate(updatedCandidate)
      }

      await loadData()
      setSuccess('Resume uploaded and details extracted successfully.')
    } catch (extractError) {
      setResumeError(extractError?.response?.data?.error || 'Failed to upload/extract resume.')
    } finally {
      setIsResumeProcessing(false)
    }
  }

  async function handleConfirmExtractedDetails() {
    if (!createdCandidate?.id) {
      setResumeError('Candidate context not found. Please create again.')
      return
    }

    try {
      setIsSubmitting(true)
      setResumeError('')
      setSuccess('')

      await updateCandidate(createdCandidate.id, {
        full_name: extractedForm.full_name,
        email: extractedForm.email,
        phone: extractedForm.phone,
      })

      await loadData()
      setSuccess('Candidate details saved successfully.')
      resetForm()
    } catch (confirmError) {
      setResumeError(confirmError?.response?.data?.error || 'Failed to save candidate details.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleSkipResumeUpload() {
    setSuccess('Candidate created successfully.')
    resetForm()
  }

  async function handleDownloadResume(candidate) {
    if (!candidate?.resume_url) return

    try {
      setError('')
      const response = await downloadResume(candidate.id)
      const contentDisposition = response.headers?.['content-disposition'] || ''
      const filenameMatch = contentDisposition.match(/filename\*?=(?:UTF-8'')?\"?([^\";]+)\"?/i)
      const fallbackName = candidate.resume_filename || `candidate_${candidate.id}_resume`
      const resolvedName = filenameMatch ? decodeURIComponent(filenameMatch[1]) : fallbackName

      const blobUrl = window.URL.createObjectURL(new Blob([response.data]))
      const tempLink = document.createElement('a')
      tempLink.href = blobUrl
      tempLink.setAttribute('download', resolvedName)
      document.body.appendChild(tempLink)
      tempLink.click()
      tempLink.remove()
      window.URL.revokeObjectURL(blobUrl)
    } catch (_downloadError) {
      setError('Failed to download resume.')
    }
  }

  async function handleStatusChange(candidateId, status) {
    try {
      setError('')
      await updateCandidate(candidateId, { status })
      setCandidates((previous) => previous.map((candidate) => (
        candidate.id === candidateId ? { ...candidate, status } : candidate
      )))
    } catch (_updateError) {
      setError('Failed to update candidate status.')
    }
  }

  async function handleDeleteCandidate(candidateId) {
    try {
      setError('')
      setSuccess('')
      await deleteCandidate(candidateId)
      setCandidates((previous) => previous.filter((candidate) => candidate.id !== candidateId))
      setSuccess('Candidate deleted successfully.')
    } catch (deleteError) {
      setError(deleteError?.response?.data?.error || 'Failed to delete candidate.')
    }
  }

  return (
    <AppShell pageTitle="Candidates" pageSubtitle="Track and manage interview candidates">
      {!isPanelist && (
        <div className="flex items-center justify-between mb-5">
          <div />
          <PrimaryBtn
            onClick={() => {
              setShowCreateForm((previous) => !previous)
              setCreateStep('form')
              setFormData({ ...DEFAULT_FORM, client_id: selectedClientId || '' })
              setCreatedCandidate(null)
              setResumeFile(null)
              setResumeError('')
              setShowExtractedEditor(false)
              setExtractedForm({ full_name: '', email: '', phone: '' })
              setError('')
              setSuccess('')
            }}
          >
            {showCreateForm ? 'Close' : '+ Add Candidate'}
          </PrimaryBtn>
        </div>
      )}

      <AlertBanner type="error" message={error} />
      <AlertBanner type="success" message={success} />

      {/* Filters */}
      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Filter by Client" htmlFor="candidate_filter_client">
            <FormSelect
              id="candidate_filter_client"
              value={selectedClientId}
              onChange={(event) => {
                setSelectedClientId(event.target.value)
                setSelectedJdId('')
              }}
            >
              <option value="">All clients</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </FormSelect>
          </FormField>
          <FormField label="Filter by JD" htmlFor="candidate_filter_jd">
            <FormSelect
              id="candidate_filter_jd"
              value={selectedJdId}
              onChange={(event) => setSelectedJdId(event.target.value)}
            >
              <option value="">All job descriptions</option>
              {filteredJds.map((jd) => (
                <option key={jd.id} value={jd.id}>{jd.title}</option>
              ))}
            </FormSelect>
          </FormField>
        </div>
      </Card>

      {/* Create form */}
      {showCreateForm && (
        <Card>
          {createStep === 'form' ? (
            <>
              <CardTitle>Create Candidate</CardTitle>
              <form onSubmit={handleCreateCandidate}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Client" htmlFor="candidate_client_id">
                    <FormSelect
                      id="candidate_client_id"
                      value={formData.client_id}
                      onChange={(event) => {
                        setFormData((previous) => ({
                          ...previous,
                          client_id: event.target.value,
                          jd_id: '',
                        }))
                      }}
                      required
                    >
                      <option value="">Select client</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>{client.name}</option>
                      ))}
                    </FormSelect>
                  </FormField>
                  <FormField label="Job Description" htmlFor="candidate_jd_id">
                    <FormSelect
                      id="candidate_jd_id"
                      value={formData.jd_id}
                      onChange={(event) => setFormData((previous) => ({ ...previous, jd_id: event.target.value }))}
                      required
                    >
                      <option value="">Select JD</option>
                      {jdsForForm.map((jd) => (
                        <option key={jd.id} value={jd.id}>{jd.title}</option>
                      ))}
                    </FormSelect>
                  </FormField>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Full Name" htmlFor="candidate_full_name">
                    <FormInput
                      id="candidate_full_name"
                      type="text"
                      value={formData.full_name}
                      onChange={(event) => setFormData((previous) => ({ ...previous, full_name: event.target.value }))}
                      required
                      placeholder="John Doe"
                    />
                  </FormField>
                  <FormField label="Email" htmlFor="candidate_email">
                    <FormInput
                      id="candidate_email"
                      type="email"
                      value={formData.email}
                      onChange={(event) => setFormData((previous) => ({ ...previous, email: event.target.value }))}
                      required
                      placeholder="john@example.com"
                    />
                  </FormField>
                </div>
                <FormField label="Initial Status" htmlFor="candidate_status">
                  <FormSelect
                    id="candidate_status"
                    value={formData.status}
                    onChange={(event) => setFormData((previous) => ({ ...previous, status: event.target.value }))}
                  >
                    {CANDIDATE_STATUSES.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </FormSelect>
                </FormField>
                <div className="flex gap-2 pt-1">
                  <PrimaryBtn type="submit" loading={isSubmitting}>
                    {isSubmitting ? 'Creating...' : 'Create Candidate'}
                  </PrimaryBtn>
                  <SecondaryBtn onClick={resetForm} disabled={isSubmitting}>Cancel</SecondaryBtn>
                </div>
              </form>
            </>
          ) : (
            <>
              <CardTitle>Upload Resume</CardTitle>
              <AlertBanner type="error" message={resumeError} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Resume File" htmlFor="candidate_resume_file">
                  <FormInput
                    id="candidate_resume_file"
                    type="file"
                    accept=".pdf,.docx"
                    onChange={handleResumeFileChange}
                  />
                </FormField>
                <div className="flex items-end">
                  <PrimaryBtn
                    onClick={handleUploadAndExtractResume}
                    loading={isResumeProcessing}
                    disabled={!resumeFile || isResumeProcessing}
                    className="w-full sm:w-auto"
                  >
                    {isResumeProcessing ? 'AI is reading resume...' : 'Upload & Extract'}
                  </PrimaryBtn>
                </div>
              </div>

              {isResumeProcessing && (
                <div className="flex items-center gap-2.5 text-sm text-slate-600 mb-4">
                  <span className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full spin" />
                  AI is reading resume...
                </div>
              )}

              {showExtractedEditor && (
                <>
                  <p className="text-xs text-slate-500 mb-3">These details were extracted by AI. Please verify before saving.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField label="Full Name" htmlFor="candidate_extracted_full_name">
                      <FormInput
                        id="candidate_extracted_full_name"
                        type="text"
                        value={extractedForm.full_name}
                        onChange={(event) => setExtractedForm((previous) => ({ ...previous, full_name: event.target.value }))}
                        placeholder="John Doe"
                      />
                    </FormField>
                    <FormField label="Email" htmlFor="candidate_extracted_email">
                      <FormInput
                        id="candidate_extracted_email"
                        type="email"
                        value={extractedForm.email}
                        onChange={(event) => setExtractedForm((previous) => ({ ...previous, email: event.target.value }))}
                        placeholder="john@example.com"
                      />
                    </FormField>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField label="Phone" htmlFor="candidate_extracted_phone">
                      <FormInput
                        id="candidate_extracted_phone"
                        type="text"
                        value={extractedForm.phone}
                        onChange={(event) => setExtractedForm((previous) => ({ ...previous, phone: event.target.value }))}
                        placeholder="+1 234 567 890"
                      />
                    </FormField>
                  </div>
                </>
              )}

              <div className="flex gap-2 pt-1">
                {showExtractedEditor ? (
                  <PrimaryBtn onClick={handleConfirmExtractedDetails} loading={isSubmitting}>
                    {isSubmitting ? 'Saving...' : 'Confirm'}
                  </PrimaryBtn>
                ) : null}
                <SecondaryBtn onClick={handleSkipResumeUpload} disabled={isResumeProcessing || isSubmitting}>Skip</SecondaryBtn>
              </div>
            </>
          )}
        </Card>
      )}

      {/* Candidates table */}
      <Card>
        <DataTable
          headers={['Name', 'Email', 'Phone', 'Client', 'Job Description', 'Status', 'Actions']}
          loading={isLoading}
          loadingLabel="Loading candidates..."
        >
          {candidates.length === 0 && !isLoading ? (
            <tr><td colSpan={7}><EmptyState message="No candidates found" /></td></tr>
          ) : (
            candidates.map((candidate) => (
              <TableRow key={candidate.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={candidate.full_name} />
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{candidate.full_name}</span>
                      <Badge variant="gray">{interviewCounts[candidate.id] || 0} interviews</Badge>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-slate-500">{candidate.email}</TableCell>
                <TableCell className="text-slate-500">{candidate.phone || '—'}</TableCell>
                <TableCell>{clientMap.get(candidate.client_id) || `Client #${candidate.client_id}`}</TableCell>
                <TableCell className="max-w-[180px]">
                  <div className="truncate text-slate-600">{jdMap.get(candidate.jd_id)?.title || `JD #${candidate.jd_id}`}</div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANTS[candidate.status] || 'gray'}>{candidate.status}</Badge>
                    {!isPanelist && (
                      <select
                        value={candidate.status}
                        onChange={(event) => handleStatusChange(candidate.id, event.target.value)}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-700"
                      >
                        {CANDIDATE_STATUSES.map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {!isPanelist && (
                      <button
                        type="button"
                        onClick={() => navigate(`/interviews?candidateId=${candidate.id}`)}
                        className="text-xs bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                      >
                        Schedule Interview
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDownloadResume(candidate)}
                      disabled={!candidate.resume_url}
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${
                        candidate.resume_url
                          ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                          : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      }`}
                      title={candidate.resume_url ? 'Download Resume' : 'No resume uploaded'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v1a3 3 0 003 3h10a3 3 0 003-3v-1" />
                      </svg>
                    </button>
                    {!isPanelist && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCandidate(candidate.id)}
                        className="text-xs bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </DataTable>
      </Card>
    </AppShell>
  )
}
