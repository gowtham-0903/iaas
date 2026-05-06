import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useNavigate, useSearchParams } from 'react-router-dom'

import AppShell from '../components/AppShell'
import { getClientCandidateReport, getClientDashboard, getClientResults } from '../api/clientPortalApi'
import {
  AlertBanner,
  Badge,
  Card,
  CardTitle,
  DataTable,
  EmptyState,
  LoadingState,
  PrimaryBtn,
  SecondaryBtn,
  TableCell,
  TableRow,
} from '../components/ui'

const TAB_OVERVIEW = 'overview'
const TAB_RESULTS = 'results'

const RECOMMENDATION_BADGES = {
  STRONG_HIRE: 'green',
  HIRE: 'blue',
  MAYBE: 'amber',
  NO_HIRE: 'red',
}

const PIPELINE_SEGMENT_STYLES = {
  scheduled: 'bg-blue-500',
  completed: 'bg-emerald-500',
  cancelled: 'bg-red-500',
  overdue: 'bg-orange-500',
}

function StatCard({ label, value, tone = 'text-slate-900' }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="text-xs font-medium text-slate-500 mb-3">{label}</div>
      <div className={`text-3xl font-bold leading-none ${tone}`}>{value}</div>
    </div>
  )
}

function formatDateTime(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRecommendation(value) {
  const map = {
    STRONG_HIRE: 'Strong Hire',
    HIRE: 'Hire',
    MAYBE: 'Maybe',
    NO_HIRE: 'No Hire',
  }
  return map[value] || 'Unknown'
}

function splitList(doc, items, x, startY, width) {
  let y = startY
  if (!items.length) {
    doc.text('None listed.', x, y)
    return y + 8
  }

  items.forEach((item) => {
    const lines = doc.splitTextToSize(`• ${item}`, width)
    doc.text(lines, x, y)
    y += (lines.length * 6) + 2
  })

  return y
}

function addReportFooter(doc) {
  const totalPages = doc.getNumberOfPages()
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page)
    doc.setFontSize(9)
    doc.setTextColor(100, 116, 139)
    doc.text('Confidential — Interview Assessment Report', 14, 288)
  }
}

