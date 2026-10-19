import { effectiveFreshness, useSnapshotClock } from '@/api/snapshotHealth'
import { FRESHNESS } from '@shared/freshness'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import type {
  CalendarMonthPayload,
  EarningsCalendarRow,
  Envelope,
  OptionPosition,
} from '@shared/contract'
import {
  CALENDAR_TIMEZONES,
  addDays,
  buildCalendarExport,
  buildEarningsExport,
  calendarToday,
  daysBetween,
  earningsDateRange,
  earningsStatus,
  earningsWeekRows,
  filterEarningsRows,
  startOfWeek,
  type CalendarTimezoneId,
  type EarningsRangeMode,
  type EarningsTiming,
} from '@shared/calendar'
import {
  useCalendarMonth,
  useEarningsCalendar,
  useRefreshCalendarMonth,
  useRefreshEarningsCalendar,
} from '@/api/calendarQueries'
import { api } from '@/api/client'
import { usePortfolio } from '@/api/queries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { SearchInput } from '@/components/ui/SearchInput'
import { Select } from '@/components/ui/Select'
import { useCalendarPage } from '@/stores/calendar'
import { CalendarMonthGrid, ECONOMIC_COLORS, EconomicReadings } from '@/components/calendar/CalendarMonthGrid'
import '@/styles/calendar.css'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const EARNINGS_WEEKDAYS = WEEKDAYS.slice(0, 5)

function dateLabel(date: string, year = false): string {
  const value = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(value.getTime())
    ? value.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        ...(year ? { year: 'numeric' } : {}),
        timeZone: 'UTC',
      })
    : '--'
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)))
}

