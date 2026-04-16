import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  createClient,
  deleteClient,
  getClients,
  updateClient,
} from '../api/clientsApi'
import { getCandidates } from '../api/candidatesApi'
import { getJDs } from '../api/jdApi'
import AppShell from '../components/AppShell'

const DEFAULT_FORM = {
  name: '',
  industry: '',
  contact_email: '',
  is_active: true,
}

function enrichClientsWithMetrics(clients, jds, candidates) {
  const jdCountByClient = {}
  const candidateCountByClient = {}
  const selectedCountByClient = {}
  const notSelectedCountByClient = {}

  for (const jd of jds) {
    if (!jd?.client_id) continue
    jdCountByClient[jd.client_id] = (jdCountByClient[jd.client_id] || 0) + 1
  }

  for (const candidate of candidates) {
    if (!candidate?.client_id) continue
    candidateCountByClient[candidate.client_id] = (candidateCountByClient[candidate.client_id] || 0) + 1

    if (candidate.status === 'SELECTED') {
      selectedCountByClient[candidate.client_id] = (selectedCountByClient[candidate.client_id] || 0) + 1
    }
    if (candidate.status === 'NOT_SELECTED') {
      notSelectedCountByClient[candidate.client_id] = (notSelectedCountByClient[candidate.client_id] || 0) + 1
    }
  }

  return clients.map((client) => {
    const backendMetrics = client.metrics || {}
    return {
      ...client,
      metrics: {
        jd_count: jdCountByClient[client.id] ?? backendMetrics.jd_count ?? 0,
        candidate_count: candidateCountByClient[client.id] ?? backendMetrics.candidate_count ?? 0,
        selected_count: selectedCountByClient[client.id] ?? backendMetrics.selected_count ?? 0,
        not_selected_count:
          notSelectedCountByClient[client.id] ?? backendMetrics.not_selected_count ?? 0,
      },
    }
  })
}

