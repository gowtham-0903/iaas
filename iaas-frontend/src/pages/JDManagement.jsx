import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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

const JD_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED']

const DEFAULT_FORM = {
  title: '',
  client_id: '',
  raw_text: '',
}

export default function JDManagement() {
  const navigate = useNavigate()
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

  function getStatusBadgeClass(status) {
    if (status === 'ACTIVE') return 'badge badge-green'
    if (status === 'CLOSED') return 'badge badge-red'
    return 'badge badge-gray'
  }

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
    <AppShell>
      <div className="topbar">
        <h1>Job Descriptions</h1>
        <button className="btn btn-primary" onClick={openModal} type="button">
          New JD
        </button>
      </div>

      {error ? <div className="login-error">{error}</div> : null}
      {success ? <div className="card section-copy section-copy-left">{success}</div> : null}

      <div className="card">
        {isLoading ? (
          <div className="loading-state">
            <div className="loading-spinner" aria-label="Loading JDs" />
            <span>Loading job descriptions...</span>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Job Code</th>
                <th>Client</th>
                <th>Status</th>
                <th>Created Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jds.map((jd) => (
                <tr key={jd.id}>
                  <td className="table-title-cell">{jd.title}</td>
                  <td>{jd.job_code || '—'}</td>
                  <td>{clientMap.get(jd.client_id) || `Client #${jd.client_id}`}</td>
                  <td>
                    <div className="jd-status-cell">
                      <span className={getStatusBadgeClass(jd.status)}>{jd.status}</span>
                      <select
                        className="jd-status-select"
                        value={jd.status}
                        disabled={isStatusSavingId === jd.id}
                        onChange={(event) => handleStatusChange(jd.id, event.target.value)}
                      >
                        {JD_STATUSES.map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>{new Date(jd.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="topbar-actions">
                      <button
                        className="btn table-action-btn"
                        onClick={() => handleExtractSkills(jd.id)}
                        disabled={isExtractingId === jd.id}
                        type="button"
                      >
                        {isExtractingId === jd.id ? 'Extracting...' : 'Extract Skills'}
                      </button>
                      <button
                        className="btn table-action-btn"
                        onClick={() => navigate(`/skill-extraction/${jd.id}`)}
                        type="button"
                      >
                        View
                      </button>
                      <button
                        className="btn table-action-btn"
                        onClick={() => handleDownloadFile(jd)}
                        type="button"
                        disabled={!jd.file_url}
                        title={jd.file_url ? 'Download uploaded JD file' : 'No uploaded file'}
                      >
                        Download
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isModalOpen ? (
        <div className="modal-overlay" role="presentation" onClick={closeModal}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="card-title">Create New JD</div>
            <form onSubmit={handleCreateJD}>
              <div className="form-group">
                <label className="form-label" htmlFor="jd-title">Title</label>
                <input
                  id="jd-title"
                  name="title"
                  type="text"
                  value={formData.title}
                  onChange={handleFieldChange}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="jd-client">Client</label>
                <select
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
                </select>
              </div>

              <div className="form-group">
                <div className="file-mode-toggle">
                  <label>
                    <input
                      checked={formMode === 'paste'}
                      onChange={() => handleModeChange('paste')}
                      type="radio"
                    />
                    Paste text
                  </label>
                  <label>
                    <input
                      checked={formMode === 'upload'}
                      onChange={() => handleModeChange('upload')}
                      type="radio"
                    />
                    Upload file
                  </label>
                </div>
              </div>

              {formMode === 'paste' ? (
                <div className="form-group">
                  <label className="form-label" htmlFor="jd-raw-text">Paste JD text</label>
                  <textarea
                    id="jd-raw-text"
                    name="raw_text"
                    rows="6"
                    value={formData.raw_text}
                    onChange={handleFieldChange}
                    placeholder="Paste job description text here..."
                  />
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label" htmlFor="jd-file">Upload .pdf or .docx</label>
                  <input
                    id="jd-file"
                    type="file"
                    accept=".pdf,.docx"
                    onChange={(event) => {
                      setSelectedFile(event.target.files?.[0] || null)
                    }}
                  />
                </div>
              )}

              <div className="topbar-actions">
                <button className="btn btn-primary" disabled={isSaving} type="submit">
                  {isSaving ? 'Saving...' : 'Save JD'}
                </button>
                <button className="btn" disabled={isSaving} onClick={closeModal} type="button">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}
