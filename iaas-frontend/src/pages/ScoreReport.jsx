import AppShell from '../components/AppShell'
import MetricCard from '../components/MetricCard'
import ProgressBar from '../components/ProgressBar'

export default function ScoreReport() {
  return (
    <AppShell>
      <div className="topbar">
        <h1>Score Report — Arjun Rajan</h1>
        <div className="report-actions">
          <button className="btn">Email Report</button>
          <button className="btn btn-primary">Download PDF</button>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Overall score" value="82%" valueClassName="metric-val-blue" />
        <MetricCard label="Primary skills" value="87%" valueClassName="metric-val-blue" />
        <MetricCard label="Secondary skills" value="70%" valueClassName="metric-val-green" />
        <MetricCard label="Recommendation" value="Strong Hire" valueClassName="metric-val-strong" />
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-title">Skill match breakdown</div>
          <ProgressBar label="React.js" value="90%" fillWidth="90%" />
          <ProgressBar label="Node.js" value="75%" fillWidth="75%" />
          <ProgressBar label="TypeScript" value="85%" fillWidth="85%" />
          <ProgressBar label="REST APIs" value="95%" fillWidth="95%" />
          <ProgressBar label="Docker" value="65%" fillWidth="65%" fillColor="#BA7517" />
          <ProgressBar label="AWS" value="55%" fillWidth="55%" fillColor="#BA7517" />
        </div>
        <div className="card">
          <div className="card-title">AI analysis</div>
          <p className="feedback-section-title-success">Strengths</p>
          <p className="report-copy">
            Strong React fundamentals. Excellent API design knowledge. Clear communication during technical questions.
          </p>
          <p className="feedback-section-title-warning">Areas of concern</p>
          <p className="report-copy">
            Limited cloud infrastructure exposure. Docker knowledge is theoretical rather than hands-on.
          </p>
          <p className="feedback-section-title-primary">Next steps</p>
          <p className="report-copy report-copy-last">
            Proceed to offer stage. Recommend a cloud onboarding plan in the first 30 days.
          </p>
        </div>
      </div>
    </AppShell>
  )
}