export default function Clients() {
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingClient, setEditingClient] = useState(null)
  const [deletingClientId, setDeletingClientId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [formData, setFormData] = useState(DEFAULT_FORM)
  const [formErrors, setFormErrors] = useState({})

  useEffect(() => {
    let isMounted = true

    async function loadClients() {
      try {
        setIsLoading(true)
        setError('')

        const [clientsResponse, jdsResponse, candidatesResponse] = await Promise.all([
          getClients(),
          getJDs(),
          getCandidates().catch(() => ({ data: { candidates: [] } })),
        ])

        if (!isMounted) return

        const clientsData = clientsResponse.data?.clients ?? []
        const jdsData = jdsResponse.data?.jds ?? []
        const candidatesData = candidatesResponse.data?.candidates ?? []

        setClients(enrichClientsWithMetrics(clientsData, jdsData, candidatesData))
      } catch (_loadError) {
        if (!isMounted) return
        setError('Unable to load clients.')
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadClients()

    return () => {
      isMounted = false
    }
  }, [])

  function getErrorText(field) {
    const value = formErrors[field]
    if (!value) return ''
    return Array.isArray(value) ? value[0] : value
  }

  function handleChange(event) {
    const { name, type, value, checked } = event.target
    setFormData((previous) => ({
      ...previous,
      [name]: type === 'checkbox' ? checked : value,
    }))

    if (formErrors[name]) {
      setFormErrors((previous) => ({
        ...previous,
        [name]: null,
      }))
    }
  }

  async function refreshClients() {
    const [clientsResponse, jdsResponse, candidatesResponse] = await Promise.all([
      getClients(),
      getJDs(),
      getCandidates().catch(() => ({ data: { candidates: [] } })),
    ])

    const clientsData = clientsResponse.data?.clients ?? []
    const jdsData = jdsResponse.data?.jds ?? []
    const candidatesData = candidatesResponse.data?.candidates ?? []

    setClients(enrichClientsWithMetrics(clientsData, jdsData, candidatesData))
  }

  function resetForm() {
    setFormData(DEFAULT_FORM)
    setFormErrors({})
    setEditingClient(null)
    setShowCreateForm(false)
  }

  async function handleCreateClient(event) {
    event.preventDefault()

    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')
      setFormErrors({})

      await createClient(formData)
      await refreshClients()
      setSuccess('Client created successfully.')
      resetForm()
    } catch (createError) {
      const validationErrors = createError?.response?.data?.errors
      if (validationErrors) {
        setFormErrors(validationErrors)
      } else {
        setError(createError?.response?.data?.error || 'Failed to create client.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleEditClick(client) {
    setEditingClient(client)
    setShowCreateForm(false)
    setDeletingClientId(null)
    setError('')
    setSuccess('')
    setFormErrors({})
    setFormData({
      name: client.name || '',
      industry: client.industry || '',
      contact_email: client.contact_email || '',
      is_active: client.is_active,
    })
  }

  async function handleUpdateClient(event) {
    event.preventDefault()

    if (!editingClient) return

    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')
      setFormErrors({})

      await updateClient(editingClient.id, formData)
      await refreshClients()
      setSuccess('Client updated successfully.')
      resetForm()
    } catch (updateError) {
      const validationErrors = updateError?.response?.data?.errors
      if (validationErrors) {
        setFormErrors(validationErrors)
      } else {
        setError(updateError?.response?.data?.error || 'Failed to update client.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDeleteClient(clientId) {
    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')

      await deleteClient(clientId)
      await refreshClients()
      setDeletingClientId(null)
      setSuccess('Client deleted successfully.')
    } catch (deleteError) {
      setError(deleteError?.response?.data?.error || 'Failed to delete client.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AppShell>
      <div className="topbar">
        <h1>Clients</h1>
        <div className="topbar-actions">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setShowCreateForm((previous) => !previous)
              setEditingClient(null)
              setDeletingClientId(null)
              setError('')
              setSuccess('')
              setFormErrors({})
              setFormData(DEFAULT_FORM)
            }}
          >
            {showCreateForm ? 'Close' : '+ Add Client'}
          </button>
        </div>
      </div>

      {error ? <div className="login-error">{error}</div> : null}
      {success ? <div className="card section-copy section-copy-left">{success}</div> : null}

      {showCreateForm ? (
        <div className="card">
          <div className="card-title">Create Client</div>
          <form onSubmit={handleCreateClient}>
            <div className="form-group">
              <label className="form-label" htmlFor="client_name">Client Name</label>
              <input
                id="client_name"
                name="name"
                type="text"
                value={formData.name}
                onChange={handleChange}
                required
              />
              {getErrorText('name') ? <div className="section-copy section-copy-left">{getErrorText('name')}</div> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="client_industry">Industry</label>
              <input
                id="client_industry"
                name="industry"
                type="text"
                value={formData.industry}
                onChange={handleChange}
                required
              />
              {getErrorText('industry') ? <div className="section-copy section-copy-left">{getErrorText('industry')}</div> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="client_email">Contact Email</label>
              <input
                id="client_email"
                name="contact_email"
                type="email"
                value={formData.contact_email}
                onChange={handleChange}
                required
              />
              {getErrorText('contact_email') ? <div className="section-copy section-copy-left">{getErrorText('contact_email')}</div> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="client_is_active">
                <input
                  id="client_is_active"
                  name="is_active"
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={handleChange}
                />
                {' '}
                Active
              </label>
            </div>

            <div className="topbar-actions">
              <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Client'}
              </button>
              <button
                className="btn"
                type="button"
                onClick={resetForm}
                disabled={isSubmitting}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editingClient ? (
        <div className="card">
          <div className="card-title">Edit Client</div>
          <form onSubmit={handleUpdateClient}>
            <div className="form-group">
              <label className="form-label" htmlFor="edit_client_name">Client Name</label>
              <input
                id="edit_client_name"
                name="name"
                type="text"
                value={formData.name}
                onChange={handleChange}
                required
              />
              {getErrorText('name') ? <div className="section-copy section-copy-left">{getErrorText('name')}</div> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="edit_client_industry">Industry</label>
              <input
                id="edit_client_industry"
                name="industry"
                type="text"
                value={formData.industry}
                onChange={handleChange}
                required
              />
              {getErrorText('industry') ? <div className="section-copy section-copy-left">{getErrorText('industry')}</div> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="edit_client_email">Contact Email</label>
              <input
                id="edit_client_email"
                name="contact_email"
                type="email"
                value={formData.contact_email}
                onChange={handleChange}
                required
              />
              {getErrorText('contact_email') ? <div className="section-copy section-copy-left">{getErrorText('contact_email')}</div> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="edit_client_is_active">
                <input
                  id="edit_client_is_active"
                  name="is_active"
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={handleChange}
                />
                {' '}
                Active
              </label>
            </div>

            <div className="topbar-actions">
              <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                className="btn"
                type="button"
                onClick={resetForm}
                disabled={isSubmitting}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {deletingClientId ? (
        <div className="card">
          <div className="card-title">Delete Client</div>
          <p className="section-copy section-copy-left">
            Deleting a client is blocked if it has linked JDs or candidates.
          </p>
          <div className="topbar-actions">
            <button
              className="btn btn-danger"
              type="button"
              onClick={() => handleDeleteClient(deletingClientId)}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Deleting...' : 'Confirm Delete'}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => setDeletingClientId(null)}
              disabled={isSubmitting}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="card">
        {isLoading ? (
          <div className="loading-state">
            <div className="loading-spinner" aria-label="Loading clients" />
            <span>Loading clients...</span>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Industry</th>
                <th>Contact Email</th>
                <th>Status</th>
                <th>JDs</th>
                <th>Candidates</th>
                <th>Selected</th>
                <th>Not Selected</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td className="table-title-cell">{client.name}</td>
                  <td>{client.industry}</td>
                  <td>{client.contact_email}</td>
                  <td>
                    <span className={client.is_active ? 'badge badge-green' : 'badge badge-gray'}>
                      {client.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{client.metrics?.jd_count ?? 0}</td>
                  <td>{client.metrics?.candidate_count ?? 0}</td>
                  <td>{client.metrics?.selected_count ?? 0}</td>
                  <td>{client.metrics?.not_selected_count ?? 0}</td>
                  <td>
                    <div className="topbar-actions">
                      <button className="btn table-action-btn" onClick={() => handleEditClick(client)} type="button">
                        Edit
                      </button>
                      <button
                        className="btn btn-danger table-action-btn"
                        onClick={() => {
                          setDeletingClientId(client.id)
                          setShowCreateForm(false)
                          setEditingClient(null)
                        }}
                        type="button"
                      >
                        Delete
                      </button>
                      <button
                        className="btn table-action-btn"
                        onClick={() => navigate('/jd')}
                        type="button"
                      >
                        JDs
                      </button>
                      <button
                        className="btn table-action-btn"
                        onClick={() => navigate(`/candidates?clientId=${client.id}`)}
                        type="button"
                      >
                        Candidates
                      </button>
                    </div>
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
