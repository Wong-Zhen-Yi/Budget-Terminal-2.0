import type { NewsArticle } from '@shared/contract'
import { NewsCard } from './NewsCard'

/**
 * One titled band of cards — Ticker Search, Portfolio Spotlight, Market & Macro.
 *
 * The grid's column count comes from the page, which measures the container rather than
 * the window: opening the reader rail narrows the grid without the window changing, and a
 * window-width breakpoint would leave three columns crammed into what is left.
 */
export function NewsSection({
  title,
  subtitle,
  articles,
  visible,
  columns,
  selectedId,
  onSelect,
  onOpen,
  showImages,
  warning,
  empty,
  now,
}: {
  title: string
  subtitle?: string
  articles: NewsArticle[]
  /** How many to mount; the rest arrive a frame at a time. */
  visible: number
  columns: number
  selectedId: string
  onSelect: (article: NewsArticle) => void
  onOpen: (article: NewsArticle) => void
  showImages: boolean
  warning?: string
  empty: string
  /** Ticks once a minute on the page, so every age badge stays live without a refetch. */
  now: number
}) {
  return (
    <section className="flex shrink-0 flex-col gap-1.5">
      <header className="flex items-center gap-2">
        <h2 className="text-2xs font-semibold tracking-wide text-accent-hover uppercase">
          {title}
        </h2>
        <span className="num text-2xs text-text-dim">{articles.length}</span>
        {warning ? (
          <span
            title={warning}
            aria-label={warning}
            className="size-1.5 shrink-0 rounded-full bg-down"
          />
        ) : null}
        {subtitle ? <span className="truncate text-2xs text-text-dim">{subtitle}</span> : null}
        <span className="ml-auto h-px flex-1 bg-border" />
      </header>

      {articles.length ? (
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {articles.slice(0, visible).map((article) => (
            <NewsCard
              key={article.id}
              article={article}
              selected={article.id === selectedId}
              onSelect={onSelect}
              onOpen={onOpen}
              showImages={showImages}
              now={now}
            />
          ))}
        </div>
      ) : (
        <p className="border border-border bg-surface p-4 text-center text-2xs text-text-dim">
          {empty}
        </p>
      )}
    </section>
  )
}
