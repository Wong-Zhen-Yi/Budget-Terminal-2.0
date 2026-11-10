export const MARKET_API_PROVIDERS = [
  { id: 'finnhub', label: 'Finnhub' },
  { id: 'fmp', label: 'Financial Modeling Prep' },
] as const

/** Finnhub is preferred for supported stock quotes when its key is configured. */
export const MARKET_DATA_PROVIDERS = [
  ...MARKET_API_PROVIDERS.map(provider => ({ ...provider, access: 'key' as const })),
  { id: 'binance', label: 'Binance', access: 'public', description: 'Enabled for supported spot quotes. USDT prices are converted to USD using a shared Coinbase rate. Independent rate budget and fallback.' },
  { id: 'coinbase', label: 'Coinbase', access: 'public', description: 'Enabled for supported USD spot quotes and USDT/USD conversion. Cached requests and independent cooldowns.' },
  { id: 'world-bank', label: 'World Bank', access: 'public', description: 'Enabled for annual US CPI inflation in Economic. Cached for 24 hours; kept separate from monthly CPI.' },
  { id: 'imf', label: 'IMF', access: 'public', description: 'Enabled through public IMF WEO SDMX for annual US real GDP growth. Only actual-data years are included; cached for 24 hours.' },
] as const

export type MarketApiProvider = (typeof MARKET_API_PROVIDERS)[number]['id']
export interface MarketApiKeyStatus {
  configured: Record<MarketApiProvider, boolean>
  encryptionAvailable: boolean
}
export type MarketApiKeyMutation =
  | { type: 'save'; provider: MarketApiProvider; key: string }
  | { type: 'remove'; provider: MarketApiProvider }
