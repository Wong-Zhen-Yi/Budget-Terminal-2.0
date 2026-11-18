import type { BackgroundRequest } from './contract.js'

export interface EthRequest extends BackgroundRequest { force?: boolean }

export interface EthTpsSample {
  asOf: number
  tps: number
}

export interface EthMainnetSample extends EthTpsSample {
  blockTimeSeconds?: number
  medianTransactionFeeUsd?: number
}

export interface EthLayerValues {
  mainnet: number
  layer2: number
}

export interface EthActivityDay {
  day: number
  mainnetTps: number
  layer2Tps: number
  gasThroughputMgasPerSecond?: EthLayerValues
  feesPaidUsdPerDay?: EthLayerValues
  stablecoinSupplyUsd?: EthLayerValues
}

export interface EthPayload {
  /** growthepie's recent ecosystem samples, oldest first. */
  ecosystem: EthTpsSample[]
  mainnet: EthMainnetSample | null
  /** Trailing seven-day averages on matching UTC dates, oldest first. */
  daily: EthActivityDay[]
}

export const ETH_SOURCE = 'growthepie'
export const ETH_SOURCE_URL = 'https://www.growthepie.com/ethereum-ecosystem'
export const ETH_DAY_MS = 86_400_000
export const ETH_LIVE_MAX_AGE_MS = 120_000
