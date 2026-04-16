import { useEffect, useState } from 'react'

import { createUser, deleteUser, getUsers, updateUser } from '../api/usersApi'
import AppShell from '../components/AppShell'

const ROLES = [
  'ADMIN',
  'M_RECRUITER',
  'SR_RECRUITER',
  'RECRUITER',
  'PANELIST',
  'QC',
  'CLIENT',
]

const DEFAULT_FORM = {
  full_name: '',
  email: '',
  password: '',
  role: 'RECRUITER',
  is_active: true,
}

const DEFAULT_PASSWORD_FORM = {
  password: '',
  confirm_password: '',
  show_password: false,
}

function LoadingSpinner() {
  return <div className="loading-spinner" aria-label="Loading users" />
}

export default function Users() {
  const [users, setUsers] = useState([])
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

  useEffect(() => {
    let isMounted = true

    async function loadUsers() {
      try {
        setIsLoading(true)
        setError('')
        const response = await getUsers()
        const payload = response.data
        const nextUsers = Array.isArray(payload) ? payload : payload.users ?? []

        if (isMounted) {
          setUsers(nextUsers)
        }
      } catch (_fetchError) {
        if (isMounted) {
          setUsers([])
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
  }, [])

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

  async function handleCreateUser(event) {
    event.preventDefault()

    try {
      setIsSubmitting(true)
      setError('')
      setSuccess('')
      setFormErrors({})

      const response = await createUser(formData)
      const createdUser = response.data?.user

      setUsers((previous) => {
        const next = createdUser ? [createdUser, ...previous] : previous
        return [...next].sort((a, b) => a.full_name.localeCompare(b.full_name))
      })
      setSuccess('User created successfully.')
      setFormData(DEFAULT_FORM)
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

  function handleEditClick(user) {
    setEditingUser(user)
    setShowCreateForm(false)
    setChangingPasswordUser(null)
    setDeletingUserId(null)
    setFormData({
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      is_active: user.is_active,
    })
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
        is_active: formData.is_active,
      }

      const response = await updateUser(editingUser.id, updateData)
      const updatedUser = response.data?.user

      setUsers((previous) =>
        previous.map((u) => (u.id === editingUser.id ? updatedUser : u)).sort((a, b) => a.full_name.localeCompare(b.full_name))
      )

      setSuccess('User updated successfully.')
      setEditingUser(null)
      setFormData(DEFAULT_FORM)
    } catch (updateError) {
      const validationErrors = updateError?.response?.data?.errors
      if (validationErrors) {
        setFormErrors(validationErrors)
      } else {
        setError(updateError?.response?.data?.error || 'Failed to update user.')
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
    } catch (deleteError) {
      setError(deleteError?.response?.data?.error || 'Failed to delete user.')
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

  return (
    <AppShell>
      <div className="topbar">
        <h1>Users</h1>
        <div className="topbar-actions">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setShowCreateForm((previous) => !previous)
              setEditingUser(null)
              setChangingPasswordUser(null)
              setDeletingUserId(null)
              setError('')
              setSuccess('')
              setFormErrors({})
              setFormData(DEFAULT_FORM)
            }}
          >
            {showCreateForm ? 'Close' : '+ Add User'}
          </button>
        </div>
      </div>

      {error ? <div className="login-error">{error}</div> : null}
      {success ? <div className="card section-copy">{success}</div> : null}

      {showCreateForm ? (
        <div className="card">
          <div className="card-title">Create User</div>
          <form onSubmit={handleCreateUser}>
            <div className="form-group">
              <label className="form-label" htmlFor="full_name">Full Name</label>
              <input
                id="full_name"
                name="full_name"
                type="text"
                value={formData.full_name}
                onChange={handleChange}
                required
              />
              {getErrorText('full_name') ? <div className="section-copy">{getErrorText('full_name')}</div> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                required
              />
              {getErrorText('email') ? <div className="section-copy">{getErrorText('email')}</div> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                required
              />
              {getErrorText('password') ? <div className="section-copy">{getErrorText('password')}</div> : null}
              <div className="section-copy">Password must include minimum 8 chars, uppercase, lowercase, number and special character.</div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="role">Role</label>
              <select
                id="role"
                name="role"
                value={formData.role}
                onChange={handleChange}
                required
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
              {getErrorText('role') ? <div className="section-copy">{getErrorText('role')}</div> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="is_active">
                <input
                  id="is_active"
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
                {isSubmitting ? 'Creating...' : 'Create User'}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setShowCreateForm(false)
                  setFormErrors({})
                  setFormData(DEFAULT_FORM)
                }}
                disabled={isSubmitting}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editingUser ? (
        <div className="card">
          <div className="card-title">Edit User</div>
          <form onSubmit={handleUpdateUser}>
            <div className="form-group">
              <label className="form-label" htmlFor="edit_full_name">Full Name</label>
              <input
                id="edit_full_name"
                name="full_name"
                type="text"
                value={formData.full_name}
                onChange={handleChange}
                required
              />
              {getErrorText('full_name') ? <div className="section-copy">{getErrorText('full_name')}</div> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="edit_email">Email</label>
              <input
                id="edit_email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                required
              />
              {getErrorText('email') ? <div className="section-copy">{getErrorText('email')}</div> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="edit_role">Role</label>
              <select
                id="edit_role"
                name="role"
                value={formData.role}
                onChange={handleChange}
                required
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
              {getErrorText('role') ? <div className="section-copy">{getErrorText('role')}</div> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="edit_is_active">
                <input
                  id="edit_is_active"
                  name="is_active"
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={handleChange}
                />
                {' '}
                Active (Inactive users cannot login)
              </label>
            </div>

            <div className="topbar-actions">
              <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Updating...' : 'Update User'}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setEditingUser(null)
                  setFormErrors({})
                  setFormData(DEFAULT_FORM)
                }}
                disabled={isSubmitting}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {changingPasswordUser ? (
        <div className="card">
          <div className="card-title">Change Password</div>
          <p className="section-copy">Changing password for {changingPasswordUser.full_name}</p>
          <form onSubmit={handleChangePassword}>
            <div className="form-group">
              <label className="form-label" htmlFor="change_password">New Password</label>
              <input
                id="change_password"
                name="password"
                type={passwordForm.show_password ? 'text' : 'password'}
                value={passwordForm.password}
                onChange={handlePasswordFieldChange}
                required
              />
              {passwordFormErrors.password ? <div className="section-copy">{passwordFormErrors.password}</div> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="confirm_change_password">Confirm New Password</label>
              <input
                id="confirm_change_password"
                name="confirm_password"
                type={passwordForm.show_password ? 'text' : 'password'}
                value={passwordForm.confirm_password}
                onChange={handlePasswordFieldChange}
                required
              />
              {passwordFormErrors.confirm_password ? <div className="section-copy">{passwordFormErrors.confirm_password}</div> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="show_password">
                <input
                  id="show_password"
                  name="show_password"
                  type="checkbox"
                  checked={passwordForm.show_password}
                  onChange={handlePasswordFieldChange}
                />
                {' '}
                Show password
              </label>
            </div>

            <div className="section-copy">Password must include minimum 8 chars, uppercase, lowercase, number and special character.</div>

            <div className="topbar-actions">
              <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Updating...' : 'Update Password'}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setChangingPasswordUser(null)
                  setPasswordFormErrors({})
                  setPasswordForm(DEFAULT_PASSWORD_FORM)
                }}
                disabled={isSubmitting}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {deletingUserId ? (
        <div className="card">
          <div className="card-title">Confirm Delete</div>
          <p className="section-copy">Are you sure you want to delete this user? This action cannot be undone.</p>
          <div className="topbar-actions">
            <button
              className="btn btn-danger"
              type="button"
              onClick={() => handleDeleteUser(deletingUserId)}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Deleting...' : 'Delete User'}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => setDeletingUserId(null)}
              disabled={isSubmitting}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-title">All Users</div>
        {isLoading ? (
          <div className="loading-state">
            <LoadingSpinner />
            <span>Loading users...</span>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Full Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="table-title-cell">{user.full_name}</td>
                  <td>{user.email}</td>
                  <td><span className="badge badge-blue">{user.role}</span></td>
                  <td>
                    <span className={user.is_active ? 'badge badge-green' : 'badge badge-red'}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{new Date(user.created_at).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        className="btn"
                        style={{ fontSize: '12px', padding: '4px 8px' }}
                        type="button"
                        onClick={() => handleEditClick(user)}
                        disabled={isSubmitting}
                      >
                        Edit
                      </button>
                      <button
                        className="btn"
                        style={{ fontSize: '12px', padding: '4px 8px' }}
                        type="button"
                        onClick={() => openChangePassword(user)}
                        disabled={isSubmitting}
                      >
                        Change Password
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ fontSize: '12px', padding: '4px 8px' }}
                        type="button"
                        onClick={() => setDeletingUserId(user.id)}
                        disabled={isSubmitting}
                      >
                        Delete
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
