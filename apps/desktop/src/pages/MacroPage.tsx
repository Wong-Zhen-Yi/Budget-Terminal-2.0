import { useEffect, useState } from 'react'
import type { EconomicRow } from '@shared/contract'
import { formatEconomicValue, SERIES_BY_ID } from '@shared/economic'
import { COMPASS_STEADY_THRESHOLD_PP, MACRO_DRIVERS, MACRO_RATES, macroCompass } from '@shared/macro'
import { useEconomic } from '@/api/economicQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { SeriesChart } from '@/components/economic/SeriesChart'
import './MacroPage.css'

const growthStates = [
  { direction: -1, label: 'Slower' },
  { direction: 0, label: 'Steady' },
  { direction: 1, label: 'Faster' },
] as const

const inflationStates = [
  { direction: 1, label: 'Rising' },
  { direction: 0, label: 'Steady' },
  { direction: -1, label: 'Easing' },
] as const

function value(row: EconomicRow | undefined) {
  return row?.available ? formatEconomicValue(row.latest, row.units, row.decimals) : '—'
}

function releaseChange(change: number | null) {
  if (change === null) return '—'
  const sign = change < 0 ? '−' : change > 0 ? '+' : ''
  return `${sign}${Math.abs(change).toFixed(2)} pp`
}

function CycleCompass({ growth, inflation }: { growth?: EconomicRow; inflation?: EconomicRow }) {
  const compass = macroCompass(growth, inflation)
  const growthState = growthStates.find(state => state.direction === compass.growthDirection)
  const inflationState = inflationStates.find(state => state.direction === compass.inflationDirection)

  return <section className="macro-compass" aria-labelledby="macro-compass-title">
    <h2 id="macro-compass-title">Cycle compass</h2>
    <p className="macro-compass-caption">Change from prior observation</p>
    <table className="macro-compass-grid" aria-label="Growth momentum by inflation momentum">
      <thead><tr>
        <td>Inflation ↓<br />Growth →</td>
        {growthStates.map(state => <th key={state.direction} scope="col">{state.label}</th>)}
      </tr></thead>
      <tbody>{inflationStates.map(price => <tr key={price.direction}>
        <th scope="row">{price.label}</th>
        {growthStates.map(activity => {
          const active = price === inflationState && activity === growthState
          return <td key={activity.direction} data-active={active}>
            {active && <span className="macro-compass-marker" aria-label="Latest release pair" role="img" />}
          </td>
        })}
      </tr>)}</tbody>
    </table>
    <p className="macro-compass-reading">{growthState && inflationState
      ? `${growthState.label} growth · ${inflationState.label} inflation`
      : 'No directional signal: release comparison unavailable.'}</p>
    <dl>
      <dt>Real GDP · QoQ annualized<small>{growth?.latestDate ?? 'Unavailable'}</small></dt>
      <dd>{value(growth)} <small>{releaseChange(compass.growthChange)}</small></dd>
      <dt>CPI · year over year<small>{inflation?.latestDate ?? 'Unavailable'}</small></dt>
      <dd>{value(inflation)} <small>{releaseChange(compass.inflationChange)}</small></dd>
    </dl>
    <p>Steady means a move under {COMPASS_STEADY_THRESHOLD_PP.toFixed(2)} percentage points. GDP is quarterly and CPI is monthly.</p>
  </section>
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
      <CycleCompass growth={find('GDPC1')} inflation={find('CPIAUCSL')} />
      <section className="macro-history"><div className="macro-chart-heading"><div><h2>Driver history</h2><p>{selectedRow?.note || 'Select a reading below to explore its history.'}</p></div><div className="macro-ranges" aria-label="History range">{[1, 5, 10].map(span => <button key={span} aria-pressed={years === span} onClick={() => setYears(span)}>{span}Y</button>)}</div></div>
        <div className="macro-chart"><SeriesChart row={selectedRow} years={years} /></div>
        <p className="macro-source">{selectedRow?.source ?? 'Source unavailable'} · Observation {selectedRow?.latestDate ?? 'unavailable'} · {selectedRow?.frequency ?? '—'}</p>
      </section>
      <section className="macro-rates"><h2>Policy & transmission</h2><p>Rates, real yields and inflation compensation</p><div className="macro-rate-list">{MACRO_RATES.map(driver)}</div><small>Breakevens are nominal less TIPS yields; they also reflect risk and liquidity premia.</small></section>
      <section className="macro-drivers" aria-label="Macro drivers">{MACRO_DRIVERS.map(group => <div key={group.title}><h2>{group.title}</h2>{group.ids.map(driver)}</div>)}</section>
    </div>
  </div>
}
