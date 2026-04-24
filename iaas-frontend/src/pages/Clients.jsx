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
import {
  AlertBanner, Avatar, Badge, Card, CardTitle, DangerBtn, DataTable,
  EmptyState, FormField, FormInput, FormSelect, LoadingState,
  ModalOverlay, PrimaryBtn, SecondaryBtn, TableCell, TableRow,
} from '../components/ui'

const DEFAULT_FORM = {
  name: '',
  industry: '',
  contact_email: '',
  is_active: true,
}

function ClientForm({
  formData,
  getErrorText,
  handleChange,
  isSubmitting,
  onSubmit,
  onCancel,
  submitLabel,
  submittingLabel,
}) {
  return (
    <form onSubmit={onSubmit}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Client Name" htmlFor="client_name" error={getErrorText('name')}>
          <FormInput id="client_name" name="name" type="text" value={formData.name} onChange={handleChange} required />
        </FormField>
        <FormField label="Industry" htmlFor="client_industry" error={getErrorText('industry')}>
          <FormInput id="client_industry" name="industry" type="text" value={formData.industry} onChange={handleChange} required />
        </FormField>
      </div>
      <FormField label="Contact Email" htmlFor="client_email" error={getErrorText('contact_email')}>
        <FormInput id="client_email" name="contact_email" type="email" value={formData.contact_email} onChange={handleChange} required />
      </FormField>
      <div className="flex items-center gap-2 mb-4">
        <input
          id="client_is_active"
          name="is_active"
          type="checkbox"
          checked={formData.is_active}
          onChange={handleChange}
          className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
        />
        <label htmlFor="client_is_active" className="text-sm text-slate-700 font-medium cursor-pointer">Active client</label>
      </div>
      <div className="flex gap-2 pt-1">
        <PrimaryBtn type="submit" loading={isSubmitting}>
          {isSubmitting ? submittingLabel : submitLabel}
        </PrimaryBtn>
        <SecondaryBtn onClick={onCancel} disabled={isSubmitting}>Cancel</SecondaryBtn>
      </div>
    </form>
  )
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
    <AppShell pageTitle="Clients" pageSubtitle="Manage client accounts and their associated JDs">
      {/* Topbar */}
      <div className="flex items-center justify-between mb-5">
        <div />
        <PrimaryBtn
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
        </PrimaryBtn>
      </div>

      <AlertBanner type="error" message={error} />
      <AlertBanner type="success" message={success} />

      {/* Create form */}
      {showCreateForm && (
        <Card>
          <CardTitle>Create Client</CardTitle>
          <ClientForm
            formData={formData}
            getErrorText={getErrorText}
            handleChange={handleChange}
            isSubmitting={isSubmitting}
            onSubmit={handleCreateClient}
            onCancel={resetForm}
            submitLabel="Create Client"
            submittingLabel="Creating..."
          />
        </Card>
      )}

      {/* Edit form */}
      {editingClient && (
        <Card>
          <CardTitle>Edit Client — {editingClient.name}</CardTitle>
          <ClientForm
            formData={formData}
            getErrorText={getErrorText}
            handleChange={handleChange}
            isSubmitting={isSubmitting}
            onSubmit={handleUpdateClient}
            onCancel={resetForm}
            submitLabel="Save Changes"
            submittingLabel="Saving..."
          />
        </Card>
      )}

      {/* Delete confirmation */}
      {deletingClientId && (
        <Card>
          <CardTitle>Delete Client</CardTitle>
          <p className="text-sm text-slate-600 mb-4">Deleting a client is blocked if it has linked JDs or candidates.</p>
          <div className="flex gap-2">
            <DangerBtn onClick={() => handleDeleteClient(deletingClientId)} loading={isSubmitting}>
              {isSubmitting ? 'Deleting...' : 'Confirm Delete'}
            </DangerBtn>
            <SecondaryBtn onClick={() => setDeletingClientId(null)} disabled={isSubmitting}>Cancel</SecondaryBtn>
          </div>
        </Card>
      )}

      {/* Table */}
      <Card>
        <DataTable
          headers={['Client', 'Industry', 'Contact Email', 'Status', 'JDs', 'Candidates', 'Selected', 'Not Selected', 'Actions']}
          loading={isLoading}
          loadingLabel="Loading clients..."
        >
          {clients.length === 0 && !isLoading ? (
            <tr><td colSpan={9}><EmptyState message="No clients found" /></td></tr>
          ) : (
            clients.map((client) => (
              <TableRow key={client.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={client.name} />
                    <span className="font-medium text-slate-900">{client.name}</span>
                  </div>
                </TableCell>
                <TableCell>{client.industry}</TableCell>
                <TableCell className="text-slate-500">{client.contact_email}</TableCell>
                <TableCell>
                  <Badge variant={client.is_active ? 'green' : 'gray'}>
                    {client.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell><span className="font-semibold text-slate-800">{client.metrics?.jd_count ?? 0}</span></TableCell>
                <TableCell><span className="font-semibold text-slate-800">{client.metrics?.candidate_count ?? 0}</span></TableCell>
                <TableCell><span className="font-semibold text-emerald-600">{client.metrics?.selected_count ?? 0}</span></TableCell>
                <TableCell><span className="font-semibold text-red-500">{client.metrics?.not_selected_count ?? 0}</span></TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleEditClick(client)}
                      className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeletingClientId(client.id)
                        setShowCreateForm(false)
                        setEditingClient(null)
                      }}
                      className="text-xs bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/jd')}
                      className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                    >
                      JDs
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/candidates?clientId=${client.id}`)}
                      className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                    >
                      Candidates
                    </button>
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
