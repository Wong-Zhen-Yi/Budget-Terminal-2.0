import { useEffect } from 'react'
import { calendarToday, daysBetween } from '@shared/calendar'
import type { EconomicCalendarEvent, EconomicGroup, EconomicRow } from '@shared/contract'
import { formatEconomicValue, SERIES_BY_ID } from '@shared/economic'
import { COMPASS_STEADY_THRESHOLD_PP, MACRO_DRIVERS, MACRO_RATES, MACRO_RELEASE_WINDOW_DAYS, macroCompass, upcomingMacroReleases } from '@shared/macro'
import { macroCalendarRequest, useCalendarMonth } from '@/api/calendarQueries'
import { useEconomic } from '@/api/economicQueries'
import { useSnapshotClock } from '@/api/snapshotHealth'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { useEconomicPage, type EconomicTab } from '@/stores/economic'
import './MacroPage.css'

const driverTabs = {
  Growth: 'growth',
  Inflation: 'inflation',
  Labor: 'labor',
  Rates: 'rates',
} satisfies Record<EconomicGroup, EconomicTab>

const releaseDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
})

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

function ReleaseWatch({ events, today, emptyMessage }: {
  events: EconomicCalendarEvent[]
  today: string
  emptyMessage: string
}) {
  const upcoming = upcomingMacroReleases(events, today)
  return <section className="macro-release-watch" aria-labelledby="macro-release-title">
    <header>
      <h2 id="macro-release-title">Upcoming US releases</h2>
      <p>Next scheduled date per release · {MACRO_RELEASE_WINDOW_DAYS}-day outlook · Eastern Time</p>
    </header>
    {upcoming.length ? <ol className="macro-release-list">
      {upcoming.map(event => {
        const days = daysBetween(today, event.date)
        return <li key={event.name}>
          <time dateTime={event.date}>{releaseDate.format(new Date(event.date))}</time>
          <strong>{event.name}</strong>
          <span>{days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}</span>
        </li>
      })}
    </ol> : <p className="macro-release-empty">{emptyMessage}</p>}
    <p className="macro-release-source">Federal Reserve, BLS and BEA schedules · Dates may change</p>
  </section>
}

export function MacroPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tab: string) => void
}) {
  const query = useEconomic(true)
  const rows = query.data?.data.rows ?? []
  const now = useSnapshotClock()
  const today = calendarToday('est', new Date(now))
  const schedule = useCalendarMonth(macroCalendarRequest(today))
  const releaseEvents = schedule.data?.data.economicEvents ?? []
  const releaseEmptyMessage = schedule.isPending && schedule.isFetching ? 'Loading release schedule…'
    : schedule.error || schedule.data?.meta.freshness === 'failed' ? 'Release schedule unavailable.'
      : `No key releases listed in the next ${MACRO_RELEASE_WINDOW_DAYS} days.`
  const find = (id: string) => rows.find(row => row.seriesId === id)
  useEffect(() => {
    onStatusChange([
      { label: 'Macro', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: query.isFetching },
      { label: 'US release schedule', envelope: schedule.data, error: schedule.error, enabled: schedule.isEnabled, loading: schedule.isFetching },
    ], '')
  }, [onStatusChange, query.data, query.error, query.isEnabled, query.isFetching, schedule.data, schedule.error, schedule.isEnabled, schedule.isFetching])

  function driver(id: string) {
    const row = find(id)
    const label = row?.label ?? SERIES_BY_ID.get(id)?.label ?? id
    const openHistory = () => {
      if (!row?.history.length) return
      const economic = useEconomicPage.getState()
      economic.selectSeries(row.group, id)
      economic.setActiveTab(driverTabs[row.group])
      onNavigate('economic')
    }
    return <button key={id} className="macro-driver" disabled={!row?.history.length}
      title={row?.history.length ? 'View history in Economic' : undefined} onClick={openHistory}>
      <span>{label}</span><strong>{value(row)}</strong>
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
      <section className="macro-drivers" aria-label="Macro drivers">
        {MACRO_DRIVERS.map(group => <div className="macro-driver-group" key={group.title}>
          <h2>{group.title}</h2>
          {group.ids.map(driver)}
        </div>)}
      </section>
      <ReleaseWatch events={releaseEvents} today={today} emptyMessage={releaseEmptyMessage} />
      <section className="macro-rates"><h2>Policy & transmission</h2><p>Rates, real yields and inflation compensation</p><div className="macro-rate-list">{MACRO_RATES.map(driver)}</div><small>Breakevens are nominal less TIPS yields; they also reflect risk and liquidity premia.</small></section>
    </div>
  </div>
}
