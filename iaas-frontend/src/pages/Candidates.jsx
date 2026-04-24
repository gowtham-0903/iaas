import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { createCandidate, deleteCandidate, getCandidates, updateCandidate } from '../api/candidatesApi'
import { getClients } from '../api/clientsApi'
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
    <AppShell pageTitle="Candidates" pageSubtitle="Track and manage interview candidates">
      <div className="flex items-center justify-between mb-5">
        <div />
        <PrimaryBtn
          onClick={() => {
            setShowCreateForm((previous) => !previous)
            setFormData({ ...DEFAULT_FORM, client_id: selectedClientId || '' })
            setError('')
            setSuccess('')
          }}
        >
          {showCreateForm ? 'Close' : '+ Add Candidate'}
        </PrimaryBtn>
      </div>

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
        </Card>
      )}

      {/* Candidates table */}
      <Card>
        <DataTable
          headers={['Name', 'Email', 'Client', 'Job Description', 'Status', 'Actions']}
          loading={isLoading}
          loadingLabel="Loading candidates..."
        >
          {candidates.length === 0 && !isLoading ? (
            <tr><td colSpan={6}><EmptyState message="No candidates found" /></td></tr>
          ) : (
            candidates.map((candidate) => (
              <TableRow key={candidate.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={candidate.full_name} />
                    <span className="font-medium text-slate-900">{candidate.full_name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-slate-500">{candidate.email}</TableCell>
                <TableCell>{clientMap.get(candidate.client_id) || `Client #${candidate.client_id}`}</TableCell>
                <TableCell className="max-w-[180px]">
                  <div className="truncate text-slate-600">{jdMap.get(candidate.jd_id)?.title || `JD #${candidate.jd_id}`}</div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANTS[candidate.status] || 'gray'}>{candidate.status}</Badge>
                    <select
                      value={candidate.status}
                      onChange={(event) => handleStatusChange(candidate.id, event.target.value)}
                      className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-700"
                    >
                      {CANDIDATE_STATUSES.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </div>
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => handleDeleteCandidate(candidate.id)}
                    className="text-xs bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                  >
                    Delete
                  </button>
                </TableCell>
              </TableRow>
            ))
          )}
        </DataTable>
      </Card>
    </AppShell>
  )
}
