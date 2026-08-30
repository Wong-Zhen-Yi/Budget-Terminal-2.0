import { useCallback, useRef, useState } from 'react'

import type { Envelope, RollPayload } from '@shared/contract'
import type { RollPatternMode } from '@shared/roll'
import { api } from './client'

export interface RollRun {
  roll: (options?: { targetSymbol?: string }) => Promise<void>
  rolling: boolean
  envelope: Envelope<RollPayload | null> | null
}

/**
 * Roll is a button, not a query.
 *
 * `init_page18` fires no request at all and creates no refresh timer — every load is the
 * Roll button or a Roll History double-click — so there is no query key here and nothing
 * to invalidate. A screen plus 120 daily histories is the second most expensive thing in
 * the app after Trading Volumes, and a background refetch would also change the answer
 * under whoever is reading it: the whole point of the page is that a roll is a *draw*.
 *
 * The reference cancels an in-flight worker when Roll is clicked again. An
 * `ipcRenderer.invoke` cannot be cancelled, so a superseded roll is discarded here by
 * request id instead — its Yahoo work still lands in the main process caches, where the
 * roll that replaced it reuses it.
 */
export function useRoll(options: {
  patternModes: RollPatternMode[]
  excludeSymbols: string[]
  historySymbols: string[]
  onPayload: (payload: RollPayload) => void
}): RollRun {
  const [rolling, setRolling] = useState(false)
  const [envelope, setEnvelope] = useState<Envelope<RollPayload | null> | null>(null)
  const requestRef = useRef(0)
  const latest = useRef(options)
  latest.current = options

  const roll = useCallback(async (run: { targetSymbol?: string } = {}) => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setRolling(true)
    try {
      const result = await api.roll({
        patternModes: latest.current.patternModes,
        excludeSymbols: latest.current.excludeSymbols,
        historySymbols: latest.current.historySymbols,
        targetSymbol: run.targetSymbol,
      })
      if (requestRef.current !== requestId) return
      setEnvelope(result)
      if (result.data) latest.current.onPayload(result.data)
    } finally {
      if (requestRef.current === requestId) setRolling(false)
    }
  }, [])

  return { roll, rolling, envelope }
}
