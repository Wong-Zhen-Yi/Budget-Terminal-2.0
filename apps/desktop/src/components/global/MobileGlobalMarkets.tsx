import { useEffect, useId, useRef, useState } from 'react'

import { GLOBAL_INTERVALS, type GlobalInterval } from '@shared/contract'
import { performancePercent, thousands } from '@/lib/format'
import { intradayRangePercent, marketMove, WorldMap, type MappedRow } from './WorldMap'
import './mobileGlobalMarkets.css'

function MarketDetails({ row, interval }: { row: MappedRow; interval: GlobalInterval }) {
  const performance = row.intervals?.[interval]
  const lastDate = row.lastDate || performance?.endDate

  return (
    <>
      <p className="global-mobile-detail-quote">
        <span>{row.country} · {row.symbol}</span>
        <strong className="global-mobile-change" data-move={marketMove(row, interval)}>
          {interval} {performancePercent(performance?.available ? performance.changePct : null)}
        </strong>
      </p>
      <dl>
        <div><dt>Last close</dt><dd>{thousands(row.lastClose)}</dd></div>
        <div><dt>Quote date</dt><dd>{lastDate || '--'}</dd></div>
        <div><dt>{interval} start close</dt><dd>{performance?.available ? thousands(performance.startClose) : '--'}</dd></div>
        <div><dt>{interval} end close</dt><dd>{performance?.available ? thousands(performance.endClose) : '--'}</dd></div>
        <div><dt>Day low / high</dt><dd>{thousands(row.dayLow)} / {thousands(row.dayHigh)}</dd></div>
        <div><dt>Day range</dt><dd>{intradayRangePercent(row)}</dd></div>
      </dl>
      <p className="global-mobile-session">{row.status.session} ({row.status.clockTimezone})</p>
    </>
  )
}

export function MobileGlobalMarkets({ rows, interval, setInterval, loading, onExport, exportState }: {
  rows: MappedRow[]
  interval: GlobalInterval
  setInterval: (interval: GlobalInterval) => void
  loading: boolean
  onExport: () => void
  exportState: 'idle' | 'saving' | 'saved' | 'failed'
}) {
  const detailsId = useId()
  const [selection, setSelection] = useState<{ symbol: string; detailsAtTop: boolean }>()
  const trigger = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const selected = rows.find((row) => row.symbol === selection?.symbol)
  const selectedSymbol = selected?.symbol
  const exportNotice = exportState === 'saved' ? 'Global market data exported.'
    : exportState === 'failed' ? 'Could not export global market data. Try again.' : ''

  useEffect(() => {
    if (selectedSymbol) closeButton.current?.focus({ preventScroll: true })
  }, [selectedSymbol])

  const closeDetails = () => {
    setSelection(undefined)
    trigger.current?.focus({ preventScroll: true })
  }

  const selectMarket = (symbol: string, button: HTMLButtonElement) => {
    if (symbol === selectedSymbol) {
      closeDetails()
      return
    }
    trigger.current = button
    const mapHeight = button.offsetParent?.clientHeight ?? 0
    setSelection({ symbol, detailsAtTop: button.offsetTop + button.offsetHeight / 2 > mapHeight / 2 })
  }

  return (
    <section className="global-mobile" aria-label="World markets">
      <div className="global-mobile-toolbar">
        <div className="global-mobile-periods" role="group" aria-label="Performance interval">
          {GLOBAL_INTERVALS.map((label) => (
            <button type="button" key={label} aria-pressed={label === interval} onClick={() => setInterval(label)}>{label}</button>
          ))}
        </div>
        <button type="button" className="global-mobile-export" data-state={exportState} aria-label="Export for LLM"
          title={exportNotice || 'Export for LLM'} disabled={!rows.length || exportState === 'saving'} onClick={onExport}>
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            {exportState === 'saved' ? <path d="m4 10 4 4 8-8" />
              : exportState === 'failed' ? <path d="M10 4v8m0 2v2" />
              : <path d="M10 2.5v10m-4-4 4 4 4-4M3 12v4.5h14V12" />}
          </svg>
        </button>
        <span role="status" className="sr-only">{exportNotice}</span>
      </div>

      <div className="global-mobile-map-card">
        <div className="global-mobile-map-surface" role="group" aria-label="Global market index map"
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !selected) return
            event.stopPropagation()
            closeDetails()
          }}>
          <WorldMap rows={rows} interval={interval} className="global-mobile-map"
            mobile={{ detailsId, selectedSymbol, onSelect: selectMarket }} />
          {!rows.length && <p className="global-mobile-empty">{loading ? 'Loading indexes…' : 'No global index data'}</p>}
          <section id={detailsId} className="global-mobile-details" aria-label={selected?.name}
            data-at-top={selection?.detailsAtTop} hidden={!selected}>
            {selected && <>
              <header>
                <h2>{selected.name || selected.shortName || selected.symbol}</h2>
                <button type="button" ref={closeButton} onClick={closeDetails}>Close</button>
              </header>
              <MarketDetails row={selected} interval={interval} />
            </>}
          </section>
        </div>
        <div className="global-mobile-legend" role="group" aria-label="Map legend">
          <span data-move="up">Up</span>
          <span data-move="flat">Flat</span>
          <span data-move="down">Down</span>
          <span data-move="unknown">No data</span>
        </div>
      </div>
    </section>
  )
}
