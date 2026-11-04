export const MARKET_API_PROVIDERS = [
  { id: 'alltick', label: 'AllTick' },
  { id: 'finnhub', label: 'Finnhub' },
  { id: 'fmp', label: 'Financial Modeling Prep' },
] as const

export type MarketApiProvider = (typeof MARKET_API_PROVIDERS)[number]['id']
export interface MarketApiKeyStatus {
  configured: Record<MarketApiProvider, boolean>
  encryptionAvailable: boolean
}
export type MarketApiKeyMutation =
  | { type: 'save'; provider: MarketApiProvider; key: string }
  | { type: 'remove'; provider: MarketApiProvider }
