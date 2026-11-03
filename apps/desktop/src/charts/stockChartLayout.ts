import type { IChartApi, ISeriesApi, LogicalRange, SeriesType } from 'lightweight-charts'
import { STOCKS_AUTO_ANCHOR } from '@shared/stocks'

/** Keep the latest candle 35% back from the right edge, at every chart size. */
export function stockChartRange(count: number, start = 0): LogicalRange {
  const from = start - 0.5
  return { from, to: from + Math.max(1, count - start) / STOCKS_AUTO_ANCHOR } as LogicalRange
}

export function fitStockChart(chart: IChartApi | null, count: number, start = 0) {
  if (chart && count > 0) chart.timeScale().setVisibleLogicalRange(stockChartRange(count, start))
}

interface IndicatorPane {
  series: ISeriesApi<SeriesType>[]
  visible: boolean
  height: number
}

/** Empty panes disappear when their last series moves out; setHeight(1) is clamped. */
export function layoutIndicatorPanes(chart: IChartApi, groups: IndicatorPane[]) {
  for (const group of groups) {
    for (const series of group.series) {
      series.applyOptions({ visible: group.visible })
      if (!group.visible) series.moveToPane(0)
    }
  }
  let index = 1
  for (const group of groups) {
    if (!group.visible) continue
    for (const series of group.series) series.moveToPane(index)
    chart.panes()[index]?.setHeight(group.height)
    index++
  }
}
