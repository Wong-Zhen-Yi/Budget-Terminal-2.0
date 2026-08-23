import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { TradingVolumeInterval } from '@shared/contract'
import {
  DEFAULT_TRADING_VOLUME_FILTER,
  TRADING_VOLUME_LIMIT,
  type TradingVolumeFilter,
} from '@shared/tradingVolumes'

/**
 * Enough for all ten columns: 44 + 76 + 184 + 96 for the identity columns, plus six ADV
 * columns at 84. Narrower and the ADV columns the page exists for start scrolling out.
 */
const DEFAULT_TABLE_WIDTH = 904
const STORE_VERSION = 2

/**
 * The Trading Volumes page's own view state.
 *
 * The reference keeps all of this on the window and saves it into the tab session
 * snapshot (`_p20_snapshot_rows` and friends). Here the rows come back from the query
 * cache instead, so only the controls need persisting.
 */
interface TradingVolumesState extends TradingVolumeFilter {
  /** Which ADV column ranks the table and drives the dot plot's x-axis. */
  interval: TradingVolumeInterval
  /** Table pane width in pixels; the dot plot takes the rest. */
  tableWidth: number

  setInterval: (interval: TradingVolumeInterval) => void
  setExcludeTop: (value: number) => void
  setRowRangeStart: (value: number) => void
  setRowRangeEnd: (value: number) => void
  /** The Search Rows button: switch to the row-range slice. */
  applyRowRange: () => void
  /** The Reset button: back to all rows, exclude 0, range 1-100. */
  reset: () => void
  setTableWidth: (width: number) => void
}

export const useTradingVolumesPage = create<TradingVolumesState>()(
  persist(
    (set) => ({
      ...DEFAULT_TRADING_VOLUME_FILTER,
      interval: '1d',
      tableWidth: DEFAULT_TABLE_WIDTH,

      setInterval: (interval) => set({ interval }),
      // Editing the spinbox is itself the filter, as `_p20_on_exclude_changed` has it:
      // a positive count means exclude, zero means show everything.
      setExcludeTop: (value) =>
        set({
          excludeTop: Math.max(0, Math.trunc(value)),
          mode: value > 0 ? 'exclude' : 'default',
        }),
      setRowRangeStart: (rowRangeStart) => set({ rowRangeStart }),
      setRowRangeEnd: (rowRangeEnd) => set({ rowRangeEnd }),
      applyRowRange: () => set({ mode: 'rowRange' }),
      reset: () =>
        set({
          ...DEFAULT_TRADING_VOLUME_FILTER,
          rowRangeEnd: TRADING_VOLUME_LIMIT,
        }),
      setTableWidth: (tableWidth) => set({ tableWidth }),
    }),
    {
      name: 'budget-terminal:trading-volumes',
      version: STORE_VERSION,
      // The column widths changed, so a persisted pane width sized for the old ones
      // would clip the last ADV column on an existing install.
      migrate: (persisted) => ({
        ...(persisted as TradingVolumesState),
        tableWidth: DEFAULT_TABLE_WIDTH,
      }),
    },
  ),
)
