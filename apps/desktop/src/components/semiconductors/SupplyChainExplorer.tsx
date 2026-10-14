import type { SemiconductorGroup, SemiconductorRow } from '@shared/semiconductors'
import { SEMICONDUCTOR_GROUPS, semiconductorOverview } from '@shared/semiconductors'

const stages: SemiconductorGroup[] = ['eda-ip', 'design', 'foundry', 'test-packaging', 'integrated', 'memory', 'equipment', 'materials']
const paths: Record<SemiconductorGroup, string> = {
  'eda-ip': 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',
  design: 'M6 6h12v12H6z M9 9h6v6H9z M9 2v4 M15 2v4 M9 18v4 M15 18v4 M2 9h4 M2 15h4 M18 9h4 M18 15h4',
  foundry: 'M3 21V10l6-4v5l6-4v6h6v8z M17 13V3h4v10 M7 16v2 M12 16v2 M17 16v2',
  'test-packaging': 'M2 7l10-5 10 5-10 5z M2 12l10 5 10-5 M2 17l10 5 10-5',
  integrated: 'M3 21V5h10v16 M13 11h8v10 M6 9h4 M6 13h4 M6 17h4 M16 15h2 M16 18h2 M1 21h22',
  memory: 'M3 4h18v6H3z M3 14h18v6H3z M6 7h2 M11 7h2 M16 7h2 M6 17h2 M11 17h2 M16 17h2',
  equipment: 'M3 21h18 M6 21v-5l5-4 M11 12l-4-5 5-4 5 6-6 3 M17 9l4 3 M9 17h6v4',
  materials: 'M9 2h6 M10 2v7L4 19q-1 3 3 3h10q4 0 3-3L14 9V2 M7 15h10',
}
const percent = (value: number | null) => value === null ? '--' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`

export function SubsectorIcon({ group }: { group: SemiconductorGroup }) {
  return <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[group]} /></svg>
}

export function SupplyChainExplorer({ rows, group, onSelect, loading }: {
  rows: SemiconductorRow[]
  group: SemiconductorGroup | 'all'
  onSelect: (group: SemiconductorGroup | 'all') => void
  loading: boolean
}) {
  return <section className="semi-ecosystem" aria-label="Semiconductor supply chain">
    <div className="semi-ecosystem-heading">
      <div><h2>Explore the semiconductor ecosystem</h2><p>Select a subsector to filter companies · industry stages, not company relationships</p></div>
      <button className="semi-reset" aria-pressed={group === 'all'} onClick={() => onSelect('all')}>All subsectors</button>
    </div>
    <div className="semi-stages">
      {stages.map((id, index) => {
        const item = SEMICONDUCTOR_GROUPS.find(item => item.id === id)!
        const members = rows.filter(row => row.company.group === id)
        const stats = semiconductorOverview(members)
        const leaders = [...members].sort((a, b) => (b.market?.marketCap ?? 0) - (a.market?.marketCap ?? 0)).slice(0, 3)
        return <button key={id} type="button" className={`semi-stage ${index < 4 ? 'semi-process-stage' : ''}`} data-subsector={id}
          aria-pressed={group === id} title={item.description} onClick={() => onSelect(group === id ? 'all' : id)}>
          <SubsectorIcon group={id} />
          <div className="semi-stage-copy"><h3>{item.label}</h3><p>{members.length} companies <span className={stats.daily === null ? 'text-text-dim' : stats.daily >= 0 ? 'text-up' : 'text-down'}>{percent(stats.daily)}</span></p>
            <div className="semi-ticker-chips">{leaders.map(row => <span key={row.company.symbol}>{row.company.symbol}</span>)}</div>
            <small>{stats.quoteCount}/{members.length} daily quotes{!stats.quoteCount && loading ? ' · loading' : ''}</small>
          </div>
        </button>
      })}
    </div>
  </section>
}

export function SubsectorPerformance({ rows, group, onSelect }: {
  rows: SemiconductorRow[]
  group: SemiconductorGroup | 'all'
  onSelect: (group: SemiconductorGroup | 'all') => void
}) {
  const groups = SEMICONDUCTOR_GROUPS.map(item => ({ ...item, stats: semiconductorOverview(rows.filter(row => row.company.group === item.id)) }))
    .sort((a, b) => (b.stats.daily ?? -Infinity) - (a.stats.daily ?? -Infinity))
  const max = Math.max(...groups.map(item => Math.abs(item.stats.daily ?? 0)), 0.01)
  return <div className="semi-performance" data-subsector-performance>
    <p>Equal-weight daily return · available quotes</p>
    {groups.map(item => <button key={item.id} aria-pressed={group === item.id} onClick={() => onSelect(group === item.id ? 'all' : item.id)} title={`${item.stats.quoteCount}/${item.stats.count} daily observations`}>
      <span className="semi-performance-label">{item.label}<small>{item.stats.quoteCount}/{item.stats.count} quotes</small></span>
      <span className="semi-bar-track" aria-hidden="true"><span className="semi-bar-zero" />{item.stats.daily !== null ? <span className={`semi-bar ${item.stats.daily < 0 ? 'semi-bar-negative' : ''}`} style={{ width: `${Math.abs(item.stats.daily) / max * 50}%` }} /> : null}</span>
      <span className={`num ${item.stats.daily === null ? 'text-text-dim' : item.stats.daily >= 0 ? 'text-up' : 'text-down'}`}>{percent(item.stats.daily)}</span>
    </button>)}
    <p className="semi-performance-note">Missing quotes are excluded. Cached values retain their source status in the company table.</p>
  </div>
}
