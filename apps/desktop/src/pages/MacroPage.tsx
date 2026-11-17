import { useEffect, useState } from 'react'
import type { EconomicRow } from '@shared/contract'
import { formatEconomicValue, SERIES_BY_ID } from '@shared/economic'
import { MACRO_DRIVERS, MACRO_RATES, macroCompass } from '@shared/macro'
import { useEconomic } from '@/api/economicQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { SeriesChart } from '@/components/economic/SeriesChart'
import './MacroPage.css'

const quadrants = [
  ['softer-rising', 'Softer growth', 'Rising inflation'],
  ['firmer-rising', 'Firmer growth', 'Rising inflation'],
  ['softer-easing', 'Softer growth', 'Easing inflation'],
  ['firmer-easing', 'Firmer growth', 'Easing inflation'],
] as const

function value(row: EconomicRow | undefined) {
  return row?.available ? formatEconomicValue(row.latest, row.units, row.decimals) : '—'
}

export function MacroPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tab: string) => void
}) {
  const query = useEconomic(true)
  const rows = query.data?.data.rows ?? []
  const [selected, setSelected] = useState('CPIAUCSL')
  const [years, setYears] = useState(5)
  const selectedRow = rows.find(row => row.seriesId === selected) ?? null
  const compass = macroCompass(rows)
  const find = (id: string) => rows.find(row => row.seriesId === id)
  useEffect(() => {
    onStatusChange([{ label: 'Macro', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: query.isFetching }], '')
  }, [onStatusChange, query.data, query.error, query.isEnabled, query.isFetching])

  function driver(id: string) {
    const row = find(id)
    return <button key={id} className="macro-driver" aria-pressed={selected === id} onClick={() => setSelected(id)}>
      <span>{row?.label ?? SERIES_BY_ID.get(id)?.label ?? id}</span><strong>{value(row)}</strong>
      <small>{row?.latestDate ?? 'No observation'} · {row?.frequency ?? '—'}</small>
    </button>
  }

  return <div className="macro-page" data-macro-page>
    <header className="macro-header">
      <div><h1>Macro</h1><p>US cycle desk · activity, prices, employment and the cost of money</p></div>
      <nav aria-label="Macro research"><button onClick={() => onNavigate('economic')}>All indicators ↗</button><button onClick={() => onNavigate('calendar')}>Release calendar ↗</button><button onClick={() => onNavigate('bonds')}>Bonds ↗</button></nav>
    </header>
    <div className="macro-workspace">
      <section className="macro-compass"><h2>Cycle compass</h2><p>Growth momentum →</p>
        <div className="macro-quadrants" aria-label="Latest release direction">
          {quadrants.map(([id, growth, prices]) => <div key={id} data-active={compass === id}><span>{growth}</span><strong>{prices}</strong>{compass === id && <small>● Latest direction</small>}</div>)}
        </div>
        <p>{compass ? 'Based on the change from each prior release.' : 'No directional signal: a required release is missing or unchanged.'}</p>
        <dl><dt>Real GDP · QoQ annualized</dt><dd>{value(find('GDPC1'))} <small>{find('GDPC1')?.latestDate ?? 'Unavailable'}</small></dd><dt>CPI · year over year</dt><dd>{value(find('CPIAUCSL'))} <small>{find('CPIAUCSL')?.latestDate ?? 'Unavailable'}</small></dd></dl>
        <p>Quarterly GDP and monthly CPI have different observation periods. This compass describes release momentum, not recession probabilities.</p>
      </section>
      <section className="macro-history"><div className="macro-chart-heading"><div><h2>Driver history</h2><p>{selectedRow?.note || 'Select a reading below to explore its history.'}</p></div><div className="macro-ranges" aria-label="History range">{[1, 5, 10].map(span => <button key={span} aria-pressed={years === span} onClick={() => setYears(span)}>{span}Y</button>)}</div></div>
        <div className="macro-chart"><SeriesChart row={selectedRow} years={years} /></div>
        <p className="macro-source">{selectedRow?.source ?? 'Source unavailable'} · Observation {selectedRow?.latestDate ?? 'unavailable'} · {selectedRow?.frequency ?? '—'}</p>
      </section>
      <section className="macro-rates"><h2>Policy & transmission</h2><p>Rates, real yields and inflation compensation</p><div className="macro-rate-list">{MACRO_RATES.map(driver)}</div><small>Breakevens are nominal less TIPS yields; they also reflect risk and liquidity premia.</small></section>
      <section className="macro-drivers" aria-label="Macro drivers">{MACRO_DRIVERS.map(group => <div key={group.title}><h2>{group.title}</h2>{group.ids.map(driver)}</div>)}</section>
    </div>
  </div>
}
