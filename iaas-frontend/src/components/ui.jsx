/* Reusable UI primitives shared across pages */
import ReactSelect from 'react-select'
import CreatableSelect from 'react-select/creatable'
import makeAnimated from 'react-select/animated'

const _animatedComponents = makeAnimated()

const _selectStyles = {
  control: (base, state) => ({
    ...base,
    borderColor: state.isFocused ? '#3b82f6' : '#e2e8f0',
    boxShadow: state.isFocused ? '0 0 0 2px rgba(59,130,246,0.3)' : 'none',
    borderRadius: '0.75rem',
    fontSize: '0.875rem',
    minHeight: '42px',
    backgroundColor: state.isDisabled ? '#f8fafc' : 'white',
    cursor: 'pointer',
    '&:hover': { borderColor: state.isFocused ? '#3b82f6' : '#cbd5e1' },
  }),
  indicatorSeparator: () => ({ display: 'none' }),
  dropdownIndicator: (base, state) => ({
    ...base,
    color: state.isFocused ? '#3b82f6' : '#94a3b8',
    padding: '0 8px',
    transition: 'color 0.15s',
    '&:hover': { color: '#3b82f6' },
  }),
  clearIndicator: (base) => ({
    ...base,
    color: '#94a3b8',
    padding: '0 4px',
    '&:hover': { color: '#64748b' },
  }),
  placeholder: (base) => ({ ...base, color: '#94a3b8', fontSize: '0.875rem' }),
  singleValue: (base) => ({ ...base, color: '#0f172a', fontSize: '0.875rem' }),
  input: (base) => ({
    ...base,
    color: '#0f172a',
    fontSize: '0.875rem',
    border: 'none',
    outline: 'none',
    boxShadow: 'none',
    background: 'transparent',
    margin: 0,
    padding: 0,
  }),
  option: (base, state) => ({
    ...base,
    fontSize: '0.875rem',
    borderRadius: '0.5rem',
    padding: '8px 10px',
    backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
    color: state.isSelected ? 'white' : '#0f172a',
    cursor: 'pointer',
    '&:active': { backgroundColor: state.isSelected ? '#2563eb' : '#dbeafe' },
  }),
  menu: (base) => ({
    ...base,
    borderRadius: '0.75rem',
    border: '1px solid #e2e8f0',
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
    overflow: 'hidden',
  }),
  menuList: (base) => ({ ...base, padding: '4px' }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  multiValue: (base) => ({
    ...base,
    backgroundColor: '#eff6ff',
    borderRadius: '6px',
    border: '1px solid #bfdbfe',
  }),
  multiValueLabel: (base) => ({
    ...base,
    color: '#1d4ed8',
    fontSize: '0.75rem',
    padding: '2px 6px',
    fontWeight: '500',
  }),
  multiValueRemove: (base) => ({
    ...base,
    color: '#60a5fa',
    borderRadius: '0 6px 6px 0',
    padding: '0 4px',
    '&:hover': { backgroundColor: '#dbeafe', color: '#1e40af' },
  }),
  valueContainer: (base) => ({ ...base, padding: '2px 10px', gap: '4px' }),
}

// ─── Search Select ─────────────────────────────────────────────────────────────
export function SearchSelect({
  options = [],
  value,
  onChange,
  isMulti = false,
  placeholder = 'Search and select...',
  isDisabled = false,
  isClearable = false,
  noOptionsMessage,
  ...rest
}) {
  const selected = isMulti
    ? options.filter((opt) => (value || []).map(String).includes(String(opt.value)))
    : (value !== '' && value != null)
      ? options.find((opt) => String(opt.value) === String(value)) || null
      : null

  function handleChange(selectedOption) {
    if (isMulti) {
      onChange((selectedOption || []).map((opt) => opt.value))
    } else {
      onChange(selectedOption?.value ?? '')
    }
  }

  return (
    <ReactSelect
      options={options}
      value={selected}
      onChange={handleChange}
      isMulti={isMulti}
      placeholder={placeholder}
      isDisabled={isDisabled}
      isClearable={isClearable}
      components={_animatedComponents}
      styles={_selectStyles}
      menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
      noOptionsMessage={noOptionsMessage ? () => noOptionsMessage : undefined}
      {...rest}
    />
  )
}

// ─── Email Tag Select ──────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function EmailTagSelect({ value = [], onChange, placeholder = 'Type an email and press Enter...', inputId, isDisabled = false }) {
  const selected = (value || []).map((email) => ({ label: email, value: email }))

  function handleChange(options) {
    onChange((options || []).map((opt) => opt.value))
  }

  return (
    <CreatableSelect
      inputId={inputId}
      isMulti
      isClearable
      components={{ ...makeAnimated(), DropdownIndicator: null }}
      options={[]}
      value={selected}
      onChange={handleChange}
      isDisabled={isDisabled}
      placeholder={placeholder}
      isValidNewOption={(inputValue) => EMAIL_RE.test(inputValue.trim())}
      formatCreateLabel={(inputValue) => `Add "${inputValue}"`}
      styles={_selectStyles}
      menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
      noOptionsMessage={() => null}
    />
  )
}

