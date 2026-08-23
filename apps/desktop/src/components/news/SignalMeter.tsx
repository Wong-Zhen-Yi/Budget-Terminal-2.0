/**
 * The heuristic score as five segments.
 *
 * The reference prints `Heuristic 9` as text. A bar reads at a glance across a grid of
 * cards, which is the point of a card grid — and the fact that it is *absent* on the Yahoo
 * lanes is itself information: those articles are unscored, not scored zero.
 */
const SEGMENTS = 5
/** A score of 25 fills the bar; in practice anything over 15 is a strong story. */
const POINTS_PER_SEGMENT = 5

export function SignalMeter({
  score,
  label,
  className = '',
}: {
  score: number | null
  /** The tag list, for the tooltip. */
  label: string
  className?: string
}) {
  if (score === null) return null

  const filled = Math.min(SEGMENTS, Math.ceil(score / POINTS_PER_SEGMENT))
  const title = [label, `Heuristic ${score}`].filter(Boolean).join(' · ')

  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-flex shrink-0 items-center gap-px ${className}`}
    >
      {Array.from({ length: SEGMENTS }, (_, index) => (
        <span
          key={index}
          className={`h-2 w-1 ${index < filled ? 'bg-accent-hover' : 'bg-border'}`}
        />
      ))}
    </span>
  )
}
