import { useEffect, useState } from 'react'

import { getClients } from '../api/clientsApi'
import { createUser, deleteUser, getUsers, getUsersByClient, updateUser } from '../api/usersApi'
import AppShell from '../components/AppShell'
import {
  AlertBanner, Avatar, Badge, Card, CardTitle, DangerBtn, DataTable,
  EmptyState, FormField, FormInput, FormSelect, LoadingState,
  PrimaryBtn, SecondaryBtn, TableCell, TableRow,
} from '../components/ui'
import useAuthStore from '../store/authStore'

const ROLES = [
  'OPERATOR',
  'M_RECRUITER',
  'SR_RECRUITER',
  'RECRUITER',
  'PANELIST',
]

const ROLE_VARIANTS = {
  ADMIN: 'purple',
  M_RECRUITER: 'blue',
  SR_RECRUITER: 'blue',
  RECRUITER: 'blue',
  PANELIST: 'amber',
  QC: 'amber',
  CLIENT: 'green',
  OPERATOR: 'gray',
}

const DEFAULT_FORM = {
  full_name: '',
  email: '',
  password: '',
  role: 'RECRUITER',
  client_id: '',
  reports_to: '',
  is_active: true,
}

const DEFAULT_PASSWORD_FORM = {
  password: '',
  confirm_password: '',
  show_password: false,
}

function LoadingSpinner() {
  return <span className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full spin" aria-label="Loading users" />
}

function EditIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </svg>
  )
}

function ChangePasswordIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
      <path d="m21 2-9.6 9.6" />
      <circle cx="7.5" cy="15.5" r="5.5" />
    </svg>
  )
}

function DeleteUserIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M22 10.5h-6m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM4 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 10.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
    </svg>
  )
}

