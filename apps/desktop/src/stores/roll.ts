import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { RollPayload } from '@shared/contract'
import { ROLL_HISTORY_LIMIT, ROLL_PATTERN_MODES, type RollPatternMode } from '@shared/roll'

/**
 * The Roll page's session state, standing in for `_p18_session_snapshot` /
 * `_p18_restore_session_snapshot`.
 *
 * The reference persists the last payload, the roll history and the pattern checkboxes
 * through its tab-session snapshot, and restores them on startup so the page opens on the
 * last idea rather than empty. This is the same three things: `payload` is the last
 * completed roll, `payloads` is `_p18_full_payloads` (five deep, so revisiting a recent
 * history row repaints instead of re-rolling), and `history` is the Roll History table.
 *
 * `indicators` is not persisted by the reference either — its Indicators checkbox is
 * session state on the chart panel — but it costs nothing to keep and a page that reopens
 * with the plain line chart after you turned candles on reads as a bug.
 */

/** `P18_FULL_PAYLOAD_LIMIT`. */
const FULL_PAYLOAD_LIMIT = 5

export interface RollHistoryRow {
  symbol: string
  company: string
  sector: string
  rolledAt: number
}

interface RollState {
  patternModes: RollPatternMode[]
  indicators: boolean
  payload: RollPayload | null
  payloads: Record<string, RollPayload>
  history: RollHistoryRow[]
  togglePatternMode: (mode: RollPatternMode, checked: boolean) => void
  setIndicators: (value: boolean) => void
  /** Record a completed roll: it becomes the payload, joins the cache and heads the history. */
  applyRoll: (payload: RollPayload) => void
  /** Re-open a cached payload without touching the history order. */
  revisit: (payload: RollPayload) => void
}

function normalizeModes(values: unknown): RollPatternMode[] {
  const allowed = new Set<string>(ROLL_PATTERN_MODES)
  const raw = Array.isArray(values) ? values : []
  const seen = new Set<RollPatternMode>()
  for (const value of raw) {
    const mode = String(value ?? '').trim().toLowerCase()
    if (allowed.has(mode)) seen.add(mode as RollPatternMode)
  }
  return [...seen].sort()
}

/**
 * A targeted load — a Scored Candidates row or a Roll History row — skips the screen, so
 * `getRoll` answers with a pool of exactly one synthetic candidate. Replacing an eight-row
 * pool with that single row makes the panel a one-shot: opening one candidate destroys the
 * list the other seven were on. Where the pool already holds the symbol being opened, it is
 * carried across so the ranking stays browsable and the highlight lands on the real row.
 *
 * The rail's own figures still come from the payload as the main process built it: an
 * exact-symbol load genuinely was not scored against a screen, and "Why This Rolled" says
 * so.
 */
function withCarriedPool(previous: RollPayload | null, incoming: RollPayload): RollPayload {
  const targeted = incoming.candidatePool.length === 1 && incoming.candidatePool[0]?.rank === 0
  if (!targeted || !previous) return incoming
  const pool = previous.candidatePool
  if (pool.length < 2 || !pool.some((candidate) => candidate.symbol === incoming.symbol)) {
    return incoming
  }
  return { ...incoming, candidatePool: pool }
}

export const useRollPage = create<RollState>()(
  persist(
    (set) => ({
      patternModes: [],
      indicators: false,
      payload: null,
      payloads: {},
      history: [],
      togglePatternMode: (mode, checked) =>
        set((state) => ({
          patternModes: normalizeModes(
            checked
              ? [...state.patternModes, mode]
              : state.patternModes.filter((entry) => entry !== mode),
          ),
        })),
      setIndicators: (indicators) => set({ indicators }),
      applyRoll: (incoming) =>
        set((state) => {
          const payload = withCarriedPool(state.payload, incoming)
          // `_p18_remember_full_payload` re-inserts an existing symbol at the end, so the
          // five it keeps are the five most recently *seen*, not the five first rolled.
          const payloads = { ...state.payloads }
          delete payloads[payload.symbol]
          payloads[payload.symbol] = payload
          for (const key of Object.keys(payloads).slice(0, -FULL_PAYLOAD_LIMIT)) delete payloads[key]

          const history = [
            {
              symbol: payload.symbol,
              company: payload.info.name || payload.symbol,
              sector: payload.info.sector || 'N/A',
              rolledAt: payload.rolledAt,
            },
            ...state.history.filter((row) => row.symbol !== payload.symbol),
          ].slice(0, ROLL_HISTORY_LIMIT)

          return { payload, payloads, history }
        }),
      revisit: (payload) => set({ payload }),
    }),
    {
      name: 'roll-page',
      version: 1,
      /**
       * `_p18_session_snapshot` persists three things: the last payload, the checkboxes
       * and the history. `_p18_full_payloads` is deliberately *not* among them — it is a
       * revisit cache for the current session, and persisting five of them would put a
       * megabyte of candidate pools in storage for no gain.
       *
       * The payload that is kept drops each candidate's `technicalSnapshot`, the way
       * `P18_CANDIDATE_FIELDS` omits `technical_snapshot`: thirty snapshots of twenty-odd
       * keys are only read for the *selected* name, whose copy sits at the top level.
       */
      partialize: (state) => ({
        patternModes: state.patternModes,
        indicators: state.indicators,
        history: state.history,
        payload: state.payload
          ? {
              ...state.payload,
              candidatePool: state.payload.candidatePool.map((candidate) => ({
                ...candidate,
                technicalSnapshot: {},
              })),
            }
          : null,
      }),
    },
  ),
)
