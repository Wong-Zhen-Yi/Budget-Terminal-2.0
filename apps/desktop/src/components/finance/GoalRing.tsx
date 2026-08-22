const SIZE = 200
const RADIUS = 84
const STROKE = 9

interface GoalRingProps {
  /** 0..1 share of the target reached. */
  progress: number
  centerText: string
  subtext: string
  /** 0..1 sweep for the fill animation. */
  animationProgress?: number
  /** False when FX is missing, which greys the ring out. */
  available?: boolean
}

/**
 * The net-worth ring: a full-circle track under an arc that starts at 12 o'clock and
 * sweeps clockwise, with the current value in the middle. Ported from
 * `NetWorthGoalWidget.paintEvent`.
 */
export function GoalRing({
  progress,
  centerText,
  subtext,
  animationProgress = 1,
  available = true,
}: GoalRingProps) {
  const circumference = 2 * Math.PI * RADIUS
  const filled = Math.max(0, Math.min(1, progress)) * Math.max(0, Math.min(1, animationProgress))
  const color = available ? 'var(--color-accent)' : 'var(--color-text-dim)'

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full max-h-[220px] min-h-[150px] w-auto">
      <g
        // Rotate so zero sits at 12 o'clock and the arc grows clockwise.
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        fill="none"
        strokeLinecap="round"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke="var(--color-border-strong)"
          strokeWidth={STROKE}
        />
        {/* A soft outer glow, the widest of the reference's three concentric strokes. */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={color}
          strokeWidth={STROKE + 8}
          strokeOpacity={0.18}
          strokeDasharray={`${circumference * filled} ${circumference}`}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={color}
          strokeWidth={STROKE}
          strokeDasharray={`${circumference * filled} ${circumference}`}
        />
      </g>
      <text
        x={SIZE / 2}
        y={SIZE / 2 - 2}
        textAnchor="middle"
        className="num fill-text"
        style={{ fontSize: 24, fontWeight: 600 }}
      >
        {centerText}
      </text>
      <text
        x={SIZE / 2}
        y={SIZE / 2 + 20}
        textAnchor="middle"
        className="fill-text-muted"
        style={{ fontSize: 14 }}
      >
        {subtext}
      </text>
    </svg>
  )
}