export default function Users() {
  const currentUser = useAuthStore((state) => state.user)
  const currentUserRole = useAuthStore((state) => state.user?.role)
  const canViewUsersPage = ['ADMIN', 'M_RECRUITER', 'SR_RECRUITER'].includes(currentUserRole)
  const [users, setUsers] = useState([])
  const [clients, setClients] = useState([])
  const [managersForClient, setManagersForClient] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [changingPasswordUser, setChangingPasswordUser] = useState(null)
  const [deletingUserId, setDeletingUserId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [formData, setFormData] = useState(DEFAULT_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [passwordForm, setPasswordForm] = useState(DEFAULT_PASSWORD_FORM)
  const [passwordFormErrors, setPasswordFormErrors] = useState({})

  const canEditClientOnUpdate = currentUserRole === 'ADMIN'
  const shouldShowClientDetails = currentUserRole === 'ADMIN'
  const creatorFixedClientId = (
    currentUserRole === 'M_RECRUITER' || currentUserRole === 'SR_RECRUITER'
  ) ? currentUser?.client_id : null

  function isRecruiterRole(role) {
    return role === 'M_RECRUITER' || role === 'SR_RECRUITER' || role === 'RECRUITER'
  }

  function shouldLoadManagers(role) {
    return role === 'SR_RECRUITER' || role === 'RECRUITER'
  }

  function getCreateRoleOptions() {
    if (currentUserRole === 'M_RECRUITER') {
      return ['SR_RECRUITER', 'RECRUITER']
    }
    if (currentUserRole === 'SR_RECRUITER') {
      return ['RECRUITER']
    }
    return ROLES
  }

  function getEditRoleOptions() {
    if (currentUserRole === 'M_RECRUITER') {
      return ['SR_RECRUITER', 'RECRUITER']
    }
    if (currentUserRole === 'SR_RECRUITER') {
      return ['RECRUITER']
    }
    return ROLES
  }

  function getDefaultFormData() {
    if (creatorFixedClientId) {
      return {
        ...DEFAULT_FORM,
        client_id: String(creatorFixedClientId),
      }
    }

    return DEFAULT_FORM
  }

  function canManageUser(user) {
    if (currentUserRole === 'ADMIN') {
      return true
    }

    if (!creatorFixedClientId || user.client_id !== creatorFixedClientId) {
      return false
    }

    if (currentUserRole === 'M_RECRUITER') {
      return user.role === 'SR_RECRUITER' || user.role === 'RECRUITER'
    }

    if (currentUserRole === 'SR_RECRUITER') {
      return user.role === 'RECRUITER'
    }

    return false
  }

  async function loadManagersByClient(role, clientId) {
    if (!clientId || !shouldLoadManagers(role)) {
      setManagersForClient([])
      return
    }

    try {
      const response = await getUsersByClient(clientId)
      const byClientUsers = response.data?.users ?? []
      const filteredManagers = byClientUsers.filter((manager) => (
        role === 'SR_RECRUITER'
          ? manager.role === 'M_RECRUITER'
          : manager.role === 'M_RECRUITER' || manager.role === 'SR_RECRUITER'
      ))
      setManagersForClient(filteredManagers)
    } catch (_error) {
      setManagersForClient([])
    }
  }

  useEffect(() => {
    let isMounted = true

    async function loadUsers() {
      try {
        setIsLoading(true)
        setError('')
        const usersResponse = await getUsers()
        const payload = usersResponse.data
        const nextUsers = Array.isArray(payload) ? payload : payload.users ?? []

        let nextClients = []
        if (currentUserRole === 'ADMIN') {
          try {
            const clientsResponse = await getClients()
            nextClients = clientsResponse.data?.clients ?? []
          } catch (_clientsError) {
            // Non-blocking for Users page; create flow for SR/M can still use own client mapping.
            nextClients = []
          }
        }

        if (isMounted) {
          setUsers(nextUsers)
          setClients(nextClients)
        }
      } catch (_fetchError) {
        if (isMounted) {
          setUsers([])
          setClients([])
          setError('Unable to load users.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadUsers()

    return () => {
      isMounted = false
    }
  }, [currentUserRole])

  function handleChange(event) {
    const { name, type, value, checked } = event.target

    if (name === 'role') {
      const nextClientId = (
        creatorFixedClientId && isRecruiterRole(value)
      ) ? String(creatorFixedClientId) : ''

      setFormData((previous) => ({
        ...previous,
        role: value,
        client_id: nextClientId,
        reports_to: '',
      }))
      setManagersForClient([])

      if (nextClientId) {
        void loadManagersByClient(value, nextClientId)
      }

      setFormErrors((previous) => ({
        ...previous,
        role: null,
        client_id: null,
        reports_to: null,
      }))
      return
    }

    if (name === 'client_id') {
      setFormData((previous) => ({
        ...previous,
        client_id: value,
        reports_to: '',
      }))
      setManagersForClient([])
      void loadManagersByClient(formData.role, value)

      setFormErrors((previous) => ({
        ...previous,
        client_id: null,
        reports_to: null,
      }))
      return
    }

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

  async function handleCreateUser(event) {
    event.preventDefault()

    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')
      setFormErrors({})

      const effectiveClientId = (
        creatorFixedClientId && isRecruiterRole(formData.role)
      ) ? Number(creatorFixedClientId) : (formData.client_id ? Number(formData.client_id) : null)

      const createPayload = {
        full_name: formData.full_name,
        email: formData.email,
        password: formData.password,
        role: formData.role,
        client_id: effectiveClientId,
        reports_to: formData.reports_to ? Number(formData.reports_to) : null,
        is_active: formData.is_active,
      }

      const response = await createUser(createPayload)
      const createdUser = response.data?.user

      setUsers((previous) => {
        const next = createdUser ? [createdUser, ...previous] : previous
        return [...next].sort((a, b) => a.full_name.localeCompare(b.full_name))
      })
      setSuccess('User created successfully.')
      setFormData(getDefaultFormData())
      setManagersForClient([])
      setShowCreateForm(false)
    } catch (createError) {
      const validationErrors = createError?.response?.data?.errors
      if (validationErrors) {
        setFormErrors(validationErrors)
      } else {
        setError(createError?.response?.data?.error || 'Failed to create user.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleEditClick(user) {
    if (!canManageUser(user)) {
      setError('You do not have permission to update this user.')
      return
    }

    setEditingUser(user)
    setShowCreateForm(false)
    setChangingPasswordUser(null)
    setDeletingUserId(null)
    setFormData({
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      client_id: user.client_id ? String(user.client_id) : (creatorFixedClientId ? String(creatorFixedClientId) : ''),
      reports_to: user.reports_to ? String(user.reports_to) : '',
      is_active: user.is_active,
    })
    setManagersForClient([])
    if (user.client_id && shouldLoadManagers(user.role)) {
      await loadManagersByClient(user.role, String(user.client_id))
    }
    setFormErrors({})
    setError('')
    setSuccess('')
  }

  async function handleUpdateUser(event) {
    event.preventDefault()

    if (!editingUser) return

    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')
      setFormErrors({})

      const updateData = {
        full_name: formData.full_name,
        email: formData.email,
        role: formData.role,
        client_id: (
          creatorFixedClientId && isRecruiterRole(formData.role)
        ) ? Number(creatorFixedClientId) : (formData.client_id ? Number(formData.client_id) : null),
        reports_to: formData.reports_to ? Number(formData.reports_to) : null,
        is_active: formData.is_active,
      }

      const response = await updateUser(editingUser.id, updateData)
      const updatedUser = response.data?.user

      setUsers((previous) =>
        previous.map((u) => (u.id === editingUser.id ? updatedUser : u)).sort((a, b) => a.full_name.localeCompare(b.full_name))
      )

      setSuccess('User updated successfully.')
      setEditingUser(null)
      setFormData(getDefaultFormData())
      setManagersForClient([])
    } catch (updateError) {
      const validationErrors = updateError?.response?.data?.errors
      if (validationErrors) {
        setFormErrors(validationErrors)
      } else {
        setError(updateError?.response?.data?.message || updateError?.response?.data?.error || 'Failed to update user.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDeleteUser(userId) {
    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')

      await deleteUser(userId)

      setUsers((previous) => previous.filter((u) => u.id !== userId))
      setSuccess('User deleted successfully.')
      setDeletingUserId(null)
      if (editingUser?.id === userId) {
        setEditingUser(null)
      }
      if (changingPasswordUser?.id === userId) {
        setChangingPasswordUser(null)
      }
    } catch (deleteError) {
      setError(deleteError?.response?.data?.message || deleteError?.response?.data?.error || 'Failed to delete user.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function validatePasswordStrength(value) {
    const messages = []
    if (value.length < 8) messages.push('Minimum 8 characters')
    if (!/[A-Z]/.test(value)) messages.push('At least one uppercase letter')
    if (!/[a-z]/.test(value)) messages.push('At least one lowercase letter')
    if (!/\d/.test(value)) messages.push('At least one number')
    if (!/[^A-Za-z0-9]/.test(value)) messages.push('At least one special character')
    return messages
  }

  function handlePasswordFieldChange(event) {
    const { name, type, value, checked } = event.target
    setPasswordForm((previous) => ({
      ...previous,
      [name]: type === 'checkbox' ? checked : value,
    }))

    if (passwordFormErrors[name]) {
      setPasswordFormErrors((previous) => ({
        ...previous,
        [name]: null,
      }))
    }
  }

  function openChangePassword(user) {
    setChangingPasswordUser(user)
    setShowCreateForm(false)
    setEditingUser(null)
    setDeletingUserId(null)
    setError('')
    setSuccess('')
    setPasswordFormErrors({})
    setPasswordForm(DEFAULT_PASSWORD_FORM)
  }

  async function handleChangePassword(event) {
    event.preventDefault()

    if (!changingPasswordUser) return

    const nextErrors = {}
    const strengthErrors = validatePasswordStrength(passwordForm.password)

    if (!passwordForm.password) {
      nextErrors.password = 'Password is required'
    } else if (strengthErrors.length > 0) {
      nextErrors.password = strengthErrors.join(', ')
    }

    if (!passwordForm.confirm_password) {
      nextErrors.confirm_password = 'Please confirm the password'
    } else if (passwordForm.password !== passwordForm.confirm_password) {
      nextErrors.confirm_password = 'Both passwords should be same'
    }

    if (Object.keys(nextErrors).length > 0) {
      setPasswordFormErrors(nextErrors)
      return
    }

    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')
      setPasswordFormErrors({})

      await updateUser(changingPasswordUser.id, { password: passwordForm.password })

      setSuccess('Password changed successfully.')
      setChangingPasswordUser(null)
      setPasswordForm(DEFAULT_PASSWORD_FORM)
    } catch (updateError) {
      const validationErrors = updateError?.response?.data?.errors
      if (validationErrors?.password) {
        const message = Array.isArray(validationErrors.password)
          ? validationErrors.password.join(', ')
          : validationErrors.password
        setPasswordFormErrors({ password: message })
      } else {
        setError(updateError?.response?.data?.error || 'Failed to change password.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  function getErrorText(field) {
    const value = formErrors[field]
    if (!value) {
      return ''
    }
    return Array.isArray(value) ? value[0] : value
  }

  function getClientName(clientId) {
    if (!clientId) return '—'
    const client = clients.find((item) => item.id === clientId)
    return client?.name || `Client #${clientId}`
  }

  function getManagerName(managerId) {
    if (!managerId) return '—'
    if (currentUser?.id === managerId) {
      return currentUser.full_name
    }
    const manager = users.find((item) => item.id === managerId)
    return manager?.full_name || `User #${managerId}`
  }

  return (
    <AppShell pageTitle="Users" pageSubtitle="Manage platform users and their access roles">
      {!canViewUsersPage && (
        <Card>
          <CardTitle>Restricted Access</CardTitle>
          <p className="text-sm text-slate-600">Only ADMIN, M_RECRUITER, or SR_RECRUITER can access this page.</p>
        </Card>
      )}

      {canViewUsersPage && (
        <>
      <div className="flex items-center justify-between mb-5">
        <div />
        <PrimaryBtn
          onClick={() => {
            const nextShowCreateForm = !showCreateForm
            const nextFormData = getDefaultFormData()

            setShowCreateForm(nextShowCreateForm)
            setEditingUser(null)
            setChangingPasswordUser(null)
            setDeletingUserId(null)
            setError('')
            setSuccess('')
            setFormErrors({})
            setFormData(nextFormData)
            setManagersForClient([])

            if (nextShowCreateForm && creatorFixedClientId && shouldLoadManagers(nextFormData.role)) {
              void loadManagersByClient(nextFormData.role, nextFormData.client_id)
            }
          }}
        >
          {showCreateForm ? 'Close' : '+ Add User'}
        </PrimaryBtn>
      </div>

      <AlertBanner type="error" message={error} />
      <AlertBanner type="success" message={success} />

      {/* Create User Form */}
      {showCreateForm && (
        <Card>
          <CardTitle>Create User</CardTitle>
          <form onSubmit={handleCreateUser}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Full Name" htmlFor="full_name" error={getErrorText('full_name')}>
                <FormInput id="full_name" name="full_name" type="text" value={formData.full_name} onChange={handleChange} required placeholder="John Doe" />
              </FormField>
              <FormField label="Email" htmlFor="email" error={getErrorText('email')}>
                <FormInput id="email" name="email" type="email" value={formData.email} onChange={handleChange} required placeholder="john@example.com" />
              </FormField>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Password" htmlFor="password" error={getErrorText('password')}>
                <FormInput id="password" name="password" type="password" value={formData.password} onChange={handleChange} required placeholder="Min 8 chars, upper, lower, number, special" />
              </FormField>
              <FormField label="Role" htmlFor="role" error={getErrorText('role')}>
                <FormSelect id="role" name="role" value={formData.role} onChange={handleChange} required>
                  {getCreateRoleOptions().map((role) => (<option key={role} value={role}>{role}</option>))}
                </FormSelect>
              </FormField>
            </div>
            {isRecruiterRole(formData.role) && !creatorFixedClientId && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Client" htmlFor="client_id" error={getErrorText('client_id')}>
                  <FormSelect id="client_id" name="client_id" value={formData.client_id} onChange={handleChange} required>
                    <option value="">Select Client</option>
                    {clients.map((client) => (<option key={client.id} value={client.id}>{client.name}</option>))}
                  </FormSelect>
                </FormField>
              </div>
            )}
            {shouldLoadManagers(formData.role) && managersForClient.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Reports To (Optional)" htmlFor="reports_to" error={getErrorText('reports_to')}>
                  <FormSelect id="reports_to" name="reports_to" value={formData.reports_to} onChange={handleChange}>
                    <option value="">No manager assigned</option>
                    {managersForClient.map((manager) => (
                      <option key={manager.id} value={manager.id}>{manager.full_name} ({manager.role})</option>
                    ))}
                  </FormSelect>
                </FormField>
              </div>
            )}
            <div className="flex items-center gap-2 mb-4">
              <input id="is_active" name="is_active" type="checkbox" checked={formData.is_active} onChange={handleChange} className="w-4 h-4 text-blue-600 rounded border-slate-300" />
              <label htmlFor="is_active" className="text-sm text-slate-700 font-medium cursor-pointer">Active</label>
            </div>
            <p className="text-xs text-slate-500 mb-4">Password must include min 8 chars, uppercase, lowercase, number and special character.</p>
            <div className="flex gap-2">
              <PrimaryBtn type="submit" loading={isSubmitting}>{isSubmitting ? 'Creating...' : 'Create User'}</PrimaryBtn>
              <SecondaryBtn onClick={() => { setShowCreateForm(false); setFormErrors({}); setFormData(getDefaultFormData()) }} disabled={isSubmitting}>Cancel</SecondaryBtn>
            </div>
          </form>
        </Card>
      )}

      {/* Edit User Form */}
      {editingUser && (
        <Card>
          <CardTitle>Edit User — {editingUser.full_name}</CardTitle>
          <form onSubmit={handleUpdateUser}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Full Name" htmlFor="edit_full_name" error={getErrorText('full_name')}>
                <FormInput id="edit_full_name" name="full_name" type="text" value={formData.full_name} onChange={handleChange} required />
              </FormField>
              <FormField label="Email" htmlFor="edit_email" error={getErrorText('email')}>
                <FormInput id="edit_email" name="email" type="email" value={formData.email} onChange={handleChange} required />
              </FormField>
            </div>
            <FormField label="Role" htmlFor="edit_role" error={getErrorText('role')}>
              <FormSelect id="edit_role" name="role" value={formData.role} onChange={handleChange} required>
                {getEditRoleOptions().map((role) => (<option key={role} value={role}>{role}</option>))}
              </FormSelect>
            </FormField>
            {isRecruiterRole(formData.role) && shouldShowClientDetails && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Client" htmlFor="edit_client_id" error={getErrorText('client_id')}>
                  <FormSelect
                    id="edit_client_id"
                    name="client_id"
                    value={formData.client_id}
                    onChange={handleChange}
                    required
                    disabled={!canEditClientOnUpdate}
                  >
                    <option value="">Select Client</option>
                    {clients.map((client) => (<option key={client.id} value={client.id}>{client.name}</option>))}
                  </FormSelect>
                </FormField>
              </div>
            )}
            {shouldLoadManagers(formData.role) && managersForClient.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Reports To (Optional)" htmlFor="edit_reports_to" error={getErrorText('reports_to')}>
                  <FormSelect id="edit_reports_to" name="reports_to" value={formData.reports_to} onChange={handleChange}>
                    <option value="">No manager assigned</option>
                    {managersForClient.map((manager) => (
                      <option key={manager.id} value={manager.id}>{manager.full_name} ({manager.role})</option>
                    ))}
                  </FormSelect>
                </FormField>
              </div>
            )}
            <div className="flex items-center gap-2 mb-4">
              <input id="edit_is_active" name="is_active" type="checkbox" checked={formData.is_active} onChange={handleChange} className="w-4 h-4 text-blue-600 rounded border-slate-300" />
              <label htmlFor="edit_is_active" className="text-sm text-slate-700 font-medium cursor-pointer">Active (Inactive users cannot login)</label>
            </div>
            <div className="flex gap-2">
              <PrimaryBtn type="submit" loading={isSubmitting}>{isSubmitting ? 'Updating...' : 'Update User'}</PrimaryBtn>
              <SecondaryBtn onClick={() => { setEditingUser(null); setFormErrors({}); setFormData(getDefaultFormData()); setManagersForClient([]) }} disabled={isSubmitting}>Cancel</SecondaryBtn>
            </div>
          </form>
        </Card>
      )}

      {/* Change Password Form */}
      {changingPasswordUser && (
        <Card>
          <CardTitle>Change Password</CardTitle>
          <p className="text-sm text-slate-600 mb-4">Changing password for <strong>{changingPasswordUser.full_name}</strong></p>
          <form onSubmit={handleChangePassword}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="New Password" htmlFor="change_password" error={passwordFormErrors.password}>
                <FormInput id="change_password" name="password" type={passwordForm.show_password ? 'text' : 'password'} value={passwordForm.password} onChange={handlePasswordFieldChange} required />
              </FormField>
              <FormField label="Confirm New Password" htmlFor="confirm_change_password" error={passwordFormErrors.confirm_password}>
                <FormInput id="confirm_change_password" name="confirm_password" type={passwordForm.show_password ? 'text' : 'password'} value={passwordForm.confirm_password} onChange={handlePasswordFieldChange} required />
              </FormField>
            </div>
            <div className="flex items-center gap-2 mb-3">
              <input id="show_password" name="show_password" type="checkbox" checked={passwordForm.show_password} onChange={handlePasswordFieldChange} className="w-4 h-4 text-blue-600 rounded border-slate-300" />
              <label htmlFor="show_password" className="text-sm text-slate-700 cursor-pointer">Show password</label>
            </div>
            <p className="text-xs text-slate-500 mb-4">Password must include min 8 chars, uppercase, lowercase, number and special character.</p>
            <div className="flex gap-2">
              <PrimaryBtn type="submit" loading={isSubmitting}>{isSubmitting ? 'Updating...' : 'Update Password'}</PrimaryBtn>
              <SecondaryBtn onClick={() => { setChangingPasswordUser(null); setPasswordFormErrors({}); setPasswordForm(DEFAULT_PASSWORD_FORM) }} disabled={isSubmitting}>Cancel</SecondaryBtn>
            </div>
          </form>
        </Card>
      )}

      {/* Delete confirmation */}
      {deletingUserId && (
        <Card>
          <CardTitle>Confirm Delete</CardTitle>
          <p className="text-sm text-slate-600 mb-4">Are you sure you want to delete this user? This action cannot be undone.</p>
          <div className="flex gap-2">
            <DangerBtn onClick={() => handleDeleteUser(deletingUserId)} loading={isSubmitting}>
              {isSubmitting ? 'Deleting...' : 'Delete User'}
            </DangerBtn>
            <SecondaryBtn onClick={() => setDeletingUserId(null)} disabled={isSubmitting}>Cancel</SecondaryBtn>
          </div>
        </Card>
      )}

      {/* Users table */}
      <Card>
        <DataTable
          headers={shouldShowClientDetails
            ? ['User', 'Email', 'Role', 'Client', 'Reports To', 'Status', 'Created', 'Actions']
            : ['User', 'Email', 'Role', 'Reports To', 'Status', 'Created', 'Actions']}
          loading={isLoading}
          loadingLabel="Loading users..."
          allowHorizontalScroll={false}
          tableClassName="text-xs sm:text-sm"
          wrapperClassName="rounded-2xl border border-slate-100"
        >
          {users.length === 0 && !isLoading ? (
            <tr><td colSpan={shouldShowClientDetails ? 8 : 7}><EmptyState message="No users found" /></td></tr>
          ) : (
            users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="whitespace-nowrap">
                  <div className="flex items-start gap-2.5 min-w-0 max-w-[240px]">
                    <Avatar name={user.full_name} colorClass="bg-blue-100 text-blue-700" />
                    <span className="font-medium text-slate-900 whitespace-normal break-words">{user.full_name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-slate-500 whitespace-normal break-all max-w-[240px]">{user.email}</TableCell>
                <TableCell>
                  <Badge variant={ROLE_VARIANTS[user.role] || 'gray'}>{user.role}</Badge>
                </TableCell>
                {shouldShowClientDetails && (
                  <TableCell className="text-slate-500 whitespace-normal break-words">{getClientName(user.client_id)}</TableCell>
                )}
                <TableCell className="text-slate-500 whitespace-normal break-words">{getManagerName(user.reports_to)}</TableCell>
                <TableCell>
                  <Badge variant={user.is_active ? 'green' : 'red'}>
                    {user.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-500">{new Date(user.created_at).toLocaleDateString()}</TableCell>
                <TableCell className="whitespace-normal break-words">
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    {canManageUser(user) ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleEditClick(user)}
                          disabled={isSubmitting}
                          aria-label="Edit user"
                          title="Edit user"
                          className="inline-flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 p-2 rounded-md transition-colors disabled:opacity-50"
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => openChangePassword(user)}
                          disabled={isSubmitting}
                          aria-label="Change password"
                          title="Change password"
                          className="inline-flex items-center justify-center bg-blue-50 hover:bg-blue-100 text-blue-700 p-2 rounded-md transition-colors disabled:opacity-50"
                        >
                          <ChangePasswordIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingUserId(user.id)}
                          disabled={isSubmitting}
                          aria-label="Delete user"
                          title="Delete user"
                          className="inline-flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 p-2 rounded-md transition-colors disabled:opacity-50"
                        >
                          <DeleteUserIcon />
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">No actions</span>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </DataTable>
      </Card>
      </>
      )}
    </AppShell>
  )
}
