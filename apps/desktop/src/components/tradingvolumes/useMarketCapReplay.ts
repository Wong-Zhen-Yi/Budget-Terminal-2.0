import { useCallback, useEffect, useMemo, useState } from 'react'

import type { TradingVolumeInterval } from '@shared/contract'
import {
  REPLAY_DURATION_MS,
  buildReplayPlan,
  replayFrame,
  type RankedTradingVolumeRow,
  type ReplayFrame,
  type ReplayPlan,
} from '@shared/tradingVolumes'

/**
 * The Replay button's state machine, ported from the animation half of `OverviewMixin`.
 *
 * The reference drives it off a 33ms `QTimer` stepping a progress float; this uses rAF
 * for the same five-second sweep without pinning the cadence to a frame budget — the
 * same trade `useAnimatedProgress` already makes for the donut and the goal ring.
 *
 * The start time is state, not a ref, so the loop lives in an effect keyed on it. Under
 * StrictMode's mount/unmount/remount a loop started outside an effect would be cancelled
 * by the teardown and never restart, leaving the plot frozen on frame zero.
 */

export interface MarketCapReplay {
  /** False when no visible row has two points of history for this interval. */
  canReplay: boolean
  playing: boolean
  /** The current frame, or `null` when idle — the plot draws live caps then. */
  frame: ReplayFrame | null
  /** Pinned y range for the whole playback, so the axis does not jitter per frame. */
  plan: ReplayPlan | null
  start: () => void
  stop: () => void
}

export function useMarketCapReplay(
  rows: RankedTradingVolumeRow[],
  interval: TradingVolumeInterval,
): MarketCapReplay {
  // Built once per (rows, interval) rather than on the button press: the same `null`
  // that means "nothing to play" is what disables the button, so the enablement check
  // and the playback path cannot drift apart.
  const plan = useMemo(() => buildReplayPlan(rows, interval), [rows, interval])

  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [progress, setProgress] = useState(1)

  // A fresh timestamp every press, so replaying a finished sweep runs it again.
  const start = useCallback(() => setStartedAt(performance.now()), [])
  const stop = useCallback(() => setStartedAt(null), [])

  // A refresh or an interval change replaces the plan under a running animation; the
  // reference stops playback at the top of both. Frames from the old plan would be
  // indexing a timeline that no longer applies.
  useEffect(() => setStartedAt(null), [plan])

  useEffect(() => {
    if (startedAt === null || !plan) return
    let handle = 0
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / REPLAY_DURATION_MS)
      setProgress(elapsed)
      if (elapsed < 1) handle = requestAnimationFrame(step)
    }
    setProgress(0)
    handle = requestAnimationFrame(step)
    return () => cancelAnimationFrame(handle)
  }, [startedAt, plan])

  const playing = startedAt !== null && progress < 1
  const frame = useMemo(
    () => (startedAt !== null && plan ? replayFrame(plan, progress) : null),
    [startedAt, plan, progress],
  )

  return { canReplay: plan !== null, playing, frame, plan, start, stop }
}
