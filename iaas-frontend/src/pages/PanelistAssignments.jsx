import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'

import AppShell from '../components/AppShell'
import {
  AlertBanner,
  Card,
  CardTitle,
  DangerBtn,
  DataTable,
  EmptyState,
  FormField,
  FormInput,
  FormSelect,
  LoadingState,
  PrimaryBtn,
  SecondaryBtn,
  TableCell,
  TableRow,
} from '../components/ui'
import { getClients } from '../api/clientsApi'
import { getJDs } from '../api/jdApi'
import { getUsers } from '../api/usersApi'
import {
  createPanelistAssignment,
  deletePanelistAssignment,
  getPanelistAssignments,
  importPanelistAssignments,
} from '../api/panelistAssignmentsApi'
import useAuthStore from '../store/authStore'

const DEFAULT_FORM = {
  client_id: '',
  jd_id: '',
  panelist_id: '',
}

export default function PanelistAssignments() {
  const currentUser = useAuthStore((state) => state.user)
  const currentUserRole = currentUser?.role
  const canViewPage = ['ADMIN', 'M_RECRUITER', 'SR_RECRUITER', 'OPERATOR'].includes(currentUserRole)
  const fixedClientId = ['M_RECRUITER', 'SR_RECRUITER'].includes(currentUserRole) ? String(currentUser?.client_id || '') : ''

  const [assignments, setAssignments] = useState([])
  const [clients, setClients] = useState([])
  const [jds, setJDs] = useState([])
  const [panelists, setPanelists] = useState([])
  const [selectedClientId, setSelectedClientId] = useState(fixedClientId)
  const [selectedJdId, setSelectedJdId] = useState('')
  const [showAssignForm, setShowAssignForm] = useState(false)
  const [assignForm, setAssignForm] = useState(() => ({ ...DEFAULT_FORM, client_id: fixedClientId }))
  const [importFile, setImportFile] = useState(null)
  const [importResults, setImportResults] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const filteredJds = useMemo(() => {
    if (!selectedClientId) return jds
    return jds.filter((jd) => String(jd.client_id) === String(selectedClientId))
  }, [jds, selectedClientId])

  async function loadAssignments(clientId = selectedClientId, jdId = selectedJdId) {
    if (!clientId && currentUserRole !== 'ADMIN' && currentUserRole !== 'OPERATOR') {
      return
    }

    const response = await getPanelistAssignments({
      ...(clientId ? { client_id: Number(clientId) } : {}),
      ...(jdId ? { jd_id: Number(jdId) } : {}),
    })
    setAssignments(response.data?.assignments || [])
  }

  useEffect(() => {
    if (!canViewPage) return
    let active = true

    async function loadData() {
      try {
        setIsLoading(true)
        setError('')
        const [clientsResponse, jdsResponse, usersResponse] = await Promise.all([
          getClients(),
          getJDs(),
          getUsers(),
        ])

        if (!active) return

        const nextClients = clientsResponse.data?.clients || []
        const nextJds = jdsResponse.data?.jds || []
        const nextUsers = Array.isArray(usersResponse.data) ? usersResponse.data : usersResponse.data?.users || []
        setClients(nextClients)
        setJDs(nextJds)
        setPanelists(nextUsers.filter((entry) => entry.role === 'PANELIST'))
        await loadAssignments(fixedClientId, '')
      } catch (_loadError) {
        if (active) setError('Failed to load panelist assignment data.')
      } finally {
        if (active) setIsLoading(false)
      }
    }

    loadData()
    return () => {
      active = false
    }
  }, [canViewPage, fixedClientId])

  async function handleFilterChange(nextClientId, nextJdId) {
    setSelectedClientId(nextClientId)
    setSelectedJdId(nextJdId)
    try {
      setError('')
      await loadAssignments(nextClientId, nextJdId)
    } catch (_error) {
      setError('Failed to load assignments for the selected filters.')
    }
  }

  async function handleCreateAssignment(event) {
    event.preventDefault()
    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')
      await createPanelistAssignment({
        client_id: Number(assignForm.client_id),
        jd_id: Number(assignForm.jd_id),
        panelist_id: Number(assignForm.panelist_id),
      })
      await loadAssignments(assignForm.client_id, selectedJdId)
      setSuccess('Panelist assigned successfully.')
      setAssignForm({ ...DEFAULT_FORM, client_id: assignForm.client_id })
      setShowAssignForm(false)
    } catch (submitError) {
      setError(submitError?.response?.data?.error || submitError?.response?.data?.message || 'Failed to assign panelist.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDeleteAssignment(assignmentId) {
    try {
      setError('')
      await deletePanelistAssignment(assignmentId)
      await loadAssignments(selectedClientId, selectedJdId)
      setSuccess('Assignment removed.')
    } catch (_deleteError) {
      setError('Failed to remove assignment.')
    }
  }

  async function handleImportAssignments() {
    if (!importFile) {
      setError('Please select an .xlsx or .csv file first.')
      return
    }

    try {
      setIsImporting(true)
      setError('')
      setSuccess('')
      const response = await importPanelistAssignments(importFile)
      setImportResults(response.data)
      await loadAssignments(selectedClientId, selectedJdId)
      setSuccess(`Import complete: ${response.data?.success || 0} assigned, ${response.data?.errors || 0} errors.`)
    } catch (importError) {
      setError(importError?.response?.data?.errors?.file?.[0] || importError?.response?.data?.error || 'Failed to import assignments.')
    } finally {
      setIsImporting(false)
    }
  }

  function downloadTemplate() {
    const worksheet = XLSX.utils.json_to_sheet([
      { panelist_email: 'panelist@meedenlabs.com', jd_code: 'JD-2026-0001', client_name: 'Acme Inc' },
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Assignments')
    XLSX.writeFile(workbook, 'panelist_assignment_template.xlsx')
  }

  if (!canViewPage) {
    return (
      <AppShell>
        <AlertBanner type="error" message="You do not have access to this page." />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <AlertBanner type="error" message={error} />
      <AlertBanner type="success" message={success} />

      <Card>
        <CardTitle>Filters</CardTitle>
        {isLoading ? (
          <LoadingState label="Loading filters..." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Client" htmlFor="assignment_client">
              <FormSelect
                id="assignment_client"
                value={selectedClientId}
                disabled={Boolean(fixedClientId)}
                onChange={(event) => {
                  const nextClientId = event.target.value
                  handleFilterChange(nextClientId, '')
                  setAssignForm((previous) => ({ ...previous, client_id: nextClientId, jd_id: '' }))
                }}
              >
                <option value="">All clients</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </FormSelect>
            </FormField>
            <FormField label="Job Description" htmlFor="assignment_jd">
              <FormSelect
                id="assignment_jd"
                value={selectedJdId}
                onChange={(event) => handleFilterChange(selectedClientId, event.target.value)}
              >
                <option value="">All JDs</option>
                {filteredJds.map((jd) => (
                  <option key={jd.id} value={jd.id}>{jd.title}</option>
                ))}
              </FormSelect>
            </FormField>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3 mb-4">
          <CardTitle>Manual Assignment</CardTitle>
          <PrimaryBtn onClick={() => setShowAssignForm((previous) => !previous)}>
            {showAssignForm ? 'Close' : '+ Assign Panelist'}
          </PrimaryBtn>
        </div>

        {showAssignForm && (
          <form onSubmit={handleCreateAssignment}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField label="Client" htmlFor="assign_client">
                <FormSelect
                  id="assign_client"
                  value={assignForm.client_id}
                  disabled={Boolean(fixedClientId)}
                  onChange={(event) => setAssignForm((previous) => ({ ...previous, client_id: event.target.value, jd_id: '' }))}
                  required
                >
                  <option value="">Select client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                  ))}
                </FormSelect>
              </FormField>
              <FormField label="Job Description" htmlFor="assign_jd">
                <FormSelect
                  id="assign_jd"
                  value={assignForm.jd_id}
                  onChange={(event) => setAssignForm((previous) => ({ ...previous, jd_id: event.target.value }))}
                  required
                >
                  <option value="">Select JD</option>
                  {jds
                    .filter((jd) => !assignForm.client_id || String(jd.client_id) === String(assignForm.client_id))
                    .map((jd) => (
                      <option key={jd.id} value={jd.id}>{jd.title}</option>
                    ))}
                </FormSelect>
              </FormField>
              <FormField label="Panelist" htmlFor="assign_panelist">
                <FormSelect
                  id="assign_panelist"
                  value={assignForm.panelist_id}
                  onChange={(event) => setAssignForm((previous) => ({ ...previous, panelist_id: event.target.value }))}
                  required
                >
                  <option value="">Select panelist</option>
                  {panelists.map((panelist) => (
                    <option key={panelist.id} value={panelist.id}>
                      {panelist.full_name} — {panelist.email}
                    </option>
                  ))}
                </FormSelect>
              </FormField>
            </div>
            <PrimaryBtn type="submit" loading={isSubmitting}>Assign</PrimaryBtn>
          </form>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3 mb-4">
          <CardTitle>Bulk Import via Excel</CardTitle>
          <SecondaryBtn onClick={downloadTemplate}>Download Template</SecondaryBtn>
        </div>
        <p className="text-sm text-slate-500 mb-4">Upload an `.xlsx` or `.csv` file with columns: `panelist_email`, `jd_code`, `client_name`.</p>
        <div className="flex flex-wrap items-center gap-3">
          <FormInput type="file" accept=".xlsx,.csv" onChange={(event) => setImportFile(event.target.files?.[0] || null)} />
          <PrimaryBtn onClick={handleImportAssignments} loading={isImporting}>Import</PrimaryBtn>
        </div>

        {importResults && (
          <div className="mt-4">
            <div className="text-sm text-slate-600 mb-3">
              {importResults.success} assigned, {importResults.errors} errors out of {importResults.total} rows.
            </div>
            <DataTable headers={['Row', 'Status', 'Panelist', 'JD', 'Reason']}>
              {(importResults.results || []).map((result) => (
                <TableRow key={`${result.row}-${result.panelist || result.reason}`}>
                  <TableCell>{result.row}</TableCell>
                  <TableCell>{result.status}</TableCell>
                  <TableCell>{result.panelist || '—'}</TableCell>
                  <TableCell>{result.jd || '—'}</TableCell>
                  <TableCell>{result.reason || '—'}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Current Assignments</CardTitle>
        {isLoading ? (
          <LoadingState label="Loading assignments..." />
        ) : (
          <DataTable headers={['Panelist Name', 'Panelist Email', 'JD', 'Job Code', 'Assigned', 'Action']}>
            {assignments.length === 0 ? (
              <tr><td colSpan={6}><EmptyState message="No panelist assignments found" /></td></tr>
            ) : (
              assignments.map((assignment) => (
                <TableRow key={assignment.id}>
                  <TableCell>{assignment.panelist_name}</TableCell>
                  <TableCell className="font-medium">{assignment.panelist_email}</TableCell>
                  <TableCell>{assignment.jd_title}</TableCell>
                  <TableCell>{assignment.job_code}</TableCell>
                  <TableCell>{assignment.created_at ? new Date(assignment.created_at).toLocaleString() : '—'}</TableCell>
                  <TableCell>
                    <DangerBtn className="px-3 py-1.5 text-xs" onClick={() => handleDeleteAssignment(assignment.id)}>
                      Remove
                    </DangerBtn>
                  </TableCell>
                </TableRow>
              ))
            )}
          </DataTable>
        )}
      </Card>
    </AppShell>
  )
}
