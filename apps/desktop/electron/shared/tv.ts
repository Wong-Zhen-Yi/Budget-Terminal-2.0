import type { BackgroundRequest } from './contract.js'

export const TV_MAX_AGE_MS = 7 * 24 * 60 * 60_000
export const TV_CHANNELS = [
  { id: 'UCrp_UI8XtuYfpiqluWLD7Lw', name: 'CNBC Television' },
  { id: 'UCEAZeUIeJs0IjQiqTCdVSIg', name: 'Yahoo Finance' },
  { id: 'UCIALMKvObZNtJ6AmdCLP7Lg', name: 'Bloomberg Television' },
] as const

export interface TvVideo {
  videoId: string
  title: string
  channel: string
  channelId: string
  publishedAt: number
  descriptionSnippet: string
  thumbnailUrl: string
  url: string
}

export interface TvPayload {
  items: TvVideo[]
  warnings: string[]
  fetchedAt: number
  channelsLoaded: number
  channelsTotal: number
}

export interface TvRequest extends BackgroundRequest {
  force?: boolean
}

/** Keep stock coverage and the macro developments that move equities. */
export function isStockMarketVideo(title: string, description = ''): boolean {
  return /\b(stock[s]?|shares?|equities|equity|markets?|earnings|investing|investors?|wall street|s&p|nasdaq|dow|russell|ipo|etfs?|fed|federal reserve|inflation|interest rates?|treasur(?:y|ies)|bonds?|yields?|recession|jobs report|payrolls?|cpi|gdp|tariffs?|nvidia|tesla|apple|microsoft|amazon|alphabet|google|meta|palantir|broadcom|amd)\b/i.test(title + ' ' + description.slice(0, 400))
}

export function recentTvVideos(items: readonly TvVideo[], now = Date.now()): TvVideo[] {
  const unique = new Map<string, TvVideo>()
  for (const item of items) {
    if (!Number.isFinite(item.publishedAt) || item.publishedAt > now || now - item.publishedAt > TV_MAX_AGE_MS) continue
    if (!isStockMarketVideo(item.title, item.descriptionSnippet)) continue
    if (!unique.has(item.videoId)) unique.set(item.videoId, item)
  }
  return [...unique.values()].sort((a, b) => b.publishedAt - a.publishedAt || a.videoId.localeCompare(b.videoId))
}
