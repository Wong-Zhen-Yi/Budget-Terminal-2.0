import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { TimeframeLabel } from '@shared/contract'
import { DEFAULT_SYMBOL, DEFAULT_TIMEFRAME } from '@shared/contract'

export type IndicatorKey = 'volume' | 'rsi' | 'ma200'

/**
 * Column widths that fit the type scale. They are persisted, so `STORE_VERSION` has to
 * move whenever the scale does — otherwise an existing install keeps widths sized for
 * the old text and clips its last column.
 *
 * Both side columns start at their narrowest allowed width so the chart opens as wide as
 * the splitters permit; dragging still reaches the same maxima as before.
 */
const MIN_LEFT_WIDTH = 400
const MAX_LEFT_WIDTH = 820
const MIN_OPTIONS_WIDTH = 320
const MAX_OPTIONS_WIDTH = 1000
const DEFAULT_WIDTHS = { leftWidth: MIN_LEFT_WIDTH, optionsWidth: MIN_OPTIONS_WIDTH }
const STORE_VERSION = 4

interface DashboardState {
  /** The ticker the chart and the options tables are showing. */
  symbol: string
  timeframe: TimeframeLabel
  indicators: Record<IndicatorKey, boolean>
  /** When on, clicking a holding loads it into the chart. */
  autoFollow: boolean
  /** Which portfolio the left panel is showing; null means the store's active one. */
  portfolioId: string | null
  /** Left column width in pixels, dragged by the splitter. */
  leftWidth: number
  /** Options column width in pixels. */
  optionsWidth: number
  /** Dashboard 2's right panel width; retain the legacy key as panel content changes. */
  agentsWidth: number

  setSymbol: (symbol: string) => void
  setTimeframe: (timeframe: TimeframeLabel) => void
  toggleIndicator: (key: IndicatorKey) => void
  toggleAutoFollow: () => void
  setPortfolioId: (id: string | null) => void
  setLeftWidth: (width: number) => void
  setOptionsWidth: (width: number) => void
  setAgentsWidth: (width: number) => void
}

export const useDashboard = create<DashboardState>()(
  persist(
    (set) => ({
      symbol: DEFAULT_SYMBOL,
      timeframe: DEFAULT_TIMEFRAME,
      indicators: { volume: true, rsi: true, ma200: true },
      autoFollow: true,
      portfolioId: null,
      ...DEFAULT_WIDTHS,
      agentsWidth: 400,

      setSymbol: (symbol) => set({ symbol: symbol.trim().toUpperCase() || DEFAULT_SYMBOL }),
      setTimeframe: (timeframe) => set({ timeframe }),
      toggleIndicator: (key) =>
        set((state) => ({ indicators: { ...state.indicators, [key]: !state.indicators[key] } })),
      toggleAutoFollow: () => set((state) => ({ autoFollow: !state.autoFollow })),
      setPortfolioId: (portfolioId) => set({ portfolioId }),
      setLeftWidth: (leftWidth) => set({ leftWidth: clamp(leftWidth, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH) }),
      setOptionsWidth: (optionsWidth) => set({ optionsWidth: clamp(optionsWidth, MIN_OPTIONS_WIDTH, MAX_OPTIONS_WIDTH) }),
      setAgentsWidth: (agentsWidth) => set({ agentsWidth: clamp(agentsWidth, 360, 1000) }),
    }),
    {
      name: 'budget-terminal:dashboard',
      version: STORE_VERSION,
      // Keep the user's symbol, timeframe and toggles; take the new widths.
      migrate: (persisted) => ({ ...(persisted as DashboardState), ...DEFAULT_WIDTHS }),
    },
  ),
)

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
