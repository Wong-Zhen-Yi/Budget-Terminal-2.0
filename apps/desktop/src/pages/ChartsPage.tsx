import { useCallback, useEffect, useState } from 'react'

import type { EnvelopeMeta } from '@shared/contract'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { CheatSheet } from '@/components/chartsworkstation/CheatSheet'
import { CompareWorkspace } from '@/components/chartsworkstation/CompareWorkspace'
import { MainWorkspace } from '@/components/chartsworkstation/MainWorkspace'
import { MultiCharts } from '@/components/chartsworkstation/MultiCharts'
import { RelationshipLab } from '@/components/chartsworkstation/RelationshipLab'
import type { ChartsSubtab } from '@/stores/charts'
import { useChartsStore } from '@/stores/charts'
import { queryFreshness } from '@/api/queryPersistence'

const TABS: Array<[ChartsSubtab, string]> = [
  ['main', 'Main'],
  ['multi', 'Multi Charts'],
  ['compare', 'Compare'],
  ['relationship', 'Relationship'],
  ['cheat', 'Cheat Sheet'],
]

export function ChartsPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const [tab, setTab] = useState<ChartsSubtab>('main')
  const interval = useChartsStore((state) => state.interval)
  const reportStatus = useCallback((meta: EnvelopeMeta | undefined, loading: boolean, error?: unknown) => {
    onStatusChange([{
      label: 'Charts',
      envelope: meta ? { data: null, errors: [], meta } : undefined,
      loading,
      error,
      freshnessMs: queryFreshness(['chartsHistory', '', interval]),
    }], '')
  }, [onStatusChange, interval])
  useEffect(() => {
    if (tab === 'cheat') onStatusChange([], '')
  }, [onStatusChange, tab])
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <nav className="flex h-9 shrink-0 items-end gap-px border-b border-border bg-surface px-2 pt-1" aria-label="Charts workspace tabs">
        {TABS.map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`h-8 border border-b-0 px-3 text-2xs ${tab === id ? 'border-accent bg-surface-raised text-text' : 'border-border bg-surface text-text-muted hover:text-text'}`}>{label}</button>)}
      </nav>
      {tab === 'main' ? <MainWorkspace onStatus={reportStatus} /> : tab === 'multi' ? <MultiCharts onStatus={reportStatus} /> : tab === 'compare' ? <CompareWorkspace onStatus={reportStatus} /> : tab === 'relationship' ? <RelationshipLab onStatus={reportStatus} /> : <CheatSheet />}
    </main>
  )
}
