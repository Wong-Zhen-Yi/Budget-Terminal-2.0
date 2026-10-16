import { backupObservation, backupStatements, backupSummary } from '../defeatbeta/data.js'

/** Adapter boundary: callers retain Yahoo's inferred optional module fields. */
export async function withBackupSummary<T>(symbol: string, primary: () => Promise<T>): Promise<T> {
  try {
    const result = await primary()
    if (!result || typeof result !== 'object' || !Object.values(result).some(value => value && typeof value === 'object')) {
      throw new Error(`Yahoo returned no company data for ${symbol}.`)
    }
    return result
  } catch (primaryError) {
    try {
      const result = await backupSummary(symbol)
      backupObservation(result.asOf, primaryError, result.limitations)
      return result.summary as T
    } catch (backupError) {
      throw new Error(`Yahoo: ${String(primaryError)}; DefeatBeta backup: ${String(backupError)}`)
    }
  }
}

export async function withBackupStatements<T>(symbol: string, period: 'annual' | 'quarterly', start: Date,
  primary: () => Promise<T>): Promise<T> {
  try {
    const result = await primary()
    if (!Array.isArray(result) || !result.length) throw new Error(`Yahoo returned no ${period} statements for ${symbol}.`)
    return result
  } catch (primaryError) {
    try {
      const result = await backupStatements(symbol, period, start)
      backupObservation(result.asOf, primaryError)
      return result.rows as T
    } catch (backupError) {
      throw new Error(`Yahoo: ${String(primaryError)}; DefeatBeta backup: ${String(backupError)}`)
    }
  }
}
