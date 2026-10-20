import type { NewsArticle, NewsPreviewPayload } from '@shared/contract'
import { ageText, categoryLabel, signalText } from '@shared/news'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { NewsTickerBadge } from './NewsTickerBadge'
import { PanelMessage } from '@/components/ui/Panel'
import { tagTone } from './NewsCard'
import { SignalMeter } from './SignalMeter'
import { NewsSummaryButton } from './NewsSummaryButton'

/**
 * The selected story, with as much of its body as could be scraped.
 *
 * One deliberate departure from `init_page34`, which stacks the reader above the cards in a
 * strip 190 to 270 pixels tall: here it is a rail down the right, collapsible, with its
 * width stored. Six thousand characters of article in a 270px strip is not readable, and at
 * any normal window width the rail still leaves the grid its three columns.
 */
export function NewsReader({
  article,
  preview,
  loading,
  onOpen,
  onClose,
  now,
}: {
  article: NewsArticle | null
  preview: NewsPreviewPayload | undefined
  loading: boolean
  onOpen: (article: NewsArticle) => void
  onClose: () => void
  now: number
}) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border border-border bg-surface">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-2">
        <h2 className="truncate text-2xs font-semibold tracking-wide text-text uppercase">
          {article ? categoryLabel(article) : 'Selected story'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the reader"
          className="ml-auto px-1 text-2xs text-text-dim hover:text-text"
        >
          ×
        </button>
      </header>

      {!article ? (
        <PanelMessage>Select a card to read it here.</PanelMessage>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <h3 className="shrink-0 text-sm leading-snug font-semibold text-text">
            {article.title}
          </h3>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <NewsTickerBadge ticker={article.ticker} category={article.category} />
            <span className="text-2xs text-text-muted">{article.source || '--'}</span>
            <span className="num text-2xs text-text-dim">
              {ageText(article.publishedAt, now)} · {article.time}
            </span>
            <SignalMeter score={article.score} label={signalText(article)} />
          </div>

          {article.signals.length ? (
            <div className="flex shrink-0 flex-wrap gap-1">
              {article.signals
                .filter((tag) => tag !== 'ticker')
                .map((tag) => (
                  <Chip key={tag} tone={tagTone(tag)}>
                    {tag}
                  </Chip>
                ))}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-border pt-2">
            {loading ? (
              <p className="text-2xs text-text-dim">Loading a readable preview...</p>
            ) : (
              <>
                <p className="text-2xs leading-relaxed whitespace-pre-wrap text-text">
                  {preview?.text ?? ''}
                </p>
                {preview?.origin === 'fallback' ? (
                  <p className="mt-3 border-t border-border pt-2 text-2xs text-text-dim">
                    This publisher renders its article in the browser, so only the summary is
                    available here. Open it externally for the full text.
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-2">
            <span
              className="w-full min-w-0 truncate text-2xs text-text-dim select-text"
              title={article.url}
            >
              {article.url || 'No link'}
            </span>
            <NewsSummaryButton article={article} preview={preview} loading={loading} />
            <Button
              variant="positive"
              disabled={!article.url}
              onClick={() => onOpen(article)}
              title="Opens in the system browser."
            >
              Open Externally
            </Button>
          </div>
        </div>
      )}
    </aside>
  )
}
