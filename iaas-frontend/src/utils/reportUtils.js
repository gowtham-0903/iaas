// reportUtils.js — shared helpers for InterviewReport page

// ---------------------------------------------------------------------------
// Score helpers
// ---------------------------------------------------------------------------

/** Convert panelist_avg (0–5 scale) to /10 */
export function avgToTen(v) {
  if (v == null) return 0
  return Math.round(Number(v) * 2 * 10) / 10
}

/** Convert overall_score (0–100) to display string */
export function fmtScore(v) {
  if (v == null) return 'N/A'
  return Number(v).toFixed(1)
}

/** Color for circular gauge by score /100 */
export function scoreColor(score) {
  if (score == null) return '#94a3b8'
  if (score >= 70) return '#16a34a'
  if (score >= 50) return '#d97706'
  return '#dc2626'
}

/** Color for skill circle by score /10 */
export function skillColor(score10) {
  if (score10 >= 7) return '#16a34a'
  if (score10 >= 5) return '#d97706'
  return '#dc2626'
}

/** Rating label for skill score /10 */
export function ratingLabel(score10) {
  if (score10 >= 9) return 'Excellent'
  if (score10 >= 8) return 'Very Good'
  if (score10 >= 7) return 'Good'
  if (score10 >= 6) return 'Above Average'
  if (score10 >= 5) return 'Average'
  if (score10 >= 3) return 'Poor'
  return 'Very Poor'
}

/** Recommendation display */
export const REC_CONFIG = {
  STRONG_HIRE: { label: 'Strong Hire', bg: '#16a34a', text: '#fff' },
  HIRE: { label: 'Hire', bg: '#2563eb', text: '#fff' },
  MAYBE: { label: 'Maybe', bg: '#d97706', text: '#fff' },
  NO_HIRE: { label: 'No Hire', bg: '#dc2626', text: '#fff' },
}

// ---------------------------------------------------------------------------
// JSON parse helper
// ---------------------------------------------------------------------------
export function safeJson(val, fallback = null) {
  if (val == null) return fallback
  if (typeof val === 'object') return val
  try { return JSON.parse(val) } catch { return fallback }
}

// ---------------------------------------------------------------------------
// Initials from name
// ---------------------------------------------------------------------------
export function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

// ---------------------------------------------------------------------------
// Date formatter
// ---------------------------------------------------------------------------
export function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

// ---------------------------------------------------------------------------
// Excel export (XLSX)
// ---------------------------------------------------------------------------
export async function exportExcel(reportData) {
  const XLSX = await import('xlsx')
  const { candidate, jd, aiScore, skillBreakdown, screeningQA, qcReview } = reportData

  const wb = XLSX.utils.book_new()

  // Sheet 1 — Candidate Info
  const info = [
    ['Field', 'Value'],
    ['Candidate Name', candidate?.full_name || ''],
    ['JD Title', jd?.title || ''],
    ['Job Code', jd?.job_code || ''],
    ['Client', candidate?.client_name || ''],
    ['Email', candidate?.email || ''],
    ['Phone', candidate?.phone || ''],
    ['Interview Date', fmtDate(candidate?.interview_date)],
    ['Overall Score', fmtScore(aiScore?.overall_score)],
    ['Primary Match', fmtScore(aiScore?.primary_match) + '%'],
    ['Secondary Match', fmtScore(aiScore?.secondary_match) + '%'],
    ['Recommendation', aiScore?.recommendation || ''],
    ['Report Status', aiScore?.report_status || ''],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), 'Candidate Info')

  // Sheet 2 — Skill Scores
  const skills = [['Skill', 'Type', 'Panelist Avg (/5)', 'Score (/10)', 'Rating', 'AI Assessment']]
  ;(skillBreakdown || []).forEach((s) => {
    const s10 = avgToTen(s.panelist_avg)
    skills.push([s.skill_name, s.skill_type, s.panelist_avg, s10, ratingLabel(s10), s.ai_assessment || ''])
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(skills), 'Skill Scores')

  // Sheet 3 — Screening Questions
  const qa = [['Question', 'Panelist Notes', 'AI Assessment', 'Score']]
  ;(screeningQA || []).forEach((q) => {
    qa.push([q.question, q.panelist_notes, q.ai_assessment, q.score])
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(qa), 'Screening Questions')

  const name = `IAAS_Report_${candidate?.full_name?.replace(/\s+/g, '_') || 'Report'}.xlsx`
  XLSX.writeFile(wb, name)
}

// ---------------------------------------------------------------------------
// PDF export (html2canvas + jsPDF)
// ---------------------------------------------------------------------------
export async function exportPdf(reportRef, candidateName) {
  const html2canvas = (await import('html2canvas')).default
  const jsPDF = (await import('jspdf')).default

  const el = reportRef.current
  if (!el) return

  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
  })

  const imgData = canvas.toDataURL('image/png')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const pageW = 210
  const pageH = 297
  const imgW = pageW
  const imgH = (canvas.height * imgW) / canvas.width

  let y = 0
  while (y < imgH) {
    if (y > 0) pdf.addPage()
    pdf.addImage(imgData, 'PNG', 0, -y, imgW, imgH)
    y += pageH
  }

  const fileName = `IAAS_Report_${(candidateName || 'Report').replace(/\s+/g, '_')}.pdf`
  pdf.save(fileName)
}
