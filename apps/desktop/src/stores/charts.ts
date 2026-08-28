import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type {
  ChartsCompareInterval,
  ChartsCompareRange,
  ChartsInterval,
  ChartsRange,
  ChartsRelationshipRange,
  ChartsRollingWindow,
} from '@shared/contract'
import { rangeForInterval, normalizeSymbols } from '@shared/charts'

const STORE_VERSION = 1

export type ChartsSubtab = 'main' | 'multi' | 'compare' | 'relationship' | 'cheat'
export type ChartsType = 'candles' | 'line' | 'area'
export type ChartsIndicator = 'volume' | 'rsi' | 'ma200' | 'avgPrice' | 'supportResistance' | 'fibonacci' | 'cursor'
export type DrawingType = 'trend' | 'horizontal' | 'ray' | 'rectangle' | 'text' | 'fib'

export interface DrawingAnchor {
  time: number
  price: number
}

export interface ChartDrawing {
  id: string
  type: DrawingType
  anchors: DrawingAnchor[]
  text: string
  color: string
  width: number
}

export interface ComparePreset {
  name: string
  symbols: string[]
  interval: ChartsCompareInterval
  range: ChartsCompareRange
}

export interface ChartsPersistedState {
  symbol: string
  interval: ChartsInterval
  range: ChartsRange
  chartType: ChartsType
  pollSeconds: 0 | 15 | 30 | 60
  sidebarVisible: boolean
  splitterRatio: number
  indicators: Record<ChartsIndicator, boolean>
  autoFollow: boolean
  playbackSpeed: '1x' | '2x' | '5x' | '10x'
  fibMode: 'auto' | 'manual'
  fibLookback: number
  drawingsByContext: Record<string, ChartDrawing[]>
  watchlist: string[]
  compareSymbols: string[]
  compareInterval: ChartsCompareInterval
  compareRange: ChartsCompareRange
  compareIntervalLabels: boolean
  compareCorrelation: boolean
  comparePresets: ComparePreset[]
  relationshipSymbols: [string, string]
  relationshipRange: ChartsRelationshipRange
  relationshipWindow: ChartsRollingWindow
  multiMode: 'portfolio' | 'watchlist'
  multiInterval: '1D' | '1W' | '1M'
  multiStyle: 'candles' | 'line'
  multiCustomSymbols: string[]
  multiOrder: string[]
}

interface ChartsState extends ChartsPersistedState {
  setSymbol: (symbol: string) => void
  setInterval: (interval: ChartsInterval) => void
  setRange: (range: ChartsRange) => void
  setChartType: (chartType: ChartsType) => void
  setPollSeconds: (pollSeconds: 0 | 15 | 30 | 60) => void
  setSidebarVisible: (visible: boolean) => void
  setSplitterRatio: (ratio: number) => void
  toggleIndicator: (indicator: ChartsIndicator) => void
  setAutoFollow: (enabled: boolean) => void
  setPlaybackSpeed: (speed: ChartsPersistedState['playbackSpeed']) => void
  setFibMode: (mode: ChartsPersistedState['fibMode']) => void
  setFibLookback: (lookback: number) => void
  setDrawings: (context: string, drawings: ChartDrawing[]) => void
  setWatchlist: (symbols: string[]) => void
  setCompareSymbols: (symbols: string[]) => void
  setCompareInterval: (interval: ChartsCompareInterval) => void
  setCompareRange: (range: ChartsCompareRange) => void
  setCompareIntervalLabels: (enabled: boolean) => void
  setCompareCorrelation: (enabled: boolean) => void
  setComparePresets: (presets: ComparePreset[]) => void
  setRelationship: (symbols: [string, string], range?: ChartsRelationshipRange, window?: ChartsRollingWindow) => void
  setMultiMode: (mode: ChartsPersistedState['multiMode']) => void
  setMultiInterval: (interval: ChartsPersistedState['multiInterval']) => void
  setMultiStyle: (style: ChartsPersistedState['multiStyle']) => void
  setMultiCustomSymbols: (symbols: string[]) => void
  setMultiOrder: (symbols: string[]) => void
}

export const DEFAULT_CHARTS_STATE: ChartsPersistedState = {
  symbol: 'SPY',
  interval: '1 Day',
  range: '5Y',
  chartType: 'candles',
  pollSeconds: 0,
  sidebarVisible: true,
  splitterRatio: 0.74,
  indicators: {
    volume: true,
    rsi: false,
    ma200: true,
    avgPrice: true,
    supportResistance: false,
    fibonacci: false,
    cursor: false,
  },
  autoFollow: true,
  playbackSpeed: '5x',
  fibMode: 'auto',
  fibLookback: 120,
  drawingsByContext: {},
  watchlist: [],
  compareSymbols: [],
  compareInterval: '1 Day',
  compareRange: '5Y',
  compareIntervalLabels: true,
  compareCorrelation: true,
  comparePresets: [],
  relationshipSymbols: ['QQQ', 'SPY'],
  relationshipRange: '1Y',
  relationshipWindow: 120,
  multiMode: 'portfolio',
  multiInterval: '1D',
  multiStyle: 'candles',
  multiCustomSymbols: [],
  multiOrder: [],
}

