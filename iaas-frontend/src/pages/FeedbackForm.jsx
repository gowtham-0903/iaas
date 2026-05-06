import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card, CardTitle } from '../components/ui'
import useAuthStore from '../store/authStore'

const initialScores = {
  react: 4,
  node: 3,
  typescript: 4,
  rest: 5,
  docker: 3,
  aws: 2,
}

function ScoreSlider({ label, value, onChange }) {
  const pct = ((value - 1) / 4) * 100
  const color = value >= 4 ? 'text-emerald-600' : value === 3 ? 'text-amber-600' : 'text-red-500'
  return (
    <div className="mb-5">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
          <span className="text-xs text-slate-400">/5</span>
        </div>
      </div>
      <input
        type="range"
        min="1"
        max="5"
        value={value}
        onChange={onChange}
        style={{ '--range-pct': `${pct}%` }}
      />
      <div className="flex justify-between mt-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`text-[10px] ${value === n ? 'text-blue-600 font-semibold' : 'text-slate-300'}`}>{n}</span>
        ))}
      </div>
    </div>
  )
}

export default function FeedbackForm() {
  const navigate = useNavigate()
  const userRole = useAuthStore((state) => state.user?.role)
  const [scores, setScores] = useState(initialScores)
  const [recommendation, setRecommendation] = useState('Strong Hire')
  const [comments, setComments] = useState('')

  useEffect(() => {
    if (userRole === 'PANELIST') {
      navigate('/slots', { replace: true })
    }
  }, [navigate, userRole])

  function updateScore(key, value) {
    setScores((current) => ({ ...current, [key]: Number(value) }))
  }

  const avgPrimary = ((scores.react + scores.node + scores.typescript + scores.rest) / 4).toFixed(1)
  const avgSecondary = ((scores.docker + scores.aws) / 2).toFixed(1)

  return (
    <AppShell logoSubtitle="Panelist view">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Score summary */}
        <div className="grid grid-cols-3 gap-4 mb-2">
          <div className="bg-white rounded-2xl shadow-card p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">{avgPrimary}</div>
            <div className="text-xs text-slate-500 mt-1">Primary avg</div>
          </div>
          <div className="bg-white rounded-2xl shadow-card p-4 text-center">
            <div className="text-2xl font-bold text-amber-600">{avgSecondary}</div>
            <div className="text-xs text-slate-500 mt-1">Secondary avg</div>
          </div>
          <div className="bg-white rounded-2xl shadow-card p-4 text-center">
            <div className="text-sm font-bold text-emerald-600">{recommendation}</div>
            <div className="text-xs text-slate-500 mt-1">Recommendation</div>
          </div>
        </div>

        {/* Primary skills */}
        <Card>
          <CardTitle>
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
              Primary Skills
            </span>
          </CardTitle>
          <ScoreSlider label="React.js" value={scores.react} onChange={(e) => updateScore('react', e.target.value)} />
          <ScoreSlider label="Node.js" value={scores.node} onChange={(e) => updateScore('node', e.target.value)} />
          <ScoreSlider label="TypeScript" value={scores.typescript} onChange={(e) => updateScore('typescript', e.target.value)} />
          <ScoreSlider label="REST APIs" value={scores.rest} onChange={(e) => updateScore('rest', e.target.value)} />
        </Card>

        {/* Secondary skills */}
        <Card>
          <CardTitle>
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
              Secondary Skills
            </span>
          </CardTitle>
          <ScoreSlider label="Docker" value={scores.docker} onChange={(e) => updateScore('docker', e.target.value)} />
          <ScoreSlider label="AWS" value={scores.aws} onChange={(e) => updateScore('aws', e.target.value)} />
        </Card>

        {/* Recommendation & comments */}
        <Card>
          <div className="mb-4">
            <label htmlFor="recommendation" className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
              Overall Recommendation
            </label>
            <select
              id="recommendation"
              value={recommendation}
              onChange={(event) => setRecommendation(event.target.value)}
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 bg-white"
            >
              <option>Hire</option>
              <option>Strong Hire</option>
              <option>Maybe</option>
              <option>No Hire</option>
            </select>
          </div>
          <div className="mb-4">
            <label htmlFor="comments" className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
              Comments
            </label>
            <textarea
              id="comments"
              rows={4}
              placeholder="Key observations about the candidate..."
              value={comments}
              onChange={(event) => setComments(event.target.value)}
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 resize-none"
            />
          </div>
          <button
            type="button"
            className="w-full bg-[#02c0fa] hover:bg-[#00a8e0] text-white text-sm font-semibold py-3 rounded-xl transition-colors shadow-sm shadow-[#02c0fa]/20"
          >
            Submit Feedback
          </button>
        </Card>
      </div>
    </AppShell>
  )
}
