import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CalendarMonthPayload, EconomicCalendarEvent, OptionPosition } from '@shared/contract'
import { monthCells } from '@shared/calendar'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const ECONOMIC_COLORS: Record<string, string> = {
  'FOMC Decision': '#e879f9', 'CPI Release': '#fbbf24', 'PPI Release': '#fb923c',
  'PCE Inflation': '#a78bfa', 'GDP Report': '#69f0ae', 'Jobs Report': '#60a5fa',
}

export function EconomicReadings({ event }: { event: EconomicCalendarEvent }) {
  return <>
    {event.readings?.length ? <>
      <table className="calendar-readings">
        <caption>Reference month: {event.readings[0].period}</caption>
        <thead><tr><th>Indicator</th><th>Actual*</th><th>Previous*</th></tr></thead>
        <tbody>{event.readings.map(reading => <tr key={`${reading.seriesId}-${reading.label}`}>
          <th scope="row">{reading.label}</th>
          <td>{reading.actual ?? 'Pending / N/A'}</td><td>{reading.previous ?? 'N/A'}</td>
        </tr>)}</tbody>
      </table>
      <p className="calendar-source">{[...new Set(event.readings.map(reading => `${reading.source} (${reading.seriesId})`))].join(' · ')}</p>
      <p className="calendar-source">* {event.readingsNote || 'Current revised data, not release-day vintages. Consensus forecasts are not supplied.'}</p>
    </> : <p className="calendar-source">Schedule only · Reported figures and consensus forecasts are not supplied for this event.</p>}
  </>
}

interface DayEvent {
  title: string
  compact: string
  category: string
  color: string
  detail: string
  economic?: EconomicCalendarEvent
}