function monthPrefix(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function warningOf(envelope: Envelope<unknown> | undefined): string | undefined {
  if (!envelope) return undefined
  return envelope.meta.failureReason || undefined
}

function DetailTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full table-fixed border-collapse" style={{ minWidth: headers.length * 95 }}>
        <thead className="sticky top-0 z-10 bg-surface-raised">
          <tr>
            {headers.map((header) => (
              <th key={header} className="border-b border-border px-1 py-1 text-center text-2xs font-medium text-text-muted">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border/60 last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="truncate px-1 py-1 text-center text-2xs text-text" title={typeof cell === 'string' ? cell : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <div className="p-3 text-center text-2xs text-text-dim">No events</div> : null}
    </div>
  )
}

function DetailPanel({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border border-border bg-surface">
      <header className="shrink-0 border-b border-border bg-surface-raised px-2 py-1 text-2xs font-semibold text-text-muted">
        {title}
      </header>
      {children}
    </section>
  )
}

function MonthlyCalendar({
  payload,
  envelope,
  loading,
  mainName,
  options,
  onRefresh,
  notice,
  setNotice,
}: {
  payload: CalendarMonthPayload | undefined
  envelope: Envelope<CalendarMonthPayload> | undefined
  loading: boolean
  mainName: string
  options: OptionPosition[]
  onRefresh: () => Promise<void>
  notice: string
  setNotice: (notice: string) => void
}) {
  const state = useCalendarPage()
  const today = calendarToday(state.timezone)
  const prefix = monthPrefix(state.year, state.month)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    setRefreshing(true)
    try {
      await onRefresh()
      setNotice('Calendar refreshed.')
    } catch (error) {
      setNotice(`Calendar refresh failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setRefreshing(false)
    }
  }
  const exportMonth = useCallback(async () => {
    const inMonth = (date: string) => date.startsWith(prefix)
    const content = buildCalendarExport({
      year: state.year,
      month: state.month,
      today,
      includeEconomic: state.showEconomic,
      includeCompany: state.showCompany,
      includeOptions: state.showOptions,
      includeMarketHolidays: state.showMarketHolidays,
      economicEvents: (payload?.economicEvents ?? []).filter((event) => inMonth(event.date)),
      companyEvents: (payload?.companyEvents ?? []).filter((event) => inMonth(event.date)),
      marketHolidays: (payload?.marketHolidays ?? []).filter((event) => inMonth(event.date)),
      options: options.filter((option) => inMonth(option.expiry) && option.status.toLowerCase() === 'open'),
    })
    try {
      await api.writeClipboard(content)
      setNotice(`Calendar export copied for ${monthLabel(state.year, state.month)}.`)
    } catch (error) {
      setNotice(`Calendar export failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [options, payload, prefix, setNotice, state, today])

  const companyRows = useMemo(
    () => (payload?.companyEvents ?? [])
      .filter((event) => event.date.startsWith(prefix))
      .sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker)),
    [payload, prefix],
  )
  const economicRows = useMemo(
    () => (payload?.economicEvents ?? []).filter((event) => event.date.startsWith(prefix)),
    [payload, prefix],
  )
  const optionRows = useMemo(
    () => options
      .filter((option) => option.expiry.startsWith(prefix) && option.status.toLowerCase() === 'open')
      .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.ticker.localeCompare(b.ticker)),
    [options, prefix],
  )

  return (
    <div className="calendar-month-page">
      <div className="calendar-toolbar">
        <h1 className="text-xs font-semibold text-text">Calendar</h1>
        <Button
          onClick={() => state.setDetailsCollapsed(!state.detailsCollapsed)}
          aria-expanded={!state.detailsCollapsed}
          aria-controls="calendar-details"
        >
          {state.detailsCollapsed ? 'Show information' : 'Hide information'}
        </Button>
        <div className="calendar-toolbar-actions">
          <Button onClick={() => state.changeMonth(-1)} aria-label="Previous month">◀</Button>
          <span className="min-w-32 text-center text-2xs font-semibold text-warn">{monthLabel(state.year, state.month)}</span>
          <Button onClick={() => state.changeMonth(1)} aria-label="Next month">▶</Button>
          <Button onClick={() => state.setPresentMonth(today)}>Today</Button>
          <Select
            value={state.timezone}
            options={CALENDAR_TIMEZONES.map((choice) => ({ value: choice.id, label: choice.label }))}
            onChange={(timezone: CalendarTimezoneId) => state.setTimezone(timezone, calendarToday(timezone))}
            className="w-24"
            aria-label="Calendar reference timezone"
          />
          <Button variant="accent" disabled={loading || refreshing} onClick={() => void refresh()}>{loading || refreshing ? 'Refreshing…' : 'Refresh'}</Button>
          <Button onClick={() => void exportMonth()}>Export</Button>
        </div>
      </div>

      <div className="calendar-filter-bar" aria-label="Calendar event categories">
        <Checkbox checked={state.showEconomic} onChange={checked => state.setCategory('showEconomic', checked)} label={`Economic (${economicRows.length})`} />
        <Checkbox checked={state.showCompany} onChange={checked => state.setCategory('showCompany', checked)} label={`Company (${companyRows.length})`} />
        <Checkbox checked={state.showOptions} onChange={checked => state.setCategory('showOptions', checked)} label={`Options (${optionRows.length})`} />
        <Checkbox checked={state.showMarketHolidays} onChange={checked => state.setCategory('showMarketHolidays', checked)} label="Market holidays" />
        <span className="calendar-hint">Hover to preview · Click a day to pin</span>
      </div>
      <div className="calendar-data-status" role="status">
        {loading || refreshing ? 'Loading calendar and economic readings…' : `${economicRows.length} economic releases · ${economicRows.filter(event => event.importance === 'high').length} high impact · ${monthLabel(state.year, state.month)}`}
        {envelope?.meta.failureReason ? <span className="text-warn">Partial data: {envelope.meta.failureReason}</span> : null}
      </div>
      {notice ? <div className="shrink-0 border border-border bg-surface-raised px-2 py-1 text-2xs text-text-muted" role="status">{notice}</div> : null}
      {envelope?.meta.freshness === 'failed' && !payload?.generatedAt ? (
        <div className="shrink-0">
          <PanelMessage>{envelope.meta.failureReason || 'Calendar data unavailable.'}</PanelMessage>
        </div>
      ) : null}

      <div className="calendar-grid-container">
        <CalendarMonthGrid
          year={state.year}
          month={state.month}
          today={today}
          payload={payload}
          options={options}
          showEconomic={state.showEconomic}
          showCompany={state.showCompany}
          showOptions={state.showOptions}
          showMarketHolidays={state.showMarketHolidays}
        />
      </div>

      <div
        id="calendar-details"
        hidden={state.detailsCollapsed}
        className={state.detailsCollapsed ? 'hidden' : 'calendar-details'}
      >
        <DetailPanel title="This Month · Company Events">
          <DetailTable
            headers={['Date', 'Ticker', 'Event', 'Details']}
            rows={state.showCompany ? companyRows.map((event) => [dateLabel(event.date), event.ticker, <span className={event.event === 'Earnings' ? 'text-[#ff9800]' : 'text-[#4fc3f7]'}>{event.event}</span>, `${daysBetween(today, event.date)}d from today`]) : []}
          />
        </DetailPanel>
        <DetailPanel title="This Month · Economic Releases & Readings">
          <div className="calendar-economic-list">
            {state.showEconomic && economicRows.length ? economicRows.map(event => <article key={`${event.date}-${event.name}`}>
              <h3 style={{ color: ECONOMIC_COLORS[event.name] ?? '#aab3c2' }}>{dateLabel(event.date)} · {event.name}</h3>
              <p className="calendar-source">{event.importance.toUpperCase()} impact</p>
              <EconomicReadings event={event} />
            </article>) : <p className="calendar-empty-message">No economic events in the enabled categories.</p>}
          </div>
        </DetailPanel>
        <DetailPanel title={<>US Market Holidays & Early Closes <span className="text-text-dim">{state.year}</span></>}>
          <DetailTable
            headers={['Date', 'Market', 'Event', 'Details']}
            rows={state.showMarketHolidays ? (payload?.marketHolidays ?? []).map((event) => [dateLabel(event.date), event.market, <span style={{ color: event.color }}>{event.event}</span>, event.detail]) : []}
          />
        </DetailPanel>
        <DetailPanel title={<>Options Expiration <span className="text-text-dim">{mainName}</span></>}>
          <DetailTable
            headers={['Expiry', 'Ticker', 'Strategy', 'Strike', 'Qty', 'Status', 'Details']}
            rows={state.showOptions ? optionRows.map((option) => [dateLabel(option.expiry, true), option.ticker, option.strategy, option.strike.toFixed(2), String(option.contracts), <span className={option.status.toLowerCase() === 'open' ? 'text-up' : 'text-text-dim'}>{option.status}</span>, `${daysBetween(today, option.expiry)}d from today`]) : []}
          />
        </DetailPanel>
      </div>
    </div>
  )
}

