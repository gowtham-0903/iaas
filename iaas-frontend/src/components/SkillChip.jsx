export default function SkillChip({ children, variant = 'default' }) {
  const styles = {
    primary: 'bg-blue-50 text-blue-700 border border-blue-200',
    secondary: 'bg-slate-100 text-slate-600 border border-slate-200',
    soft: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    default: 'bg-slate-100 text-slate-600 border border-slate-200',
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium ${styles[variant] || styles.default}`}>
      {children}
    </span>
  )
}
