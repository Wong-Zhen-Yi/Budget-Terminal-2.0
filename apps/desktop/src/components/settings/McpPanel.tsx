import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { McpPolicy } from '../../../electron/shared/mcpAccess'
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

const company = new Set<Operation>(['stocks', 'fundamentals', 'fundamentalsPage', 'targets', 'valuation', 'discoveryUniverse', 'discovery', 'bmnr', 'hood', 'amzn', 'avgo'])
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
  const client = useQueryClient()
  const [testMessage, setTestMessage] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const { data, error } = useQuery({ queryKey: ['mcpStatus'], queryFn: () => api.mcpStatus(), refetchInterval: 5_000 })
  const permissions = useMutation({
    mutationFn: (policy: McpPolicy) => api.configureMcp(policy),
    onSuccess: status => { client.setQueryData(['mcpStatus'], status) },
  })
  const test = useMutation({
    mutationFn: () => api.testMcpConnection(),
    onMutate: () => setTestMessage(''),
    onSuccess: status => { client.setQueryData(['mcpStatus'], status); setTestMessage('Connection test passed. The authenticated local bridge is responding.') },
  })
  const cancel = useMutation({ mutationFn: (id: number) => api.cancelMcpCall(id), onSuccess: status => client.setQueryData(['mcpStatus'], status) })
  const diagnostics = data?.diagnostics
  const policy = diagnostics?.policy
  const active = diagnostics?.activity.filter(entry => entry.durationMs === undefined).length ?? 0
  return <Panel title="Local MCP" className="p-3">
    <p className={`mt-1 text-2xs ${data?.available ? 'text-up' : 'text-down'}`}>
      {data?.available ? `Ready · ${data.tools} tools for ChatGPT / Codex` : data?.error ?? error?.message ?? 'Checking connection…'}
    </p>
    <p className="mt-1 text-2xs text-text-muted">Available while Budget Terminal is running. Client setup is documented in the repository README.</p>
    <div className="mt-3 space-y-2 rounded border border-border p-2 text-2xs">
      <h3 className="font-semibold text-text">Permissions · external clients and embedded agent tools</h3>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={policy?.readOnly ?? true} disabled={!data?.available || !policy || permissions.isPending}
          onChange={event => policy && permissions.mutate({ ...policy, readOnly: event.target.checked })} />
        Read-only MCP (blocks saved-record edits and shared Browser research actions)
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={policy?.requireApproval ?? true} disabled={!data?.available || !policy || permissions.isPending}
          onChange={event => policy && permissions.mutate({ ...policy, requireApproval: event.target.checked })} />
        Require local approval for every saved-record edit
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={policy?.browserRequireApproval ?? false} disabled={!policy || permissions.isPending}
          onChange={event => policy && permissions.mutate({ ...policy, browserRequireApproval: event.target.checked })} />
        Ask before agents read or capture website content (including app screenshots)
      </label>
      <p className="text-text-muted">New installs and unreadable permissions default to read-only. Approvals show the exact edit in a native dialog, default to Deny and expire after 60 seconds. Changing permissions cancels pending approval; edits already executing cannot be undone. These controls do not restrict manual editing or the existing reviewed portfolio-import flow.</p>
      {diagnostics?.policyError && <p role="alert" className="text-down">{diagnostics.policyError}</p>}
      {permissions.error && <p role="alert" className="text-down">Could not save MCP permissions. {permissions.error.message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="rounded border border-border px-2 py-1" disabled={!data?.available || test.isPending}
          onClick={() => test.mutate()}>{test.isPending ? 'Testing…' : 'Test MCP connection'}</button>
        <span role="status">{testMessage}</span>
      </div>
      {test.error && <p role="alert" className="text-down">Connection test failed. {test.error.message}</p>}
    </div>
    <details className="mt-3 rounded border border-border p-2 text-2xs">
      <summary className="cursor-pointer font-semibold">Client setup</summary>
      <p className={data?.setup?.valid ? 'mt-2 text-up' : 'mt-2 text-text-muted'}>{data?.setup?.message ?? 'Test the connection to validate local client setup.'}</p>
      {data?.setup?.configuration && <>
        <p className="mt-1 text-text-muted">The adapter reads the local runtime descriptor on each call. This configuration contains no session token. Requires Node.js on PATH.</p>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">{data.setup.configuration}</pre>
        <button type="button" className="mt-2 rounded border border-border px-2 py-1" onClick={() => {
          void api.writeClipboard(data.setup!.configuration!).then(() => setCopyMessage('Client configuration copied.')).catch(() => setCopyMessage('Copy failed. Select and copy the configuration above.'))
        }}>Copy client configuration</button><span className="ml-2" role="status">{copyMessage}</span>
      </>}
    </details>
    <details className="mt-3 rounded border border-border p-2 text-2xs" open>
      <summary className="cursor-pointer font-semibold text-text">Recent MCP activity · {active} active</summary>
      <p className="mt-1 text-text-muted">Last 100 calls, this session only. Arguments, results, website URLs, client IDs and error details are never logged. Connection heartbeats are excluded.</p>
      <p className="mt-1 text-text-muted">Write receipts: {diagnostics?.writeReceipts ?? 0}/{diagnostics?.writeReceiptLimit ?? 500}. Reusing a mutation requestId with the same arguments replays its receipt instead of editing twice. Receipts are lost on app restart; read saved records before retrying after a restart.</p>
      {!diagnostics?.activity.length ? <p className="mt-2 text-text-muted">No MCP calls recorded this session.</p> :
        <div className="mt-2 max-h-64 overflow-auto"><table className="w-full text-left" aria-label="Recent MCP activity">
          <thead><tr><th className="pr-2">Time</th><th className="pr-2">Tool</th><th className="pr-2">Source</th><th className="pr-2">Status</th><th>Duration</th><th>Control</th></tr></thead>
          <tbody>{[...diagnostics.activity].reverse().map(entry => <tr key={entry.id}>
            <td className="whitespace-nowrap pr-2">{new Date(entry.startedAt).toLocaleTimeString()}</td>
            <td className="pr-2">{entry.tool}</td><td className="pr-2">{entry.source}</td>
            <td className={`pr-2 ${entry.state === 'blocked' || entry.state === 'failed' ? 'text-down' : entry.state === 'approval' ? 'text-warning' : ''}`}>{entry.state === 'approval' ? 'Awaiting local approval' : entry.state}</td>
            <td className="whitespace-nowrap">{entry.durationMs === undefined ? 'In progress' : `${entry.durationMs} ms`}</td>
            <td>{entry.durationMs === undefined && <button type="button" className="rounded border border-border px-1" disabled={cancel.isPending} onClick={() => cancel.mutate(entry.id)}>Cancel request</button>}</td>
          </tr>)}</tbody>
        </table></div>}
    </details>
    <p className="mt-2 text-2xs text-text-muted">Cancellation stops pending approvals and new scan/capture work. Shared provider requests already in flight may finish. An executing edit may still complete; cancellation does not roll it back.</p>
    {cancel.error && <p role="alert" className="text-down text-2xs">Could not cancel the request.</p>}
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
