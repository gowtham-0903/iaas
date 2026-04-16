import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { getClients } from '../api/clientsApi'
import { createJD, getJDs, uploadJDFile } from '../api/jdApi'
import AppShell from '../components/AppShell'

const DEFAULT_FORM = {
  title: '',
  client_id: '',
  raw_text: '',
}

export default function SkillExtractionHub() {
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [jds, setJds] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [formMode, setFormMode] = useState('paste')
  const [selectedFile, setSelectedFile] = useState(null)
  const [formData, setFormData] = useState(DEFAULT_FORM)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const clientMap = useMemo(() => {
    return new Map(clients.map((client) => [client.id, client.name]))
  }, [clients])

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      try {
        setIsLoading(true)
        setError('')

        const [clientsResponse, jdsResponse] = await Promise.all([
          getClients(),
          getJDs(),
        ])

        if (!isMounted) return

        setClients(clientsResponse.data?.clients ?? [])
        setJds(jdsResponse.data?.jds ?? [])
      } catch (_loadError) {
        if (!isMounted) return
        setError('Unable to load AI Skill Extraction data.')
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

  function getStatusBadgeClass(status) {
    if (status === 'ACTIVE') return 'badge badge-green'
    if (status === 'CLOSED') return 'badge badge-red'
    return 'badge badge-gray'
  }

  async function handleCreateOpening(event) {
    event.preventDefault()

    if (!formData.title.trim() || !formData.client_id) {
      setError('Title and client are required.')
      return
    }

    if (formMode === 'upload' && !selectedFile) {
      setError('Please choose a .pdf or .docx file.')
      return
    }

    try {
      setIsSaving(true)
      setError('')
      setSuccess('')

      const createPayload = {
        title: formData.title.trim(),
        client_id: Number(formData.client_id),
        raw_text: formMode === 'paste' ? (formData.raw_text || '').trim() : null,
      }

      const createResponse = await createJD(createPayload)
      const createdJD = createResponse.data?.jd

      if (formMode === 'upload' && selectedFile && createdJD?.id) {
        await uploadJDFile(createdJD.id, selectedFile)
      }

      const jdsResponse = await getJDs()
      setJds(jdsResponse.data?.jds ?? [])
      setSuccess('Opening created. Continue to extraction.')
      resetForm()

      if (createdJD?.id) {
        navigate(`/skill-extraction/${createdJD.id}`)
      }
    } catch (createError) {
      const apiError = createError?.response?.data
      if (apiError?.errors?.file) {
        setError(apiError.errors.file[0])
      } else {
        setError(apiError?.error || apiError?.message || 'Failed to create opening.')
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AppShell>
      <div className="topbar">
        <h1>AI Skill Extraction</h1>
      </div>

      {error ? <div className="login-error">{error}</div> : null}
      {success ? <div className="card section-copy section-copy-left">{success}</div> : null}

      <div className="card">
        <div className="card-title">Create New Opening</div>
        <form onSubmit={handleCreateOpening}>
          <div className="form-group">
            <label className="form-label" htmlFor="se-title">Title</label>
            <input
              id="se-title"
              name="title"
              type="text"
              value={formData.title}
              onChange={(event) => setFormData((prev) => ({ ...prev, title: event.target.value }))}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="se-client">Client</label>
            <select
              id="se-client"
              name="client_id"
              value={formData.client_id}
              onChange={(event) => setFormData((prev) => ({ ...prev, client_id: event.target.value }))}
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
                  onChange={() => {
                    setFormMode('paste')
                    setSelectedFile(null)
                  }}
                  type="radio"
                />
                Paste text
              </label>
              <label>
                <input
                  checked={formMode === 'upload'}
                  onChange={() => {
                    setFormMode('upload')
                    setSelectedFile(null)
                  }}
                  type="radio"
                />
                Upload file
              </label>
            </div>
          </div>

          {formMode === 'paste' ? (
            <div className="form-group">
              <label className="form-label" htmlFor="se-raw-text">JD text</label>
              <textarea
                id="se-raw-text"
                rows="6"
                value={formData.raw_text}
                onChange={(event) => setFormData((prev) => ({ ...prev, raw_text: event.target.value }))}
                placeholder="Paste job description here..."
              />
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label" htmlFor="se-file">Upload .pdf or .docx</label>
              <input
                id="se-file"
                type="file"
                accept=".pdf,.docx"
                onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
              />
            </div>
          )}

          <div className="topbar-actions">
            <button className="btn btn-primary" type="submit" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Create Opening'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-title">Existing Openings</div>
        {isLoading ? (
          <div className="loading-state">
            <div className="loading-spinner" aria-label="Loading openings" />
            <span>Loading openings...</span>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Client</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jds.map((jd) => (
                <tr key={jd.id}>
                  <td className="table-title-cell">{jd.title}</td>
                  <td>{clientMap.get(jd.client_id) || `Client #${jd.client_id}`}</td>
                  <td><span className={getStatusBadgeClass(jd.status)}>{jd.status}</span></td>
                  <td>{new Date(jd.created_at).toLocaleDateString()}</td>
                  <td>
                    <button
                      className="btn table-action-btn"
                      type="button"
                      onClick={() => navigate(`/skill-extraction/${jd.id}`)}
                    >
                      Open Extraction
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  )
}
