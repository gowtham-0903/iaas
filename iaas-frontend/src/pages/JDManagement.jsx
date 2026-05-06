import { useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import useAuthStore from '../store/authStore'

import { getClients } from '../api/clientsApi'
import {
  addSkill,
  createJD,
  deleteSkill,
  downloadJDFile,
  extractSkills,
  getJD,
  getJDs,
  getSkills,
  updateJDStatus,
  updateSkill,
  uploadJDFile,
} from '../api/jdApi'
import AppShell from '../components/AppShell'
import {
  AlertBanner, Badge, Card, CardTitle, DataTable, EmptyState, FormField,
  FormInput, FormTextarea, LoadingState, ModalOverlay,
  PrimaryBtn, SearchSelect, SecondaryBtn, TableCell, TableRow,
} from '../components/ui'

// ── Skill card helpers ────────────────────────────────────────────────────

function toCommaText(subtopics) {
  return (subtopics || []).join(', ')
}

function fromCommaText(value) {
  return value.split(',').map((e) => e.trim()).filter(Boolean)
}

function buildCard(skill) {
  return {
    local_id: `existing-${skill.id}`,
    ...skill,
    subtopics_text: toCommaText(skill.subtopics),
    isNew: false,
    isModified: false,
    isEditing: false,
    editSnapshot: null,
    original: {
      skill_name: skill.skill_name,
      importance_level: skill.importance_level || '',
      subtopics_text: toCommaText(skill.subtopics),
    },
  }
}

function getSkillTypeVariant(skillType) {
  if (skillType === 'primary') return 'blue'
  if (skillType === 'soft') return 'green'
  return 'gray'
}

// ── JD status helpers ─────────────────────────────────────────────────────

const JD_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED']

const DEFAULT_FORM = { title: '', client_id: '', raw_text: '' }

function getDefaultForm(user) {
  if (user?.role !== 'ADMIN' && user?.client_id != null) {
    return { ...DEFAULT_FORM, client_id: String(user.client_id) }
  }
  return { ...DEFAULT_FORM }
}

function getStatusSelectClasses(status) {
  if (status === 'ACTIVE') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'CLOSED') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-slate-100 text-slate-700 border-slate-200'
}

function ViewIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M12 15V3" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
    </svg>
  )
}

// ── Component ─────────────────────────────────────────────────────────────