export default function ClientDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const [dashboardData, setDashboardData] = useState(null)
  const [resultsData, setResultsData] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [downloadingCandidateId, setDownloadingCandidateId] = useState(null)
  const [error, setError] = useState('')

  const activeTab = searchParams.get('tab') === TAB_RESULTS ? TAB_RESULTS : TAB_OVERVIEW

  const resultsByJd = useMemo(() => {
    const map = new Map()
    resultsData.forEach((group) => {
      map.set(group.jd_id, group)
    })
    return map
  }, [resultsData])

  const summaryStats = useMemo(() => {
    const jdSummary = dashboardData?.jd_summary || []
    return {
      interviewsScheduled: jdSummary.reduce((sum, item) => sum + (item.interviews_scheduled || 0), 0),
      interviewsCompleted: jdSummary.reduce((sum, item) => sum + (item.interviews_completed || 0), 0),
      interviewsOverdue: jdSummary.reduce((sum, item) => sum + (item.interviews_overdue || 0), 0),
    }
  }, [dashboardData])

  useEffect(() => {
    let active = true

    async function loadData() {
      try {
        setIsLoading(true)
        setError('')

        const [dashboardResponse, resultsResponse] = await Promise.all([
          getClientDashboard(),
          getClientResults(),
        ])

        if (!active) return
        setDashboardData(dashboardResponse.data || null)
        setResultsData(resultsResponse.data?.results || [])
      } catch (_loadError) {
        if (active) {
          setError('Failed to load client dashboard data.')
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    loadData()

    return () => {
      active = false
    }
  }, [])

  function setActiveTab(tab) {
    if (tab === TAB_RESULTS) {
      setSearchParams({ tab: TAB_RESULTS })
      return
    }
    setSearchParams({})
  }

  async function handleDownloadReport(candidateId) {
    try {
      setDownloadingCandidateId(candidateId)
      setError('')

      const response = await getClientCandidateReport(candidateId)
      const report = response.data

      const doc = new jsPDF()
      const pageWidth = doc.internal.pageSize.getWidth()

      doc.setFontSize(18)
      doc.setTextColor(15, 23, 42)
      doc.text('Interview Report', 14, 18)
      doc.setFontSize(11)
      doc.setTextColor(100, 116, 139)
      doc.text('Meeden Labs', pageWidth - 14, 18, { align: 'right' })

      doc.setFontSize(12)
      doc.setTextColor(15, 23, 42)
      doc.text(`Candidate: ${report.candidate?.full_name || '—'}`, 14, 34)
      doc.text(`JD Title: ${report.jd?.title || '—'}`, 14, 42)
      doc.text(`Interview Date: ${formatDateTime(report.interview_date)}`, 14, 50)
      doc.text(`Recommendation: ${formatRecommendation(report.final_recommendation)}`, 14, 58)
      doc.text(`Overall Score: ${report.overall_score ?? '—'}`, 14, 66)
      if (report.qc_notes) {
        const qcNotes = doc.splitTextToSize(`QC Notes: ${report.qc_notes}`, 180)
        doc.text(qcNotes, 14, 78)
      }

      doc.addPage()
      doc.setFontSize(18)
      doc.setTextColor(15, 23, 42)
      doc.text('Skill Breakdown', 14, 18)
      autoTable(doc, {
        startY: 26,
        head: [['Skill', 'Type', 'Score']],
        body: (report.skill_breakdown || []).map((skill) => [
          skill.skill_name || '—',
          skill.skill_type || '—',
          skill.final_score ?? skill.combined_score ?? '—',
        ]),
        styles: {
          fontSize: 10,
          cellPadding: 3,
        },
        headStyles: {
          fillColor: [2, 192, 250],
        },
      })

      doc.addPage()
      doc.setFontSize(18)
      doc.setTextColor(15, 23, 42)
      doc.text('Assessment Summary', 14, 18)
      doc.setFontSize(12)
      doc.text('Summary', 14, 30)
      doc.setFontSize(10)
      const summaryLines = doc.splitTextToSize(report.summary || 'Placeholder summary.', 180)
      doc.text(summaryLines, 14, 38)

      const strengthsStartY = 60 + (summaryLines.length * 4)
      doc.setFontSize(12)
      doc.text('Strengths', 14, strengthsStartY)
      doc.setFontSize(10)
      const afterStrengthsY = splitList(doc, report.strengths || [], 14, strengthsStartY + 8, 180)

      doc.setFontSize(12)
      doc.text('Areas for Development', 14, afterStrengthsY + 6)
      doc.setFontSize(10)
      splitList(doc, report.areas_for_development || [], 14, afterStrengthsY + 14, 180)

      addReportFooter(doc)
      doc.save(`Interview_Report_${(report.candidate?.full_name || 'Candidate').replace(/\s+/g, '_')}.pdf`)
    } catch (_downloadError) {
      setError('Failed to generate the interview report.')
    } finally {
      setDownloadingCandidateId(null)
    }
  }

  return (
    <AppShell>
      <AlertBanner type="error" message={error} />

      <div className="flex items-center gap-2 mb-5">
        <button
          type="button"
          onClick={() => setActiveTab(TAB_OVERVIEW)}
          className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
            activeTab === TAB_OVERVIEW
              ? 'bg-blue-50 text-blue-700 border-blue-200'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setActiveTab(TAB_RESULTS)}
          className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
            activeTab === TAB_RESULTS
              ? 'bg-blue-50 text-blue-700 border-blue-200'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          Results
        </button>
      </div>

      {isLoading ? (
        <Card>
          <LoadingState label="Loading client dashboard..." />
        </Card>
      ) : activeTab === TAB_OVERVIEW ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4 mb-5">
            <StatCard label="Total JDs" value={dashboardData?.overall?.total_jds ?? 0} tone="text-blue-600" />
            <StatCard label="Total Candidates" value={dashboardData?.overall?.total_candidates ?? 0} />
            <StatCard label="Interviews Scheduled" value={summaryStats.interviewsScheduled} tone="text-blue-600" />
            <StatCard label="Interviews Completed" value={summaryStats.interviewsCompleted} tone="text-emerald-600" />
            <StatCard label="Overdue / No Show" value={summaryStats.interviewsOverdue} tone="text-red-600" />
            <StatCard label="Selected Candidates" value={dashboardData?.overall?.total_selected ?? 0} tone="text-emerald-600" />
          </div>

          {(dashboardData?.jd_summary || []).length === 0 ? (
            <Card>
              <EmptyState message="No job descriptions available for this client." />
            </Card>
          ) : (
            (dashboardData?.jd_summary || []).map((jd) => {
              const overdueCount = jd.interviews_overdue || 0
              const scheduledCount = Math.max((jd.interviews_scheduled || 0) - overdueCount, 0)
              const completedCount = jd.interviews_completed || 0
              const cancelledCount = jd.interviews_cancelled || 0

              const totalPipeline = scheduledCount + completedCount + cancelledCount + overdueCount
              const scheduledPct = totalPipeline ? (scheduledCount / totalPipeline) * 100 : 0
              const completedPct = totalPipeline ? ((jd.interviews_completed || 0) / totalPipeline) * 100 : 0
              const cancelledPct = totalPipeline ? ((jd.interviews_cancelled || 0) / totalPipeline) * 100 : 0
              const overduePct = totalPipeline ? (overdueCount / totalPipeline) * 100 : 0
              const hasApprovedResults = (resultsByJd.get(jd.jd_id)?.results || []).length > 0

              return (
                <Card key={jd.jd_id}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h2 className="text-lg font-semibold text-slate-900">{jd.jd_title}</h2>
                        <Badge variant="gray">{jd.job_code || 'No Job Code'}</Badge>
                      </div>
                      <div className="w-full max-w-xl">
                        <div className="flex overflow-hidden h-3 rounded-full bg-slate-100">
                          <div className={PIPELINE_SEGMENT_STYLES.scheduled} style={{ width: `${scheduledPct}%` }} />
                          <div className={PIPELINE_SEGMENT_STYLES.completed} style={{ width: `${completedPct}%` }} />
                          <div className={PIPELINE_SEGMENT_STYLES.cancelled} style={{ width: `${cancelledPct}%` }} />
                          <div className={PIPELINE_SEGMENT_STYLES.overdue} style={{ width: `${overduePct}%` }} />
                        </div>
                        <div className="flex flex-wrap gap-4 mt-2 text-xs text-slate-500">
                          <span>Scheduled: {scheduledCount}</span>
                          <span>Completed: {completedCount}</span>
                          <span>Cancelled: {cancelledCount}</span>
                          <span>Overdue: {overdueCount}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 lg:justify-end">
                      <div className="text-sm">
                        <div className="text-emerald-600 font-semibold">{jd.selected || 0}</div>
                        <div className="text-xs text-slate-500">Selected</div>
                      </div>
                      <div className="text-sm">
                        <div className="text-red-600 font-semibold">{jd.not_selected || 0}</div>
                        <div className="text-xs text-slate-500">Not Selected</div>
                      </div>
                      <PrimaryBtn
                        disabled={!hasApprovedResults}
                        onClick={() => {
                          setActiveTab(TAB_RESULTS)
                          navigate(`/client-dashboard?tab=${TAB_RESULTS}`)
                        }}
                      >
                        View Results
                      </PrimaryBtn>
                    </div>
                  </div>
                </Card>
              )
            })
          )}
        </>
      ) : (
        <>
          {resultsData.length === 0 ? (
            <Card>
              <EmptyState message="No approved interview results are available yet." />
            </Card>
          ) : (
            resultsData.map((group) => (
              <Card key={group.jd_id}>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <CardTitle>{group.jd_title}</CardTitle>
                  <Badge variant="gray">{group.job_code || 'No Job Code'}</Badge>
                </div>
                <DataTable
                  headers={['Candidate Name', 'Email', 'Interview Date', 'Score', 'Recommendation', 'Action']}
                >
                  {(group.results || []).map((result) => (
                    <TableRow key={result.candidate_id}>
                      <TableCell>{result.candidate_name || '—'}</TableCell>
                      <TableCell>{result.candidate_email || '—'}</TableCell>
                      <TableCell>{formatDateTime(result.interview_date)}</TableCell>
                      <TableCell className="font-semibold text-slate-900">{result.combined_score ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={RECOMMENDATION_BADGES[result.final_recommendation] || 'gray'}>
                          {formatRecommendation(result.final_recommendation)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <SecondaryBtn
                          onClick={() => handleDownloadReport(result.candidate_id)}
                          disabled={downloadingCandidateId === result.candidate_id}
                          className="px-3 py-2 text-xs"
                        >
                          {downloadingCandidateId === result.candidate_id ? 'Generating...' : 'Download Report'}
                        </SecondaryBtn>
                      </TableCell>
                    </TableRow>
                  ))}
                </DataTable>
              </Card>
            ))
          )}
        </>
      )}
    </AppShell>
  )
}
