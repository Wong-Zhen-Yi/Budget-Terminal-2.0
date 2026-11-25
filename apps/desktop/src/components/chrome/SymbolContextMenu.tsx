import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { normalizeChartSymbol } from '@shared/chartWindow'
import { api } from '@/api/client'
import { useChartsStore } from '@/stores/charts'

/** Pages a ticker can open in, in menu order. Hidden pages are left out. */
const OPEN_IN: ReadonlyArray<[string, string]> = [
  ['charts', 'Charts'],
  ['stocks', 'Stocks'],
  ['fundamentals', 'Fundamentals'],
  ['options', 'Options'],
  ['valuation', 'Valuation'],
]

interface MenuItem {
  label: string
  hint?: string
  disabled?: boolean
  run: () => void | Promise<void>
}

interface OpenMenu {
  symbol: string
  x: number
  y: number
}

/**
 * The right-click menu for any element marked `data-symbol`: table rows, heatmap tiles,
 * chart symbol lists and scorecard tickers. It opens the ticker on another page, pops a
 * chart out into its own window, copies it or adds it to the Charts watchlist.
 */
export function SymbolContextMenu({ visibleTabIds, onNavigate, enabled }: {
  visibleTabIds: readonly string[]
  onNavigate: (tabId: string, symbol: string) => void
  enabled: boolean
}) {
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [message, setMessage] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const element = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const watchlist = useChartsStore((state) => state.watchlist)

  const close = useCallback(() => {
    setMenu(null)
    setPosition(null)
    setMessage('')
    const previous = returnFocus.current
    returnFocus.current = null
    if (previous?.isConnected) previous.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (!enabled) return
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-symbol]') : null
      const symbol = normalizeChartSymbol(target?.dataset.symbol)
      if (!target || !symbol) return
      event.preventDefault()
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setMessage('')
      setHighlighted(0)
      setPosition(null)
      setMenu({ symbol, x: event.clientX, y: event.clientY })
    }
    window.addEventListener('contextmenu', onContextMenu)
    return () => window.removeEventListener('contextmenu', onContextMenu)
  }, [enabled])

  useEffect(() => {
    if (!enabled) close()
  }, [enabled, close])

  // Anything that moves the page under the menu dismisses it.
  useEffect(() => {
    if (!menu) return
    const onPointerDown = (event: PointerEvent) => {
      if (!element.current?.contains(event.target as Node)) close()
    }
    const dismiss = () => close()
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('wheel', dismiss, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('wheel', dismiss)
    }
  }, [menu, close])

  // Keep the menu inside the window: flip left/up near the right and bottom edges.
  useLayoutEffect(() => {
    if (!menu || !element.current) return
    const { width, height } = element.current.getBoundingClientRect()
    const margin = 8
    const left = menu.x + width + margin > window.innerWidth ? Math.max(margin, menu.x - width) : menu.x
    const top = menu.y + height + margin > window.innerHeight ? Math.max(margin, menu.y - height) : menu.y
    setPosition({ left, top })
  }, [menu])

  // Focus once placed: the menu is invisible while it is measured and cannot take focus then.
  useEffect(() => {
    if (position) element.current?.focus({ preventScroll: true })
  }, [position])

  if (!menu) return null
  const { symbol } = menu
  const inWatchlist = watchlist.includes(symbol)
  const items: MenuItem[] = [
    ...OPEN_IN.filter(([id]) => visibleTabIds.includes(id)).map(([id, label]): MenuItem => ({
      label: `Open in ${label}`,
      run: () => { onNavigate(id, symbol); close() },
    })),
    {
      label: 'Pop out chart',
      hint: 'New window',
      run: async () => {
        try {
          await api.openChartWindow(symbol)
          close()
        } catch (error) {
          setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not open a chart window.')
        }
      },
    },
    {
      label: 'Copy ticker',
      run: async () => {
        try {
          await api.writeClipboard(symbol)
          close()
        } catch {
          setMessage('Could not copy the ticker.')
        }
      },
    },
    {
      label: inWatchlist ? 'In Charts watchlist' : 'Add to Charts watchlist',
      disabled: inWatchlist,
      run: () => {
        const state = useChartsStore.getState()
        state.setWatchlist([...state.watchlist, symbol])
        close()
      },
    },
  ]
  const openCount = items.length - 3
  const enabledIndexes = items.flatMap((item, index) => item.disabled ? [] : [index])
  const active = enabledIndexes.includes(highlighted) ? highlighted : enabledIndexes[0] ?? -1
  const move = (step: 1 | -1) => {
    if (!enabledIndexes.length) return
    const at = enabledIndexes.indexOf(active)
    setHighlighted(enabledIndexes[(at + step + enabledIndexes.length) % enabledIndexes.length])
  }

  return (
    <div
      ref={element}
      role="menu"
      aria-label={`${symbol} actions`}
      tabIndex={-1}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault()
          event.stopPropagation()
          close()
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          move(-1)
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (active >= 0) void items[active].run()
        }
      }}
      className="fixed z-50 min-w-52 rounded border border-border-strong bg-surface-raised py-1 text-2xs shadow-2xl outline-none"
      style={{ left: position?.left ?? menu.x, top: position?.top ?? menu.y, visibility: position ? 'visible' : 'hidden' }}
    >
      <p className="num border-b border-border px-3 pb-1.5 pt-1 font-semibold text-text">{symbol}</p>
      {items.map((item, index) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          disabled={item.disabled}
          onMouseEnter={() => { if (!item.disabled) setHighlighted(index) }}
          onClick={() => void item.run()}
          className={`flex h-7 w-full items-center justify-between gap-4 px-3 text-left disabled:text-text-dim ${
            index === active ? 'bg-accent-dim text-text' : 'text-text-muted'
          } ${index === openCount && openCount > 0 ? 'mt-1 border-t border-border' : ''}`}
        >
          <span>{item.label}</span>
          {item.hint ? <span className="text-text-dim">{item.hint}</span> : null}
        </button>
      ))}
      {message ? <p role="alert" className="max-w-64 border-t border-border px-3 pt-1.5 pb-1 text-down">{message}</p> : null}
    </div>
  )
}
