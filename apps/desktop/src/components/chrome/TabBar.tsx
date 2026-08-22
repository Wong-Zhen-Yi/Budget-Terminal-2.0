import { useEffect, useRef, useState } from 'react'

import { TABS } from '@shared/contract'
import { api } from '@/api/client'
import { clockTime } from '@/lib/format'

interface TabBarProps {
  activeTab: string
  onSelectTab: (id: string) => void
  onReload: () => void
  reloading: boolean
}

/**
 * The page strip across the top. Every page of the PySide6 app is listed in its
 * navigation order, but only Dashboard is built — the rest are inert markers of what
 * the migration still has to cover.
 */
export function TabBar({ activeTab, onSelectTab, onReload, reloading }: TabBarProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const [clock, setClock] = useState(() => clockTime(new Date()))

  useEffect(() => {
    const timer = setInterval(() => setClock(clockTime(new Date())), 1000)
    return () => clearInterval(timer)
  }, [])

  const scrollBy = (delta: number) => {
    scroller.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  return (
    <div className="drag-region flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface pr-0 pl-2">
      <span className="shrink-0 pr-1 text-2xs font-semibold tracking-widest text-accent-hover">
        BT
      </span>

      <ArrowButton label="Scroll tabs left" onClick={() => scrollBy(-360)}>
        {'<'}
      </ArrowButton>

      <div
        ref={scroller}
        className="no-drag flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              disabled={!tab.implemented}
              title={tab.implemented ? tab.label : `${tab.label} - not migrated yet`}
              onClick={() => onSelectTab(tab.id)}
              className={`h-9 shrink-0 border px-3 text-2xs whitespace-nowrap transition-colors ${
                isActive
                  ? 'border-accent bg-accent-dim text-text'
                  : tab.implemented
                    ? 'border-border-strong bg-surface-raised text-text hover:bg-surface-hover'
                    : 'cursor-not-allowed border-border bg-surface-raised/50 text-text-dim'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <ArrowButton label="Scroll tabs right" onClick={() => scrollBy(360)}>
        {'>'}
      </ArrowButton>

      <span className="num no-drag px-2 text-2xs text-text-muted">{clock}</span>

      <button
        type="button"
        onClick={onReload}
        disabled={reloading}
        className="no-drag h-9 shrink-0 border border-border-strong bg-surface-raised px-3 text-2xs text-text hover:bg-surface-hover disabled:opacity-50"
      >
        {reloading ? 'Reloading...' : 'Reload (F5)'}
      </button>

      <WindowControls />
    </div>
  )
}

function ArrowButton({
  children,
  label,
  onClick,
}: {
  children: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="no-drag h-9 w-7 shrink-0 border border-border-strong bg-surface-raised text-2xs text-text-muted hover:bg-surface-hover hover:text-text"
    >
      {children}
    </button>
  )
}

function WindowControls() {
  return (
    <div className="no-drag flex shrink-0 items-center">
      {(
        [
          ['minimize', '─'],
          ['maximize', '□'],
          ['close', '✕'],
        ] as const
      ).map(([action, glyph]) => (
        <button
          key={action}
          type="button"
          aria-label={action}
          onClick={() => void api.windowControl(action)}
          className={`h-12 w-12 text-xs text-text-muted transition-colors ${
            action === 'close' ? 'hover:bg-down hover:text-white' : 'hover:bg-surface-hover'
          }`}
        >
          {glyph}
        </button>
      ))}
    </div>
  )
}
