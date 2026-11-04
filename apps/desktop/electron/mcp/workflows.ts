import { toolName, type Operation } from '../../mcp/operations.js'
import { McpError, errorDetails } from '../../mcp/errors.js'
import type { CompanyOverviewRequest, PortfolioBriefingRequest } from '../../mcp/features.js'
import type { Envelope, PortfolioPayload } from '../shared/contract.js'
import { ok } from '../shared/envelope.js'

type Invoke = (name: string, args: unknown) => Promise<unknown>
export async function researchWorkflow(operation: 'companyOverview' | 'portfolioBriefing', request: CompanyOverviewRequest | PortfolioBriefingRequest, invoke: Invoke) {
  const evidence: Record<string, unknown> = {}
  const errors: Envelope<unknown>['errors'] = []
  let tickers: string[]
  let sections: Array<'quotes' | 'fundamentals' | 'news'>
  if (operation === 'companyOverview') {
    const input = request as CompanyOverviewRequest
    const symbol = input.symbol.trim().toUpperCase()
    if (!/^[A-Z0-9^][A-Z0-9.^=/-]{0,29}$/.test(symbol)) throw new McpError('Provide a valid research symbol.', 'INVALID_ARGUMENTS')
    tickers = [symbol]
    sections = input.sections ?? ['quotes', 'fundamentals', 'news']
  } else {
    const input = request as PortfolioBriefingRequest
    const saved = await invoke(toolName('portfolio'), { request: {} }) as Envelope<PortfolioPayload>
    if (saved.meta.freshness === 'failed') return saved
    const portfolio = saved.data.portfolios.find(item => item.id === input.portfolioId)
    if (!portfolio) throw new McpError('Portfolio not found. Read saved portfolios to choose a portfolioId.', 'INVALID_ARGUMENTS')
    evidence.portfolio = { ...saved, data: { portfolio } }
    tickers = [...new Set(portfolio.tickers)]
    if (tickers.length > 100) throw new McpError('Portfolio exceeds the 100-symbol briefing limit. Research smaller symbol groups.', 'INVALID_ARGUMENTS')
    sections = input.sections ?? ['quotes', 'news']
  }
  const tasks: Record<string, { operation: Operation; request: unknown }> = {
    quotes: { operation: 'quotes', request: { holdings: tickers } },
    fundamentals: { operation: 'fundamentals', request: { tickers } },
    news: { operation: 'news', request: { tickers } },
  }
  // Bounded task list. Omitted sections never start provider work.
  await Promise.all([...new Set(sections)].map(async section => {
    if (!tickers.length) return
    const task = tasks[section]
    try {
      const result = await invoke(toolName(task.operation), { request: task.request }) as Envelope<unknown>
      evidence[section] = result
      errors.push(...result.errors)
      if (['stale', 'partial', 'failed'].includes(result.meta.freshness)) errors.push({ source: section, operation: 'briefing', reason: `Section is ${result.meta.freshness}; inspect its source timestamps and coverage.` })
    } catch (error) {
      const detail = errorDetails(error)
      evidence[section] = { error: detail }
      errors.push({ source: section, operation: 'briefing', reason: detail.message })
    }
  }))
  const result = ok({ tickers, evidence }, 'Budget Terminal research workflow')
  result.errors = errors
  if (errors.length) result.meta.freshness = 'partial'
  return result
}
