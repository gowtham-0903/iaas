import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../store/authStore'

import { getClients } from '../api/clientsApi'
import {
  createJD,
  downloadJDFile,
  extractSkills,
  getJDs,
  updateJDStatus,
  uploadJDFile,
} from '../api/jdApi'
import AppShell from '../components/AppShell'
import {
  AlertBanner, Badge, Card, DataTable, EmptyState, FormField,
  FormInput, FormSelect, FormTextarea, LoadingState, ModalOverlay,
  PrimaryBtn, SecondaryBtn, TableCell, TableRow,
} from '../components/ui'

const JD_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED']

const DEFAULT_FORM = {
  title: '',
  client_id: '',
  raw_text: '',
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

function getStatusSelectClasses(status) {
  if (status === 'ACTIVE') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  }
  if (status === 'CLOSED') {
    return 'bg-red-50 text-red-700 border-red-200'
  }
  return 'bg-slate-100 text-slate-700 border-slate-200'
}

export default function JDManagement() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const isPanelist = user?.role === 'PANELIST'
  const [jds, setJDs] = useState([])
  const [clients, setClients] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isExtractingId, setIsExtractingId] = useState(null)
  const [isStatusSavingId, setIsStatusSavingId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [formMode, setFormMode] = useState('paste')
  const [selectedFile, setSelectedFile] = useState(null)
  const [formData, setFormData] = useState(DEFAULT_FORM)

  const clientMap = useMemo(() => {
    return new Map(clients.map((client) => [client.id, client.name]))
  }, [clients])

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      try {
        setIsLoading(true)
        setError('')

        const [jdsResponse, clientsResponse] = await Promise.all([getJDs(), getClients()])
        const nextJDs = jdsResponse.data?.jds ?? []
        const nextClients = clientsResponse.data?.clients ?? []

        if (!isMounted) {
          return
        }

        setJDs(nextJDs)
        setClients(nextClients)
      } catch (_loadError) {
        if (!isMounted) {
          return
        }
        setError('Unable to load job descriptions.')
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadData()

    return () => {
      isMounted = false
    }
  }, [])

  function resetForm() {
    setFormData(DEFAULT_FORM)
    setFormMode('paste')
    setSelectedFile(null)
  }

  function openModal() {
    setError('')
    setSuccess('')
    resetForm()
    setIsModalOpen(true)
  }

  function closeModal() {
    if (isSaving) return
    setIsModalOpen(false)
  }

  function handleFieldChange(event) {
    const { name, value } = event.target
    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }))
  }

  function handleModeChange(nextMode) {
    setFormMode(nextMode)
    setSelectedFile(null)
  }

  async function handleCreateJD(event) {
    event.preventDefault()

    if (!formData.title.trim() || !formData.client_id) {
      setError('Title and client are required.')
      return
    }

    if (formMode === 'upload' && !selectedFile) {
      setError('Please select a .pdf or .docx file.')
      return
    }

    try {
      setIsSaving(true)
      setError('')
      setSuccess('')

      const createPayload = {
        title: formData.title.trim(),
        client_id: Number(formData.client_id),
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
      setIsModalOpen(false)
      resetForm()
    } catch (createError) {
      const apiError = createError?.response?.data
      if (apiError?.errors?.file) {
        setError(apiError.errors.file[0])
      } else {
        setError(apiError?.error || apiError?.message || 'Failed to create JD.')
      }
    } finally {
      setIsSaving(false)
    }
  }

  async function handleStatusChange(jdId, status) {
    try {
      setIsStatusSavingId(jdId)
      setError('')
      await updateJDStatus(jdId, status)
      setJDs((previous) =>
        previous.map((jd) => (jd.id === jdId ? { ...jd, status } : jd)),
      )
    } catch (_statusError) {
      setError('Failed to update JD status.')
    } finally {
      setIsStatusSavingId(null)
    }
  }

  async function handleExtractSkills(jdId) {
    try {
      setIsExtractingId(jdId)
      setError('')
      setSuccess('')
      await extractSkills(jdId)
      setSuccess('Skills extracted successfully.')
      navigate(`/skill-extraction/${jdId}`)
    } catch (_extractError) {
      setError('AI extraction failed — you can add skills manually.')
      navigate(`/skill-extraction/${jdId}`)
    } finally {
      setIsExtractingId(null)
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
    } catch (_downloadError) {
      setError('Unable to download uploaded JD file.')
    }
  }

  return (
    <AppShell pageTitle="Job Descriptions" pageSubtitle="Create and manage job descriptions for clients">
      {!isPanelist && (
        <div className="flex items-center justify-between mb-5">
          <div />
          <PrimaryBtn onClick={openModal}>
            + New JD
          </PrimaryBtn>
        </div>
      )}

      <AlertBanner type="error" message={error} />
      <AlertBanner type="success" message={success} />

      <Card>
        <DataTable
          headers={['Title', 'Job Code', 'Client', 'Status', 'Created', 'Actions']}
          loading={isLoading}
          loadingLabel="Loading job descriptions..."
        >
          {jds.length === 0 && !isLoading ? (
            <tr><td colSpan={6}><EmptyState message="No job descriptions yet" /></td></tr>
          ) : (
            jds.map((jd) => (
              <TableRow key={jd.id}>
                <TableCell className="font-medium text-slate-900 whitespace-normal break-words max-w-[320px]">
                  <div>{jd.title}</div>
                </TableCell>
                <TableCell>
                  {jd.job_code
                    ? <Badge variant="blue">{jd.job_code}</Badge>
                    : <span className="text-slate-400">—</span>
                  }
                </TableCell>
                <TableCell>{clientMap.get(jd.client_id) || `Client #${jd.client_id}`}</TableCell>
                <TableCell>
                  <select
                    value={jd.status}
                    disabled={isStatusSavingId === jd.id || isPanelist}
                    onChange={(event) => handleStatusChange(jd.id, event.target.value)}
                    title={isPanelist ? 'Only admins can change status' : 'Click to change status'}
                    className={`appearance-none ${isPanelist ? 'cursor-default' : 'cursor-pointer'} inline-flex items-center rounded-full border px-4 py-1 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 ${getStatusSelectClasses(jd.status)}`}
                  >
                    {JD_STATUSES.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </TableCell>
                <TableCell className="text-slate-500">{new Date(jd.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    {!isPanelist && (
                      <button
                        type="button"
                        onClick={() => handleExtractSkills(jd.id)}
                        disabled={isExtractingId === jd.id}
                        className="text-xs bg-[#02c0fa] hover:bg-[#00a8e0] text-white px-2.5 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        {isExtractingId === jd.id ? (
                          <><span className="w-3 h-3 border border-white/40 border-t-white rounded-full spin" />Extracting...</>
                        ) : 'Extract Skills'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => navigate(`/skill-extraction/${jd.id}`)}
                      aria-label="View job description"
                      title="View job description"
                      className="inline-flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 p-2 rounded-lg transition-colors"
                    >
                      <ViewIcon />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadFile(jd)}
                      disabled={!jd.file_url}
                      aria-label="Download job description file"
                      title={jd.file_url ? 'Download uploaded JD file' : 'No uploaded file'}
                      className="inline-flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 p-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <DownloadIcon />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </DataTable>
      </Card>

      {/* Create JD Modal */}
      {isModalOpen && (
        <ModalOverlay onClose={closeModal}>
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-slate-900">Create New JD</h2>
              <button
                type="button"
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <AlertBanner type="error" message={error} />

            <form onSubmit={handleCreateJD}>
              <FormField label="Title" htmlFor="jd-title">
                <FormInput
                  id="jd-title"
                  name="title"
                  type="text"
                  value={formData.title}
                  onChange={handleFieldChange}
                  required
                  placeholder="e.g. Senior React Developer"
                />
              </FormField>

              <FormField label="Client" htmlFor="jd-client">
                <FormSelect
                  id="jd-client"
                  name="client_id"
                  value={formData.client_id}
                  onChange={handleFieldChange}
                  required
                >
                  <option value="">Select client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                  ))}
                </FormSelect>
              </FormField>

              {/* Mode toggle */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">JD Source</label>
                <div className="flex gap-3">
                  {['paste', 'upload'].map((mode) => (
                    <label key={mode} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={formMode === mode}
                        onChange={() => handleModeChange(mode)}
                        className="text-blue-600"
                      />
                      <span className="text-sm text-slate-700 capitalize">{mode === 'paste' ? 'Paste text' : 'Upload file'}</span>
                    </label>
                  ))}
                </div>
              </div>

              {formMode === 'paste' ? (
                <FormField label="Paste JD Text" htmlFor="jd-raw-text">
                  <FormTextarea
                    id="jd-raw-text"
                    name="raw_text"
                    rows={6}
                    value={formData.raw_text}
                    onChange={handleFieldChange}
                    placeholder="Paste job description text here..."
                  />
                </FormField>
              ) : (
                <FormField label="Upload .pdf or .docx" htmlFor="jd-file">
                  <input
                    id="jd-file"
                    type="file"
                    accept=".pdf,.docx"
                    onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                    className="w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                </FormField>
              )}

              <div className="flex gap-2 pt-2">
                <PrimaryBtn type="submit" loading={isSaving}>
                  {isSaving ? 'Saving...' : 'Save JD'}
                </PrimaryBtn>
                <SecondaryBtn onClick={closeModal} disabled={isSaving}>Cancel</SecondaryBtn>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}
    </AppShell>
  )
}
