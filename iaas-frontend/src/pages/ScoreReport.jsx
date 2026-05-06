import AppShell from '../components/AppShell'
import MetricCard from '../components/MetricCard'
import ProgressBar from '../components/ProgressBar'
import { Card, CardTitle } from '../components/ui'

export default function ScoreReport() {
  return (
    <AppShell>
      {/* Actions topbar */}
      <div className="flex items-center justify-between mb-5">
        <div />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Email Report
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 bg-[#02c0fa] hover:bg-[#00a8e0] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm shadow-[#02c0fa]/20"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download PDF
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <MetricCard label="Overall Score" value="82%" valueClassName="text-blue-600" />
        <MetricCard label="Primary Skills" value="87%" valueClassName="text-blue-600" />
        <MetricCard label="Secondary Skills" value="70%" valueClassName="text-emerald-600" />
        <MetricCard label="Recommendation" value="Strong Hire" valueClassName="text-emerald-600 text-xl" />
      </div>

      {/* Two col */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Skill breakdown */}
        <Card>
          <CardTitle>Skill Match Breakdown</CardTitle>
          <div className="space-y-1">
            <ProgressBar label="React.js" value="90%" fillWidth="90%" />
            <ProgressBar label="Node.js" value="75%" fillWidth="75%" />
            <ProgressBar label="TypeScript" value="85%" fillWidth="85%" />
            <ProgressBar label="REST APIs" value="95%" fillWidth="95%" />
            <ProgressBar label="Docker" value="65%" fillWidth="65%" fillColor="#d97706" />
            <ProgressBar label="AWS" value="55%" fillWidth="55%" fillColor="#d97706" />
          </div>
        </Card>

        {/* AI analysis */}
        <Card>
          <CardTitle>AI Analysis</CardTitle>
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Strengths</span>
              </div>
              <p className="text-sm text-emerald-800">
                Strong React fundamentals. Excellent API design knowledge. Clear communication during technical questions.
              </p>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Areas of Concern</span>
              </div>
              <p className="text-sm text-amber-800">
                Limited cloud infrastructure exposure. Docker knowledge is theoretical rather than hands-on.
              </p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Next Steps</span>
              </div>
              <p className="text-sm text-blue-800">
                Proceed to offer stage. Recommend a cloud onboarding plan in the first 30 days.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
