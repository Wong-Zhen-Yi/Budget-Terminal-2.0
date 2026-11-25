import { useEffect } from 'react'

import { MainWorkspace } from '@/components/chartsworkstation/MainWorkspace'
import { useChartsStore } from '@/stores/charts'

const ignoreStatus = () => {}

/**
 * A pop-out chart window: the Charts main workspace on its own, for a second monitor.
 * Startup preloading, navigation and diagnostics stay with the main window.
 */
export function ChartWindow() {
  const symbol = useChartsStore((state) => state.symbol)
  useEffect(() => {
    document.title = `${symbol} · Budget Terminal Chart`
  }, [symbol])
  return (
    <div className="terminal-shell flex h-full flex-col bg-bg">
      <main className="flex min-h-0 flex-1 flex-col">
        <MainWorkspace onStatus={ignoreStatus} />
      </main>
    </div>
  )
}
