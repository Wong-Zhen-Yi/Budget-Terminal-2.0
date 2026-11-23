import type { Point } from './worldGeometry'

const inset = 6
const gap = 4
const height = 42

interface MarketPoint {
  symbol: string
  lon: number
  point: Point
}

export function layoutMobileMapLabels<T extends MarketPoint>(markets: T[], width: number, mapHeight: number) {
  const wide = width >= 620
  const boundaries = wide ? [-30, 40, 120] : [-30, 40]
  const lanes = Array.from({ length: boundaries.length + 1 }, (): T[] => [])
  const laneWidth = (width - inset * 2) / lanes.length
  const labelWidth = Math.min(110, Math.floor(laneWidth) - 12)
  const stagger = Math.min(26, laneWidth - labelWidth - 2)

  for (const market of markets) {
    const lane = boundaries.findIndex((longitude) => market.lon < longitude)
    lanes[lane === -1 ? lanes.length - 1 : lane].push(market)
  }

  return lanes.flatMap((lane, laneIndex) => {
    if (!lane.length) return []
    lane.sort((a, b) => a.point.y - b.point.y)
    const laneCenter = inset + (laneIndex + 0.5) * laneWidth
    const bottom = mapHeight - inset - height
    let nextTop = inset

    // Reserve space for each following label. Recenter a crowded cluster around its pins.
    const labels = lane.map((market, index) => {
      const target = market.point.y - height / 2 + (laneIndex % 2) * gap * 2
      const latest = bottom - (lane.length - 1 - index) * (height + gap)
      const y = Math.max(nextTop, Math.min(target, latest))
      nextTop = y + height + gap
      return { market, y, target }
    })
    const meanOffset = labels.reduce((total, label) => total + label.target - label.y, 0) / labels.length
    const shift = Math.max(inset - labels[0].y, Math.min(meanOffset, bottom - labels[labels.length - 1].y))

    return labels.map(({ market, y }, index) => {
      const direction = (index + laneIndex) % 2 ? 1 : -1
      const x = laneCenter - labelWidth / 2 + direction * stagger / 2
      return { ...market, rect: { x, y: y + shift, width: labelWidth, height } }
    })
  })
}
