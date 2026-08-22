import { useCallback, useEffect, useRef, useState } from 'react'

/** Cubic ease-out, the curve the reference's goal ring fills on. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function linear(t: number): number {
  return t
}

/**
 * A 0..1 value that sweeps from zero to one when replayed.
 *
 * The reference drives both of these off `QTimer`s ticking every 33ms; a rAF loop is
 * the same idea without pinning the cadence to a fixed frame budget. `replay` restarts
 * from zero, which is exactly what the Show Animation button does.
 *
 * The start time is state rather than a ref so the loop lives in an effect keyed on it.
 * That matters under StrictMode, which mounts, tears down and remounts: a loop started
 * outside the effect would be cancelled by the teardown and never restart, leaving both
 * charts stuck at zero.
 */
export function useAnimatedProgress(
  durationMs: number,
  easing: (t: number) => number = linear,
): { progress: number; replay: () => void } {
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [progress, setProgress] = useState(1)
  const easingRef = useRef(easing)
  easingRef.current = easing

  // A fresh timestamp every call, so replaying an already-finished sweep re-runs it.
  const replay = useCallback(() => setStartedAt(performance.now()), [])

  useEffect(() => {
    if (startedAt === null) return
    let frame = 0
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / Math.max(durationMs, 1))
      setProgress(easingRef.current(elapsed))
      if (elapsed < 1) frame = requestAnimationFrame(step)
    }
    setProgress(0)
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [startedAt, durationMs])

  return { progress, replay }
}
