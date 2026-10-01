import { TABS } from '@shared/contract'
import { Panel } from '@/components/ui/Panel'
import { useDataHealth } from '@/stores/dataHealth'

const PAGE_LABELS = new Map(TABS.map((tab) => [tab.id, tab.label]))

/** Show the fixed order for this launch alongside the latest saved timings. */
export function PageLoadOrderPanel() {
  const startup = useDataHealth((state) => state.startup)
  const loads = useDataHealth((state) => state.startupLoads)
  const order = startup?.pageOrder ?? []

  return (
    <Panel title="Page Load Order">
      <div className="flex flex-col gap-2 p-2">
        <p className="text-2xs text-text-muted">
          This launch's loading priority. Saved load times guide the order on future launches.
        </p>
        {order.length ? <>
          <div className="max-h-72 overflow-auto border border-border" data-startup-order-scroll>
            <table className="w-full text-2xs" aria-label="Startup page load order">
              <thead className="sticky top-0 bg-surface-raised text-text-muted">
                <tr>
                  <th scope="col" className="w-14 px-2 py-1 text-left font-medium">Order</th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">Page</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Saved load time</th>
                </tr>
              </thead>
              <tbody>{order.map((page, index) => <tr key={page} data-startup-page={page} className="border-t border-border">
                <td className="num px-2 py-1 text-text-dim">{index + 1}</td>
                <th scope="row" className="px-2 py-1 text-left font-normal text-text">{PAGE_LABELS.get(page) ?? page}</th>
                <td className="num px-2 py-1 text-right text-text-muted">
                  {loads[page] ? `${(loads[page].durationMs / 1000).toFixed(1)}s` : 'Not measured'}
                </td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="text-2xs text-text-dim">All pages warm in parallel. Opening a page takes priority.</p>
        </> : <p className="text-2xs text-text-dim">The page load order will appear when startup begins.</p>}
      </div>
    </Panel>
  )
}
