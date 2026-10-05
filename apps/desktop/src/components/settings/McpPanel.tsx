import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Panel } from '@/components/ui/Panel'
import { mutationDomains, operations, toolName, type Operation } from '../../../mcp/operations'

const groups = [
  { title: 'Markets & screens', hint: 'Quotes, indexes, ETFs, currencies, crypto, commodities and market screens.' },
  { title: 'Company research', hint: 'Stocks, fundamentals, analyst targets, valuations and discovery.' },
  { title: 'Charts & trading research', hint: 'Price histories, comparisons, options chains, signals, backtests and quant analysis.' },
  { title: 'News & events', hint: 'News, earnings, calendars, institutional activity, IPOs, disclosures and videos.' },
  { title: 'Portfolio & personal finance', hint: 'Read saved records and calculate performance, risk, exchange rates and projections.' },
  { title: 'Macro & bonds', hint: 'Economic indicators, bond research, money and liquidity.' },
  { title: 'Saved-record edits', hint: 'Create, update, reorder and delete records; change app settings.' },
  { title: 'Connection & diagnostics', hint: 'Capture app pages, check MCP availability and provider request pressure.' },
] as const

const company = new Set<Operation>(['stocks', 'fundamentals', 'fundamentalsPage', 'targets', 'valuation', 'discoveryUniverse', 'discovery', 'bmnr', 'hood'])
const trading = new Set<Operation>(['chart', 'chartsHistory', 'chartsCompare', 'chartsRelationship', 'options', 'optionsChain', 'optionsExpirations', 'signals', 'technicalScan', 'backtest', 'quantScan', 'quantPair'])
const events = new Set<Operation>(['news', 'newsPage', 'newsTickerSearch', 'newsArticle', 'newsThumbnail', 'calendarMonth', 'earningsCalendar', 'institutionActivity', 'institutionTickerActivity', 'ipoUpcoming', 'ipoCompleted', 'politicsPage', 'politicsExport', 'youtube', 'youtubeThumbnail'])
const finance = new Set<Operation>(['portfolio', 'cards', 'cardsPerformance', 'personalFinance', 'settings', 'returns', 'momentum', 'analytics', 'optionQuotes', 'projections', 'fx'])

function groupIndex(operation: Operation): number {
  if (operation in mutationDomains) return 6
  if (operation === 'apiUsage' || operation === 'screenshot') return 7
  if (operation === 'money' || operation === 'economic') return 5
  if (finance.has(operation)) return 4
  if (events.has(operation)) return 3
  if (trading.has(operation)) return 2
  if (company.has(operation)) return 1
  return 0
}

const capabilities: Array<{ name: string; description: string; group: number }> = (Object.keys(operations) as Operation[]).map((operation) => ({
  name: toolName(operation), description: operations[operation], group: groupIndex(operation),
}))
capabilities.push({ name: 'budget_terminal_connection_status', description: 'Check whether the running Budget Terminal app can accept MCP calls.', group: 7 })

export function McpPanel() {
  const { data, error } = useQuery({ queryKey: ['mcpStatus'], queryFn: () => api.mcpStatus(), refetchInterval: 5_000 })
  return <Panel title="Local MCP" className="p-3">
    <p className={`mt-1 text-2xs ${data?.available ? 'text-up' : 'text-down'}`}>
      {data?.available ? `Ready · ${data.tools} tools for ChatGPT / Codex` : data?.error ?? error?.message ?? 'Checking connection…'}
    </p>
    <p className="mt-1 text-2xs text-text-muted">Available while Budget Terminal is running. Client setup is documented in the repository README.</p>
    <h3 className="mt-3 text-xs font-semibold text-text">MCP capabilities · {capabilities.length}</h3>
    <div className="mt-2 grid gap-2 md:grid-cols-2" aria-label="MCP capabilities">
      {groups.map((group, index) => {
        const entries = capabilities.filter((entry) => entry.group === index)
        return <details key={group.title} className="rounded border border-border bg-surface-raised p-2">
          <summary className="cursor-pointer text-2xs font-semibold text-text">
            {group.title} <span className="font-normal text-text-muted">({entries.length})</span>
            <span className="mt-1 block font-normal text-text-muted">{group.hint}</span>
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-2xs text-text-muted">
            {entries.map((entry) => <li key={entry.name} data-mcp-capability={entry.name}>{entry.description}</li>)}
          </ul>
        </details>
      })}
    </div>
    <p className="mt-2 text-2xs text-text-muted">Edits update local records and automatic backups. Broker orders, bulk backup import/export, clearing all user data and cache reset stay outside MCP.</p>
  </Panel>
}
