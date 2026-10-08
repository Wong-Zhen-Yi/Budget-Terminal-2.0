import type { NewsArticle } from '@shared/contract'
import { ageText, categoryLabel, categoryTone, signalText, type NewsTone } from '@shared/news'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ageClass, tagTone } from './NewsCard'
import { NewsTickerBadge } from './NewsTickerBadge'
import { NewsThumb } from './NewsThumb'
import { SignalMeter } from './SignalMeter'

/**
 * The top story, full width above the grid.
 *
 * Not in the reference, which gives every article the same card. A feed of a hundred and
 * seventy headlines has no entry point without one, and the scoring heuristic already
 * knows which story is the biggest — this is just letting it say so.
 */

const railClass: Record<NewsTone, string> = {
  up: 'border-l-up',
  warn: 'border-l-warn',
  'accent-dim': 'border-l-accent-dim',
  accent: 'border-l-accent',
}

export function NewsHero({
  article,
  price,
  currency,
  selected,
  onSelect,
  onOpen,
  showImages,
  now,
}: {
  price?: number
  currency?: string
  article: NewsArticle
  selected: boolean
  onSelect: (article: NewsArticle) => void
  onOpen: (article: NewsArticle) => void
  showImages: boolean
  now: number
}) {
  const tone = categoryTone(article)
  const tags = article.signals.filter((tag) => tag !== 'ticker')

  return (
    <section
      data-article-id={article.id}
      onClick={() => onSelect(article)}
      onDoubleClick={() => onOpen(article)}
      className={`flex shrink-0 cursor-pointer gap-3 border border-l-2 p-3 transition-colors ${railClass[tone]} ${
        selected
          ? 'border-accent border-l-accent bg-surface-hover'
          : 'border-border bg-surface hover:bg-surface-hover'
      }`}
    >
      {showImages && article.imageUrl ? (
        <NewsThumb
          url={article.imageUrl}
          ticker={article.ticker}
          source={article.source}
          enabled={showImages}
          className="h-28 w-44"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Chip tone="accent">TOP STORY</Chip>
          <span className="shrink-0 text-2xs text-text-muted">{categoryLabel(article)}</span>
          <NewsTickerBadge ticker={article.ticker} price={price} currency={currency} category={article.category} />
          <SignalMeter score={article.score} label={signalText(article)} />
          <span
            className={`num ml-auto shrink-0 text-2xs ${ageClass(article.publishedAt, now)}`}
            title={article.time}
          >
            {ageText(article.publishedAt, now)}
          </span>
        </div>

        <h2 className="text-sm leading-snug font-semibold text-text">{article.title}</h2>

        {article.summary ? (
          <p className="line-clamp-2 text-2xs text-text-muted">{article.summary}</p>
        ) : null}

        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-1">
          <span className="truncate text-2xs text-text-dim">{article.source}</span>
          {tags.slice(0, 4).map((tag) => (
            <Chip key={tag} tone={tagTone(tag)}>
              {tag}
            </Chip>
          ))}
          <Button
            variant="accent"
            className="ml-auto"
            disabled={!article.url}
            onClick={(event) => {
              event.stopPropagation()
              onOpen(article)
            }}
          >
            Open ↗
          </Button>
        </div>
      </div>
    </section>
  )
}
