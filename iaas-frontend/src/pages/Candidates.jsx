import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { createCandidate, deleteCandidate, getCandidates, updateCandidate } from '../api/candidatesApi'
import { getClients } from '../api/clientsApi'
import { getJDs } from '../api/jdApi'
import AppShell from '../components/AppShell'

const CANDIDATE_STATUSES = ['APPLIED', 'SHORTLISTED', 'INTERVIEWED', 'SELECTED', 'NOT_SELECTED']

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

  const [clients, setClients] = useState([])
  const [jds, setJDs] = useState([])
  const [candidates, setCandidates] = useState([])
  const [selectedClientId, setSelectedClientId] = useState(initialClientId)
  const [selectedJdId, setSelectedJdId] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [formData, setFormData] = useState({ ...DEFAULT_FORM, client_id: initialClientId })
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

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

      const candidatesResponse = await getCandidates(candidateParams)
      setCandidates(candidatesResponse.data?.candidates ?? [])
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

  function getStatusBadgeClass(status) {
    if (status === 'SELECTED') return 'badge badge-green'
    if (status === 'NOT_SELECTED') return 'badge badge-red'
    if (status === 'INTERVIEWED') return 'badge badge-amber'
    if (status === 'SHORTLISTED') return 'badge badge-blue'
    return 'badge badge-gray'
  }

  function resetForm() {
    setFormData({ ...DEFAULT_FORM, client_id: selectedClientId || '' })
    setShowCreateForm(false)
  }

  async function handleCreateCandidate(event) {
    event.preventDefault()

    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')

      await createCandidate({
        client_id: Number(formData.client_id),
        jd_id: Number(formData.jd_id),
        full_name: formData.full_name,
        email: formData.email,
        status: formData.status,
      })

      await loadData()
      setSuccess('Candidate created successfully.')
      resetForm()
    } catch (createError) {
      setError(createError?.response?.data?.error || 'Failed to create candidate.')
    } finally {
      setIsSubmitting(false)
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
    <AppShell>
      <div className="topbar">
        <h1>Candidates</h1>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => {
            setShowCreateForm((previous) => !previous)
            setFormData({ ...DEFAULT_FORM, client_id: selectedClientId || '' })
            setError('')
            setSuccess('')
          }}
        >
          {showCreateForm ? 'Close' : '+ Add Candidate'}
        </button>
      </div>

      {error ? <div className="login-error">{error}</div> : null}
      {success ? <div className="card section-copy section-copy-left">{success}</div> : null}

      <div className="card">
        <div className="two-col">
          <div className="form-group">
            <label className="form-label" htmlFor="candidate_filter_client">Filter by Client</label>
            <select
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
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="candidate_filter_jd">Filter by JD</label>
            <select
              id="candidate_filter_jd"
              value={selectedJdId}
              onChange={(event) => setSelectedJdId(event.target.value)}
            >
              <option value="">All job descriptions</option>
              {filteredJds.map((jd) => (
                <option key={jd.id} value={jd.id}>{jd.title}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {showCreateForm ? (
        <div className="card">
          <div className="card-title">Create Candidate</div>
          <form onSubmit={handleCreateCandidate}>
            <div className="two-col">
              <div className="form-group">
                <label className="form-label" htmlFor="candidate_client_id">Client</label>
                <select
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
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="candidate_jd_id">Job Description</label>
                <select
                  id="candidate_jd_id"
                  value={formData.jd_id}
                  onChange={(event) => setFormData((previous) => ({ ...previous, jd_id: event.target.value }))}
                  required
                >
                  <option value="">Select JD</option>
                  {jdsForForm.map((jd) => (
                    <option key={jd.id} value={jd.id}>{jd.title}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="two-col">
              <div className="form-group">
                <label className="form-label" htmlFor="candidate_full_name">Full Name</label>
                <input
                  id="candidate_full_name"
                  type="text"
                  value={formData.full_name}
                  onChange={(event) => setFormData((previous) => ({ ...previous, full_name: event.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="candidate_email">Email</label>
                <input
                  id="candidate_email"
                  type="email"
                  value={formData.email}
                  onChange={(event) => setFormData((previous) => ({ ...previous, email: event.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="candidate_status">Initial Status</label>
              <select
                id="candidate_status"
                value={formData.status}
                onChange={(event) => setFormData((previous) => ({ ...previous, status: event.target.value }))}
              >
                {CANDIDATE_STATUSES.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>

            <div className="topbar-actions">
              <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Candidate'}
              </button>
              <button className="btn" type="button" onClick={resetForm} disabled={isSubmitting}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="card">
        {isLoading ? (
          <div className="loading-state">
            <div className="loading-spinner" aria-label="Loading candidates" />
            <span>Loading candidates...</span>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Client</th>
                <th>JD</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.id}>
                  <td className="table-title-cell">{candidate.full_name}</td>
                  <td>{candidate.email}</td>
                  <td>{clientMap.get(candidate.client_id) || `Client #${candidate.client_id}`}</td>
                  <td>{jdMap.get(candidate.jd_id)?.title || `JD #${candidate.jd_id}`}</td>
                  <td>
                    <div className="jd-status-cell">
                      <span className={getStatusBadgeClass(candidate.status)}>{candidate.status}</span>
                      <select
                        className="jd-status-select"
                        value={candidate.status}
                        onChange={(event) => handleStatusChange(candidate.id, event.target.value)}
                      >
                        {CANDIDATE_STATUSES.map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>
                    <button
                      className="btn btn-danger table-action-btn"
                      type="button"
                      onClick={() => handleDeleteCandidate(candidate.id)}
                    >
                      Delete
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
