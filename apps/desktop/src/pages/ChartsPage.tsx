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
      <nav className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-b border-border bg-surface px-3" aria-label="Charts workspaces">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={`h-10 shrink-0 border-b-2 px-3 text-[13px] font-medium transition-colors focus-visible:outline-accent ${tab === id ? 'border-accent bg-surface-raised text-text' : 'border-transparent text-text-muted hover:bg-surface-hover hover:text-text'}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'main' ? <MainWorkspace onStatus={reportStatus} /> : tab === 'multi' ? <MultiCharts onStatus={reportStatus} /> : tab === 'compare' ? <CompareWorkspace onStatus={reportStatus} /> : tab === 'relationship' ? <RelationshipLab onStatus={reportStatus} /> : <CheatSheet />}
    </main>
  )
}
