import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../store/authStore'

import { getClients } from '../api/clientsApi'
import { createJD, getJDs, uploadJDFile } from '../api/jdApi'
import AppShell from '../components/AppShell'
import {
  AlertBanner, Badge, Card, CardTitle, DataTable, EmptyState,
  FormField, FormInput, FormSelect, FormTextarea, LoadingState,
  PrimaryBtn, TableCell, TableRow,
} from '../components/ui'

const DEFAULT_FORM = {
  title: '',
  client_id: '',
  raw_text: '',
}

function getDefaultForm(user) {
  if (user?.role !== 'ADMIN' && user?.client_id != null) {
    return {
      ...DEFAULT_FORM,
      client_id: String(user.client_id),
    }
  }

  return { ...DEFAULT_FORM }
}

function getStatusVariant(status) {
  if (status === 'ACTIVE') return 'green'
  if (status === 'CLOSED') return 'red'
  return 'gray'
}

export default function SkillExtractionHub() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.role === 'ADMIN'
  const [clients, setClients] = useState([])
  const [jds, setJds] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [formMode, setFormMode] = useState('paste')
  const [selectedFile, setSelectedFile] = useState(null)
  const [formData, setFormData] = useState(() => getDefaultForm(user))
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

  useEffect(() => {
    if (isAdmin) {
      return
    }

    setFormData((previous) => ({
      ...previous,
      client_id: user?.client_id != null ? String(user.client_id) : '',
    }))
  }, [isAdmin, user?.client_id])

  function resetForm() {
    setFormData(getDefaultForm(user))
    setFormMode('paste')
    setSelectedFile(null)
  }

  async function handleCreateOpening(event) {
    event.preventDefault()

    const selectedClientId = isAdmin
      ? formData.client_id
      : (user?.client_id != null ? String(user.client_id) : '')

    if (!formData.title.trim() || !selectedClientId) {
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
        client_id: Number(selectedClientId),
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
    <AppShell pageTitle="AI Skill Extraction" pageSubtitle="Create openings and extract skills from job descriptions">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Create Opening form */}
        <div>
          <AlertBanner type="error" message={error} />
          <AlertBanner type="success" message={success} />

          <Card>
            <CardTitle>Create New Opening</CardTitle>
            <form onSubmit={handleCreateOpening}>
              <FormField label="Title" htmlFor="se-title">
                <FormInput
                  id="se-title"
                  name="title"
                  type="text"
                  value={formData.title}
                  onChange={(event) => setFormData((prev) => ({ ...prev, title: event.target.value }))}
                  required
                  placeholder="e.g. Senior React Developer"
                />
              </FormField>

              {isAdmin && (
                <FormField label="Client" htmlFor="se-client">
                  <FormSelect
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
                  </FormSelect>
                </FormField>
              )}

              {/* Mode toggle */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">JD Source</label>
                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
                  {[
                    { id: 'paste', label: 'Paste Text' },
                    { id: 'upload', label: 'Upload File' },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setFormMode(option.id)
                        setSelectedFile(null)
                      }}
                      className={`flex-1 text-xs font-medium py-2 rounded-lg transition-all ${
                        formMode === option.id
                          ? 'bg-white text-blue-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {formMode === 'paste' ? (
                <FormField label="JD Text" htmlFor="se-raw-text">
                  <FormTextarea
                    id="se-raw-text"
                    rows={6}
                    value={formData.raw_text}
                    onChange={(event) => setFormData((prev) => ({ ...prev, raw_text: event.target.value }))}
                    placeholder="Paste job description here..."
                  />
                </FormField>
              ) : (
                <FormField label="Upload .pdf or .docx" htmlFor="se-file">
                  <input
                    id="se-file"
                    type="file"
                    accept=".pdf,.docx"
                    onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                    className="w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                </FormField>
              )}

              <PrimaryBtn type="submit" loading={isSaving} className="w-full justify-center mt-2">
                {isSaving ? 'Saving...' : 'Create Opening & Extract'}
              </PrimaryBtn>
            </form>
          </Card>
        </div>

        {/* Existing openings */}
        <div>
          <Card>
            <CardTitle>Existing Openings</CardTitle>
            <DataTable
              headers={['Title', 'Client', 'Status', 'Created', 'Action']}
              loading={isLoading}
              loadingLabel="Loading openings..."
            >
              {jds.length === 0 && !isLoading ? (
                <tr><td colSpan={5}><EmptyState message="No openings yet" /></td></tr>
              ) : (
                jds.map((jd) => (
                  <TableRow key={jd.id}>
                    <TableCell className="font-medium text-slate-900 max-w-[140px]">
                      <div className="truncate">{jd.title}</div>
                    </TableCell>
                    <TableCell className="text-slate-600">{clientMap.get(jd.client_id) || `Client #${jd.client_id}`}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(jd.status)}>{jd.status}</Badge>
                    </TableCell>
                    <TableCell className="text-slate-500 text-xs">{new Date(jd.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => navigate(`/skill-extraction/${jd.id}`)}
                        className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                      >
                        Open
                      </button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </DataTable>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
