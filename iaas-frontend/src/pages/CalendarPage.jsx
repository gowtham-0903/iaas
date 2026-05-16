import { useState, useEffect, useMemo } from 'react'
import AppShell from '../components/AppShell'
import CalendarWrapper from '../components/CalendarWrapper'
import { getCalendarEvents } from '../api/calendarApi'
import { getClients } from '../api/clientsApi'
import useAuthStore from '../store/authStore'

const STATUS_META = [
  { value: 'SCHEDULED', label: 'Scheduled', color: '#F59E0B', bg: 'bg-amber-100', text: 'text-amber-700' },
  { value: 'IN_PROGRESS', label: 'In Progress', color: '#3B82F6', bg: 'bg-blue-100', text: 'text-blue-700' },
  { value: 'COMPLETED', label: 'Completed', color: '#10B981', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { value: 'CANCELLED', label: 'Cancelled', color: '#EF4444', bg: 'bg-red-100', text: 'text-red-700' },
  { value: 'ABSENT', label: 'Absent', color: '#6B7280', bg: 'bg-slate-100', text: 'text-slate-600' },
]

function statusMeta(status) {
  return STATUS_META.find(s => s.value === status) || { label: status, bg: 'bg-slate-100', text: 'text-slate-600', color: '#94A3B8' }
}

function formatTime(isoStr) {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function formatDateTime(isoStr, timezone) {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  const opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }
  if (timezone) {
    try { opts.timeZone = timezone } catch (_) { /* ignore invalid tz */ }
  }
  return d.toLocaleString('en-US', opts)
}

function toLocalDateValue(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function defaultFilters() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0)
  return {
    start: toLocalDateValue(start),
    end: toLocalDateValue(end),
    client_id: '',
    status: '',
  }
}

// ── InterviewDetailModal ───────────────────────────────────────────────────────
function InterviewDetailModal({ event, onClose }) {
  const meta = statusMeta(event.status)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">{event.candidate_name}</h2>
            <p className="text-sm text-slate-500 mt-0.5">{event.job_title}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-100 ml-3 flex-shrink-0"
            type="button"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Status */}
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mb-4 ${meta.bg} ${meta.text}`}>
          <span className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: meta.color }} />
          {meta.label}
        </span>

        {/* Details grid */}
        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <div>
              <span className="text-slate-500">Client</span>
              <p className="text-slate-800 font-medium">{event.client_name}</p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <div>
              <span className="text-slate-500">Scheduled At</span>
              <p className="text-slate-800 font-medium">{formatDateTime(event.start_date, event.timezone)}</p>
              {event.timezone && <p className="text-slate-400 text-xs">{event.timezone}</p>}
            </div>
          </div>

          {event.panelists && event.panelists.length > 0 && (
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <div>
                <span className="text-slate-500">Panelists</span>
                <div className="mt-0.5 space-y-0.5">
                  {event.panelists.map((p, i) => (
                    <p key={i} className="text-slate-800 font-medium">{p.name}</p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {event.meeting_link && (
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <div>
                <span className="text-slate-500">Teams Meeting</span>
                <a
                  href={event.meeting_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[#02c0fa] hover:text-[#00a8e0] font-medium mt-0.5 text-xs truncate max-w-xs"
                >
                  Join Meeting
                </a>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}

// ── TodayStrip ─────────────────────────────────────────────────────────────────
function TodayStrip({ events, onSelect }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1.5 h-1.5 rounded-full bg-[#02c0fa]" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Today — {events.length} Interview{events.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
        {events.map(ev => {
          const meta = statusMeta(ev.status)
          return (
            <button
              key={ev.id}
              type="button"
              onClick={() => onSelect(ev)}
              className="flex-shrink-0 bg-white border border-slate-200 rounded-xl px-4 py-3 text-left hover:border-[#02c0fa]/40 hover:shadow-sm transition-all min-w-[200px] max-w-[240px]"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-[#02c0fa]">{formatTime(ev.start_date)}</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>
                  {meta.label}
                </span>
              </div>
              <p className="text-sm font-medium text-slate-800 truncate">{ev.candidate_name}</p>
              <p className="text-xs text-slate-500 truncate">{ev.job_title}</p>
              {ev.client_name && (
                <p className="text-xs text-slate-400 truncate mt-0.5">{ev.client_name}</p>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── FilterBar ──────────────────────────────────────────────────────────────────
function FilterBar({ filters, onChange, clients, userRole }) {
  const showClientFilter = ['ADMIN', 'QC'].includes(userRole)

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-500">From</label>
        <input
          type="date"
          value={filters.start}
          onChange={e => onChange({ ...filters, start: e.target.value })}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:border-[#02c0fa] focus:ring-1 focus:ring-[#02c0fa]/20"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-500">To</label>
        <input
          type="date"
          value={filters.end}
          onChange={e => onChange({ ...filters, end: e.target.value })}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:border-[#02c0fa] focus:ring-1 focus:ring-[#02c0fa]/20"
        />
      </div>

      {showClientFilter && clients.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500">Client</label>
          <select
            value={filters.client_id}
            onChange={e => onChange({ ...filters, client_id: e.target.value })}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:border-[#02c0fa] focus:ring-1 focus:ring-[#02c0fa]/20"
          >
            <option value="">All Clients</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-500">Status</label>
        <select
          value={filters.status}
          onChange={e => onChange({ ...filters, status: e.target.value })}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:border-[#02c0fa] focus:ring-1 focus:ring-[#02c0fa]/20"
        >
          <option value="">All Statuses</option>
          {STATUS_META.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => onChange(defaultFilters())}
        className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 transition-colors"
      >
        Reset
      </button>
    </div>
  )
}

// ── CalendarPage ───────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const user = useAuthStore(state => state.user)
  const [filters, setFilters] = useState(defaultFilters())
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [clients, setClients] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)

  useEffect(() => {
    if (['ADMIN', 'QC'].includes(user?.role)) {
      getClients()
        .then(r => setClients(r.data || []))
        .catch(() => setClients([]))
    }
  }, [user?.role])

  useEffect(() => {
    setLoading(true)
    const params = {}
    if (filters.start) params.start = filters.start
    if (filters.end) params.end = filters.end
    if (filters.client_id) params.client_id = filters.client_id
    if (filters.status) params.status = filters.status

    getCalendarEvents(params)
      .then(r => setEvents(r.data.events || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [filters])

  const todayEvents = useMemo(() => {
    const today = toLocalDateValue(new Date())
    return events.filter(e => e.start_date.startsWith(today))
  }, [events])

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Interview Calendar</h1>
          <p className="text-sm text-slate-500 mt-0.5">View and track all scheduled interviews</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {STATUS_META.map(s => (
            <div key={s.value} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
              <span className="text-xs text-slate-500">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar
        filters={filters}
        onChange={setFilters}
        clients={clients}
        userRole={user?.role}
      />

      {/* Today strip */}
      {todayEvents.length > 0 && (
        <TodayStrip events={todayEvents} onSelect={setSelectedEvent} />
      )}

      {/* Calendar */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center" style={{ height: '600px' }}>
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-[#02c0fa] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-slate-500">Loading calendar…</span>
            </div>
          </div>
        ) : (
          <CalendarWrapper events={events} onEventClick={setSelectedEvent} />
        )}
      </div>

      {/* Detail modal */}
      {selectedEvent && (
        <InterviewDetailModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </AppShell>
  )
}
