import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useAuthStore from '../store/authStore'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

import {
  createCandidate,
  deleteCandidate,
  downloadResume,
  extractResume,
  getCandidates,
  createCandidateWithResume,
  updateCandidate,
  uploadResume,
  bulkUploadResumes,
  notifyOperators,
} from '../api/candidatesApi'
import { getClients } from '../api/clientsApi'
import { getInterviews } from '../api/interviewsApi'
import { getJDs } from '../api/jdApi'
import AppShell from '../components/AppShell'
import {
  AlertBanner, Avatar, Badge, Card, CardTitle, DataTable,
  EmptyState, FormField, FormInput, FormSelect, LoadingState,
  PrimaryBtn, SearchSelect, SecondaryBtn, TableCell, TableRow,
} from '../components/ui'

const CANDIDATE_STATUSES = ['APPLIED', 'SHORTLISTED', 'INTERVIEWED', 'SELECTED', 'NOT_SELECTED']

const STATUS_VARIANTS = {
  SELECTED: 'green',
  NOT_SELECTED: 'red',
  INTERVIEWED: 'amber',
  SHORTLISTED: 'blue',
  APPLIED: 'gray',
}

const IST_TIMEZONE = 'Asia/Kolkata'

const DEFAULT_FORM = {
  client_id: '',
  jd_id: '',
  full_name: '',
  email: '',
  status: 'APPLIED',
}

function getDefaultForm(clientId = '') {
  return {
    ...DEFAULT_FORM,
    client_id: clientId,
  }
}

