// ReportComponents.jsx — reusable sub-components for InterviewReport

import { scoreColor, skillColor, ratingLabel, REC_CONFIG, initials } from '../utils/reportUtils'

const NAVY = '#1B3A6B'

// ---------------------------------------------------------------------------
// Section banner (navy header bar)
// ---------------------------------------------------------------------------
export function SectionBanner({ children }) {
  return (
    <div
      className="flex items-center px-5 py-3 rounded-t-xl font-bold text-white text-sm tracking-wide uppercase"
      style={{ background: NAVY }}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Circular SVG gauge
// ---------------------------------------------------------------------------
export function CircleGauge({ score, max = 100, size = 90, strokeWidth = 8, label, sub, colorFn }) {
  const r = (size - strokeWidth * 2) / 2
  const circ = 2 * Math.PI * r
  const pct = Math.min(1, Math.max(0, (score ?? 0) / max))
  const dash = pct * circ
  const color = colorFn ? colorFn(score) : (max === 100 ? scoreColor(score) : skillColor(score))

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="#e2e8f0" strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-bold text-slate-800" style={{ fontSize: size < 80 ? 13 : 18 }}>
            {score != null ? Number(score).toFixed(score >= 10 ? 0 : 1) : '—'}
          </span>
          {max !== 100 && (
            <span className="text-slate-400" style={{ fontSize: 10 }}>/{max}</span>
          )}
        </div>
      </div>
      {label && <p className="text-center text-xs font-semibold text-slate-700 max-w-[80px] leading-tight">{label}</p>}
      {sub && <p className="text-center text-[10px] text-slate-400">{sub}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skill circle for Page 2 grid (score /10)
// ---------------------------------------------------------------------------
export function SkillCircle({ skillName, score10 }) {
  const color = skillColor(score10)
  const rating = ratingLabel(score10)
  return (
    <div className="flex flex-col items-center gap-2 p-3">
      <CircleGauge score={score10} max={10} size={78} strokeWidth={7} colorFn={skillColor} />
      <p className="text-center text-xs font-semibold text-slate-700 leading-tight max-w-[80px]">{skillName}</p>
      <span
        className="text-[10px] font-bold px-2 py-0.5 rounded-full"
        style={{ background: color + '22', color }}
      >
        {rating}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Donut ring segment — used for soft/analytical skills
// ---------------------------------------------------------------------------
export function DonutRing({ items }) {
  // items: [{label, rating, color}]
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="flex-1">
            <div className="flex justify-between mb-1">
              <span className="text-xs font-semibold text-slate-700">{item.label}</span>
              <span className="text-xs font-bold" style={{ color: item.color }}>{item.rating}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${item.pct || 70}%`, background: item.color }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recommendation badge
// ---------------------------------------------------------------------------
export function RecBadge({ rec, size = 'md' }) {
  const cfg = REC_CONFIG[rec] || { label: rec, bg: '#6b7280', text: '#fff' }
  const pad = size === 'lg' ? 'px-5 py-2 text-base' : 'px-3 py-1 text-xs'
  return (
    <span
      className={`inline-block font-bold rounded-full ${pad}`}
      style={{ background: cfg.bg, color: cfg.text }}
    >
      {cfg.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Avatar placeholder
// ---------------------------------------------------------------------------
export function Avatar({ name, size = 72 }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white flex-shrink-0"
      style={{
        width: size, height: size, fontSize: size * 0.35,
        background: 'rgba(255,255,255,0.2)',
        border: '3px solid rgba(255,255,255,0.4)',
      }}
    >
      {initials(name)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton loader block
// ---------------------------------------------------------------------------
export function SkeletonBlock({ h = 24, w = '100%', rounded = 'rounded-lg' }) {
  return (
    <div
      className={`bg-slate-200 animate-pulse ${rounded}`}
      style={{ height: h, width: w }}
    />
  )
}

// ---------------------------------------------------------------------------
// Skills tree (3-node hierarchy diagram)
// ---------------------------------------------------------------------------
export function SkillsTree({ primaryAvg, secondaryAvg, softAvg }) {
  const Node = ({ score, label, x, y }) => {
    const s10 = Number(score || 0)
    const color = skillColor(s10)
    return (
      <g>
        <circle cx={x} cy={y} r={32} fill={color + '22'} stroke={color} strokeWidth={2} />
        <text x={x} y={y - 4} textAnchor="middle" fontSize={14} fontWeight="bold" fill={color}>
          {s10.toFixed(1)}
        </text>
        <text x={x} y={y + 10} textAnchor="middle" fontSize={9} fill="#94a3b8">/10</text>
        <text x={x} y={y + 52} textAnchor="middle" fontSize={10} fill="#475569" fontWeight="600">
          {label}
        </text>
      </g>
    )
  }

  return (
    <svg width="100%" viewBox="0 0 300 180" style={{ overflow: 'visible' }}>
      {/* Lines */}
      <line x1="150" y1="62" x2="60" y2="130" stroke="#cbd5e1" strokeWidth={1.5} strokeDasharray="4 3" />
      <line x1="150" y1="62" x2="240" y2="130" stroke="#cbd5e1" strokeWidth={1.5} strokeDasharray="4 3" />
      {/* Nodes */}
      <Node score={primaryAvg} label="Mandatory" x={150} y={40} />
      <Node score={secondaryAvg} label="Optional" x={60} y={130} />
      <Node score={softAvg} label="Soft Skills" x={240} y={130} />
    </svg>
  )
}
