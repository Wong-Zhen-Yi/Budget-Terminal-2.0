/** Coalesce bursts without postponing progress indefinitely during continuous loads. */
export function createProgressReporter(report: () => void, intervalMs = 100) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const flush = () => {
    cancel()
    report()
  }
  return {
    schedule: () => { timer ??= setTimeout(flush, intervalMs) },
    flush,
    cancel,
  }
}
