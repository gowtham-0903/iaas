import AppShell from '../components/AppShell'

export default function Candidates() {
  return (
    <AppShell>
      <div className="topbar">
        <h1>Candidates — Senior React Developer</h1>
        <button className="btn btn-primary">+ Add Candidate</button>
      </div>

      <div className="pipeline">
        <div className="pipeline-col">
          <div className="pipeline-header pipeline-header-default">
            Applied · 3
          </div>
          <div className="pipeline-card"><div className="name">Arjun Rajan</div><div className="meta">arjun@email.com</div></div>
          <div className="pipeline-card"><div className="name">Priya Kumar</div><div className="meta">priya@email.com</div></div>
          <div className="pipeline-card"><div className="name">Ravi S.</div><div className="meta">ravi@email.com</div></div>
        </div>
        <div className="pipeline-col">
          <div className="pipeline-header pipeline-header-info">
            Shortlisted · 2
          </div>
          <div className="pipeline-card"><div className="name">Sara Mathew</div><div className="meta">Scheduled 20 Apr</div></div>
          <div className="pipeline-card"><div className="name">Kiran V.</div><div className="meta">Scheduled 21 Apr</div></div>
        </div>
        <div className="pipeline-col">
          <div className="pipeline-header pipeline-header-warning">
            Interviewed · 1
          </div>
          <div className="pipeline-card"><div className="name">Deepa Nair</div><div className="meta">Score: 78%</div></div>
        </div>
        <div className="pipeline-col">
          <div className="pipeline-header pipeline-header-success">
            Offered · 1
          </div>
          <div className="pipeline-card"><div className="name">Anand Raj</div><div className="meta">Strong Hire</div></div>
        </div>
      </div>
    </AppShell>
  )
}
