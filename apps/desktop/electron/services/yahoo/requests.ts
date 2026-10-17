/** Validate Yahoo responses without switching to another data provider. */
export async function withYahooSummary<T>(symbol: string, request: () => Promise<T>): Promise<T> {
  const result = await request()
  if (!result || typeof result !== 'object' || !Object.values(result).some(value => value && typeof value === 'object')) {
    throw new Error(`Yahoo returned no company data for ${symbol}.`)
  }
  return result
}

export async function withYahooStatements<T>(symbol: string, period: 'annual' | 'quarterly', _start: Date,
  request: () => Promise<T>): Promise<T> {
  const result = await request()
  if (!Array.isArray(result) || !result.length) throw new Error(`Yahoo returned no ${period} statements for ${symbol}.`)
  return result
}