function cacheText(envelope: Envelope<unknown> | undefined, universeCount: number, now: number): string {
  const age = envelope ? Math.max(envelope.meta.cacheAgeSeconds ?? 0, (now - envelope.meta.fetchedAt) / 1000, 0) : undefined
  const universe = universeCount ? `; ${universeCount.toLocaleString()} US company symbols` : ''
  if (age === undefined) return `Cache status unavailable${universe}`
  const ageText = age < 3600 ? `${Math.round(age / 60)}m` : age < 172800 ? `${(age / 3600).toFixed(1)}h` : `${(age / 86400).toFixed(1)}d`
  return `Cache ${envelope ? effectiveFreshness(envelope, now, FRESHNESS.calendar) : 'unavailable'}: ${ageText} old${universe}`
}

function EarningsCard({ row }: { row: EarningsCalendarRow }) {
  const statusTone = row.status === 'Reported' ? 'text-up' : row.status === 'Today' ? 'text-warn' : 'text-text-muted'
  return (
    <article className={`border bg-[#182235] p-2 ${row.changedDate ? 'border-warn' : 'border-border-strong'}`} title={row.eventName}>
      <div className="flex items-center gap-2">
        <strong className="text-2xs text-text">{row.symbol}</strong>
        <span className={`ml-auto text-2xs ${statusTone}`}>{row.status}</span>
      </div>
      <div className="mt-1 text-2xs text-text">{row.company}</div>
      <div className="mt-1 text-2xs text-text-muted">{row.timing} | {row.timeDisplay}</div>
      <div className="text-2xs text-text-muted">EPS {row.epsEstimate} / {row.reportedEps} | Surprise {row.surprisePct}</div>
      <div className="text-2xs text-text-dim">Market cap {row.marketCap}</div>
      {row.changedDate ? <div className="mt-1 text-2xs font-semibold text-warn">Changed from {row.previousDate || 'previous date'}</div> : null}
    </article>
  )
}

