import { useState } from 'react'
import AppShell from '../components/AppShell'

const initialScores = {
  react: 4,
  node: 3,
  typescript: 4,
  rest: 5,
  docker: 3,
  aws: 2,
}

export default function FeedbackForm() {
  const [scores, setScores] = useState(initialScores)
  const [recommendation, setRecommendation] = useState('Strong Hire')
  const [comments, setComments] = useState('')

  function updateScore(key, value) {
    setScores((current) => ({ ...current, [key]: Number(value) }))
  }

  return (
    <AppShell logoSubtitle="Panelist view">
      <div className="topbar">
        <h1>Feedback — Arjun Rajan · Sr. React Dev</h1>
      </div>

      <div className="card card-stack">
        <div className="card-title feedback-section-title-info">Primary Skills</div>
        <div className="slider-row">
          <span className="slider-label">React.js</span>
          <input type="range" min="1" max="5" value={scores.react} onChange={(event) => updateScore('react', event.target.value)} />
          <span className="slider-val">{scores.react}</span>
        </div>
        <div className="slider-row">
          <span className="slider-label">Node.js</span>
          <input type="range" min="1" max="5" value={scores.node} onChange={(event) => updateScore('node', event.target.value)} />
          <span className="slider-val">{scores.node}</span>
        </div>
        <div className="slider-row">
          <span className="slider-label">TypeScript</span>
          <input type="range" min="1" max="5" value={scores.typescript} onChange={(event) => updateScore('typescript', event.target.value)} />
          <span className="slider-val">{scores.typescript}</span>
        </div>
        <div className="slider-row">
          <span className="slider-label">REST APIs</span>
          <input type="range" min="1" max="5" value={scores.rest} onChange={(event) => updateScore('rest', event.target.value)} />
          <span className="slider-val">{scores.rest}</span>
        </div>
      </div>

      <div className="card card-stack">
        <div className="card-title feedback-section-title-secondary">Secondary Skills</div>
        <div className="slider-row">
          <span className="slider-label">Docker</span>
          <input type="range" min="1" max="5" value={scores.docker} onChange={(event) => updateScore('docker', event.target.value)} />
          <span className="slider-val">{scores.docker}</span>
        </div>
        <div className="slider-row">
          <span className="slider-label">AWS</span>
          <input type="range" min="1" max="5" value={scores.aws} onChange={(event) => updateScore('aws', event.target.value)} />
          <span className="slider-val">{scores.aws}</span>
        </div>
      </div>

      <div className="card">
        <div className="form-group">
          <label className="form-label" htmlFor="recommendation">Overall recommendation</label>
          <select id="recommendation" value={recommendation} onChange={(event) => setRecommendation(event.target.value)}>
            <option>Hire</option>
            <option>Strong Hire</option>
            <option>Maybe</option>
            <option>No Hire</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="comments">Comments</label>
          <textarea id="comments" rows="3" placeholder="Key observations about the candidate..." value={comments} onChange={(event) => setComments(event.target.value)} />
        </div>
        <button className="btn btn-primary">Submit Feedback</button>
      </div>
    </AppShell>
  )
}
