import type { Envelope } from '../../shared/contract.js'
import type { DefeatBetaTerminalPayload, DefeatBetaTerminalRequest, TerminalValue } from '../../shared/defeatbetaTerminal.js'
import { DEFEATBETA_SECTIONS, TERMINAL_TTL } from '../../shared/defeatbetaTerminal.js'
import { describeError, failed, meta } from '../../shared/envelope.js'
import { defeatBeta, defeatBetaSymbol, type DefeatBetaClient, type DefeatBetaTable } from './client.js'

const TABLES: Record<DefeatBetaTerminalRequest['section'], DefeatBetaTable> = {
  prices: 'stock_prices', profile: 'stock_profile', officers: 'stock_officers', statements: 'stock_statement',
  shares: 'stock_shares_outstanding', dividends: 'stock_dividend_events', splits: 'stock_split_events',
  earnings: 'stock_earning_calendar', news: 'stock_news', transcripts: 'stock_earning_call_transcripts',
  filings: 'stock_sec_filing', breakdown: 'stock_revenue_breakdown',
}
function serializable(value: unknown): TerminalValue {
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : String(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(serializable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializable(entry)]))
  return typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function getDefeatBetaTerminal(request: DefeatBetaTerminalRequest, client: Pick<DefeatBetaClient, 'rows' | 'company'> = defeatBeta): Promise<Envelope<DefeatBetaTerminalPayload>> {
  const empty: DefeatBetaTerminalPayload = { symbol: request.symbol, section: request.section, rows: [], publishedAt: null, financialCurrency: null, companyName: null }
  const source = 'DefeatBeta published dataset'
  try {
    const symbol = defeatBetaSymbol(request.symbol)
    if (!DEFEATBETA_SECTIONS.includes(request.section)) throw new Error('Unknown DefeatBeta section.')
    const result = await client.rows(TABLES[request.section], symbol, request.force)
    const company = request.section === 'profile' ? await client.company(symbol) : {}
    const rows = result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, serializable(value)])))
    rows.sort((a, b) => String(b.report_date ?? b.filing_date ?? '').localeCompare(String(a.report_date ?? a.filing_date ?? '')))
    const stale = !Number.isFinite(result.updatedAt) || Date.now() - result.updatedAt > 7 * 86_400_000 || result.updatedAt > Date.now() + 86_400_000
    return { data: { ...empty, symbol, rows, publishedAt: result.updatedAt,
      financialCurrency: typeof company.financial_currency === 'string' ? company.financial_currency : null,
      companyName: typeof company.title === 'string' ? company.title : null },
      meta: meta(source, stale ? 'stale' : 'fresh', { asOf: result.updatedAt, expiresAt: Date.now() + TERMINAL_TTL,
        ...(stale ? { failureReason: 'Dataset publication is over seven days old or has an invalid date.' } : {}) }), errors: [] }
  } catch (error) { return failed(empty, describeError(error), source) }
}