function EarningsCalendar({
  notice,
  setNotice,
  onStatusChange,
  sourcePath,
}: {
  notice: string
  setNotice: (notice: string) => void
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  sourcePath: string
}) {
  const state = useCalendarPage()
  const now = useSnapshotClock()
  const today = calendarToday(state.timezone, new Date(now))
  const range = useMemo(() => earningsDateRange(state.earningsMode, state.earningsYear, today), [state.earningsMode, state.earningsYear, today])
  const request = useMemo(() => ({ startDate: range.startDate, endDate: range.endDate, rangeKey: range.rangeKey }), [range])
  const query = useEarningsCalendar(request, true)
  const refresh = useRefreshEarningsCalendar(request)
  const rows = useMemo(
    () => filterEarningsRows(query.data?.data.rows ?? [], state.earningsSearch, state.earningsTiming, state.earningsChangedOnly)
      .map(row => ({ ...row, status: earningsStatus(row, today) })),
    [query.data, state.earningsChangedOnly, state.earningsSearch, state.earningsTiming, today],
  )
  const minWeek = startOfWeek(range.startDate)
  const maxWeek = startOfWeek(range.endDate)
  const weekStart = state.earningsWeekStart < minWeek ? minWeek : state.earningsWeekStart > maxWeek ? maxWeek : state.earningsWeekStart
  const setEarningsWeekStart = state.setEarningsWeekStart
  useEffect(() => {
    if (weekStart !== state.earningsWeekStart) setEarningsWeekStart(weekStart)
  }, [setEarningsWeekStart, state.earningsWeekStart, weekStart])
  useEffect(() => {
    onStatusChange(
      [{ label: 'Earnings Calendar', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: query.isFetching }],
      sourcePath,
    )
  }, [onStatusChange, query.data, query.isFetching, sourcePath])
  const groups = useMemo(() => earningsWeekRows(rows, weekStart), [rows, weekStart])
  const visibleCount = groups.reduce((total, group) => total + group.length, 0)
  const weekEnd = addDays(weekStart, 4)

  const exportWeek = useCallback(async () => {
    const payload = query.data?.data
    if (!payload) return
    try {
      await api.writeClipboard(buildEarningsExport({
        payload,
        rows,
        weekStart,
        rangeLabel: range.label,
        search: state.earningsSearch,
        timing: state.earningsTiming,
        changedOnly: state.earningsChangedOnly,
        exportedAt: new Date().toLocaleString(),
      }))
      setNotice(`Earnings week export copied to clipboard (${visibleCount} events).`)
    } catch (error) {
      setNotice(`Earnings export failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [query.data, range.label, rows, setNotice, state, visibleCount, weekStart])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex flex-wrap items-center gap-2 border border-border bg-surface p-2">
        <div>
          <h1 className="text-sm font-semibold text-text">Earnings</h1>
          <p className={`text-2xs ${query.data?.meta.freshness === 'failed' ? 'text-down' : 'text-text-muted'}`}>
            {query.isFetching ? `Refreshing earnings for ${range.label}…` : query.data ? `${query.data.data.rows.length} earnings row(s) for ${range.label} from ${query.data.data.source}` : 'Loading cached earnings data…'}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button disabled={weekStart <= minWeek} onClick={() => state.setEarningsWeekStart(addDays(weekStart, -7))}>&lt;</Button>
          <span className="min-w-48 text-center text-2xs text-text-muted">{dateLabel(weekStart)} - {dateLabel(weekEnd, true)}</span>
          <Button disabled={weekStart >= maxWeek} onClick={() => state.setEarningsWeekStart(addDays(weekStart, 7))}>&gt;</Button>
          <Button onClick={() => state.setEarningsWeekStart(startOfWeek(today))}>Current week</Button>
          <span className="ml-2 text-2xs text-text-muted">Range</span>
          <Select<EarningsRangeMode>
            value={state.earningsMode}
            options={[{ value: 'rolling', label: 'Current + next 12 months' }, { value: 'year', label: 'Selected year' }]}
            onChange={state.setEarningsMode}
            className="w-52"
          />
          <label className="flex items-center gap-1 text-2xs text-text-muted">
            Year
            <input
              type="number"
              min={1990}
              max={Number(today.slice(0, 4)) + 10}
              value={state.earningsYear}
              disabled={state.earningsMode !== 'year'}
              onChange={(event) => state.setEarningsYear(Number(event.target.value))}
              className="no-drag h-8 w-20 border border-border-strong bg-surface-raised px-1 text-2xs text-text outline-none disabled:opacity-40"
            />
          </label>
          <Button variant="accent" disabled={query.isFetching} onClick={() => void refresh()}>{query.isFetching ? 'Refreshing…' : 'Refresh'}</Button>
          <Button onClick={() => void exportWeek()}>Export to LLM</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border border-border bg-surface p-2">
        <SearchInput value={state.earningsSearch} onChange={state.setEarningsSearch} placeholder="Search symbol, company, or event" className="min-w-64 flex-1" />
        <Select<EarningsTiming>
          value={state.earningsTiming}
          options={[
            { value: 'all', label: 'All timing' },
            { value: 'BMO', label: 'BMO' },
            { value: 'AMC', label: 'AMC' },
            { value: 'TAS', label: 'TAS' },
            { value: 'TBD', label: 'TBD' },
          ]}
          onChange={state.setEarningsTiming}
          className="w-36"
        />
        <Checkbox checked={state.earningsChangedOnly} onChange={state.setEarningsChangedOnly} label="Changed dates only" />
        <span className={`ml-auto text-2xs ${query.data && effectiveFreshness(query.data, now, FRESHNESS.calendar) === 'stale' ? 'text-warn' : 'text-text-muted'}`}>
          {cacheText(query.data, query.data?.data.symbolUniverseCount ?? 0, now)}
        </span>
      </div>

      {notice ? <div className="border border-border bg-surface-raised px-2 py-1 text-2xs text-text-muted">{notice}</div> : null}
      <Panel
        title="Weekly Earnings Calendar"
        warning={warningOf(query.data)}
        actions={<span className="text-2xs font-normal normal-case text-text-muted">{visibleCount} this week{rows.length !== (query.data?.data.rows.length ?? 0) ? `; ${rows.length} filtered of ${query.data?.data.rows.length ?? 0}` : ''}</span>}
        className="min-h-0 flex-1"
      >
        {query.data?.meta.freshness === 'failed' && !query.data.data.rows.length ? (
          <PanelMessage>{query.data.meta.failureReason || 'Earnings calendar unavailable.'}</PanelMessage>
        ) : (
          <div className="min-h-0 flex-1 overflow-x-auto">
            <div className="grid h-full min-w-[72rem] grid-cols-5 gap-2 p-2">
              {groups.map((group, index) => {
                const date = addDays(weekStart, index)
                return (
                  <section key={date} className="flex min-h-0 flex-col border border-border bg-bg">
                    <header className={`flex items-center border-b border-border bg-surface-raised px-2 py-1 text-2xs font-semibold ${date === today ? 'text-warn' : 'text-text'}`}>
                      {EARNINGS_WEEKDAYS[index]} {dateLabel(date)}
                      <span className="ml-auto text-text-muted">{group.length}</span>
                    </header>
                    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1">
                      {group.length ? group.map((row) => <EarningsCard key={`${row.eventKey}-${row.datetimeUtc}`} row={row} />) : <div className="p-4 text-center text-2xs text-text-dim">No earnings</div>}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}

export function CalendarPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const state = useCalendarPage()
  const portfolio = usePortfolio()
  const main = portfolio.data?.data.portfolios.find((entry) => entry.id === portfolio.data?.data.mainId)
    ?? portfolio.data?.data.portfolios.find((entry) => !entry.readOnly)
  const tickers = useMemo(() => main?.tickers ?? [], [main])
  const options = useMemo(() => main?.options ?? [], [main])
  const today = calendarToday(state.timezone)
  const initialize = state.initialize
  useEffect(() => initialize(today), [initialize, today])

  const monthRequest = useMemo(() => ({ tickers, year: state.year, month: state.month }), [tickers, state.month, state.year])
  const monthQuery = useCalendarMonth(monthRequest, state.subTab === 'calendar')
  const refreshMonth = useRefreshCalendarMonth(monthRequest)
  const [notice, setNotice] = useState('')

  useEffect(() => setNotice(''), [state.subTab])
  useEffect(() => {
    if (state.subTab !== 'calendar') return
    onStatusChange(
      [
        { label: 'Company Events', envelope: monthQuery.data, error: monthQuery.error, enabled: monthQuery.isEnabled, loading: monthQuery.isFetching },
        { label: 'Economic Events', envelope: monthQuery.data, error: monthQuery.error, enabled: monthQuery.isEnabled, loading: monthQuery.isFetching },
        { label: 'Market Holidays', envelope: monthQuery.data, error: monthQuery.error, enabled: monthQuery.isEnabled, loading: monthQuery.isFetching },
        { label: 'Options Expirations', envelope: portfolio.data, error: portfolio.error, enabled: portfolio.isEnabled, loading: portfolio.isFetching },
      ],
      portfolio.data?.data.sourcePath ?? '',
    )
  }, [monthQuery.data, monthQuery.isFetching, onStatusChange, portfolio.data, portfolio.isFetching, state.subTab])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex h-9 shrink-0 border-b border-border bg-surface px-2">
        {(['calendar', 'earnings'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => state.setSubTab(tab)}
            className={`border-b-2 px-4 text-2xs ${state.subTab === tab ? 'border-accent text-text' : 'border-transparent text-text-muted hover:text-text'}`}
          >
            {tab === 'calendar' ? 'Calendar' : 'Earnings'}
          </button>
        ))}
      </nav>
      {state.subTab === 'calendar' ? (
        <MonthlyCalendar
          payload={monthQuery.data?.data}
          envelope={monthQuery.data}
          loading={monthQuery.isFetching}
          mainName={main?.name ?? 'Main Portfolio'}
          options={options}
          onRefresh={refreshMonth}
          notice={notice}
          setNotice={setNotice}
        />
      ) : (
        <EarningsCalendar
          notice={notice}
          setNotice={setNotice}
          onStatusChange={onStatusChange}
          sourcePath={portfolio.data?.data.sourcePath ?? ''}
        />
      )}
    </div>
  )
}
