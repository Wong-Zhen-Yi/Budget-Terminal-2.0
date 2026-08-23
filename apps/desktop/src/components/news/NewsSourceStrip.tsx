import type { NewsLaneStatus } from '@shared/contract'
import { Chip } from '@/components/ui/Chip'

/**
 * Every source behind the page, and whether it answered.
 *
 * The reference folds this into a status sentence — "1 stale source(s), 1 unavailable
 * source(s)". Naming them is more useful: when Nasdaq times out, the difference between
 * "the page is broken" and "one of six feeds is slow today" is the whole difference, and
 * only this strip can tell you which.
 */
export function NewsSourceStrip({
  lanes,
  errors,
}: {
  lanes: NewsLaneStatus[]
  /** Reason per source name, for the tooltips. */
  errors: Map<string, string>
}) {
  const feeds = lanes.find((lane) => lane.lane === 'other')
  const yahooLanes = lanes.filter((lane) => lane.lane !== 'other')

  const yahooFailed = yahooLanes.reduce((count, lane) => count + lane.failed.length, 0)
  const yahooTotal = yahooLanes.reduce(
    (count, lane) => count + lane.fresh.length + lane.failed.length,
    0,
  )

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      <span className="pr-1 text-2xs text-text-dim">Sources</span>

      <Chip
        tone={yahooFailed ? 'warn' : 'up'}
        title={
          yahooFailed
            ? `${yahooFailed} of ${yahooTotal} Yahoo symbol(s) returned nothing.`
            : `All ${yahooTotal} Yahoo symbol(s) answered.`
        }
      >
        Yahoo {yahooTotal - yahooFailed}/{yahooTotal}
      </Chip>

      {feeds
        ? (['fresh', 'stale', 'failed'] as const).flatMap((state) =>
            feeds[state].map((source) => (
              <Chip
                key={source}
                tone={state === 'fresh' ? 'up' : state === 'stale' ? 'warn' : 'down'}
                title={errors.get(source) ?? `${source}: up to date.`}
              >
                {source}
              </Chip>
            )),
          )
        : null}
    </div>
  )
}
