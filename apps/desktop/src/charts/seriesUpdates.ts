/** Tail edits preserve the chart's viewport. History corrections still replace the series. */
export function syncTimeSeries<Input extends { time: number }, Output>(
  series: { setData(data: Output[]): void; update(data: Output): void },
  previous: Input[] | undefined,
  next: Input[],
  convert: (point: Input) => Output,
  reset = false,
): boolean {
  if (!reset && previous === next) return false
  let samePrefix = true
  if (previous) {
    for (let index = 0; index < previous.length - 1; index++) {
      if (previous[index] !== next[index]) { samePrefix = false; break }
    }
  }
  if (!reset && previous?.length && next.length >= previous.length
    && next[previous.length - 1].time === previous.at(-1)!.time
    && samePrefix) {
    const start = previous.at(-1) === next[previous.length - 1] ? previous.length : previous.length - 1
    for (let index = start; index < next.length; index++) series.update(convert(next[index]))
    return false
  }
  series.setData(next.map(convert))
  return true
}
