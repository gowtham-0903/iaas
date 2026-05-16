// InterviewReport.jsx — M4 Phase 4 full report page
import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import {
  SectionBanner, CircleGauge, SkillCircle, DonutRing,
  RecBadge, Avatar, SkeletonBlock, SkillsTree,
} from '../components/ReportComponents'
import useReportData from '../utils/useReportData'
import useAuthStore from '../store/authStore'
import { avgToTen, fmtScore, fmtDate, scoreColor, skillColor, safeJson, exportPdf, exportExcel } from '../utils/reportUtils'

const NAVY = '#1B3A6B'
const ALLOWED = ['ADMIN', 'QC', 'M_RECRUITER', 'SR_RECRUITER', 'RECRUITER', 'CLIENT']

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
function ReportSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="rounded-2xl h-44 bg-slate-200" />
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl h-48 bg-slate-200" />
        <div className="rounded-xl h-48 bg-slate-200" />
      </div>
      <div className="rounded-xl h-40 bg-slate-200" />
      <div className="rounded-xl h-64 bg-slate-200" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
function NoScoreState({ onGenerate, loading }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6">
      <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center">
        <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6M3 21h18M5 21V7l7-4 7 4v14" />
        </svg>
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-slate-800 mb-2">Report Not Yet Generated</h2>
        <p className="text-slate-500 text-sm">The AI score has not been generated for this interview yet.</p>
      </div>
      <button
        onClick={onGenerate}
        disabled={loading}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white text-sm transition-all"
        style={{ background: NAVY, opacity: loading ? 0.7 : 1 }}
      >
        {loading ? 'Generating…' : '✦ Generate AI Score'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page 1 — Header card
// ---------------------------------------------------------------------------
function HeaderCard({ aiScore, qcReview }) {
  const candidate = qcReview?.candidate || {}
  const jd = qcReview?.jd || {}
  const name = candidate.full_name || '—'
  const score = aiScore?.overall_score ?? null
  const rec = aiScore?.recommendation
  const cfg = rec ? { STRONG_HIRE: '#16a34a', HIRE: '#2563eb', MAYBE: '#d97706', NO_HIRE: '#dc2626' }[rec] : '#6b7280'

  return (
    <div className="rounded-2xl overflow-hidden mb-5 print:rounded-none" style={{ background: NAVY }}>
      <div className="flex items-center gap-6 p-7">
        <Avatar name={name} size={80} />

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-blue-200 uppercase tracking-widest mb-1">{jd.job_code || aiScore?.job_code || ''}</p>
          <h1 className="text-2xl font-bold text-white leading-tight mb-1">{name}</h1>
          <p className="text-blue-200 text-sm font-medium mb-3">{jd.title || '—'}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-blue-100">
            {candidate.email && <span>✉ {candidate.email}</span>}
            {candidate.phone && <span>📞 {candidate.phone}</span>}
            {candidate.client_name && <span>🏢 {candidate.client_name}</span>}
            {qcReview?.interview_date && <span>📅 {fmtDate(qcReview.interview_date)}</span>}
          </div>
        </div>

        <div className="flex flex-col items-center gap-2 flex-shrink-0">
          <CircleGauge score={score} max={100} size={110} strokeWidth={10} />
          <span className="text-white text-xs font-semibold opacity-80">Overall Score</span>
          {rec && (
            <span className="mt-1 px-3 py-1 rounded-full text-xs font-bold text-white" style={{ background: cfg }}>
              {rec.replace('_', ' ')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page 1 — Resume Summary + Skills Tree
// ---------------------------------------------------------------------------
function Page1Lower({ aiSuggestion, aiScore, skillBreakdown }) {
  const summary = aiSuggestion?.resume_summary || ''
  const bullets = summary.split(/[.\n]/).map(s => s.trim()).filter(Boolean)

  const primary = skillBreakdown.filter(s => s.skill_type === 'primary')
  const secondary = skillBreakdown.filter(s => s.skill_type === 'secondary')
  const soft = skillBreakdown.filter(s => s.skill_type === 'soft')

  const avg = arr => arr.length ? arr.reduce((a, b) => a + avgToTen(b.panelist_avg), 0) / arr.length : 0

  const softSkills = aiSuggestion?.soft_skill_analysis || {}
  const analyticalSkills = aiSuggestion?.analytical_skills || {}

  const SOFT_COLORS = ['#2563eb', '#16a34a', '#d97706']
  const softItems = [
    { label: 'Confidence', rating: softSkills.confidence?.rating || '—', pct: 75, color: SOFT_COLORS[0] },
    { label: 'Communication', rating: softSkills.communication?.rating || '—', pct: 68, color: SOFT_COLORS[1] },
    { label: 'Pressure Handling', rating: softSkills.pressure_handling?.rating || '—', pct: 72, color: SOFT_COLORS[2] },
  ]
  const analyticalItems = [
    { label: 'Approach & Attitude', rating: analyticalSkills.approach_attitude?.rating || '—', pct: 78, color: '#7c3aed' },
    { label: 'Problem Solving', rating: analyticalSkills.problem_solving?.rating || '—', pct: 70, color: '#0891b2' },
    { label: 'Result Oriented', rating: analyticalSkills.result_oriented?.rating || '—', pct: 65, color: '#be185d' },
  ]

  return (
    <>
      {/* Resume + Skills tree */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 font-bold text-white text-sm uppercase tracking-wide" style={{ background: NAVY }}>
            Resume Summary
          </div>
          <div className="p-5">
            <ul className="space-y-2">
              {bullets.slice(0, 8).map((b, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-700">
                  <span className="text-blue-500 mt-1 flex-shrink-0">•</span>
                  <span>{b}</span>
                </li>
              ))}
              {!bullets.length && <li className="text-slate-400 text-sm italic">No resume summary available.</li>}
            </ul>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 font-bold text-white text-sm uppercase tracking-wide" style={{ background: NAVY }}>
            Overall Skills
          </div>
          <div className="p-5">
            <SkillsTree primaryAvg={avg(primary)} secondaryAvg={avg(secondary)} softAvg={avg(soft)} />
          </div>
        </div>
      </div>

      {/* Soft + Analytical */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 font-bold text-white text-sm uppercase tracking-wide" style={{ background: NAVY }}>
            Soft Skills Analysis
          </div>
          <div className="p-5">
            <DonutRing items={softItems} />
            {Object.keys(softSkills).length === 0 && (
              <p className="text-slate-400 text-sm italic">No soft skill data available.</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 font-bold text-white text-sm uppercase tracking-wide" style={{ background: NAVY }}>
            Analytical Skills
          </div>
          <div className="p-5">
            <DonutRing items={analyticalItems} />
            {Object.keys(analyticalSkills).length === 0 && (
              <p className="text-slate-400 text-sm italic">No analytical skill data available.</p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Page 2 — Skills breakdown grid
// ---------------------------------------------------------------------------
function SkillsGrid({ title, skills }) {
  if (!skills.length) return null
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-5">
      <SectionBanner>{title}</SectionBanner>
      <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {skills.map((s, i) => (
          <SkillCircle key={i} skillName={s.skill_name} score10={avgToTen(s.panelist_avg)} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page 2 — QC Consolidated Review
// ---------------------------------------------------------------------------
function QCSection({ qcReview }) {
  if (!qcReview?.review?.approved) return null
  const rev = qcReview.review
  const overrides = rev.skill_overrides || []
  const jdSkills = qcReview.jd?.skills || []
  const skillMap = Object.fromEntries(jdSkills.map(s => [s.id, s.skill_name]))
  const validator = rev.validated_by
  const validatedAt = rev.validated_at ? fmtDate(rev.validated_at) : '—'

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-5">
      <SectionBanner>QC Consolidated Review</SectionBanner>
      <div className="p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs text-slate-400 uppercase font-semibold">QC Reviewer</p>
            <p className="font-semibold text-slate-800 text-sm">{validator || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase font-semibold">Approved On</p>
            <p className="font-semibold text-slate-800 text-sm">{validatedAt}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase font-semibold">Final Recommendation</p>
            <RecBadge rec={rev.final_recommendation} />
          </div>
        </div>

        {rev.qc_notes && (
          <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-700 leading-relaxed border border-slate-100">
            <p className="text-xs font-bold text-slate-400 uppercase mb-1">QC Notes</p>
            <p>{rev.qc_notes}</p>
          </div>
        )}

        {overrides.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-2">Score Overrides</p>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left p-2 border border-slate-100 font-semibold text-slate-600">Skill</th>
                  <th className="text-center p-2 border border-slate-100 font-semibold text-slate-600">QC Score</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="p-2 border border-slate-100">{skillMap[o.skill_id] || `Skill #${o.skill_id}`}</td>
                    <td className="p-2 border border-slate-100 text-center font-bold text-blue-600">{o.final_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page 3 — Final Remarks + Panelist comparison
// ---------------------------------------------------------------------------
function FinalRemarks({ aiSuggestion, qcReview }) {
  const remarks = aiSuggestion?.final_remarks || {}
  const strengths = aiSuggestion?.strengths || []
  const concerns = aiSuggestion?.concerns || []
  const panelists = qcReview?.panelists || []
  const jdSkills = qcReview?.jd?.skills || []

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-5">
      <SectionBanner>Detailed Feedback — Final Remarks</SectionBanner>
      <div className="p-5 space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
            <p className="text-xs font-bold text-emerald-600 uppercase mb-2">Strengths</p>
            <ul className="space-y-1">
              {strengths.slice(0, 5).map((s, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-700">
                  <span className="text-emerald-500 mt-0.5">✓</span>{s}
                </li>
              ))}
              {strengths.length === 0 && <li className="text-slate-400 italic text-sm">—</li>}
            </ul>
            {remarks.strengths_paragraph && (
              <p className="text-sm text-slate-600 mt-3 leading-relaxed">{remarks.strengths_paragraph}</p>
            )}
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-xs font-bold text-blue-600 uppercase mb-2">Conclusion</p>
            <p className="text-sm text-slate-700 leading-relaxed">
              {remarks.conclusion || (concerns[0] || 'No conclusion available.')}
            </p>
            {concerns.length > 0 && (
              <ul className="mt-3 space-y-1">
                {concerns.slice(0, 3).map((c, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-600">
                    <span className="text-amber-500">⚠</span>{c}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Panelist comparison table */}
        {panelists.length > 0 && jdSkills.length > 0 && (
          <div className="overflow-x-auto">
            <p className="text-xs font-bold text-slate-400 uppercase mb-2">Panelist Score Comparison</p>
            <table className="w-full text-xs border-collapse min-w-[500px]">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left p-2 font-semibold">Skill</th>
                  {panelists.map((p, i) => (
                    <th key={i} className="text-center p-2 font-semibold">{p.panelist_name?.split(' ')[0] || `P${i+1}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jdSkills.map((skill, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="p-2 border border-slate-100 font-medium">{skill.skill_name}</td>
                    {panelists.map((p, j) => {
                      const s = p.scores?.find(sc => sc.skill_id === skill.id)
                      const avg = s ? ((s.technical_score + s.communication_score + s.problem_solving_score) / 3).toFixed(1) : '—'
                      return <td key={j} className="p-2 border border-slate-100 text-center">{avg}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page 3 — Screening Questions
// ---------------------------------------------------------------------------
function ScreeningQuestions({ aiSuggestion }) {
  const qa = aiSuggestion?.screening_question_analysis || []
  if (!qa.length) return null

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-5">
      <SectionBanner>Screening Questions</SectionBanner>
      <div className="p-5 space-y-4">
        {qa.map((item, i) => (
          <div key={i} className="rounded-xl overflow-hidden border border-slate-100">
            <div className="bg-slate-700 px-4 py-2 text-white text-sm font-semibold flex justify-between items-center">
              <span>Q{i + 1}: {item.question}</span>
              {item.score != null && (
                <span className="ml-3 px-2 py-0.5 rounded-full text-xs font-bold bg-white text-slate-800">
                  {item.score}/10
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-x divide-slate-100 bg-white">
              <div className="p-4">
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">Panelist Notes</p>
                <p className="text-sm text-slate-700">{item.panelist_notes || '—'}</p>
              </div>
              <div className="p-4">
                <p className="text-xs font-bold text-blue-400 uppercase mb-1">AI Assessment</p>
                <p className="text-sm text-slate-700">{item.ai_assessment || '—'}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page 3 — Code Snippets
// ---------------------------------------------------------------------------
function CodeSnippets({ qcReview }) {
  const panelists = qcReview?.panelists || []
  const allCodingQA = panelists.flatMap(p => safeJson(p.coding_qa, []) || [])
  if (!allCodingQA.length) return null

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-5">
      <SectionBanner>Code Snippets</SectionBanner>
      <div className="p-5 space-y-4">
        {allCodingQA.map((item, i) => (
          <div key={i} className="rounded-xl overflow-hidden border border-slate-100">
            <div className="bg-blue-700 px-4 py-2 text-white text-sm font-semibold">
              {item.question || `Question ${i + 1}`}
            </div>
            <pre className="bg-slate-900 text-green-400 text-xs p-4 overflow-x-auto leading-relaxed font-mono whitespace-pre-wrap">
              {item.answer || item.code || '# No code submitted'}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main InterviewReport page
// ---------------------------------------------------------------------------
export default function InterviewReport() {
  const { interviewId } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const reportRef = useRef(null)
  const [exporting, setExporting] = useState(false)

  const {
    loading, error, noScore,
    aiScore, qcReview, skillBreakdown, aiSuggestion,
    handleGenerate,
  } = useReportData(interviewId)

  // Role guard
  if (user && !ALLOWED.includes(user.role)) {
    return (
      <AppShell>
        <div className="flex flex-col items-center py-20 gap-3">
          <p className="text-slate-500 font-semibold">You do not have permission to view this report.</p>
          <button onClick={() => navigate(-1)} className="text-blue-600 text-sm underline">Go Back</button>
        </div>
      </AppShell>
    )
  }

  const candidateName = qcReview?.candidate?.full_name || ''
  const primarySkills = skillBreakdown.filter(s => s.skill_type === 'primary')
  const secondarySkills = skillBreakdown.filter(s => s.skill_type === 'secondary')

  const handlePdf = async () => {
    setExporting(true)
    try { await exportPdf(reportRef, candidateName) } finally { setExporting(false) }
  }

  const handleExcel = async () => {
    setExporting(true)
    try {
      await exportExcel({
        candidate: { ...qcReview?.candidate, interview_date: qcReview?.interview_date },
        jd: qcReview?.jd,
        aiScore,
        skillBreakdown,
        screeningQA: aiSuggestion?.screening_question_analysis || [],
        qcReview: qcReview?.review,
      })
    } finally { setExporting(false) }
  }

  return (
    <AppShell>
      {/* Topbar */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-slate-800">Interview Report</h1>
          {interviewId && <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">#{interviewId}</span>}
        </div>
        {!loading && !noScore && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleExcel}
              disabled={exporting}
              className="inline-flex items-center gap-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 6h18M3 14h18M3 18h18" />
              </svg>
              Download Excel
            </button>
            <button
              onClick={handlePdf}
              disabled={exporting}
              className="inline-flex items-center gap-2 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
              style={{ background: NAVY }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {exporting ? 'Exporting…' : 'Download PDF'}
            </button>
          </div>
        )}
      </div>

      {/* States */}
      {loading && <ReportSkeleton />}
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-5 text-red-700 text-sm">{error}</div>
      )}
      {noScore && !loading && (
        <NoScoreState onGenerate={handleGenerate} loading={loading} />
      )}

      {/* Report body */}
      {!loading && !error && !noScore && aiScore && (
        <div ref={reportRef} className="space-y-0 bg-white" id="report-root">
          {/* PAGE 1 */}
          <HeaderCard aiScore={aiScore} qcReview={qcReview} />
          <Page1Lower aiSuggestion={aiSuggestion} aiScore={aiScore} skillBreakdown={skillBreakdown} />

          {/* PAGE 2 */}
          <SkillsGrid title="Mandatory Skills" skills={primarySkills} />
          {secondarySkills.length > 0 && <SkillsGrid title="Optional Skills" skills={secondarySkills} />}
          <QCSection qcReview={qcReview} />

          {/* PAGE 3 */}
          <FinalRemarks aiSuggestion={aiSuggestion} qcReview={qcReview} />
          <ScreeningQuestions aiSuggestion={aiSuggestion} />
          <CodeSnippets qcReview={qcReview} />
        </div>
      )}
    </AppShell>
  )
}
