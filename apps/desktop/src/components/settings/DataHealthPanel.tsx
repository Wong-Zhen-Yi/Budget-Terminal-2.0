import { useCallback, useMemo, useState } from 'react'

import { TABS } from '@shared/contract'
import { SectionHeader } from '@/components/settings/SettingsSection'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { timestampLabel } from '@/lib/format'
import { sortRecords, useDataHealth, type HealthRecord } from '@/stores/dataHealth'

const PAGE_LABELS = new Map(TABS.map((tab) => [tab.id, tab.label]))

/** One line per panel, worst first, in the copyable plain-text form the reference uses. */
function buildReport(records: HealthRecord[]): string {
  if (!records.length) {
    return 'No market data has been loaded in this session yet.\nOpen a page, then refresh this report.'
  }
  const lines = [
    'Budget Terminal data health',
    `Generated: ${timestampLabel(Date.now())}`,
    `Panels observed: ${records.length}`,
    '',
  ]
  for (const record of records) {
    const page = PAGE_LABELS.get(record.page) ?? record.page
    lines.push(
      `[${record.freshness.toUpperCase()}] ${page} / ${record.label} | source ${record.source} | ${timestampLabel(record.fetchedAt)}`,
    )
    if (record.failureReason) lines.push(`    reason: ${record.failureReason}`)
    for (const error of record.errors) lines.push(`    - ${error}`)
  }
  return lines.join('\n')
}

/** The current report text, read straight from the store rather than a render snapshot. */
function currentReport(): string {
  return buildReport(sortRecords(useDataHealth.getState().records))
}

/** `_build_settings_data_health_box`: a session-only view of stale feeds and API issues. */
export function DataHealthPanel({ onStatus }: { onStatus: (message: string) => void }) {
  const records = useDataHealth((state) => state.records)
  const clear = useDataHealth((state) => state.clear)

  // The body is a snapshot taken on demand, so it does not shift under the reader every
  // time the quote timer ticks. The summary line above it stays live.
  const [report, setReport] = useState(currentReport)
  const refresh = useCallback(() => setReport(currentReport()), [])

  const sorted = useMemo(() => sortRecords(records), [records])
  const degraded = sorted.filter(
    (record) => record.freshness === 'failed' || record.freshness === 'partial',
  )
  const summary = sorted.length
    ? degraded.length
      ? `Data health: ${degraded.length} of ${sorted.length} panel(s) degraded`
      : `Data health: OK across ${sorted.length} panel(s)`
    : 'Data health: nothing loaded yet'

  return (
    <Panel title="Data Health">
      <div className="flex min-h-0 flex-col gap-2 p-2">
        <SectionHeader
          title="Market Data Status"
          hint="Session-only view of stale data, cache fallback, missing prices and API issues."
        />
        <div className="flex items-center gap-2">
          <span className={`text-2xs ${degraded.length ? 'text-down' : 'text-up'}`}>{summary}</span>
          <Button className="ml-auto" onClick={refresh}>
            Refresh
          </Button>
          <Button
            variant="accent"
            onClick={async () => {
              const text = currentReport()
              setReport(text)
              try {
                await navigator.clipboard.writeText(text)
                onStatus('Data health report copied to clipboard.')
              } catch {
                onStatus('Unable to reach the clipboard; the report is shown below.')
              }
            }}
          >
            Copy Report
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              clear()
              // `clear` has already run, so this re-reads an empty store.
              setReport(currentReport())
              onStatus('Data health history cleared.')
            }}
          >
            Clear
          </Button>
        </div>
        <pre className="num max-h-72 overflow-auto border border-border-strong bg-bg p-2 text-2xs whitespace-pre text-text-muted select-text">
          {report}
        </pre>
      </div>
    </Panel>
  )
}
