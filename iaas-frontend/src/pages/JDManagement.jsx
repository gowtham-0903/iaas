import AppShell from '../components/AppShell'
import SkillChip from '../components/SkillChip'

export default function JDManagement() {
  return (
    <AppShell>
      <div className="topbar">
        <h1>Job Descriptions</h1>
        <button className="btn btn-primary">+ Add JD</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Client</th>
              <th>Skills</th>
              <th>Candidates</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="table-title-cell">Senior React Developer</td>
              <td>Acme Corp</td>
              <td>
                <SkillChip variant="primary">React</SkillChip>
                <SkillChip variant="primary">Node</SkillChip>
                <SkillChip variant="secondary">+3</SkillChip>
              </td>
              <td>12</td>
              <td><span className="badge badge-green">Active</span></td>
              <td><button className="btn table-action-btn">View</button></td>
            </tr>
            <tr>
              <td className="table-title-cell">Product Manager</td>
              <td>TechStart</td>
              <td>
                <SkillChip variant="primary">Agile</SkillChip>
                <SkillChip variant="secondary">+2</SkillChip>
              </td>
              <td>7</td>
              <td><span className="badge badge-amber">Draft</span></td>
              <td><button className="btn table-action-btn">View</button></td>
            </tr>
            <tr>
              <td className="table-title-cell">DevOps Engineer</td>
              <td>CloudBase</td>
              <td>
                <SkillChip variant="primary">Docker</SkillChip>
                <SkillChip variant="primary">AWS</SkillChip>
              </td>
              <td>5</td>
              <td><span className="badge badge-blue">Active</span></td>
              <td><button className="btn table-action-btn">View</button></td>
            </tr>
            <tr>
              <td className="table-title-cell">ML Engineer</td>
              <td>DataFlow</td>
              <td>
                <SkillChip variant="primary">Python</SkillChip>
                <SkillChip variant="secondary">+4</SkillChip>
              </td>
              <td>9</td>
              <td><span className="badge badge-red">Closed</span></td>
              <td><button className="btn table-action-btn">View</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppShell>
  )
}