export function normalizeChartsState(value: unknown): ChartsPersistedState {
  const raw = value && typeof value === 'object' ? value as Partial<ChartsPersistedState> : {}
  const interval = ([
    '1 Minute', '5 Minutes', '15 Minutes', '1 Hour', '4 Hours', '1 Day', '1 Week', '1 Month',
  ] as ChartsInterval[]).includes(raw.interval as ChartsInterval) ? raw.interval! : '1 Day'
  const relationship = normalizeSymbols(raw.relationshipSymbols)
  const presets = Array.isArray(raw.comparePresets)
    ? raw.comparePresets.filter((preset): preset is ComparePreset => Boolean(preset?.name && preset.symbols?.length))
    : []
  return {
    ...DEFAULT_CHARTS_STATE,
    ...raw,
    symbol: String(raw.symbol || 'SPY').trim().toUpperCase() || 'SPY',
    interval,
    range: rangeForInterval(interval, raw.range),
    pollSeconds: ([0, 15, 30, 60] as const).includes(raw.pollSeconds as 0) ? raw.pollSeconds! : 0,
    splitterRatio: Math.max(0.5, Math.min(0.85, Number(raw.splitterRatio) || 0.74)),
    fibLookback: Math.max(20, Math.min(500, Math.trunc(Number(raw.fibLookback) || 120))),
    indicators: { ...DEFAULT_CHARTS_STATE.indicators, ...(raw.indicators ?? {}) },
    watchlist: normalizeSymbols(raw.watchlist),
    compareSymbols: normalizeSymbols(raw.compareSymbols),
    comparePresets: presets,
    relationshipSymbols: relationship.length === 2 ? [relationship[0], relationship[1]] : ['QQQ', 'SPY'],
    multiCustomSymbols: normalizeSymbols(raw.multiCustomSymbols),
    multiOrder: normalizeSymbols(raw.multiOrder),
    drawingsByContext: raw.drawingsByContext && typeof raw.drawingsByContext === 'object' ? raw.drawingsByContext : {},
  }
}

export const useChartsStore = create<ChartsState>()(
  persist(
    (set) => ({
      ...DEFAULT_CHARTS_STATE,
      setSymbol: (symbol) => set({ symbol: symbol.trim().toUpperCase() || 'SPY' }),
      setInterval: (interval) => set((state) => ({ interval, range: rangeForInterval(interval, state.range) })),
      setRange: (range) => set((state) => ({ range: rangeForInterval(state.interval, range) })),
      setChartType: (chartType) => set({ chartType }),
      setPollSeconds: (pollSeconds) => set({ pollSeconds }),
      setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
      setSplitterRatio: (splitterRatio) => set({ splitterRatio: Math.max(0.5, Math.min(0.85, splitterRatio)) }),
      toggleIndicator: (indicator) => set((state) => ({ indicators: { ...state.indicators, [indicator]: !state.indicators[indicator] } })),
      setAutoFollow: (autoFollow) => set({ autoFollow }),
      setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
      setFibMode: (fibMode) => set({ fibMode }),
      setFibLookback: (fibLookback) => set({ fibLookback: Math.max(20, Math.min(500, Math.trunc(fibLookback))) }),
      setDrawings: (context, drawings) => set((state) => ({ drawingsByContext: { ...state.drawingsByContext, [context]: drawings } })),
      setWatchlist: (watchlist) => set({ watchlist: normalizeSymbols(watchlist) }),
      setCompareSymbols: (compareSymbols) => set({ compareSymbols: normalizeSymbols(compareSymbols) }),
      setCompareInterval: (compareInterval) => set({ compareInterval }),
      setCompareRange: (compareRange) => set({ compareRange }),
      setCompareIntervalLabels: (compareIntervalLabels) => set({ compareIntervalLabels }),
      setCompareCorrelation: (compareCorrelation) => set({ compareCorrelation }),
      setComparePresets: (comparePresets) => set({ comparePresets }),
      setRelationship: (relationshipSymbols, relationshipRange, relationshipWindow) => set((state) => ({
        relationshipSymbols,
        relationshipRange: relationshipRange ?? state.relationshipRange,
        relationshipWindow: relationshipWindow ?? state.relationshipWindow,
      })),
      setMultiMode: (multiMode) => set({ multiMode }),
      setMultiInterval: (multiInterval) => set({ multiInterval }),
      setMultiStyle: (multiStyle) => set({ multiStyle }),
      setMultiCustomSymbols: (multiCustomSymbols) => set({ multiCustomSymbols: normalizeSymbols(multiCustomSymbols) }),
      setMultiOrder: (multiOrder) => set({ multiOrder: normalizeSymbols(multiOrder) }),
    }),
    {
      name: 'budget-terminal:charts',
      version: STORE_VERSION,
      merge: (persisted, current) => ({ ...current, ...normalizeChartsState(persisted) }),
      partialize: (state) => {
        const {
          setSymbol: _setSymbol,
          setInterval: _setInterval,
          setRange: _setRange,
          setChartType: _setChartType,
          setPollSeconds: _setPoll,
          setSidebarVisible: _setSidebar,
          setSplitterRatio: _setSplitter,
          toggleIndicator: _toggleIndicator,
          setAutoFollow: _setAuto,
          setPlaybackSpeed: _setPlayback,
          setFibMode: _setFibMode,
          setFibLookback: _setFibLookback,
          setDrawings: _setDrawings,
          setWatchlist: _setWatchlist,
          setCompareSymbols: _setCompareSymbols,
          setCompareInterval: _setCompareInterval,
          setCompareRange: _setCompareRange,
          setCompareIntervalLabels: _setCompareLabels,
          setCompareCorrelation: _setCompareCorrelation,
          setComparePresets: _setComparePresets,
          setRelationship: _setRelationship,
          setMultiMode: _setMultiMode,
          setMultiInterval: _setMultiInterval,
          setMultiStyle: _setMultiStyle,
          setMultiCustomSymbols: _setMultiCustom,
          setMultiOrder: _setMultiOrder,
          ...persisted
        } = state
        return persisted
      },
    },
  ),
)
