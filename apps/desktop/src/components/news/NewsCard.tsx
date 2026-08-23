import { memo } from 'react'

import type { NewsArticle } from '@shared/contract'
import { ageText, categoryLabel, categoryTone, signalText, type NewsTone } from '@shared/news'
import { Chip, type ChipTone } from '@/components/ui/Chip'
import { NewsThumb } from './NewsThumb'
import { SignalMeter } from './SignalMeter'

/**
 * One article, as a card.
 *
 * `_p34_create_card` in the reference: a coloured rail for the category, a meta row, the
 * headline unclipped, the source, and the signal line. Click selects it into the reader,
 * double-click and the Open button send it to the system browser — nothing navigates
 * inside the app.
 *
 * Memoised, and it has to be: selecting a card re-renders the page, and without this every
 * one of the other hundred and sixty cards would re-render with it.
 */

/** The left rail and the category word, in the tone `categoryTone` picked. */
const railClass: Record<NewsTone, string> = {
  up: 'border-l-up',
  warn: 'border-l-warn',
  'accent-dim': 'border-l-accent-dim',
  accent: 'border-l-accent',
}

const categoryTextClass: Record<NewsTone, string> = {
  up: 'text-up',
  warn: 'text-warn',
  'accent-dim': 'text-accent-hover',
  accent: 'text-accent-hover',
}

/**
 * Tag chips take their colour from what the tag means, so a grid of cards reads as a
 * heat map of what kind of day it is.
 */
export function tagTone(tag: string): ChipTone {
  if (tag === 'macro' || tag === 'regulatory') return 'warn'
  if (tag === 'earnings' || tag === 'beat/miss' || tag === 'capital returns') return 'up'
  if (tag === 'analyst' || tag === 'm&a') return 'accent'
  return 'muted'
}

/**
 * Recency as colour. The reference prints the age in one muted grey; on a feed that mixes
 * a five-minute-old headline with a month-old one, that is the single most useful thing
 * the card can say, so it gets a temperature.
 */
export function ageClass(publishedAt: number, now: number): string {
  if (!publishedAt) return 'text-text-dim'
  const hours = (now - publishedAt) / 3_600_000
  if (hours < 1) return 'text-up'
  if (hours < 6) return 'text-text'
  if (hours < 24) return 'text-text-muted'
  return 'text-text-dim'
}

export const NewsCard = memo(function NewsCard({
  article,
  selected,
  onSelect,
  onOpen,
  showImages,
  now,
}: {
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
    <article
      data-article-id={article.id}
      onClick={() => onSelect(article)}
      onDoubleClick={() => onOpen(article)}
      className={`flex min-w-0 cursor-pointer flex-col gap-1.5 border border-l-2 p-2 transition-colors ${railClass[tone]} ${
        selected
          ? 'border-accent border-l-accent bg-surface-hover'
          : 'border-border bg-surface hover:bg-surface-hover'
      }`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`shrink-0 text-2xs font-semibold ${categoryTextClass[tone]}`}>
          {categoryLabel(article)}
        </span>
        {article.ticker && article.ticker !== 'OTHER' ? (
          <Chip className="num" title={article.ticker}>
            {article.ticker}
          </Chip>
        ) : null}
        <span
          className={`num ml-auto shrink-0 text-2xs ${ageClass(article.publishedAt, now)}`}
          title={article.time}
        >
          {ageText(article.publishedAt, now)}
        </span>
      </div>

      <div className="flex min-w-0 gap-2">
        <h3 className="min-w-0 flex-1 text-2xs leading-snug font-semibold text-text">
          {article.title}
        </h3>
        {showImages && article.imageUrl ? (
          <NewsThumb
            url={article.imageUrl}
            ticker={article.ticker}
            source={article.source}
            enabled={showImages}
            className="size-14"
          />
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-2xs text-text-dim">{article.source}</span>
        <SignalMeter score={article.score} label={signalText(article)} className="ml-auto" />
      </div>

      {tags.length ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {tags.slice(0, 3).map((tag) => (
            <Chip key={tag} tone={tagTone(tag)}>
              {tag}
            </Chip>
          ))}
          {tags.length > 3 ? <Chip title={tags.join(', ')}>+{tags.length - 3}</Chip> : null}
        </div>
      ) : null}
    </article>
  )
})
