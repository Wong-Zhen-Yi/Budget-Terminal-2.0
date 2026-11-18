import type { BackgroundRequest, StocksPayload } from './contract.js'

export interface NvdaRequest extends BackgroundRequest {
  force?: boolean
}

export interface NvdaQuarter {
  period: string
  revenue: number
  dataCenter: number
  platforms: number[]
  grossMargin: number
  operatingIncome: number
  dilutedEps: number
}

export interface NvdaEarnings {
  sourceUrl: string
  releaseUrl: string
  platformLabels: string[]
  /** Latest reported quarter first, followed by the previous and year-ago quarters. */
  quarters: NvdaQuarter[]
  revenueGrowthYoY: number
  platformGrowthYoY: number[]
  guidance: { period: string; revenueMidpoint: number; rangePct: number } | null
}

export interface NvdaPayload {
  symbol: 'NVDA'
  earnings: NvdaEarnings | null
  market: StocksPayload | null
  progress: Record<'earnings' | 'market', 'loaded' | 'partial' | 'stale' | 'unavailable'>
  laneFetchedAt: Record<'earnings' | 'market', number | null>
}
