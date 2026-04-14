import AppShell from '../components/AppShell'
import SkillChip from '../components/SkillChip'

export default function SkillExtraction() {
  return (
    <AppShell>
      <div className="topbar">
        <h1>Senior React Developer — Skill Extraction</h1>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-title">Upload / Paste JD</div>
          <div className="form-group">
            <label className="form-label" htmlFor="jd-text">Paste JD text</label>
            <textarea id="jd-text" rows="5" placeholder="Paste job description here..." />
          </div>
          <p className="section-copy">or</p>
          <button className="btn btn-block btn-stack">Upload PDF / Word file</button>
          <button className="btn btn-primary btn-block">Extract Skills with AI</button>
        </div>

        <div className="card">
          <div className="card-title">Extracted Skills</div>
          <p className="skill-section-label">Primary skills</p>
          <div className="skill-group">
            <SkillChip variant="primary">React.js</SkillChip>
            <SkillChip variant="primary">Node.js</SkillChip>
            <SkillChip variant="primary">TypeScript</SkillChip>
            <SkillChip variant="primary">REST APIs</SkillChip>
          </div>
          <p className="skill-section-label">Secondary skills</p>
          <div className="skill-group-lg">
            <SkillChip variant="secondary">Docker</SkillChip>
            <SkillChip variant="secondary">AWS</SkillChip>
            <SkillChip variant="secondary">GraphQL</SkillChip>
          </div>
          <p className="skill-section-label">Subtopics — React.js</p>
          <div className="skill-group-lg">
            <SkillChip>Hooks</SkillChip>
            <SkillChip>Context API</SkillChip>
            <SkillChip>Performance</SkillChip>
          </div>
          <button className="btn btn-primary btn-block">Save Skills</button>
        </div>
      </div>
    </AppShell>
  )
}
