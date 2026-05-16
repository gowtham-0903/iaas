import { useEffect, useRef, useState } from 'react'
import AppShell from '../components/AppShell'
import {
  ActionBtn, AlertBanner, Card, CardTitle, DangerBtn,
  EmptyState, FormField, FormInput, LoadingState, ModalOverlay,
  PrimaryBtn, SecondaryBtn,
} from '../components/ui'
import {
  createBulkPanelists,
  createPanelist,
  deletePanelist,
  listPanelists,
  updatePanelist,
  uploadPanelistExcel,
} from '../api/panelistsApi'

// ─── helpers ──────────────────────────────────────────────────────────────────

const IST_TZ = 'Asia/Kolkata'

function fmt(iso) {
  if (!iso) return '—'
  const normalised =
    typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(iso)
      ? `${iso}Z`
      : iso
  const d = new Date(normalised)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: IST_TZ,
  })
}

function blankRow() {
  return { name: '', skill: '', email: '', phone: '', location: '' }
}

// ─── Add Dropdown ─────────────────────────────────────────────────────────────

function AddDropdown({ onSingle, onMulti, onExcel }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  function pick(fn) {
    setOpen(false)
    fn()
  }

  return (
    <div className="relative" ref={ref}>
      <PrimaryBtn onClick={() => setOpen((o) => !o)}>
        + Add Panelist
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </PrimaryBtn>

      {open && (
        <div className="absolute right-0 mt-1.5 w-44 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1 overflow-hidden">
          <button
            className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            onClick={() => pick(onSingle)}
          >
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Add Single
          </button>
          <button
            className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            onClick={() => pick(onMulti)}
          >
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Add Multiple
          </button>
          <div className="mx-3 my-1 border-t border-slate-100" />
          <button
            className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            onClick={() => pick(onExcel)}
          >
            <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Import Excel
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Close button helper ──────────────────────────────────────────────────────

function CloseBtn({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-slate-400 hover:text-slate-600 transition-colors"
      aria-label="Close"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  )
}

// ─── Single / Edit Modal ──────────────────────────────────────────────────────

function SinglePanelistModal({ initial, onClose, onSaved }) {
  const editing = !!initial
  const [form, setForm] = useState(initial ? { ...initial } : blankRow())
  const [fieldErrors, setFieldErrors] = useState({})
  const [globalError, setGlobalError] = useState('')
  const [saving, setSaving] = useState(false)

  function field(k) {
    return (e) => setForm((p) => ({ ...p, [k]: e.target.value }))
  }

  function getFieldError(key) {
    const v = fieldErrors[key]
    return Array.isArray(v) ? v[0] : v || ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    if (!form.email.trim()) errs.email = 'Email is required'
    else if (!form.email.includes('@')) errs.email = 'Invalid email address'
    if (Object.keys(errs).length) { setFieldErrors(errs); return }

    setSaving(true)
    setGlobalError('')
    try {
      if (editing) {
        const res = await updatePanelist(initial.id, form)
        onSaved(res.data.panelist, 'updated')
      } else {
        const res = await createPanelist(form)
        onSaved(res.data.panelist, 'created')
      }
    } catch (err) {
      const data = err.response?.data
      if (data?.errors) setFieldErrors(data.errors)
      else setGlobalError(data?.error || data?.message || 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">
          {editing ? 'Edit Panelist' : 'Add Panelist'}
        </h2>
        <CloseBtn onClick={onClose} />
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="px-6 py-5">
          <AlertBanner type="error" message={globalError} />
          <FormField label="Name" htmlFor="pnl_name" error={getFieldError('name')}>
            <FormInput
              id="pnl_name"
              value={form.name}
              onChange={field('name')}
              placeholder="Full name"
              autoFocus
            />
          </FormField>
          <FormField label="Email ID" htmlFor="pnl_email" error={getFieldError('email')}>
            <FormInput
              id="pnl_email"
              type="email"
              value={form.email}
              onChange={field('email')}
              placeholder="panelist@example.com"
            />
          </FormField>
          <FormField label="Skill" htmlFor="pnl_skill" error={getFieldError('skill')}>
            <FormInput
              id="pnl_skill"
              value={form.skill}
              onChange={field('skill')}
              placeholder="e.g. Java, AWS, SQL"
            />
          </FormField>
          <FormField label="Phone Number" htmlFor="pnl_phone" error={getFieldError('phone')}>
            <FormInput
              id="pnl_phone"
              value={form.phone}
              onChange={field('phone')}
              placeholder="+91 98765 43210"
            />
          </FormField>
          <FormField label="Location" htmlFor="pnl_location" error={getFieldError('location')}>
            <FormInput
              id="pnl_location"
              value={form.location}
              onChange={field('location')}
              placeholder="City, Country"
            />
          </FormField>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <SecondaryBtn type="button" onClick={onClose} disabled={saving}>Cancel</SecondaryBtn>
          <PrimaryBtn type="submit" loading={saving} disabled={saving}>
            {editing ? 'Save Changes' : 'Add Panelist'}
          </PrimaryBtn>
        </div>
      </form>
    </ModalOverlay>
  )
}

// ─── Multi-row Add Modal ──────────────────────────────────────────────────────

const INPUT_CLS =
  'w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all bg-white'

const COL_LABEL_CLS =
  'block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5'

function MultiPanelistModal({ onClose, onSaved }) {
  const [rows, setRows] = useState([blankRow()])
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState(null)

  function setRowField(i, k) {
    return (e) =>
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [k]: e.target.value } : r)))
  }

  function addRow() { setRows((p) => [...p, blankRow()]) }
  function removeRow(i) { setRows((p) => p.filter((_, idx) => idx !== i)) }

  async function handleSave() {
    setSaving(true)
    setResults(null)
    try {
      const res = await createBulkPanelists(rows)
      const { success, results: r } = res.data
      setResults(r)
      if (success > 0) onSaved(success)
    } catch (err) {
      setResults([{
        row: 0,
        status: 'error',
        reason: err.response?.data?.error || 'Request failed',
        email: '',
      }])
    } finally {
      setSaving(false)
    }
  }

  const errors = results?.filter((r) => r.status !== 'success') || []
  const successCount = results?.filter((r) => r.status === 'success').length || 0

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-slate-900">Add Multiple Panelists</h2>
          <CloseBtn onClick={onClose} />
        </div>

        <div className="overflow-auto flex-1 px-6 py-5 space-y-3">
          {rows.map((row, i) => (
            <div
              key={i}
              className="grid grid-cols-5 gap-2 items-end p-3 rounded-xl bg-slate-50 border border-slate-200"
            >
              <div>
                <label className={COL_LABEL_CLS}>Name *</label>
                <input className={INPUT_CLS} value={row.name} onChange={setRowField(i, 'name')} placeholder="Full name" />
              </div>
              <div>
                <label className={COL_LABEL_CLS}>Email ID *</label>
                <input type="email" className={INPUT_CLS} value={row.email} onChange={setRowField(i, 'email')} placeholder="email@example.com" />
              </div>
              <div>
                <label className={COL_LABEL_CLS}>Skill</label>
                <input className={INPUT_CLS} value={row.skill} onChange={setRowField(i, 'skill')} placeholder="e.g. Java, SQL" />
              </div>
              <div>
                <label className={COL_LABEL_CLS}>Number</label>
                <input className={INPUT_CLS} value={row.phone} onChange={setRowField(i, 'phone')} placeholder="Phone" />
              </div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className={COL_LABEL_CLS}>Location</label>
                  <input className={INPUT_CLS} value={row.location} onChange={setRowField(i, 'location')} placeholder="City" />
                </div>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="pb-2 text-slate-400 hover:text-red-500 transition-colors"
                    title="Remove row"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addRow}
            className="text-sm text-[#02c0fa] hover:text-[#00a8e0] font-medium flex items-center gap-1 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Another Row
          </button>

          {results && (
            <div className="space-y-2 pt-1">
              {successCount > 0 && (
                <AlertBanner type="success" message={`${successCount} panelist${successCount > 1 ? 's' : ''} added successfully.`} />
              )}
              {errors.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-600 mb-1">{errors.length} row{errors.length > 1 ? 's' : ''} failed:</p>
                  <div className="max-h-36 overflow-auto space-y-1">
                    {errors.map((r, i) => (
                      <div key={i} className="text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 text-red-700">
                        Row {r.row}
                        {r.email ? <span className="font-semibold"> ({r.email})</span> : ''}
                        {': '}{r.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 sticky bottom-0 bg-white">
          <SecondaryBtn onClick={onClose} disabled={saving}>Close</SecondaryBtn>
          <PrimaryBtn onClick={handleSave} loading={saving} disabled={saving}>
            Save {rows.length} Panelist{rows.length > 1 ? 's' : ''}
          </PrimaryBtn>
        </div>
      </div>
    </div>
  )
}

// ─── Excel Import Modal ───────────────────────────────────────────────────────

function ExcelImportModal({ onClose, onDone }) {
  const fileRef = useRef(null)
  const [cached, setCached] = useState(null)
  const [reading, setReading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState(null)

  function handleFileSelect(e) {
    const f = e.target.files[0]
    if (!f) return
    setResults(null)
    setReading(true)
    const reader = new FileReader()
    reader.onload = (evt) => {
      setCached({ name: f.name, bytes: evt.target.result })
      setReading(false)
    }
    reader.onerror = () => {
      setResults({ error: 'Could not read file — please try again.' })
      setReading(false)
    }
    reader.readAsArrayBuffer(f)
    e.target.value = ''
  }

  async function handleUpload() {
    if (!cached) return
    setUploading(true)
    setResults(null)
    try {
      const blob = new Blob([cached.bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const form = new FormData()
      form.append('file', blob, cached.name)
      const res = await uploadPanelistExcel(form)
      setResults(res.data)
      if (res.data.success > 0) onDone(res.data.success)
    } catch (err) {
      const errMsg =
        err.response?.data?.errors?.file?.[0] ||
        err.response?.data?.error ||
        'Upload failed'
      setResults({ error: errMsg })
    } finally {
      setUploading(false)
    }
  }

  const importErrors = results?.results?.filter((r) => r.status === 'error') || []
  const importSuccesses = results?.results?.filter((r) => r.status === 'success') || []

  return (
    <ModalOverlay onClose={onClose}>
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Import Panelists via Excel</h2>
        <CloseBtn onClick={onClose} />
      </div>

      <div className="px-6 py-5 space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 space-y-1">
          <p className="font-semibold">Required column headers in row 1:</p>
          <p>
            <strong>Name</strong>, <strong>Email ID</strong> — required &nbsp;|&nbsp;
            Skill, Number, Location — optional
          </p>
          <p className="text-blue-400">
            Panel ID and Date Added are auto-assigned — do not include them in the sheet.
          </p>
        </div>

        <div
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
            cached
              ? 'border-emerald-400 bg-emerald-50'
              : 'border-slate-300 hover:border-[#02c0fa] hover:bg-blue-50/40'
          }`}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileSelect}
          />
          {reading ? (
            <p className="text-sm text-slate-500">Reading file…</p>
          ) : cached ? (
            <>
              <p className="text-sm text-slate-700 font-medium">{cached.name}</p>
              <p className="text-xs text-slate-400 mt-1">
                {(cached.bytes.byteLength / 1024).toFixed(1)} KB — click to change
              </p>
            </>
          ) : (
            <>
              <svg className="w-8 h-8 mx-auto text-slate-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm text-slate-500">Click to select .xlsx / .xls file</p>
            </>
          )}
        </div>

        {results && (
          <div className="space-y-2">
            {results.error ? (
              <AlertBanner type="error" message={results.error} />
            ) : (
              <>
                <div className="flex gap-4 text-sm">
                  {importSuccesses.length > 0 && (
                    <span className="text-emerald-700 font-semibold">{importSuccesses.length} added</span>
                  )}
                  {importErrors.length > 0 && (
                    <span className="text-red-600 font-semibold">{importErrors.length} failed</span>
                  )}
                  <span className="text-slate-500">{results.total} total rows</span>
                </div>

                {importErrors.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-red-600 mb-1">Failed rows:</p>
                    <div className="max-h-40 overflow-auto space-y-1">
                      {importErrors.map((r, i) => (
                        <div key={i} className="text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 text-red-700">
                          Row {r.row}
                          {r.email ? <span className="font-semibold"> — {r.email}</span> : ''}
                          {': '}{r.reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {importErrors.length === 0 && importSuccesses.length > 0 && (
                  <AlertBanner type="success" message={`All ${importSuccesses.length} panelists imported successfully.`} />
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
        <SecondaryBtn onClick={onClose} disabled={uploading}>Close</SecondaryBtn>
        <PrimaryBtn
          onClick={handleUpload}
          loading={uploading}
          disabled={!cached || reading || uploading}
        >
          Upload & Import
        </PrimaryBtn>
      </div>
    </ModalOverlay>
  )
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────

function DeleteModal({ panelist, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    setDeleting(true)
    setError('')
    try {
      await deletePanelist(panelist.id)
      onDeleted(panelist.id)
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete panelist.')
      setDeleting(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Delete Panelist</h2>
        <CloseBtn onClick={onClose} />
      </div>
      <div className="px-6 py-5">
        <AlertBanner type="error" message={error} />
        <p className="text-sm text-slate-600">
          Remove{' '}
          <strong className="text-slate-900">{panelist.name}</strong>{' '}
          <span className="text-slate-400">({panelist.panel_id})</span> from the system?
        </p>
        <p className="text-xs text-slate-400 mt-2">
          This cannot be undone. All JD and interview assignments for this panelist will also be removed.
        </p>
      </div>
      <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
        <SecondaryBtn onClick={onClose} disabled={deleting}>Cancel</SecondaryBtn>
        <DangerBtn onClick={handleDelete} loading={deleting} disabled={deleting}>Delete</DangerBtn>
      </div>
    </ModalOverlay>
  )
}

// ─── Bulk Delete Modal ────────────────────────────────────────────────────────

function BulkDeleteModal({ ids, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    setDeleting(true)
    setError('')
    const idList = [...ids]
    const failed = []

    for (const id of idList) {
      try {
        await deletePanelist(id)
      } catch {
        failed.push(id)
      }
    }

    const deletedIds = idList.filter((id) => !failed.includes(id))
    if (deletedIds.length > 0) onDeleted(deletedIds)

    if (failed.length > 0) {
      setError(
        `${failed.length} panelist${failed.length > 1 ? 's' : ''} could not be deleted — they may be assigned to active interviews.`
      )
      setDeleting(false)
    }
  }

  const count = ids.size

  return (
    <ModalOverlay onClose={onClose}>
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">
          Delete {count} Panelist{count > 1 ? 's' : ''}
        </h2>
        <CloseBtn onClick={onClose} />
      </div>
      <div className="px-6 py-5">
        <AlertBanner type="error" message={error} />
        <p className="text-sm text-slate-600">
          You are about to permanently delete{' '}
          <strong>{count} panelist{count > 1 ? 's' : ''}</strong>. This cannot be undone.
        </p>
        <p className="text-xs text-slate-400 mt-2">
          JD and interview assignments for these panelists will also be removed.
        </p>
      </div>
      <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
        <SecondaryBtn onClick={onClose} disabled={deleting}>Cancel</SecondaryBtn>
        <DangerBtn onClick={handleDelete} loading={deleting} disabled={deleting}>
          Delete {count} Panelist{count > 1 ? 's' : ''}
        </DangerBtn>
      </div>
    </ModalOverlay>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABLE_COLS = [
  {
    key: 'sl',
    label: 'Sl.No',
    headerClass:
      'text-left text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-widest px-3 sm:px-4 lg:px-5 py-3 w-12',
    cellClass: 'px-3 sm:px-4 lg:px-5 py-3.5 text-sm text-slate-400 align-top',
    render: (_p, idx) => idx + 1,
  },
  {
    key: 'name',
    label: 'Name',
    headerClass:
      'text-left text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-widest px-3 sm:px-4 lg:px-5 py-3 w-[18%] min-w-[160px]',
    cellClass: 'px-3 sm:px-4 lg:px-5 py-3.5 text-sm font-medium text-slate-900 align-top',
    render: (p) => (
      <span className="block leading-5 break-words line-clamp-2" title={p.name}>
        {p.name}
      </span>
    ),
  },
  {
    key: 'skill',
    label: 'Skill',
    headerClass:
      'text-left text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-widest px-3 sm:px-4 lg:px-5 py-3 w-[16%] min-w-[140px]',
    cellClass: 'px-3 sm:px-4 lg:px-5 py-3.5 text-sm text-slate-600 align-top',
    render: (p) => (
      <span
        className="block leading-5 break-words line-clamp-2 text-slate-600"
        title={p.skill || undefined}
      >
        {p.skill || <span className="text-slate-300">—</span>}
      </span>
    ),
  },
  {
    key: 'email',
    label: 'Email ID',
    headerClass:
      'text-left text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-widest px-3 sm:px-4 lg:px-5 py-3 w-[22%] min-w-[190px]',
    cellClass: 'px-3 sm:px-4 lg:px-5 py-3.5 text-sm text-slate-700 align-top',
    render: (p) => (
      <span className="block leading-5 break-all line-clamp-2" title={p.email}>
        {p.email}
      </span>
    ),
  },
  {
    key: 'phone',
    label: 'Number',
    headerClass:
      'hidden md:table-cell text-left text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-widest px-3 sm:px-4 lg:px-5 py-3 w-[12%] min-w-[120px]',
    cellClass: 'hidden md:table-cell px-3 sm:px-4 lg:px-5 py-3.5 text-sm text-slate-600 align-top',
    render: (p) => (
      <span className="whitespace-normal break-words" title={p.phone || undefined}>
        {p.phone || <span className="text-slate-300">—</span>}
      </span>
    ),
  },
  {
    key: 'location',
    label: 'Location',
    headerClass:
      'hidden lg:table-cell text-left text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-widest px-3 sm:px-4 lg:px-5 py-3 w-[12%] min-w-[120px]',
    cellClass: 'hidden lg:table-cell px-3 sm:px-4 lg:px-5 py-3.5 text-sm text-slate-600 align-top',
    render: (p) => (
      <span
        className="block leading-5 break-words line-clamp-2"
        title={p.location || undefined}
      >
        {p.location || <span className="text-slate-300">—</span>}
      </span>
    ),
  },
  {
    key: 'created',
    label: 'Date Added',
    headerClass:
      'hidden xl:table-cell text-left text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-widest px-3 sm:px-4 lg:px-5 py-3 w-[12%] min-w-[130px]',
    cellClass: 'hidden xl:table-cell px-3 sm:px-4 lg:px-5 py-3.5 text-sm text-slate-500 align-top whitespace-nowrap',
    render: (p) => fmt(p.created_at),
  },
  {
    key: 'actions',
    label: 'Actions',
    headerClass:
      'text-left text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-widest px-3 sm:px-4 lg:px-5 py-3 w-[140px]',
    cellClass: 'px-3 sm:px-4 lg:px-5 py-3.5 align-top',
    render: (p, _idx, { onEdit, onDelete }) => (
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <ActionBtn variant="primary" onClick={onEdit}>
          Edit
        </ActionBtn>
        <ActionBtn variant="danger" onClick={onDelete}>
          Delete
        </ActionBtn>
      </div>
    ),
  },
]

export default function Panelists() {
  const [panelists, setPanelists] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())

  const [singleOpen, setSingleOpen] = useState(false)
  const [multiOpen, setMultiOpen] = useState(false)
  const [excelOpen, setExcelOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  async function load() {
    setIsLoading(true)
    setError('')
    try {
      const res = await listPanelists()
      setPanelists(res.data.panelists || [])
    } catch {
      setError('Unable to load panelists.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = panelists.filter((p) => {
    const q = search.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q) ||
      (p.skill || '').toLowerCase().includes(q) ||
      (p.location || '').toLowerCase().includes(q) ||
      p.panel_id.toLowerCase().includes(q)
    )
  })

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((p) => selected.has(p.id))

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        filtered.forEach((p) => next.delete(p.id))
      } else {
        filtered.forEach((p) => next.add(p.id))
      }
      return next
    })
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSaved(panelist, action) {
    if (action === 'created') {
      setPanelists((p) => [panelist, ...p])
      setSuccess(`Panelist ${panelist.panel_id} added successfully.`)
    } else {
      setPanelists((p) => p.map((x) => (x.id === panelist.id ? panelist : x)))
      setSuccess('Panelist updated successfully.')
    }
    setSingleOpen(false)
    setEditTarget(null)
  }

  function handleBulkSaved(count) {
    setSuccess(`${count} panelist${count > 1 ? 's' : ''} added successfully.`)
    load()
  }

  function handleDeleted(id) {
    setPanelists((p) => p.filter((x) => x.id !== id))
    setSelected((prev) => { const next = new Set(prev); next.delete(id); return next })
    setSuccess('Panelist deleted.')
    setDeleteTarget(null)
  }

  function handleBulkDeleted(ids) {
    const idSet = new Set(ids)
    setPanelists((p) => p.filter((x) => !idSet.has(x.id)))
    setSelected(new Set())
    setSuccess(`${ids.length} panelist${ids.length > 1 ? 's' : ''} deleted.`)
    setBulkDeleteOpen(false)
  }

  const selectedCount = selected.size

  return (
    <AppShell>
      {singleOpen && (
        <SinglePanelistModal onClose={() => setSingleOpen(false)} onSaved={handleSaved} />
      )}
      {multiOpen && (
        <MultiPanelistModal onClose={() => setMultiOpen(false)} onSaved={handleBulkSaved} />
      )}
      {excelOpen && (
        <ExcelImportModal onClose={() => setExcelOpen(false)} onDone={handleBulkSaved} />
      )}
      {editTarget && (
        <SinglePanelistModal
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={handleSaved}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          panelist={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      )}
      {bulkDeleteOpen && (
        <BulkDeleteModal
          ids={selected}
          onClose={() => setBulkDeleteOpen(false)}
          onDeleted={handleBulkDeleted}
        />
      )}

      {/* Topbar */}
      <div className="flex items-center justify-between mb-5">
        <div />
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <DangerBtn onClick={() => setBulkDeleteOpen(true)}>
              Delete {selectedCount} Selected
            </DangerBtn>
          )}
          <AddDropdown
            onSingle={() => { setError(''); setSuccess(''); setSingleOpen(true) }}
            onMulti={() => { setError(''); setSuccess(''); setMultiOpen(true) }}
            onExcel={() => { setError(''); setSuccess(''); setExcelOpen(true) }}
          />
        </div>
      </div>

      <AlertBanner type="error" message={error} />
      <AlertBanner type="success" message={success} />

      {/* Search */}
      <Card>
        <FormField label="Search Panelists" htmlFor="panelists_search">
          <FormInput
            id="panelists_search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, skill, location, Panel ID…"
          />
        </FormField>
      </Card>

      {/* Table */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <CardTitle>
            {panelists.length} Panelist{panelists.length !== 1 ? 's' : ''}
          </CardTitle>
          {selectedCount > 0 && (
            <span className="text-xs text-slate-500">{selectedCount} selected</span>
          )}
        </div>

        <div className="overflow-x-auto -mx-5">
          <div className="min-w-full px-5">
            <table className="w-full table-fixed min-w-0">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="border-b border-slate-100">
                  <th className="px-3 sm:px-4 lg:px-5 py-3 w-10">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 cursor-pointer accent-[#02c0fa]"
                    checked={allFilteredSelected && filtered.length > 0}
                    onChange={toggleSelectAll}
                    title={allFilteredSelected ? 'Deselect all' : 'Select all'}
                    disabled={filtered.length === 0}
                  />
                  </th>
                  {TABLE_COLS.map((col) => (
                    <th key={col.key} className={col.headerClass}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={TABLE_COLS.length + 1}>
                      <LoadingState label="Loading panelists…" />
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={TABLE_COLS.length + 1}>
                      <EmptyState
                        message={
                          search
                            ? 'No panelists match your search.'
                            : 'No panelists yet. Use the Add Panelist button above.'
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((p, idx) => (
                    <tr
                      key={p.id}
                      className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors last:border-0 ${
                        selected.has(p.id) ? 'bg-blue-50/30' : ''
                      }`}
                    >
                      <td className="px-3 sm:px-4 lg:px-5 py-3.5 align-top">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-slate-300 cursor-pointer accent-[#02c0fa]"
                          checked={selected.has(p.id)}
                          onChange={() => toggleSelect(p.id)}
                        />
                      </td>
                      {TABLE_COLS.map((col) => (
                        <td key={col.key} className={col.cellClass}>
                          {col.render(p, idx, {
                            onEdit: () => { setError(''); setSuccess(''); setEditTarget(p) },
                            onDelete: () => { setError(''); setSuccess(''); setDeleteTarget(p) },
                          })}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </AppShell>
  )
}
