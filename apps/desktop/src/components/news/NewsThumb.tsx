import { useEffect, useRef, useState } from 'react'

import { useNewsThumbnail } from '@/api/newsQueries'

/**
 * A card's picture.
 *
 * The renderer's CSP is `img-src 'self' data:`, so this cannot point an `<img>` at a
 * publisher's CDN — the request would be blocked silently and read as a broken proxy. The
 * main process fetches the bytes and hands back a `data:` URI instead.
 *
 * Nothing is requested until the card is near the viewport. A hundred and seventy cards
 * asking for a hundred and seventy images on mount would be a hundred and seventy round
 * trips for pictures nobody has scrolled to yet.
 */
/**
 * What the tile shows instead of a picture: the first ticker if the story named one, else
 * the publisher's initials. Never nothing — an empty bordered box reads as a broken image,
 * where two letters read as a deliberate placeholder.
 */
function placeholder(ticker: string, source: string): string {
  const symbol = ticker.split(',')[0]?.trim()
  if (symbol && symbol !== 'OTHER') return symbol

  const words = source.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '—'
  // A single-word publisher gives two letters rather than one: a lone `I` for
  // Investing.com reads as a rendering glitch where `IN` reads as a monogram.
  const initials =
    words.length > 1
      ? words.slice(0, 2).map((word) => word[0] ?? '')
      : [words[0]?.slice(0, 2) ?? '']
  return initials.join('').toUpperCase() || '—'
}

export function NewsThumb({
  url,
  ticker,
  source,
  enabled,
  className = '',
}: {
  url: string
  /** Drawn in the fallback tile, so a dead image still says what the story is about. */
  ticker: string
  source: string
  enabled: boolean
  className?: string
}) {
  const wrapper = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const element = wrapper.current
    if (!element || inView || !enabled) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true)
      },
      { rootMargin: '400px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [inView, enabled])

  const query = useNewsThumbnail(url, enabled && inView)
  const dataUri = query.data?.data.dataUri ?? ''

  return (
    <div
      ref={wrapper}
      className={`relative shrink-0 overflow-hidden border border-border bg-surface-raised ${className}`}
    >
      {dataUri ? (
        <img src={dataUri} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        // The fallback is the same size as the image, so a feed that stops serving
        // pictures changes how the grid looks and not how it is laid out.
        <div className="flex size-full items-center justify-center bg-surface-raised">
          <span className="num truncate px-1 text-2xs font-semibold text-text-dim">
            {placeholder(ticker, source)}
          </span>
        </div>
      )}
    </div>
  )
}
