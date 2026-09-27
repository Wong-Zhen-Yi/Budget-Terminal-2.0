export const compact = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A'
  const magnitude = Math.abs(value)
  for (const [limit, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
    if (magnitude >= limit) return `${(value / limit).toFixed(2)}${suffix}`
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export const money = (value: number | null | undefined): string => value === null || value === undefined ? 'N/A' : `${value < 0 ? '-' : ''}$${compact(Math.abs(value))}`
export const decimal = (value: number | null | undefined): string => value === null || value === undefined ? 'N/A' : value.toFixed(2)
export const signedPercent = (value: number | null | undefined): string => value === null || value === undefined ? 'N/A' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
