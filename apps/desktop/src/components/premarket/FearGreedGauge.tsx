import { FEAR_GREED_BANDS } from '@shared/preMarket'

/**
 * The CNN dial, ported from `_FearGreedGauge.paintEvent`.
 *
 * Score maps to angle as `180 - score * 1.8`: 0 is due left, 50 is straight up, 100 is
 * due right. Everything else — the five band arcs, the translucent wedge over the active
 * band, dots at 25/50/75, tick numbers and tangent-rotated band labels outside the arc,
 * the needle and the truncated score under the hub — follows from that one mapping.
 */

const W = 340
const H = 225
const CX = W / 2
const CY = 170
/** Centre-line radius of the band arcs, and their stroke width. */
const AR = 110
const AW = 30
const INNER = AR - AW / 2
const TICK_R = AR + AW / 2 + 14
const LABEL_R = AR + AW / 2 + 30

const LABELS: ReadonlyArray<{ at: number; lines: string[] }> = [
  { at: 12.5, lines: ['EXTREME', 'FEAR'] },
  { at: 35, lines: ['FEAR'] },
  { at: 50, lines: ['NEUTRAL'] },
  { at: 65, lines: ['GREED'] },
  { at: 87.5, lines: ['EXTREME', 'GREED'] },
]

/** Degrees for a score, in the maths convention the reference uses (CCW, y up). */
function angleOf(score: number): number {
  return 180 - score * 1.8
}

function pointAt(score: number, radius: number): [number, number] {
  const radians = (angleOf(score) * Math.PI) / 180
  return [CX + radius * Math.cos(radians), CY - radius * Math.sin(radians)]
}

/** The band arc from `from` to `to`, swept clockwise on screen. */
function arcPath(from: number, to: number, radius: number): string {
  const [x0, y0] = pointAt(from, radius)
  const [x1, y1] = pointAt(to, radius)
  return `M ${x0} ${y0} A ${radius} ${radius} 0 0 1 ${x1} ${y1}`
}

export function FearGreedGauge({
  score,
  /** 0..1; sweeps the needle up from zero on load. */
  progress = 1,
}: {
  score: number | null
  progress?: number
}) {
  const hasScore = score !== null && Number.isFinite(score)
  const clamped = hasScore ? Math.max(0, Math.min(100, score)) : 0
  const needleAt = clamped * progress
  const active = FEAR_GREED_BANDS.find((band) => clamped < band.to) ?? FEAR_GREED_BANDS[4]
  const [needleX, needleY] = pointAt(needleAt, INNER - 2)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="min-h-0 w-full flex-1" role="img">
      {/* The active band, filled back to the hub at low opacity. */}
      {hasScore ? (
        <path
          d={`M ${CX} ${CY} L ${pointAt(active.from, INNER).join(' ')} A ${INNER} ${INNER} 0 0 1 ${pointAt(active.to, INNER).join(' ')} Z`}
          fill={active.color}
          fillOpacity={0.2}
        />
      ) : null}

      {FEAR_GREED_BANDS.map((band) => (
        <path
          key={band.label}
          d={arcPath(band.from, band.to, AR)}
          fill="none"
          stroke={band.color}
          strokeWidth={AW}
        />
      ))}

      {/* Boundary dots sit on the arc itself; 0 and 100 get none, as in the reference. */}
      {[25, 50, 75].map((value) => {
        const [x, y] = pointAt(value, AR)
        return <circle key={value} cx={x} cy={y} r={2.5} fill="var(--color-text-muted)" />
      })}

      {[0, 25, 50, 75, 100].map((value) => {
        const [x, y] = pointAt(value, TICK_R)
        return (
          <text
            key={value}
            x={x}
            y={y + 4}
            fill="var(--color-text-muted)"
            fontSize={11}
            textAnchor="middle"
          >
            {value}
          </text>
        )
      })}

      {LABELS.map(({ at, lines }) => {
        const [x, y] = pointAt(at, LABEL_R)
        return (
          <g key={lines.join(' ')} transform={`translate(${x} ${y}) rotate(${90 - angleOf(at)})`}>
            {lines.map((line, index) => (
              <text
                key={line}
                x={0}
                y={(index - (lines.length - 1) / 2) * 10 + 3}
                fill="var(--color-text-muted)"
                fontSize={9}
                fontWeight={700}
                textAnchor="middle"
              >
                {line}
              </text>
            ))}
          </g>
        )
      })}

      {hasScore ? (
        <>
          <line
            x1={CX}
            y1={CY}
            x2={needleX}
            y2={needleY}
            stroke="var(--color-text)"
            strokeWidth={3}
          />
          <circle cx={CX} cy={CY} r={5} fill="var(--color-text)" />
          <text
            x={CX}
            y={CY + 38}
            fill="var(--color-text)"
            fontSize={24}
            fontWeight={700}
            textAnchor="middle"
          >
            {/* `int()` in the reference: 54.9 shows as 54, not 55. */}
            {Math.trunc(clamped)}
          </text>
        </>
      ) : null}
    </svg>
  )
}