export default function JDManagement() {
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.role === 'ADMIN'
  const isPanelist = user?.role === 'PANELIST'
  const isRecruiterScopedRole = ['RECRUITER', 'SR_RECRUITER', 'M_RECRUITER'].includes(user?.role)

  // ── Base data ──────────────────────────────────────────────────────────
  const [jds, setJDs] = useState([])
  const [clients, setClients] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isStatusSavingId, setIsStatusSavingId] = useState(null)

  // ── Create JD modal ────────────────────────────────────────────────────
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [formMode, setFormMode] = useState('paste')
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileError, setFileError] = useState('')
  const [formData, setFormData] = useState(() => getDefaultForm(user))

  // ── Skills modal ───────────────────────────────────────────────────────
  const [skillsModalOpen, setSkillsModalOpen] = useState(false)
  const [skillsModalJdId, setSkillsModalJdId] = useState(null)
  const [skillsJd, setSkillsJd] = useState(null)
  const [skillCards, setSkillCards] = useState([])
  const [isLoadingSkills, setIsLoadingSkills] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [isExtractingTableId, setIsExtractingTableId] = useState(null)
  const [savingRowId, setSavingRowId] = useState(null)
  const [skillModalError, setSkillModalError] = useState('')
  const [skillModalSuccess, setSkillModalSuccess] = useState('')
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false)
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  const [skillUploadFile, setSkillUploadFile] = useState(null)
  const [isUploadingSkillFile, setIsUploadingSkillFile] = useState(false)
  const skillFileInputRef = useRef(null)

  // ── Derived ────────────────────────────────────────────────────────────
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients])

  const filteredJDs = useMemo(() => {
    let base = jds
    if (isRecruiterScopedRole && user?.client_id != null) {
      base = jds.filter((jd) => String(jd.client_id) === String(user.client_id))
    }
    const query = searchQuery.trim().toLowerCase()
    if (!query) return base
    return base.filter((jd) =>
      jd.title.toLowerCase().includes(query) ||
      (jd.job_code && jd.job_code.toLowerCase().includes(query)) ||
      (clientMap.get(jd.client_id) || '').toLowerCase().includes(query)
    )
  }, [jds, searchQuery, clientMap, isRecruiterScopedRole, user?.client_id])

  // ── Load base data ─────────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true
    async function loadData() {
      try {
        setIsLoading(true)
        setError('')
        const [jdsResponse, clientsResponse] = await Promise.all([getJDs(), getClients()])
        if (!isMounted) return
        setJDs(jdsResponse.data?.jds ?? [])
        setClients(clientsResponse.data?.clients ?? [])
      } catch {
        if (isMounted) setError('Unable to load job descriptions.')
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }
    loadData()
    return () => { isMounted = false }
  }, [])

  useEffect(() => {
    if (isAdmin) return
    setFormData((prev) => ({ ...prev, client_id: user?.client_id != null ? String(user.client_id) : '' }))
  }, [isAdmin, user?.client_id])

  // ── Create JD ──────────────────────────────────────────────────────────
  const ALLOWED_JD_EXTENSIONS = ['.pdf', '.docx']

  function handleFileChange(event) {
    const file = event.target.files?.[0] || null
    if (!file) { setSelectedFile(null); setFileError(''); return }
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED_JD_EXTENSIONS.includes(ext)) {
      event.target.value = ''
      setSelectedFile(null)
      setFileError('Only .pdf and .docx files are allowed.')
      return
    }
    setFileError('')
    setSelectedFile(file)
  }

  function resetForm() {
    setFormData(getDefaultForm(user))
    setFormMode('paste')
    setSelectedFile(null)
    setFileError('')
  }

  function openCreateModal() {
    setError('')
    setSuccess('')
    resetForm()
    setIsCreateModalOpen(true)
  }

  function closeCreateModal() {
    if (isSaving) return
    setIsCreateModalOpen(false)
  }

  function handleFieldChange(event) {
    const { name, value } = event.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  async function handleCreateJD(event) {
    event.preventDefault()
    const selectedClientId = isAdmin ? formData.client_id : (user?.client_id != null ? String(user.client_id) : '')
    if (!formData.title.trim() || !selectedClientId) { setError('Title and client are required.'); return }
    if (formMode === 'upload' && !selectedFile) { setError('Please select a .pdf or .docx file.'); return }
    try {
      setIsSaving(true); setError(''); setSuccess('')
      const createPayload = {
        title: formData.title.trim(),
        client_id: Number(selectedClientId),
        raw_text: formMode === 'paste' ? formData.raw_text.trim() : null,
      }
      const createResponse = await createJD(createPayload)
      const createdJD = createResponse.data?.jd
      if (formMode === 'upload' && selectedFile && createdJD?.id) {
        await uploadJDFile(createdJD.id, selectedFile)
      }
      const refreshed = await getJDs()
      setJDs(refreshed.data?.jds ?? [])
      setSuccess('JD created successfully.')
      setIsCreateModalOpen(false)
      resetForm()
    } catch (createError) {
      const apiError = createError?.response?.data
      setError(apiError?.errors?.file?.[0] || apiError?.error || apiError?.message || 'Failed to create JD.')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleStatusChange(jdId, status) {
    try {
      setIsStatusSavingId(jdId); setError('')
      await updateJDStatus(jdId, status)
      setJDs((prev) => prev.map((jd) => (jd.id === jdId ? { ...jd, status } : jd)))
    } catch {
      setError('Failed to update JD status.')
    } finally {
      setIsStatusSavingId(null)
    }
  }

  async function handleDownloadFile(jd) {
    try {
      setError('')
      const response = await downloadJDFile(jd.id)
      const contentDisposition = response.headers?.['content-disposition'] || ''
      const fileNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
      const fileName = fileNameMatch?.[1] || `jd_${jd.id}`
      const blobUrl = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(blobUrl)
    } catch {
      setError('Unable to download uploaded JD file.')
    }
  }

  // ── Skills modal — open / load ──────────────────────────────────────────

  async function loadSkillsForModal(jdId) {
    try {
      setIsLoadingSkills(true)
      setSkillModalError('')
      setSkillModalSuccess('')
      const [jdResponse, skillsResponse] = await Promise.all([getJD(jdId), getSkills(jdId)])
      setSkillsJd(jdResponse.data?.jd ?? null)
      setSkillCards((skillsResponse.data?.skills ?? []).map(buildCard))
    } catch {
      setSkillModalError('Failed to load skills.')
    } finally {
      setIsLoadingSkills(false)
    }
  }

  async function openSkillsModal(jdId) {
    setSkillsModalJdId(jdId)
    setSkillsJd(null)
    setSkillCards([])
    setSkillModalError('')
    setSkillModalSuccess('')
    setSkillsModalOpen(true)
    await loadSkillsForModal(jdId)
  }

  async function handleExtractFromTable(jdId) {
    try {
      setIsExtractingTableId(jdId); setError(''); setSuccess('')
      await extractSkills(jdId)
      const refreshed = await getJDs()
      setJDs(refreshed.data?.jds ?? [])
      setSuccess('Skills extracted.')
      await openSkillsModal(jdId)
    } catch {
      setError('AI extraction failed — you can add skills manually.')
      await openSkillsModal(jdId)
    } finally {
      setIsExtractingTableId(null)
    }
  }

  function closeSkillsModal() {
    setSkillsModalOpen(false)
    setSkillsModalJdId(null)
    // Refresh the JD list so skill count badges update
    getJDs().then((r) => setJDs(r.data?.jds ?? []))
  }

  // ── Skills modal — upload JD file ─────────────────────────────────────

  async function handleUploadSkillFile() {
    if (!skillsModalJdId || !skillUploadFile) {
      setSkillModalError('Please choose a .pdf or .docx file.')
      return
    }
    try {
      setIsUploadingSkillFile(true); setSkillModalError(''); setSkillModalSuccess('')
      await uploadJDFile(skillsModalJdId, skillUploadFile)
      const jdResponse = await getJD(skillsModalJdId)
      setSkillsJd(jdResponse.data?.jd ?? null)
      if (!(jdResponse.data?.jd?.raw_text || '').trim()) {
        setSkillModalError('Upload succeeded but no readable text was extracted. Try a different file.')
        return
      }
      setSkillModalSuccess('File uploaded. You can now extract skills.')
      setSkillUploadFile(null)
      if (skillFileInputRef.current) skillFileInputRef.current.value = ''
    } catch (uploadError) {
      const apiError = uploadError?.response?.data
      setSkillModalError(apiError?.errors?.file?.[0] || apiError?.error || 'Failed to upload file.')
    } finally {
      setIsUploadingSkillFile(false)
    }
  }

  // ── Skills modal — extract ─────────────────────────────────────────────

  async function handleExtractInModal() {
    if (!skillsModalJdId) return
    if (!skillsJd?.raw_text?.trim()) {
      setSkillModalError('No text to extract from. Upload a .pdf/.docx file first.')
      return
    }
    try {
      setIsExtracting(true); setSkillModalError(''); setSkillModalSuccess('')
      const extractResponse = await extractSkills(skillsModalJdId)
      const [jdResponse, skillsResponse] = await Promise.all([
        getJD(skillsModalJdId),
        getSkills(skillsModalJdId),
      ])
      setSkillsJd(jdResponse.data?.jd ?? null)
      setSkillCards((skillsResponse.data?.skills ?? []).map(buildCard))
      setSkillModalSuccess(extractResponse.data?.cached ? 'Existing extracted skills loaded.' : 'Skills extracted successfully.')
    } catch {
      setSkillModalError('AI extraction failed — you can add skills manually.')
    } finally {
      setIsExtracting(false)
    }
  }

  // ── Skills modal — card management ────────────────────────────────────

  function updateCardField(localId, field, value) {
    setSkillCards((prev) =>
      prev.map((card) => {
        if (card.local_id !== localId) return card
        const next = { ...card, [field]: value }
        if (!next.isNew) {
          next.isModified =
            next.skill_name !== next.original.skill_name ||
            (next.importance_level || '') !== next.original.importance_level ||
            next.subtopics_text !== next.original.subtopics_text
        }
        return next
      })
    )
  }

  async function handleDeleteCard(localId) {
    const card = skillCards.find((c) => c.local_id === localId)
    if (!card) return
    try {
      setSkillModalError('')
      if (!card.isNew) await deleteSkill(skillsModalJdId, card.id)
      setSkillCards((prev) => prev.filter((c) => c.local_id !== localId))
    } catch {
      setSkillModalError('Failed to delete skill.')
    }
  }

  function handleAddManualSkill() {
    const localId = `new-${Date.now()}-${Math.random()}`
    setSkillCards((prev) => [
      ...prev,
      {
        local_id: localId, id: null, skill_name: '', skill_type: 'secondary',
        importance_level: '', subtopics: [], subtopics_text: '',
        isNew: true, isModified: true, isEditing: true, editSnapshot: null,
      },
    ])
  }

  function handleEditCard(localId) {
    setSkillCards((prev) =>
      prev.map((card) => {
        if (card.local_id !== localId || card.isEditing) return card
        return {
          ...card, isEditing: true,
          editSnapshot: {
            skill_name: card.skill_name,
            importance_level: card.importance_level || '',
            subtopics_text: card.subtopics_text || '',
            skill_type: card.skill_type || 'secondary',
          },
        }
      })
    )
  }

  function handleCancelEdit(localId) {
    setSkillCards((prev) => {
      const card = prev.find((c) => c.local_id === localId)
      if (!card) return prev
      if (card.isNew) return prev.filter((c) => c.local_id !== localId)
      return prev.map((c) => {
        if (c.local_id !== localId) return c
        const snap = c.editSnapshot
        if (!snap) return { ...c, isEditing: false }
        return {
          ...c,
          skill_name: snap.skill_name, importance_level: snap.importance_level,
          subtopics_text: snap.subtopics_text, skill_type: snap.skill_type,
          isEditing: false, isModified: false, editSnapshot: null,
        }
      })
    })
  }

  async function handleSaveCard(localId) {
    const card = skillCards.find((c) => c.local_id === localId)
    if (!card) return
    if (!card.skill_name.trim()) { setSkillModalError('Skill name is required.'); return }
    try {
      setSavingRowId(localId); setSkillModalError(''); setSkillModalSuccess('')
      const payload = {
        skill_name: card.skill_name.trim(),
        importance_level: card.importance_level?.trim() || null,
        subtopics: fromCommaText(card.subtopics_text),
      }
      if (card.isNew) {
        await addSkill(skillsModalJdId, { ...payload, skill_type: card.skill_type || 'secondary' })
      } else if (card.isModified) {
        await updateSkill(skillsModalJdId, card.id, payload)
      }
      const skillsResponse = await getSkills(skillsModalJdId)
      setSkillCards((skillsResponse.data?.skills ?? []).map(buildCard))
      setSkillModalSuccess('Skill saved.')
    } catch {
      setSkillModalError('Failed to save skill.')
    } finally {
      setSavingRowId(null)
    }
  }

  // ── Skills modal — export ──────────────────────────────────────────────

  function getExportRows() {
    return skillCards.map((c) => ({
      type: c.skill_type || 'secondary',
      skill_name: c.skill_name || '-',
      importance: c.importance_level || '-',
      subtopics: c.subtopics_text || '-',
    }))
  }

  function getExportBaseName() {
    return `jd-${skillsModalJdId || 'unknown'}-skills-${new Date().toISOString().slice(0, 10)}`
  }

  function handleDownloadExcel() {
    const rows = getExportRows()
    if (!rows.length) { setSkillModalError('No skills to export.'); return }
    try {
      setIsDownloadingExcel(true)
      const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
        Type: r.type, 'Skill Name': r.skill_name, Importance: r.importance, Subtopics: r.subtopics,
      })))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Extracted Skills')
      XLSX.writeFile(wb, `${getExportBaseName()}.xlsx`)
    } catch {
      setSkillModalError('Failed to export Excel.')
    } finally {
      setIsDownloadingExcel(false)
    }
  }

  function handleDownloadPdf() {
    const rows = getExportRows()
    if (!rows.length) { setSkillModalError('No skills to export.'); return }
    try {
      setIsDownloadingPdf(true)
      const doc = new jsPDF({ orientation: 'landscape' })
      doc.setFontSize(12)
      doc.text(`Extracted Skills — ${skillsJd?.title || `JD #${skillsModalJdId}`}`, 14, 14)
      autoTable(doc, {
        startY: 20,
        head: [['Type', 'Skill Name', 'Importance', 'Subtopics']],
        body: rows.map((r) => [r.type, r.skill_name, r.importance, r.subtopics]),
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fillColor: [37, 99, 235] },
      })
      doc.save(`${getExportBaseName()}.pdf`)
    } catch {
      setSkillModalError('Failed to export PDF.')
    } finally {
      setIsDownloadingPdf(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, job code or client..."
            className="w-full pl-9 pr-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all bg-white"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Clear search">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {!isPanelist && <PrimaryBtn onClick={openCreateModal}>+ New JD</PrimaryBtn>}
      </div>

      <AlertBanner type="error" message={error} />
      <AlertBanner type="success" message={success} />

      <Card>
        <DataTable
          headers={['Title', 'Job Code', ...(!isRecruiterScopedRole ? ['Client'] : []), 'Status', 'Created', 'Actions']}
          loading={isLoading}
          loadingLabel="Loading job descriptions..."
        >
          {filteredJDs.length === 0 && !isLoading ? (
            <tr><td colSpan={isRecruiterScopedRole ? 5 : 6}>
              <EmptyState message={searchQuery ? `No JDs match "${searchQuery}"` : 'No job descriptions yet'} />
            </td></tr>
          ) : (
            filteredJDs.map((jd) => (
              <TableRow key={jd.id}>
                <TableCell className="font-medium text-slate-900 whitespace-normal break-words max-w-[320px]">
                  <div>{jd.title}</div>
                </TableCell>
                <TableCell>
                  {jd.job_code
                    ? <Badge variant="blue">{jd.job_code}</Badge>
                    : <span className="text-slate-400">—</span>}
                </TableCell>
                {!isRecruiterScopedRole && (
                  <TableCell>{clientMap.get(jd.client_id) || `Client #${jd.client_id}`}</TableCell>
                )}
                <TableCell>
                  <select
                    value={jd.status}
                    disabled={isStatusSavingId === jd.id || isPanelist}
                    onChange={(e) => handleStatusChange(jd.id, e.target.value)}
                    title={isPanelist ? 'Only admins can change status' : 'Click to change status'}
                    className={`appearance-none ${isPanelist ? 'cursor-default' : 'cursor-pointer'} inline-flex items-center rounded-full border px-4 py-1 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 ${getStatusSelectClasses(jd.status)}`}
                  >
                    {JD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </TableCell>
                <TableCell className="text-slate-500">{new Date(jd.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    {!isPanelist && (
                      jd.skills && jd.skills.length > 0 ? (
                        <button type="button" onClick={() => openSkillsModal(jd.id)}
                          className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-1.5 rounded-lg font-medium transition-colors">
                          View Skills ({jd.skills.length})
                        </button>
                      ) : (
                        <button type="button"
                          onClick={() => handleExtractFromTable(jd.id)}
                          disabled={isExtractingTableId === jd.id}
                          className="text-xs bg-[#02c0fa] hover:bg-[#00a8e0] text-white px-2.5 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-1">
                          {isExtractingTableId === jd.id
                            ? <><span className="w-3 h-3 border border-white/40 border-t-white rounded-full spin" />Extracting...</>
                            : 'Extract Skills'}
                        </button>
                      )
                    )}
                    <button type="button" onClick={() => openSkillsModal(jd.id)}
                      aria-label="View job description" title="View job description"
                      className="inline-flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 p-2 rounded-lg transition-colors">
                      <ViewIcon />
                    </button>
                    <button type="button" onClick={() => handleDownloadFile(jd)}
                      disabled={!jd.file_url}
                      aria-label="Download JD file" title={jd.file_url ? 'Download uploaded JD file' : 'No uploaded file'}
                      className="inline-flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 p-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                      <DownloadIcon />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </DataTable>
      </Card>

      {/* ── Create JD Modal ───────────────────────────────────────────── */}
      {isCreateModalOpen && (
        <ModalOverlay onClose={closeCreateModal}>
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-slate-900">Create New JD</h2>
              <button type="button" onClick={closeCreateModal} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <AlertBanner type="error" message={error} />

            <form onSubmit={handleCreateJD}>
              <FormField label="Title" htmlFor="jd-title">
                <FormInput id="jd-title" name="title" type="text" value={formData.title}
                  onChange={handleFieldChange} required placeholder="e.g. Senior React Developer" />
              </FormField>

              {isAdmin ? (
                <FormField label="Client" htmlFor="jd-client">
                  <SearchSelect
                    inputId="jd-client"
                    options={clients.map((c) => ({ label: c.name, value: String(c.id) }))}
                    value={formData.client_id}
                    onChange={(val) => handleFieldChange({ target: { name: 'client_id', value: val || '' } })}
                    placeholder="Select client"
                  />
                </FormField>
              ) : (
                <FormField label="Client" htmlFor="jd-client-display">
                  <FormInput id="jd-client-display" type="text"
                    value={clientMap.get(user?.client_id) || '—'} disabled readOnly />
                </FormField>
              )}

              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">JD Source</label>
                <div className="flex gap-3">
                  {['paste', 'upload'].map((mode) => (
                    <label key={mode} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" checked={formMode === mode}
                        onChange={() => { setFormMode(mode); setSelectedFile(null); setFileError('') }}
                        className="text-blue-600" />
                      <span className="text-sm text-slate-700">{mode === 'paste' ? 'Paste text' : 'Upload file'}</span>
                    </label>
                  ))}
                </div>
              </div>

              {formMode === 'paste' ? (
                <FormField label="Paste JD Text" htmlFor="jd-raw-text">
                  <FormTextarea id="jd-raw-text" name="raw_text" rows={6}
                    value={formData.raw_text} onChange={handleFieldChange}
                    placeholder="Paste job description text here..." />
                </FormField>
              ) : (
                <FormField label="Upload .pdf or .docx" htmlFor="jd-file" error={fileError}>
                  <input id="jd-file" type="file" accept=".pdf,.docx" onChange={handleFileChange}
                    className="w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                </FormField>
              )}

              <div className="flex gap-2 pt-2">
                <PrimaryBtn type="submit" loading={isSaving}>{isSaving ? 'Saving...' : 'Save JD'}</PrimaryBtn>
                <SecondaryBtn onClick={closeCreateModal} disabled={isSaving}>Cancel</SecondaryBtn>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* ── Skills Modal ──────────────────────────────────────────────── */}
      {skillsModalOpen && (
        <ModalOverlay onClose={closeSkillsModal}>
          <div className="p-6 w-full max-w-5xl">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {skillsJd?.title || 'Skills'}
                </h2>
                {skillsJd?.job_code && (
                  <span className="text-xs text-slate-500">{skillsJd.job_code}</span>
                )}
              </div>
              <button type="button" onClick={closeSkillsModal} className="text-slate-400 hover:text-slate-600 ml-4 flex-shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <AlertBanner type="error" message={skillModalError} />
            <AlertBanner type="success" message={skillModalSuccess} />

            {isLoadingSkills ? (
              <div className="flex items-center justify-center gap-2.5 py-12 text-slate-500 text-sm">
                <span className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full spin" />
                Loading skills...
              </div>
            ) : (
              <>
                {/* Upload JD file if no raw text */}
                {skillsJd && !skillsJd.raw_text?.trim() && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                    <p className="text-sm text-amber-800 font-medium mb-2">No JD text found. Upload a file to enable AI extraction.</p>
                    <div className="flex items-center gap-3">
                      <input ref={skillFileInputRef} type="file" accept=".pdf,.docx"
                        onChange={(e) => setSkillUploadFile(e.target.files?.[0] || null)}
                        className="text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                      <SecondaryBtn onClick={handleUploadSkillFile} disabled={isUploadingSkillFile || !skillUploadFile}>
                        {isUploadingSkillFile ? 'Uploading...' : 'Upload'}
                      </SecondaryBtn>
                    </div>
                  </div>
                )}

                {/* Toolbar */}
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Extracted Skills
                    {skillCards.length > 0 && (
                      <span className="ml-2 text-xs font-normal text-slate-500">({skillCards.length} skills)</span>
                    )}
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <SecondaryBtn disabled={isDownloadingExcel || skillCards.length === 0} onClick={handleDownloadExcel}>
                      {isDownloadingExcel ? 'Downloading...' : 'Excel'}
                    </SecondaryBtn>
                    <SecondaryBtn disabled={isDownloadingPdf || skillCards.length === 0} onClick={handleDownloadPdf}>
                      {isDownloadingPdf ? 'Downloading...' : 'PDF'}
                    </SecondaryBtn>
                    {skillCards.length > 0 ? (
                      <SecondaryBtn disabled>
                        Skills Extracted{skillsJd?.skills_extracted_at ? ` on ${new Date(skillsJd.skills_extracted_at).toLocaleDateString()}` : ''}
                      </SecondaryBtn>
                    ) : (
                      <PrimaryBtn
                        disabled={isExtracting || !skillsJd?.raw_text}
                        onClick={handleExtractInModal}
                        title={!skillsJd?.raw_text ? 'Upload a JD file or paste text before extracting' : undefined}
                        loading={isExtracting}
                      >
                        {isExtracting ? 'Analysing...' : 'Extract Skills'}
                      </PrimaryBtn>
                    )}
                  </div>
                </div>

                {isExtracting && (
                  <div className="flex items-center justify-center gap-2.5 py-6 text-slate-500 text-sm border-b border-slate-100 mb-4">
                    <span className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full spin" />
                    Analysing JD with GPT-4o...
                  </div>
                )}

                {/* Skills table */}
                <div className="overflow-x-auto -mx-6">
                  <table className="skills-editor-table min-w-[860px]">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-5 py-3 w-[120px]">Type</th>
                        <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-5 py-3">Skill Name</th>
                        <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-5 py-3 w-[130px]">Importance</th>
                        <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-5 py-3">Subtopics (comma-separated)</th>
                        <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-5 py-3 w-[180px]">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {skillCards.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="text-center py-10 text-slate-400 text-sm">
                            No skills yet. Run extraction or add one manually.
                          </td>
                        </tr>
                      ) : (
                        skillCards.map((card) => (
                          <tr key={card.local_id || card.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors last:border-0">
                            <td className="px-5 py-3 w-[120px]">
                              {card.isEditing && card.isNew ? (
                                <select value={card.skill_type}
                                  onChange={(e) => updateCardField(card.local_id, 'skill_type', e.target.value)}
                                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-700">
                                  <option value="primary">primary</option>
                                  <option value="secondary">secondary</option>
                                  <option value="soft">soft</option>
                                </select>
                              ) : (
                                <Badge variant={getSkillTypeVariant(card.skill_type)}>{card.skill_type || 'secondary'}</Badge>
                              )}
                            </td>
                            <td className="px-5 py-3">
                              {card.isEditing ? (
                                <input type="text" value={card.skill_name}
                                  onChange={(e) => updateCardField(card.local_id, 'skill_name', e.target.value)}
                                  placeholder="Skill name"
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[140px]" />
                              ) : (
                                <div className="text-sm text-slate-800 font-medium whitespace-nowrap overflow-hidden text-ellipsis">{card.skill_name || '-'}</div>
                              )}
                            </td>
                            <td className="px-5 py-3 w-[130px]">
                              {card.isEditing ? (
                                <input type="text" value={card.importance_level || ''}
                                  onChange={(e) => updateCardField(card.local_id, 'importance_level', e.target.value)}
                                  placeholder="Optional"
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[100px]" />
                              ) : (
                                <div className="text-sm text-slate-600">{card.importance_level || '-'}</div>
                              )}
                            </td>
                            <td className="px-5 py-3">
                              {card.isEditing ? (
                                <input type="text" value={card.subtopics_text}
                                  onChange={(e) => updateCardField(card.local_id, 'subtopics_text', e.target.value)}
                                  placeholder="Node.js, Express, API Design"
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[200px]" />
                              ) : (
                                <div className="text-sm text-slate-600 whitespace-nowrap overflow-hidden text-ellipsis">{card.subtopics_text || '-'}</div>
                              )}
                            </td>
                            <td className="px-5 py-3 w-[180px]">
                              <div className="flex items-center gap-1.5">
                                {card.isEditing ? (
                                  <>
                                    <button type="button" onClick={() => handleSaveCard(card.local_id)}
                                      disabled={savingRowId === card.local_id}
                                      className="text-xs bg-[#02c0fa] hover:bg-[#00a8e0] text-white px-2.5 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-1">
                                      {savingRowId === card.local_id
                                        ? <><span className="w-3 h-3 border border-white/40 border-t-white rounded-full spin" />Saving...</>
                                        : 'Save'}
                                    </button>
                                    <button type="button" onClick={() => handleCancelEdit(card.local_id)}
                                      className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors">
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button type="button" onClick={() => handleEditCard(card.local_id)}
                                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors">
                                    Edit
                                  </button>
                                )}
                                <button type="button" onClick={() => handleDeleteCard(card.local_id)}
                                  className="text-xs bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-2.5 py-1.5 rounded-lg font-medium transition-colors">
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="pt-4 mt-2 border-t border-slate-100">
                  <SecondaryBtn onClick={handleAddManualSkill}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Add Skill Manually
                  </SecondaryBtn>
                </div>
              </>
            )}
          </div>
        </ModalOverlay>
      )}
    </AppShell>
  )
}
