import type { EconomicPayload } from '@shared/contract'
import { headlineCaptions, summarizeHeadlines } from '@shared/economic'

/**
 * The seven headline tiles, ported from `_p42_build_headline_strip`.
 *
 * Every series in `HEADLINE_SERIES` resolves from a direct provider rather than from FRED,
 * so the strip stays populated on a network where the fallback is blocked.
 */
export function HeadlineStrip({ payload }: { payload: EconomicPayload | undefined }) {
  const values = summarizeHeadlines(payload)
  return (
    <div className="flex shrink-0 flex-wrap items-start gap-x-6 gap-y-1 border border-border bg-surface px-3 py-2">
      {headlineCaptions().map(({ seriesId, caption }) => (
        <div key={seriesId} className="flex flex-col">
          <span className="text-2xs text-text-muted">{caption}</span>
          <span className="font-mono text-sm text-text tabular-nums">{values[seriesId]}</span>
        </div>
      ))}
    </div>
  )
}