function formatDateTimeInIST(value) {
  if (!value) return '—'

  const normalizedValue = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value}Z`
    : value

  const parsed = new Date(normalizedValue)
  if (Number.isNaN(parsed.getTime())) return '—'

  return parsed.toLocaleString('en-IN', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

export default function Candidates() {
  const [searchParams] = useSearchParams()
  const initialClientId = searchParams.get('clientId') || ''
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const isPanelist = user?.role === 'PANELIST'
  const isRecruiterScopedRole = ['RECRUITER', 'SR_RECRUITER', 'M_RECRUITER'].includes(user?.role)
  const recruiterClientId = isRecruiterScopedRole && user?.client_id != null ? String(user.client_id) : ''

  const [clients, setClients] = useState([])
  const [jds, setJDs] = useState([])
  const [candidates, setCandidates] = useState([])
  const [selectedClientId, setSelectedClientId] = useState(initialClientId || recruiterClientId)
  const [selectedJdId, setSelectedJdId] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createStep, setCreateStep] = useState('form')
  const [formData, setFormData] = useState(() => getDefaultForm(initialClientId || recruiterClientId))
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
  
  // Bulk upload state
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [bulkUploadJdId, setBulkUploadJdId] = useState('')
  const [bulkUploadClientId, setBulkUploadClientId] = useState(isRecruiterScopedRole ? recruiterClientId : '')
  const [bulkUploadFiles, setBulkUploadFiles] = useState([])
  const [bulkUploadErrors, setBulkUploadErrors] = useState({})
  const [bulkUploadDrafts, setBulkUploadDrafts] = useState([])
  const [bulkUploadPreviewing, setBulkUploadPreviewing] = useState(false)
  const [bulkUploadCreating, setBulkUploadCreating] = useState(false)
  const [bulkUploadProgress, setBulkUploadProgress] = useState(0)
  
  // Modal for viewing extracted resume details
  const [showExtractedModal, setShowExtractedModal] = useState(false)
  const [selectedCandidateForView, setSelectedCandidateForView] = useState(null)

  const jdMap = useMemo(() => new Map(jds.map((jd) => [jd.id, jd])), [jds])
  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients])

  const filteredJds = useMemo(() => {
    const activeJds = jds.filter((jd) => jd.status === 'ACTIVE')
    if (!selectedClientId) return activeJds
    return activeJds.filter((jd) => String(jd.client_id) === String(selectedClientId))
  }, [jds, selectedClientId])

  const jdsForForm = useMemo(() => {
    if (!formData.client_id) return []
    return jds.filter(
      (jd) => String(jd.client_id) === String(formData.client_id) && jd.status === 'ACTIVE'
    )
  }, [jds, formData.client_id])

  const bulkUploadJdsForForm = useMemo(() => {
    if (isRecruiterScopedRole) {
      if (!recruiterClientId) return []
      return jds.filter(
        (jd) => String(jd.client_id) === String(recruiterClientId) && jd.status === 'ACTIVE'
      )
    }
    if (bulkUploadClientId) {
      return jds.filter(
        (jd) => String(jd.client_id) === String(bulkUploadClientId) && jd.status === 'ACTIVE'
      )
    }
    return []
  }, [jds, isRecruiterScopedRole, recruiterClientId, bulkUploadClientId])

  function isDuplicateDraft(draft) {
    const err = (draft.previewError || draft.createError || '').toLowerCase()
    return (
      (draft.previewStatus === 'rejected' && (err.includes('already exists') || err.includes('duplicate'))) ||
      (draft.createStatus === 'error' && (err.includes('already exists') || err.includes('duplicate')))
    )
  }

  const bulkUploadDuplicateCount =
    Object.values(bulkUploadErrors).filter((message) => message.toLowerCase().includes('duplicate')).length +
    bulkUploadDrafts.filter(isDuplicateDraft).length

  const bulkUploadErrorCount = bulkUploadDrafts.filter((draft) => {
    if (isDuplicateDraft(draft)) return false
    return draft.createStatus === 'error' || draft.previewStatus === 'failed' || draft.previewStatus === 'rejected'
  }).length

  const bulkUploadValidationErrorCount = Object.values(bulkUploadErrors).filter((message) => !message.toLowerCase().includes('duplicate')).length
  const bulkUploadIssuesCount = bulkUploadValidationErrorCount + bulkUploadErrorCount

  useEffect(() => {
    if (!isRecruiterScopedRole || !recruiterClientId) return

    setSelectedClientId(recruiterClientId)
    setFormData((previous) => ({
      ...previous,
      client_id: recruiterClientId,
    }))
  }, [isRecruiterScopedRole, recruiterClientId])

  async function loadData() {
    try {
      setIsLoading(true)
      setError('')

      // For RECRUITER, backend list_jds already returns only assigned JDs.
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
    setFormData(getDefaultForm(isRecruiterScopedRole ? recruiterClientId : (selectedClientId || '')))
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
    const effectiveClientId = isRecruiterScopedRole ? recruiterClientId : formData.client_id

    if (!effectiveClientId || !formData.jd_id) {
      setError('Client and job description are required.')
      return
    }

    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')

      const createResponse = await createCandidate({
        client_id: Number(effectiveClientId),
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
    const isConfirmed = window.confirm('Are you sure you want to delete this candidate? This action cannot be undone.')
    if (!isConfirmed) {
      return
    }

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

  function normalizeDraftSkills(skills) {
    if (!Array.isArray(skills)) return []
    return skills
      .map((skill) => (typeof skill === 'string' ? skill.trim() : ''))
      .filter(Boolean)
  }

  function createBulkDraftFromResult(result, file, index) {
    const extracted = result?.extracted || {}
    const skills = normalizeDraftSkills(extracted.skills)
    return {
      id: `${index}-${file?.name || result?.filename || 'resume'}`,
      file,
      filename: result?.filename || file?.name || `resume-${index + 1}`,
      previewStatus: result?.status || 'failed',
      previewError: result?.error || '',
      createStatus: 'pending',
      createError: '',
      candidate: null,
      isEditing: false,
      full_name: extracted.full_name || '',
      email: extracted.email || '',
      phone: extracted.phone || '',
      skills,
      original: {
        full_name: extracted.full_name || '',
        email: extracted.email || '',
        phone: extracted.phone || '',
        skills,
      },
    }
  }

  function updateBulkDraft(draftId, updater) {
    setBulkUploadDrafts((previous) => previous.map((draft) => (
      draft.id === draftId ? updater(draft) : draft
    )))
  }

  function handleBulkDraftEdit(draftId) {
    updateBulkDraft(draftId, (draft) => ({
      ...draft,
      isEditing: true,
      createError: '',
    }))
  }

  function handleBulkDraftCancel(draftId) {
    updateBulkDraft(draftId, (draft) => ({
      ...draft,
      ...draft.original,
      isEditing: false,
      createError: '',
    }))
  }

  function handleBulkDraftSave(draftId) {
    updateBulkDraft(draftId, (draft) => ({
      ...draft,
      original: {
        full_name: draft.full_name,
        email: draft.email,
        phone: draft.phone,
        skills: [...draft.skills],
      },
      isEditing: false,
      createError: '',
    }))
  }

  function handleBulkDraftFieldChange(draftId, field, value) {
    updateBulkDraft(draftId, (draft) => ({
      ...draft,
      [field]: value,
      createError: '',
      createStatus: draft.createStatus === 'created' ? 'created' : draft.createStatus,
    }))
  }

  function handleBulkDraftSkillsChange(draftId, value) {
    const skills = value
      .split(',')
      .map((skill) => skill.trim())
      .filter(Boolean)

    updateBulkDraft(draftId, (draft) => ({
      ...draft,
      skills,
      createError: '',
      createStatus: draft.createStatus === 'created' ? 'created' : draft.createStatus,
    }))
  }

  function handleBulkUploadFileChange(event) {
    const newFiles = Array.from(event.target.files || [])
    const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
    const errors = {}

    const existingSignatures = new Set(
      bulkUploadFiles.map((file) => `${file.name}:${file.size}`),
    )
    const batchSignatures = new Set()

    newFiles.forEach((file) => {
      if (file.size > MAX_FILE_SIZE) {
        errors[file.name] = `File size exceeds 2MB limit (${(file.size / (1024 * 1024)).toFixed(2)}MB)`
        return
      }

      const signature = `${file.name}:${file.size}`
      if (existingSignatures.has(signature) || batchSignatures.has(signature)) {
        errors[file.name] = 'Duplicate file selected. Please remove duplicate resumes.'
        return
      }

      batchSignatures.add(signature)
    })

    setBulkUploadErrors(errors)
    
    // Only add files without errors
    const validFiles = newFiles.filter((file) => !errors[file.name])
    
    if (validFiles.length + bulkUploadFiles.length > 20) {
      setError('Maximum 20 files per upload')
      return
    }

    setBulkUploadFiles((previous) => [...previous, ...validFiles])
    setError('')
  }

  function handleBulkUploadRemoveFile(fileName) {
    setBulkUploadFiles((previous) => previous.filter((file) => file.name !== fileName))
    setBulkUploadErrors((previous) => {
      const next = { ...previous }
      delete next[fileName]
      return next
    })
  }

  function handleBulkUploadClose() {
    setShowBulkUpload(false)
    setBulkUploadJdId('')
    setBulkUploadClientId(isRecruiterScopedRole ? recruiterClientId : '')
    setBulkUploadFiles([])
    setBulkUploadErrors({})
    setBulkUploadDrafts([])
    setBulkUploadPreviewing(false)
    setBulkUploadCreating(false)
    setBulkUploadProgress(0)
  }

  async function handleBulkUploadSubmit() {
    if (!bulkUploadJdId || bulkUploadFiles.length === 0) {
      setError('JD and at least one file are required')
      return
    }

    setBulkUploadPreviewing(true)
    setBulkUploadProgress(0)
    setError('')
    setSuccess('')

    try {
      const response = await bulkUploadResumes(
        Number(bulkUploadJdId),
        Number(bulkUploadClientId || selectedClientId),
        bulkUploadFiles,
      )

      const results = response.data?.results || []
      const nextDrafts = results.map((result, index) => createBulkDraftFromResult(result, bulkUploadFiles[index], index))
      setBulkUploadDrafts(nextDrafts)
      setBulkUploadFiles([])
    } catch (uploadError) {
      setError(uploadError?.response?.data?.error || 'Failed to upload resumes')
    } finally {
      setBulkUploadPreviewing(false)
    }
  }

  async function handleBulkCreateCandidates() {
    const effectiveClientId = bulkUploadClientId || selectedClientId
    if (!bulkUploadJdId || !effectiveClientId) {
      setError('Client and JD are required to create candidates.')
      return
    }

    if (bulkUploadDrafts.length === 0) {
      setError('Preview resumes before creating candidates.')
      return
    }

    setBulkUploadCreating(true)
    setBulkUploadProgress(0)
    setError('')
    setSuccess('')

    let createdCount = 0

    const emailCounts = new Map()
    bulkUploadDrafts.forEach((draft) => {
      if (draft.createStatus === 'created') return
      const normalizedEmail = draft.email.trim().toLowerCase()
      if (!normalizedEmail) return
      emailCounts.set(normalizedEmail, (emailCounts.get(normalizedEmail) || 0) + 1)
    })

    for (let index = 0; index < bulkUploadDrafts.length; index += 1) {
      const draft = bulkUploadDrafts[index]

      if (draft.createStatus === 'created') {
        setBulkUploadProgress(index + 1)
        continue
      }

      const nextCreateStatus = draft.createStatus === 'created' ? 'created' : 'creating'

      updateBulkDraft(draft.id, (currentDraft) => ({
        ...currentDraft,
        createStatus: nextCreateStatus,
        createError: '',
      }))

      if (!['ready', 'success'].includes(draft.previewStatus)) {
        updateBulkDraft(draft.id, (currentDraft) => ({
          ...currentDraft,
          createStatus: 'error',
          createError: currentDraft.previewError || 'Resume is not ready for creation. Fix preview issues first.',
        }))
        continue
      }

      if (!draft.full_name.trim() || !draft.email.trim()) {
        updateBulkDraft(draft.id, (currentDraft) => ({
          ...currentDraft,
          createStatus: 'error',
          createError: 'Full name and email are required before creating.',
        }))
        continue
      }

      const normalizedEmail = draft.email.trim().toLowerCase()
      if ((emailCounts.get(normalizedEmail) || 0) > 1) {
        updateBulkDraft(draft.id, (currentDraft) => ({
          ...currentDraft,
          createStatus: 'error',
          createError: 'Duplicate email detected in this bulk upload. Keep only one candidate per email.',
        }))
        continue
      }

      if (!draft.file) {
        updateBulkDraft(draft.id, (currentDraft) => ({
          ...currentDraft,
          createStatus: 'error',
          createError: 'Original resume file is missing.',
        }))
        continue
      }

      try {
        const formData = new FormData()
        formData.append('client_id', String(Number(effectiveClientId)))
        formData.append('jd_id', String(Number(bulkUploadJdId)))
        formData.append('full_name', draft.full_name.trim())
        formData.append('email', draft.email.trim())
        formData.append('status', 'APPLIED')
        if (draft.phone?.trim()) {
          formData.append('phone', draft.phone.trim())
        }
        if (draft.skills.length > 0) {
          formData.append('candidate_extracted_skills', JSON.stringify(draft.skills))
        }
        formData.append('resume', draft.file)

        const response = await createCandidateWithResume(formData)
        createdCount += 1
        updateBulkDraft(draft.id, (currentDraft) => ({
          ...currentDraft,
          createStatus: 'created',
          createError: '',
          candidate: response.data?.candidate || null,
          isEditing: false,
          original: {
            full_name: draft.full_name,
            email: draft.email,
            phone: draft.phone,
            skills: [...draft.skills],
          },
        }))
      } catch (createError) {
        updateBulkDraft(draft.id, (currentDraft) => ({
          ...currentDraft,
          createStatus: 'error',
          createError: createError?.response?.data?.error || 'Failed to create candidate.',
        }))
      } finally {
        setBulkUploadProgress(index + 1)
      }
    }

    await loadData()

    if (createdCount > 0) {
      try {
        await notifyOperators(Number(bulkUploadJdId), Number(effectiveClientId), createdCount)
      } catch (_notifyError) {
        // Notification failure should not block the user
      }
    }

    setSuccess(createdCount > 0 ? `Created ${createdCount} candidate${createdCount === 1 ? '' : 's'} successfully.` : 'No candidates were created.')
    setBulkUploadCreating(false)
  }

  function exportToExcel() {
    if (candidates.length === 0) {
      setError('No candidates to export')
      return
    }

    const exportData = candidates.map((candidate) => ({
      'Full Name': candidate.full_name,
      'Email': candidate.email,
      'Phone': candidate.phone || '',
      'Status': candidate.status,
      'Client': clientMap.get(candidate.client_id) || '',
      'Job Description': jdMap.get(candidate.jd_id)?.title || '',
      'Created At (IST)': formatDateTimeInIST(candidate.created_at),
      'Resume Uploaded At (IST)': formatDateTimeInIST(candidate.resume_uploaded_at),
    }))

    const worksheet = XLSX.utils.json_to_sheet(exportData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Candidates')

    // Adjust column widths
    const columnWidths = [
      { wch: 20 }, // Full Name
      { wch: 30 }, // Email
      { wch: 15 }, // Phone
      { wch: 15 }, // Status
      { wch: 20 }, // Client
      { wch: 30 }, // Job Description
      { wch: 24 }, // Created At (IST)
      { wch: 24 }, // Resume Uploaded At (IST)
    ]
    worksheet['!cols'] = columnWidths

    const fileName = `candidates_${new Date().toISOString().split('T')[0]}.xlsx`
    XLSX.writeFile(workbook, fileName)
    setSuccess(`Exported ${candidates.length} candidate${candidates.length === 1 ? '' : 's'} to Excel`)
  }

  function exportToPDF() {
    if (candidates.length === 0) {
      setError('No candidates to export')
      return
    }

    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text('Candidates Report', 14, 15)
    doc.setFontSize(10)
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 25)

    const tableData = candidates.map((candidate) => [
      candidate.full_name,
      candidate.email,
      candidate.phone || '',
      candidate.status,
      clientMap.get(candidate.client_id) || '',
      jdMap.get(candidate.jd_id)?.title || '',
      formatDateTimeInIST(candidate.created_at),
      formatDateTimeInIST(candidate.resume_uploaded_at),
    ])

    autoTable(doc, {
      head: [['Full Name', 'Email', 'Phone', 'Status', 'Client', 'Job Description', 'Created At (IST)', 'Resume Uploaded At (IST)']],
      body: tableData,
      startY: 35,
      theme: 'grid',
      styles: {
        fontSize: 9,
      },
      headStyles: {
        fillColor: [41, 128, 185],
        textColor: 255,
        fontStyle: 'bold',
      },
    })

    const fileName = `candidates_${new Date().toISOString().split('T')[0]}.pdf`
    doc.save(fileName)
    setSuccess(`Exported ${candidates.length} candidate${candidates.length === 1 ? '' : 's'} to PDF`)
  }

  return (
    <AppShell>
      {!isPanelist && (
        <div className="flex items-center justify-between mb-5">
          <div />
          <div className="flex gap-2">
            <SecondaryBtn onClick={exportToExcel}>
              📊 Export Excel
            </SecondaryBtn>
            <SecondaryBtn onClick={exportToPDF}>
              📄 Export PDF
            </SecondaryBtn>
            <PrimaryBtn
              onClick={() => {
                setShowBulkUpload((previous) => !previous)
                if (showBulkUpload) {
                  handleBulkUploadClose()
                }
              }}
            >
              {showBulkUpload ? 'Close' : 'Bulk Upload Resumes'}
            </PrimaryBtn>
            <PrimaryBtn
              onClick={() => {
                setShowCreateForm((previous) => !previous)
                setCreateStep('form')
                setFormData(getDefaultForm(isRecruiterScopedRole ? recruiterClientId : (selectedClientId || '')))
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
        </div>
      )}

      <AlertBanner type="error" message={error} />
      <AlertBanner type="success" message={success} />

      {/* Filters */}
      <Card>
        <div className={`grid grid-cols-1 gap-4 ${!isRecruiterScopedRole ? 'sm:grid-cols-2' : ''}`}>
          {!isRecruiterScopedRole && (
            <FormField label="Filter by Client" htmlFor="candidate_filter_client">
              <SearchSelect
                inputId="candidate_filter_client"
                options={clients.map((c) => ({ label: c.name, value: String(c.id) }))}
                value={selectedClientId}
                onChange={(val) => { setSelectedClientId(val || ''); setSelectedJdId('') }}
                placeholder="All clients"
                isClearable
              />
            </FormField>
          )}
          <FormField label="Filter by JD" htmlFor="candidate_filter_jd">
            <SearchSelect
              inputId="candidate_filter_jd"
              options={filteredJds.map((jd) => ({ label: jd.title, value: String(jd.id) }))}
              value={selectedJdId}
              onChange={(val) => setSelectedJdId(val || '')}
              placeholder="All job descriptions"
              isClearable
            />
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
                  {!isRecruiterScopedRole && (
                    <FormField label="Client" htmlFor="candidate_client_id">
                      <SearchSelect
                        inputId="candidate_client_id"
                        options={clients.map((c) => ({ label: c.name, value: String(c.id) }))}
                        value={formData.client_id}
                        onChange={(val) => setFormData((previous) => ({ ...previous, client_id: val || '', jd_id: '' }))}
                        placeholder="Select client"
                      />
                    </FormField>
                  )}
                  <FormField label="Job Description" htmlFor="candidate_jd_id">
                    <SearchSelect
                      inputId="candidate_jd_id"
                      options={jdsForForm.map((jd) => ({ label: jd.title, value: String(jd.id) }))}
                      value={formData.jd_id}
                      onChange={(val) => setFormData((previous) => ({ ...previous, jd_id: val || '' }))}
                      placeholder="Select JD"
                      noOptionsMessage={isRecruiterScopedRole ? 'No JDs assigned to you. Contact your manager.' : 'No options'}
                    />
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
                  <SearchSelect
                    inputId="candidate_status"
                    options={CANDIDATE_STATUSES.map((s) => ({ label: s, value: s }))}
                    value={formData.status}
                    onChange={(val) => setFormData((previous) => ({ ...previous, status: val || 'APPLIED' }))}
                    placeholder="Select status"
                  />
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

      {/* Bulk upload panel */}
      {showBulkUpload && (
        <Card>
          {bulkUploadDrafts.length === 0 ? (
            <>
              <CardTitle>Bulk Upload Resumes</CardTitle>
              <div className="space-y-4">
                {/* Client selector (ADMIN only) */}
                {!isRecruiterScopedRole && (
                  <FormField label="Client" htmlFor="bulk_client_id">
                    <SearchSelect
                      inputId="bulk_client_id"
                      options={clients.map((c) => ({ label: c.name, value: String(c.id) }))}
                      value={bulkUploadClientId}
                      onChange={(val) => { setBulkUploadClientId(val || ''); setBulkUploadJdId('') }}
                      placeholder="Select client"
                    />
                  </FormField>
                )}

                {/* JD selector */}
                <FormField label="Job Description" htmlFor="bulk_jd_id">
                  <SearchSelect
                    inputId="bulk_jd_id"
                    options={bulkUploadJdsForForm.map((jd) => ({ label: jd.title, value: String(jd.id) }))}
                    value={bulkUploadJdId}
                    onChange={(val) => setBulkUploadJdId(val || '')}
                    placeholder="Select JD"
                    noOptionsMessage={isRecruiterScopedRole ? 'No JDs assigned to you. Contact your manager.' : 'No options'}
                  />
                </FormField>

                {/* File upload area */}
                <FormField label="Resume Files" htmlFor="bulk_resumes">
                  <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                    <input
                      id="bulk_resumes"
                      type="file"
                      multiple
                      accept=".pdf,.docx"
                      onChange={handleBulkUploadFileChange}
                      disabled={bulkUploadPreviewing || bulkUploadCreating}
                      className="hidden"
                    />
                    <label htmlFor="bulk_resumes" className="cursor-pointer">
                      <svg className="mx-auto h-12 w-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <p className="mt-2 text-sm font-medium text-slate-700">
                        Click to select files or drag and drop
                      </p>
                      <p className="text-xs text-slate-500 mt-1">PDF or DOCX, max 2MB per file, up to 20 files</p>
                    </label>
                  </div>
                </FormField>

                {/* Selected files list */}
                {bulkUploadFiles.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">{bulkUploadFiles.length} file(s) selected</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {bulkUploadFiles.map((file) => (
                        <div key={file.name} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{file.name}</p>
                            <p className="text-xs text-slate-500">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleBulkUploadRemoveFile(file.name)}
                            className="ml-2 text-red-600 hover:text-red-700 font-bold"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* File errors */}
                {Object.keys(bulkUploadErrors).length > 0 && (
                  <AlertBanner type="error" message={`${Object.keys(bulkUploadErrors).length} upload issue(s) found`} />
                )}

                {/* Upload button */}
                <div className="flex gap-2">
                  <PrimaryBtn
                    onClick={handleBulkUploadSubmit}
                    loading={bulkUploadPreviewing}
                    disabled={!bulkUploadJdId || bulkUploadFiles.length === 0 || bulkUploadPreviewing || bulkUploadCreating}
                  >
                    {bulkUploadPreviewing ? 'Extracting...' : 'Upload & Extract'}
                  </PrimaryBtn>
                  <SecondaryBtn onClick={handleBulkUploadClose} disabled={bulkUploadPreviewing || bulkUploadCreating}>
                    Cancel
                  </SecondaryBtn>
                </div>

                {/* Progress indicator */}
                {bulkUploadPreviewing && (
                  <div className="flex items-center gap-2.5 text-sm text-slate-600 mt-4">
                    <span className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                    Extracting resume data...
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <CardTitle>Review Extracted Resumes</CardTitle>
                  <p className="text-sm text-slate-500 mt-1">Edit the extracted values, then create the candidates when ready.</p>
                </div>
                <div className="flex items-center gap-2">
                  <SecondaryBtn onClick={() => {
                    setBulkUploadDrafts([])
                    setBulkUploadFiles([])
                    setBulkUploadErrors({})
                    setBulkUploadProgress(0)
                  }} disabled={bulkUploadCreating}>
                    Back to Upload
                  </SecondaryBtn>
                </div>
              </div>

              <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-sm text-slate-500">Total Extracted</p>
                    <p className="text-2xl font-semibold text-blue-600">
                      {bulkUploadDrafts.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Duplicates</p>
                    <p className="text-2xl font-semibold text-amber-600">
                      {bulkUploadDuplicateCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Errors Found</p>
                    <p className="text-2xl font-semibold text-red-600">
                      {bulkUploadIssuesCount}
                    </p>
                  </div>
                </div>
              </div>

              {/* Review table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[1100px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left px-4 py-3 font-semibold text-slate-700">File</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-700">Name</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-700">Email</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-700">Phone</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-700">Skills</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-700">Status</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkUploadDrafts.map((draft) => {
                      const isDup = isDuplicateDraft(draft)

                      const rowStatus = draft.createStatus === 'created'
                        ? 'created'
                        : draft.createStatus === 'creating'
                          ? 'creating'
                          : isDup
                            ? 'duplicate'
                            : draft.createStatus === 'error'
                              ? 'error'
                              : draft.previewStatus

                      const normalizedRowStatus = rowStatus === 'success' ? 'ready' : rowStatus

                      const statusVariant = normalizedRowStatus === 'created' || normalizedRowStatus === 'ready'
                        ? 'green'
                        : normalizedRowStatus === 'creating'
                          ? 'blue'
                          : normalizedRowStatus === 'duplicate'
                            ? 'amber'
                            : normalizedRowStatus === 'rejected'
                              ? 'amber'
                              : 'red'

                      return (
                        <tr key={draft.id} className="border-b border-slate-200 hover:bg-slate-50 align-top">
                          <td className="px-4 py-3 text-slate-700 font-medium max-w-[220px]">
                            <div className="truncate" title={draft.filename}>{draft.filename}</div>
                            {draft.previewError && (
                              <div className="mt-1 text-xs text-amber-600">{draft.previewError}</div>
                            )}
                            {draft.createError && (
                              <div className="mt-1 text-xs text-red-600">{draft.createError}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {draft.isEditing ? (
                              <FormInput
                                value={draft.full_name}
                                onChange={(event) => handleBulkDraftFieldChange(draft.id, 'full_name', event.target.value)}
                                placeholder="Full name"
                              />
                            ) : (
                              <span className="font-medium">{draft.full_name || '—'}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {draft.isEditing ? (
                              <FormInput
                                type="email"
                                value={draft.email}
                                onChange={(event) => handleBulkDraftFieldChange(draft.id, 'email', event.target.value)}
                                placeholder="email@example.com"
                              />
                            ) : (
                              <span>{draft.email || '—'}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {draft.isEditing ? (
                              <FormInput
                                value={draft.phone}
                                onChange={(event) => handleBulkDraftFieldChange(draft.id, 'phone', event.target.value)}
                                placeholder="Phone number"
                              />
                            ) : (
                              <span>{draft.phone || '—'}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {draft.isEditing ? (
                              <FormInput
                                value={draft.skills.join(', ')}
                                onChange={(event) => handleBulkDraftSkillsChange(draft.id, event.target.value)}
                                placeholder="React, Node.js, SQL"
                              />
                            ) : draft.skills.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {draft.skills.slice(0, 4).map((skill) => (
                                  <Badge key={skill} variant="gray">{skill}</Badge>
                                ))}
                                {draft.skills.length > 4 && (
                                  <span className="text-xs text-slate-400">+{draft.skills.length - 4} more</span>
                                )}
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-2">
                              <Badge variant={statusVariant}>{
                                normalizedRowStatus === 'created'
                                  ? 'Created'
                                  : normalizedRowStatus === 'creating'
                                    ? 'Creating'
                                    : normalizedRowStatus === 'ready'
                                      ? 'Ready'
                                      : normalizedRowStatus === 'duplicate'
                                        ? 'Duplicate'
                                        : normalizedRowStatus === 'rejected'
                                          ? 'Rejected'
                                          : 'Parse Error'
                              }</Badge>
                              {draft.previewStatus === 'rejected' && draft.previewError && (
                                <p className="text-xs text-amber-600 max-w-[220px]">{draft.previewError}</p>
                              )}
                              {draft.previewStatus === 'failed' && draft.previewError && (
                                <p className="text-xs text-red-600 max-w-[220px]">{draft.previewError}</p>
                              )}
                              {draft.createStatus === 'error' && draft.createError && (
                                <p className="text-xs text-red-600 max-w-[220px]">{draft.createError}</p>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {draft.isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleBulkDraftSave(draft.id)}
                                    className="text-xs bg-[#02c0fa] hover:bg-[#00a8e0] text-white px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleBulkDraftCancel(draft.id)}
                                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleBulkDraftEdit(draft.id)}
                                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                                  disabled={draft.createStatus === 'created'}
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Done button */}
              <div className="flex flex-wrap gap-2 mt-4">
                <PrimaryBtn onClick={handleBulkCreateCandidates} loading={bulkUploadCreating} disabled={bulkUploadCreating || bulkUploadDrafts.length === 0}>
                  {bulkUploadCreating ? 'Creating Candidates...' : 'Create Candidates'}
                </PrimaryBtn>
                <SecondaryBtn onClick={handleBulkUploadClose} disabled={bulkUploadCreating}>
                  Done
                </SecondaryBtn>
              </div>
            </>
          )}
        </Card>
      )}

      {/* Candidates table */}
      <Card>
        <DataTable
          headers={isRecruiterScopedRole
            ? ['Name', 'Email', 'Phone', 'Skills', 'Job Description', 'Status', 'Uploaded At (IST)', 'Actions']
            : ['Name', 'Email', 'Phone', 'Skills', 'Client', 'Job Description', 'Status', 'Uploaded At (IST)', 'Actions']}
          loading={isLoading}
          loadingLabel="Loading candidates..."
        >
          {candidates.length === 0 && !isLoading ? (
            <tr><td colSpan={isRecruiterScopedRole ? 8 : 9}><EmptyState message="No candidates found" /></td></tr>
          ) : (
            candidates.map((candidate) => (
              <TableRow key={candidate.id}>
                <TableCell>
                  <div>
                    <div className="font-medium text-slate-900">{candidate.full_name}</div>
                    <Badge variant="gray">{interviewCounts[candidate.id] || 0} interviews</Badge>
                  </div>
                </TableCell>
                <TableCell className="text-slate-500">{candidate.email}</TableCell>
                <TableCell className="text-slate-500">{candidate.phone || '—'}</TableCell>
                <TableCell>
                  {candidate.candidate_extracted_skills && candidate.candidate_extracted_skills.length > 0 ? (
                    <div className="flex flex-wrap gap-2 items-center">
                      {candidate.candidate_extracted_skills.slice(0, 3).map((skill, idx) => (
                        <Badge key={idx} variant="gray">{skill}</Badge>
                      ))}
                      {candidate.candidate_extracted_skills.length > 3 && (
                        <span className="text-xs text-slate-400">+{candidate.candidate_extracted_skills.length - 3} more</span>
                      )}
                    </div>
                  ) : (
                    '—'
                  )}
                </TableCell>
                {!isRecruiterScopedRole && (
                  <TableCell>{clientMap.get(candidate.client_id) || `Client #${candidate.client_id}`}</TableCell>
                )}
                <TableCell className="max-w-[220px]">
                  <div className="text-slate-600 whitespace-normal break-words leading-snug">{jdMap.get(candidate.jd_id)?.title || `JD #${candidate.jd_id}`}</div>
                </TableCell>
                <TableCell>
                  {!isPanelist ? (
                    <select
                      value={candidate.status}
                      onChange={(event) => handleStatusChange(candidate.id, event.target.value)}
                      className={`text-xs border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium transition-colors cursor-pointer ${
                        STATUS_VARIANTS[candidate.status] === 'green' ? 'border-green-200 text-green-700' :
                        STATUS_VARIANTS[candidate.status] === 'red' ? 'border-red-200 text-red-700' :
                        STATUS_VARIANTS[candidate.status] === 'amber' ? 'border-amber-200 text-amber-700' :
                        STATUS_VARIANTS[candidate.status] === 'blue' ? 'border-blue-200 text-blue-700' :
                        'border-slate-200 text-slate-700'
                      }`}
                    >
                      {CANDIDATE_STATUSES.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  ) : (
                    <Badge variant={STATUS_VARIANTS[candidate.status] || 'gray'}>{candidate.status}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-slate-500 whitespace-nowrap">
                  {formatDateTimeInIST(candidate.resume_uploaded_at)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {!isPanelist && (
                      <button
                        type="button"
                        onClick={() => navigate(`/interviews?jd_id=${candidate.jd_id}&candidate_id=${candidate.id}`)}
                        className="text-xs bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                      >
                        Schedule Interview
                      </button>
                    )}
                    {candidate.candidate_extracted_skills && candidate.candidate_extracted_skills.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCandidateForView(candidate)
                          setShowExtractedModal(true)
                        }}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 transition-colors"
                        title="View extracted resume data"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
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

      {/* Extracted Resume Details Modal */}
      {showExtractedModal && selectedCandidateForView && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Extracted Resume Data</h3>
              <button
                type="button"
                onClick={() => {
                  setShowExtractedModal(false)
                  setSelectedCandidateForView(null)
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Full Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <p className="text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-lg break-words">
                  {selectedCandidateForView.full_name || '—'}
                </p>
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <p className="text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-lg break-all">
                  {selectedCandidateForView.email || '—'}
                </p>
              </div>

              {/* Phone */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                <p className="text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-lg">
                  {selectedCandidateForView.phone || '—'}
                </p>
              </div>

              {/* Skills */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Skills</label>
                {selectedCandidateForView.candidate_extracted_skills && selectedCandidateForView.candidate_extracted_skills.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedCandidateForView.candidate_extracted_skills.map((skill, index) => (
                      <span key={index} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        {skill}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-lg">—</p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowExtractedModal(false)
                setSelectedCandidateForView(null)
              }}
              className="mt-6 w-full bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Close
            </button>
          </Card>
        </div>
      )}
    </AppShell>
  )
}
