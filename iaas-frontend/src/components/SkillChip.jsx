export default function SkillChip({ children, variant = 'default' }) {
  const className =
    variant === 'primary'
      ? 'chip chip-primary'
      : variant === 'secondary'
        ? 'chip chip-secondary'
        : 'chip'

  return <span className={className}>{children}</span>
}
