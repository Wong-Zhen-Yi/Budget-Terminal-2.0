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
  /** Trailing seven-day average of tracked L2 fees paid to Mainnet for settlement and data. */
  layer2SettlementUsdPerDay?: number
}

export interface EthMarketDay {
  /** Start of the completed UTC date reported by Coin Metrics. */
  day: number
  priceUsd: number
  marketCapUsd: number
  supplyEth: number
  issuanceEth?: number
  activeAddresses?: number
}

export interface EthStakingSnapshot {
  asOf: number
  /** Aggregate Beacon Chain validator balance, including rewards. */
  validatorBalanceEth: number
  /** ETH supply calculated from matched execution and Beacon Chain balances. */
  supplyEth: number
}

export interface EthBurnSnapshot {
  asOf: number
  /** Native fees burned over the rolling seven days ending at asOf. */
  sevenDayEth: number
}

export interface EthPayload {
  /** growthepie's recent ecosystem samples, oldest first. */
  ecosystem: EthTpsSample[]
  mainnet: EthMainnetSample | null
  /** Trailing seven-day averages on matching UTC dates, oldest first. */
  daily: EthActivityDay[]
  /** Completed Coin Metrics market and network dates, oldest first. */
  market?: EthMarketDay[]
  staking?: EthStakingSnapshot
  burn?: EthBurnSnapshot
}

export const ETH_SOURCE = 'growthepie, Coin Metrics, ultrasound.money'
export const ETH_SOURCE_URL = 'https://www.growthepie.com/ethereum-ecosystem'
export const ETH_MARKET_SOURCE_URL = 'https://charts.coinmetrics.io/network-data/'
export const ETH_PROTOCOL_SOURCE_URL = 'https://ultrasound.money/'
export const ETH_DAY_MS = 86_400_000
export const ETH_LIVE_MAX_AGE_MS = 120_000
export const ETH_MARKET_MAX_AGE_MS = 3 * ETH_DAY_MS
export const ETH_PROTOCOL_MAX_AGE_MS = 60 * 60_000