// ─── Alert Banner ─────────────────────────────────────────────────────────────
export function AlertBanner({ type = 'error', message }) {
  if (!message) return null
  const styles = {
    error: 'bg-red-50 border-red-200 text-red-700',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  }
  const icons = {
    error: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    success: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  }
  return (
    <div className={`flex items-start gap-2.5 border rounded-xl px-4 py-3 text-sm mb-4 ${styles[type]}`}>
      {icons[type]}
      {message}
    </div>
  )
}

// ─── Page Topbar ──────────────────────────────────────────────────────────────
export function PageTopbar({ title, children }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl shadow-card p-5 mb-4 ${className}`}>
      {children}
    </div>
  )
}

// ─── Card Title ───────────────────────────────────────────────────────────────
export function CardTitle({ children }) {
  return <h2 className="text-sm font-semibold text-slate-900 mb-4">{children}</h2>
}

// ─── Loading State ────────────────────────────────────────────────────────────
export function LoadingState({ label = 'Loading...' }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-10 text-slate-500 text-sm">
      <span className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full spin" />
      {label}
    </div>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────
export function EmptyState({ message = 'No data found' }) {
  return (
    <div className="text-center py-10 text-slate-400 text-sm">{message}</div>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
export function Badge({ children, variant = 'gray' }) {
  const variants = {
    green: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    red: 'bg-red-50 text-red-700 border border-red-200',
    amber: 'bg-amber-50 text-amber-700 border border-amber-200',
    blue: 'bg-blue-50 text-blue-700 border border-blue-200',
    gray: 'bg-slate-100 text-slate-600 border border-slate-200',
    purple: 'bg-purple-50 text-purple-700 border border-purple-200',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${variants[variant]}`}>
      {children}
    </span>
  )
}

// ─── Primary Button ───────────────────────────────────────────────────────────
export function PrimaryBtn({ children, onClick, type = 'button', disabled, loading, className = '' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 bg-[#02c0fa] hover:bg-[#00a8e0] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm shadow-[#02c0fa]/20 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {loading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full spin" />}
      {children}
    </button>
  )
}

// ─── Secondary Button ─────────────────────────────────────────────────────────
export function SecondaryBtn({ children, onClick, type = 'button', disabled, className = '' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  )
}

// ─── Danger Button ────────────────────────────────────────────────────────────
export function DangerBtn({ children, onClick, type = 'button', disabled, loading, className = '' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {loading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full spin" />}
      {children}
    </button>
  )
}

// ─── Small Action Button ──────────────────────────────────────────────────────
export function ActionBtn({ children, onClick, type = 'button', disabled, variant = 'default' }) {
  const variants = {
    default: 'bg-slate-100 hover:bg-slate-200 text-slate-700',
    danger: 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200',
    primary: 'bg-[#02c0fa]/10 hover:bg-[#02c0fa]/20 text-[#0090d4]',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${variants[variant]}`}
    >
      {children}
    </button>
  )
}

// ─── Form Field ───────────────────────────────────────────────────────────────
export function FormField({ label, htmlFor, error, children }) {
  return (
    <div className="mb-4">
      {label && (
        <label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
          {label}
        </label>
      )}
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ─── Form Input ───────────────────────────────────────────────────────────────
export function FormInput({ id, ...props }) {
  return (
    <input
      id={id}
      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
      {...props}
    />
  )
}

// ─── Form Select ──────────────────────────────────────────────────────────────
export function FormSelect({ id, children, ...props }) {
  return (
    <select
      id={id}
      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all bg-white"
      {...props}
    >
      {children}
    </select>
  )
}

// ─── Form Textarea ────────────────────────────────────────────────────────────
export function FormTextarea({ id, ...props }) {
  return (
    <textarea
      id={id}
      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all resize-none"
      {...props}
    />
  )
}

// ─── Data Table ───────────────────────────────────────────────────────────────
export function DataTable({
  headers,
  children,
  loading,
  loadingLabel,
  allowHorizontalScroll = true,
  wrapperClassName = '',
  tableClassName = '',
}) {
  const wrapperClasses = allowHorizontalScroll ? 'overflow-x-auto -mx-5' : 'overflow-x-visible -mx-0'
  const tableClasses = allowHorizontalScroll ? 'w-full min-w-[640px]' : 'w-full table-fixed'

  return (
    <div className={`${wrapperClasses} ${wrapperClassName}`.trim()}>
      <table className={`${tableClasses} ${tableClassName}`.trim()}>
        <thead>
          <tr className="border-b border-slate-100">
            {headers.map((h) => (
              <th
                key={h}
                className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-5 py-3"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={headers.length}>
                <LoadingState label={loadingLabel} />
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── Table Row ────────────────────────────────────────────────────────────────
export function TableRow({ children }) {
  return (
    <tr className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors last:border-0">
      {children}
    </tr>
  )
}

// ─── Table Cell ───────────────────────────────────────────────────────────────
export function TableCell({ children, className = '' }) {
  return (
    <td className={`px-5 py-3.5 text-sm text-slate-700 ${className}`}>{children}</td>
  )
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
export function Avatar({ name, colorClass = 'bg-blue-100 text-blue-700' }) {
  const initials = name
    ? name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
    : '?'
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${colorClass}`}>
      {initials}
    </div>
  )
}

// ─── Modal Overlay ────────────────────────────────────────────────────────────
export function ModalOverlay({ onClose, children }) {
  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
