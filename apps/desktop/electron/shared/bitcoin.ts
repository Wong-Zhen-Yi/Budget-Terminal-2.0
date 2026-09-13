import type { BackgroundRequest } from './contract.js'

export interface BitcoinRequest extends BackgroundRequest { force?: boolean }
export interface BitcoinBlock {
  id: string
  height: number
  timestamp: number
  tx_count: number
  size: number
  weight: number
  difficulty: number
}
export interface BitcoinStats {
  timestamp: number
  market_price_usd: number
  hash_rate: number
  n_btc_mined: number
  n_tx: number
  n_blocks_mined: number
  minutes_between_blocks: number
  totalbc: number
  difficulty: number
}
export interface BitcoinPayload {
  stats: BitcoinStats | null
  blocks: BitcoinBlock[]
  fees: { fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number; minimumFee: number } | null
  mempool: { count: number; vsize: number; total_fee: number } | null
}

export function bitcoinCycle(height: number) {
  if (!Number.isSafeInteger(height) || height < 0) throw new Error('Invalid Bitcoin height')
  const epoch = Math.floor(height / 210_000)
  const subsidy = epoch >= 33 ? 0 : Math.floor(5_000_000_000 / 2 ** epoch) / 1e8
  const nextHalving = (epoch + 1) * 210_000
  return {
    subsidy,
    nextHalving,
    remaining: nextHalving - height,
    progress: (height % 210_000) / 210_000 * 100,
    nextRetarget: (Math.floor(height / 2016) + 1) * 2016,
  }
}