export function CalendarMonthGrid({ year, month, today, payload, options, showEconomic, showCompany, showOptions, showMarketHolidays }: {
  year: number
  month: number
  today: string
  payload: CalendarMonthPayload | undefined
  options: OptionPosition[]
  showEconomic: boolean
  showCompany: boolean
  showOptions: boolean
  showMarketHolidays: boolean
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [size, setSize] = useState({ width: 1000, height: 600 })
  const [active, setActive] = useState<{ date: string; anchor: HTMLButtonElement; pinned: boolean } | null>(null)
  const [position, setPosition] = useState({ left: 12, top: 12 })
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  const events = useMemo(() => {
    const byDate = new Map<string, DayEvent[]>()
    const add = (date: string, event: DayEvent) => {
      if (!date.startsWith(prefix)) return
      byDate.set(date, [...(byDate.get(date) ?? []), event])
    }
    if (showMarketHolidays) for (const event of payload?.marketHolidays ?? []) add(event.date, {
      title: event.event, compact: event.cellLabel, category: 'Market', color: event.color,
      detail: `${event.market} · ${event.detail}`,
    })
    if (showEconomic) for (const event of payload?.economicEvents ?? []) {
      const reading = event.readings?.slice(0, 2).find(reading => reading.actual !== null)
      add(event.date, { title: event.name, compact: `${event.name.replace(/ Release| Report| Inflation| Decision/g, '')}${reading ? ` ${reading.actual} ${reading.label.includes('YoY') ? 'YoY' : 'MoM'}` : ''}`,
        category: 'Economic', color: ECONOMIC_COLORS[event.name] ?? '#aab3c2',
        detail: `${event.importance.toUpperCase()} impact · US economic release`, economic: event })
    }
    if (showCompany) for (const event of payload?.companyEvents ?? []) add(event.date, {
      title: `${event.ticker} · ${event.event}`, compact: `${event.ticker} ${event.event === 'Earnings' ? 'EPS' : 'Ex-div'}`,
      category: 'Company', color: event.event === 'Earnings' ? '#fb923c' : '#4fc3f7',
      detail: event.event === 'Earnings' ? 'Portfolio company earnings · Reporting time not supplied' : 'Ex-dividend date · Dividend amount not supplied',
    })
    if (showOptions) for (const option of options) {
      if (option.status.toLowerCase() !== 'open') continue
      add(option.expiry, { title: `${option.ticker.toUpperCase()} · ${option.strategy}`, compact: `${option.ticker.toUpperCase()} expiry`,
        category: 'Options', color: '#f472b6', detail: `Strike $${option.strike.toFixed(2)} · ${option.contracts} contract(s) · ${option.status}` })
    }
    return byDate
  }, [options, payload, prefix, showCompany, showEconomic, showMarketHolidays, showOptions])

  const cells = monthCells(year, month)
  // Avoid a wasted sixth row in months that fit in four or five weeks.
  while (cells.length > 28 && cells.slice(-7).every(day => day === null)) cells.splice(-7)
  const weeks = cells.length / 7
  // Reserve space for the larger day heading and overflow count before fitting 24px event lines.
  const limit = Math.max(1, Math.min(size.width < 600 ? 1 : size.width < 950 ? 3 : 5, Math.floor(((size.height - 34) / weeks - 60) / 24)))
  const cancelClose = () => clearTimeout(closeTimer.current)
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setActive(current => {
      const focused = document.activeElement
      return current?.pinned || current?.anchor === focused || previewRef.current?.contains(focused) ? current : null
    }), 180)
  }
  const open = (date: string, anchor: HTMLButtonElement) => {
    cancelClose()
    setActive(current => current?.pinned ? current : { date, anchor, pinned: false })
  }
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    if (gridRef.current) observer.observe(gridRef.current)
    return () => { observer.disconnect(); clearTimeout(closeTimer.current) }
  }, [])
  useEffect(() => { setActive(null) }, [prefix, showEconomic, showCompany, showOptions, showMarketHolidays])
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!previewRef.current?.contains(event.target as Node) && !active?.anchor.contains(event.target as Node)) setActive(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (previewRef.current?.contains(document.activeElement)) active?.anchor.focus()
        setActive(null)
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [active])
  useLayoutEffect(() => {
    if (!active) return
    const place = () => {
      const rect = active.anchor.getBoundingClientRect()
      const width = previewRef.current?.offsetWidth ?? 520
      const height = previewRef.current?.offsetHeight ?? 400
      const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12))
      const preferredTop = rect.bottom + height + 8 <= window.innerHeight - 12 ? rect.bottom + 8 : rect.top - height - 8
      const top = Math.max(12, Math.min(preferredTop, window.innerHeight - height - 12))
      setPosition({ left, top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [active, size, events])

  const activeEvents = active ? events.get(active.date) ?? [] : []
  return <>
    <div ref={gridRef} className="calendar-month-grid" style={{ gridTemplateRows: `34px repeat(${weeks}, minmax(110px, 1fr))` }} aria-label="Monthly event calendar">
      {WEEKDAYS.map(day => <div key={day} className="calendar-weekday">{day}</div>)}
      {cells.map((day, index) => {
        const date = `${prefix}-${String(day).padStart(2, '0')}`
        const rows = events.get(date) ?? []
        return day ? <button type="button" key={date} className={`calendar-day ${date === today ? 'is-today' : ''} ${index % 7 >= 5 ? 'is-weekend' : ''} ${active?.date === date ? 'is-active' : ''}`}
          aria-label={`${date}, ${rows.length} event${rows.length === 1 ? '' : 's'}${date === today ? ', today' : ''}`}
          aria-describedby={active?.date === date ? 'calendar-day-preview' : undefined}
          onPointerEnter={event => { if (event.pointerType !== 'touch') open(date, event.currentTarget) }} onPointerLeave={scheduleClose}
          onFocus={event => open(date, event.currentTarget)} onBlur={scheduleClose}
          onClick={event => { cancelClose(); const anchor = event.currentTarget; setActive(current => current?.date === date && current.pinned ? null : { date, anchor, pinned: true }) }}>
          <span className="calendar-day-heading"><span className="calendar-day-number num">{day}</span>{rows.length > 0 ? <span className="calendar-day-count">{rows.length}</span> : null}</span>
          {rows.slice(0, limit).map((event, i) => <span className="calendar-grid-event" key={i} style={{ color: event.color }}><span className="calendar-event-dot" />{event.compact}</span>)}
          {rows.length > limit ? <span className="calendar-more">+{rows.length - limit} more</span> : null}
        </button> : <div key={`blank-${index}`} className="calendar-day is-empty" />
      })}
    </div>
    {active ? createPortal(<div ref={previewRef} id="calendar-day-preview" role="region" aria-label={`Events on ${active.date}`} className="calendar-day-preview" style={position}
      onPointerEnter={cancelClose} onPointerLeave={scheduleClose} onFocus={cancelClose} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose() }}>
      <header><div><strong>{new Date(`${active.date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</strong>
        <p>{activeEvents.length} event{activeEvents.length === 1 ? '' : 's'} · {active.pinned ? 'Pinned day' : 'Click day to pin details'}</p></div>
        <button type="button" aria-label="Close day details" onClick={() => { active.anchor.focus(); setActive(null) }}>×</button></header>
      <div className="calendar-preview-events">{activeEvents.length ? activeEvents.map((event, index) => <article key={index} style={{ borderLeftColor: event.color }}>
        <div className="calendar-preview-category" style={{ color: event.color }}>{event.category}</div>
        <h3>{event.title}</h3><p className="calendar-source">{event.detail}</p>
        {event.economic ? <EconomicReadings event={event.economic} /> : null}
      </article>) : <p className="calendar-empty-message">No events in the enabled categories for this day.</p>}</div>
    </div>, document.body) : null}
  </>
}
