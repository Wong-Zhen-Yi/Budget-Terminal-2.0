import { useState } from 'react'

import { TABS } from '@shared/contract'
import { api } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { useDataHealth } from '@/stores/dataHealth'

const PAGE_LABELS = new Map(TABS.map((tab) => [tab.id, tab.label]))

/** A point-in-time diagnostic report, without settings, holdings or local file paths. */
function buildReport({ startup, startupLoads }: ReturnType<typeof useDataHealth.getState>): string {
  const lines = [
    'Budget Terminal — Page Load Order',
    `Generated: ${new Date().toISOString()}`,
    'Snapshot of this launch; loading pages are not yet ready.',
    'Saved load times are learned across launches, not individual task timings.',
    '',
    `Startup tasks completed: ${startup?.timings.length ?? 0}/${startup?.planned ?? 0}`,
    `Startup elapsed: ${((startup?.durationMs ?? 0) / 1000).toFixed(1)}s`,
    '',
    'Order | Page | Startup status | Saved load time | Saved samples',
  ]
  for (const [index, page] of (startup?.pageOrder ?? []).entries()) {
    const status = startup?.pages?.[page]
    const load = startupLoads[page]
    lines.push(`${index + 1} | ${PAGE_LABELS.get(page) ?? page} (${page}) | ${status?.state ?? 'loading'}${status?.reason ? ` · ${status.reason}` : ''} | ${load ? `${(load.durationMs / 1000).toFixed(1)}s` : 'Not measured'} | ${load?.samples ?? 0}`)
  }
  lines.push('', 'Completed startup task timings:')
  for (const task of startup?.timings ?? []) {
    lines.push(`${PAGE_LABELS.get(task.tab) ?? task.tab} / ${task.label} | ${(task.durationMs / 1000).toFixed(1)}s | ${task.state ?? (task.failed ? 'failed' : 'ready')}${task.reason ? ` · ${task.reason}` : ''}`)
  }
  if (!startup?.timings.length) lines.push('No completed tasks yet.')
  lines.push('', 'Analyze loading bottlenecks and failures. Distinguish pending pages from failures and saved page estimates from this launch\'s task timings.')
  return lines.join('\n')
}

/** Show the fixed order for this launch alongside the latest saved timings. */
export function PageLoadOrderPanel() {
  const startup = useDataHealth((state) => state.startup)
  const loads = useDataHealth((state) => state.startupLoads)
  const order = startup?.pageOrder ?? []
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)

  async function exportForAi() {
    setExporting(true)
    setNotice(null)
    try {
      const report = buildReport(useDataHealth.getState())
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const path = await api.saveText(`BudgetTerminal_PageLoadOrder_${stamp}.txt`, report)
      setNotice({ text: path ? 'Page load report exported. You can attach it to your AI chat.' : 'Export cancelled.' })
    } catch {
      setNotice({ text: 'Unable to export the page load report. Please try again.', error: true })
    } finally {
      setExporting(false)
    }
  }

  return (
    <Panel title="Page Load Order" actions={
      <Button variant="positive" onClick={() => void exportForAi()} disabled={!order.length || exporting}
        title="Save a text snapshot of all startup pages, saved load times, task timings and failures for AI analysis. Nothing is sent to an AI service.">
        {exporting ? 'Exporting...' : 'Export for AI'}
      </Button>
    }>
      <div className="flex flex-col gap-2 p-2">
        <p className="text-2xs text-text-muted">
          This launch's loading priority. Saved load times guide the order on future launches.
        </p>
        {notice ? <p role={notice.error ? 'alert' : 'status'} className={`text-2xs ${notice.error ? 'text-warn' : 'text-text-muted'}`}>{notice.text}</p> : null}
        {order.length ? <>
          <div className="max-h-72 overflow-auto border border-border" data-startup-order-scroll>
            <table className="w-full text-2xs" aria-label="Startup page load order">
              <thead className="sticky top-0 bg-surface-raised text-text-muted">
                <tr>
                  <th scope="col" className="w-14 px-2 py-1 text-left font-medium">Order</th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">Page</th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">Startup status</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Saved load time</th>
                </tr>
              </thead>
              <tbody>{order.map((page, index) => <tr key={page} data-startup-page={page} className="border-t border-border">
                <td className="num px-2 py-1 text-text-dim">{index + 1}</td>
                <th scope="row" className="px-2 py-1 text-left font-normal text-text">{PAGE_LABELS.get(page) ?? page}</th>
                <td className={`px-2 py-1 ${['failed', 'degraded'].includes(startup?.pages?.[page]?.state ?? '') ? 'text-warn' : 'text-text-muted'}`} title={startup?.pages?.[page]?.reason}>
                  {startup?.pages?.[page]?.state ?? 'loading'}{startup?.pages?.[page]?.reason ? ` · ${startup.pages[page].reason}` : ''}
                </td>
                <td className="num px-2 py-1 text-right text-text-muted">
                  {loads[page] ? `${(loads[page].durationMs / 1000).toFixed(1)}s` : 'Not measured'}
                </td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="text-2xs text-text-dim">All pages load at startup. Yahoo background requests are paced at 3 per second, with up to 3 in flight, and slow further if rate limited. Foreground requests take priority. Temporary failures retry automatically; unresolved failures remain visible.</p>
        </> : <p className="text-2xs text-text-dim">The page load order will appear when startup begins.</p>}
      </div>
    </Panel>
  )
}
