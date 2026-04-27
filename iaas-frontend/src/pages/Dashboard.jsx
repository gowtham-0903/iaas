import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import AppShell from '../components/AppShell'
import { getInterviews } from '../api/interviewsApi'
import { getQCDashboard } from '../api/qcApi'
import { getUsers } from '../api/usersApi'
import useAuthStore from '../store/authStore'

const BRAND = '#02c0fa'

function StatCard({ label, value, delta, deltaType = 'up', sub, icon, iconBg }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.10)] transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <span className="text-xs text-slate-500 font-medium">{label}</span>
        {delta !== undefined && (
          <span
            className={`flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${
              deltaType === 'up'
                ? 'text-emerald-600 bg-emerald-50'
                : 'text-red-500 bg-red-50'
            }`}
          >
            {deltaType === 'up' ? '↑' : '↓'} {delta}
          </span>
        )}
      </div>
      <div className="text-3xl font-bold text-slate-900 leading-none mb-2">{value}</div>
      {sub && <div className="text-xs text-slate-400 leading-snug">{sub}</div>}
    </div>
  )
}

function MiniBar({ label, pct, color, count }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-20 text-xs text-slate-500 shrink-0">{label}</div>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className="w-6 text-right text-xs font-semibold text-slate-700">{count}</div>
    </div>
  )
}

function getInitials(name) {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
}

const ROLE_COLORS = {
  ADMIN: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  M_RECRUITER: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
  SR_RECRUITER: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  RECRUITER: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  PANELIST: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  QC: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  CLIENT: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
}

const PIPELINE = [
  { label: 'Applied', count: 24, pct: 100, color: BRAND },
  { label: 'Shortlisted', count: 14, pct: 58, color: '#6366f1' },
  { label: 'Interviewed', count: 9, pct: 37, color: '#f59e0b' },
  { label: 'Offered', count: 3, pct: 12, color: '#10b981' },
  { label: 'Rejected', count: 5, pct: 20, color: '#ef4444' },
]

const QUICK_ACTIONS = [
  {
    label: 'New JD',
    to: '/jd',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
    ),
  },
  {
    label: 'Add Client',
    to: '/clients',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1" />
      </svg>
    ),
  },
  {
    label: 'Add Candidate',
    to: '/candidates',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
      </svg>
    ),
  },
  {
    label: 'AI Extraction',
    to: '/skill-extraction',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
]

export default function Dashboard() {
  const [users, setUsers] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [weekStats, setWeekStats] = useState({ interviewsThisWeek: '—', pendingQcReview: '—' })
  const navigate = useNavigate()
  const currentUserRole = useAuthStore((state) => state.user?.role)
  const isPanelist = currentUserRole === 'PANELIST'
  const showInterviewStats = ['ADMIN', 'RECRUITER', 'SR_RECRUITER', 'M_RECRUITER', 'PANELIST'].includes(currentUserRole)

  useEffect(() => {
    let alive = true

    async function loadData() {
      try {
        const now = new Date()
        const dayOfWeek = now.getDay()
        const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
        const startOfWeek = new Date(now)
        startOfWeek.setDate(now.getDate() + diffToMonday)
        startOfWeek.setHours(0, 0, 0, 0)

        const endOfWeek = new Date(startOfWeek)
        endOfWeek.setDate(startOfWeek.getDate() + 6)
        endOfWeek.setHours(23, 59, 59, 999)

        const requests = [getUsers()]
        if (showInterviewStats) {
          requests.push(getInterviews({
            date_from: startOfWeek.toISOString().slice(0, 10),
            date_to: endOfWeek.toISOString().slice(0, 10),
          }))
          if (!isPanelist) {
            requests.push(getQCDashboard())
          }
        }

        const [usersResponse, interviewsResponse, qcResponse] = await Promise.all(requests)

        if (!alive) return

        const data = usersResponse.data
        setUsers(Array.isArray(data) ? data : data?.users ?? [])

        if (showInterviewStats) {
          setWeekStats({
            interviewsThisWeek: interviewsResponse?.data?.interviews?.length ?? 0,
            pendingQcReview: qcResponse?.data?.pending_reviews ?? 0,
          })
        }
      } catch (_error) {
        if (!alive) return
        setUsers([])
        if (showInterviewStats) {
          setWeekStats({ interviewsThisWeek: '—', pendingQcReview: '—' })
        }
      } finally {
        if (alive) setIsLoading(false)
      }
    }

    loadData()
    return () => { alive = false }
  }, [showInterviewStats])

  return (
    <AppShell pageTitle="Overview" pageSubtitle="Get a quick snapshot of key metrics, candidate data, and pipeline trends">
      {/* ─── Row 1: Stat Cards ─────────────────────────── */}
      {!isPanelist && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
          <StatCard label="Active JDs" value="12" delta="+2" sub="2 added this week" />
          <StatCard label="Total Candidates" value="48" delta="+6.3%" sub="Increased by +7 this week" />
          <StatCard label="Interviews" value="9" sub="3 scheduled this week" />
          <StatCard label="Pending QC" value="5" delta="-2" deltaType="down" sub="Needs review before closing" />
        </div>
      )}

      {showInterviewStats ? (
        <div className={`grid grid-cols-1 ${isPanelist ? 'md:grid-cols-1' : 'md:grid-cols-2'} gap-4 mb-5`}>
          <StatCard label="Interviews This Week" value={weekStats.interviewsThisWeek} sub={isPanelist ? "Your assigned interviews this week" : "Scheduled during the current week"} />
          {!isPanelist && (
            <StatCard label="Pending QC Review" value={weekStats.pendingQcReview} sub="Completed interviews awaiting QC validation" />
          )}
        </div>
      ) : null}

      {/* ─── Row 2: Pipeline + Quick Actions ──────────── */}
      {!isPanelist && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        {/* Pipeline — 2/3 width */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Recruitment Pipeline</h2>
              <p className="text-xs text-slate-400 mt-0.5">Total applied this month</p>
            </div>
            <div className="text-2xl font-bold text-slate-900">24</div>
          </div>
          <div className="space-y-3.5">
            {PIPELINE.map((stage) => (
              <MiniBar key={stage.label} {...stage} />
            ))}
          </div>
          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center gap-4">
            {[
              { dot: BRAND, label: 'Applied', val: '24' },
              { dot: '#10b981', label: 'Offered', val: '3' },
              { dot: '#ef4444', label: 'Rejected', val: '5' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.dot }} />
                <span className="text-xs text-slate-500">{item.label}</span>
                <span className="text-xs font-bold text-slate-800 ml-0.5">•{item.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions — 1/3 */}
        <div className="bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => navigate(action.to)}
                className="flex flex-col items-center gap-2 p-3.5 rounded-xl border border-slate-100 hover:border-[#02c0fa]/40 hover:bg-[#02c0fa]/5 transition-all group text-center"
              >
                <span
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white transition-transform group-hover:scale-110"
                  style={{ background: 'linear-gradient(135deg, #02c0fa 0%, #0090d4 100%)' }}
                >
                  {action.icon}
                </span>
                <span className="text-xs font-medium text-slate-600 group-hover:text-slate-900 leading-tight">{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* ─── Row 3: Team Members table ─────────────────── */}
      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Team Members</h2>
            <p className="text-xs text-slate-400 mt-0.5">{users.length} members in platform</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/users')}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
          >
            View all →
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2.5 py-10 text-slate-500 text-sm">
            <span className="w-4 h-4 border-2 border-slate-200 border-t-[#02c0fa] rounded-full spin" />
            Loading team...
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">No users found</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {users.slice(0, 6).map((user) => {
              const rc = ROLE_COLORS[user.role] || { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' }
              return (
                <div key={user.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #02c0fa 0%, #0090d4 100%)' }}
                  >
                    {getInitials(user.full_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900 truncate">{user.full_name}</div>
                    <div className="text-xs text-slate-400 truncate">{user.email}</div>
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 border ${rc.bg} ${rc.text} ${rc.border}`}
                  >
                    {user.role}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ml-1 ${
                      user.is_active
                        ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                        : 'bg-red-50 text-red-500 border border-red-200'
                    }`}
                  >
                    {user.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}
