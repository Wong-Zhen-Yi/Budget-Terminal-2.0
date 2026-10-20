/**
 * Print the News page exactly as it loads, without Electron.
 *
 *   npm run probe:news                        # the active portfolio's holdings
 *   npm run probe:news -- AAPL MSFT NVDA      # override the holdings
 *   npm run probe:news -- --offline           # pure functions over fixtures, no network
 *   npm run probe:news -- --feeds-only        # just the six RSS feeds
 *   npm run probe:news -- --search TSLA,AMD   # the outside-portfolio ticker search
 *   npm run probe:news -- --preview 3         # extract the 3rd article's body
 *   npm run probe:news -- --images            # proxy the first five thumbnails
 *
 * Run it beside the PySide6 app on its News page and compare line by line: the ages, the
 * tickers, the signal tags and the heuristic scores should agree. Two things nobody can
 * eyeball get printed on purpose — the diversity round-robin that decides which 36 of 80
 * candidates survive, and the per-lane count of timestamps that failed to parse.
 */
import type { NewsArticle } from '../electron/shared/contract.js'
import {
  OTHER_NEWS_LIMIT,
  ageText,
  articleTickerSet,
  buildNewsExportText,
  buildNewsSummaryPrompt,
  extractTickers,
  normalizeTickerUniverse,
  otherFocusTickers,
  parseNewsTimestamp,
  parseSearchSymbols,
  scoreArticle,
  selectDiverseOtherNews,
  signalText,
} from '../electron/shared/news.js'
import { getOtherNews } from '../electron/services/news/feeds.js'
import { extractReadableText } from '../electron/services/news/extract.js'
import { MACRO_SYMBOLS } from '../electron/services/yahoo/newsPage.js'
import { yahooProvider } from '../electron/services/provider.js'
import { runNewsSecurityChecks } from './probe-news-security.js'

function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const value = text.length > width ? `${text.slice(0, width - 1)}…` : text
  return align === 'right' ? value.padStart(width) : value.padEnd(width)
}

function rule(title: string): void {
  console.log(`\n${title}\n${'-'.repeat(Math.max(title.length, 40))}`)
}

const failures: string[] = []
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message)
}

/* ------------------------------------------------------------------ offline */

/**
 * The pure half, over fixtures. Runs with the network unplugged, which makes it the fast
 * way to confirm a change to the scoring or the date parser did what was intended.
 */
function runOffline(): void {
  const universe = normalizeTickerUniverse(otherFocusTickers())
  rule(`Ticker universe: ${universe.size} symbols (indices and futures excluded)`)

  rule('Scoring and tag extraction')
  const fixtures: Array<[string, string, string[]]> = [
    ['Nvidia (NVDA) beats estimates, raises forecast', 'The chip maker lifted guidance.', []],
    ['Is AI overhyped?', 'Analysts at C3.ai disagree with the bears.', []],
    ['Fed holds rates steady as CPI cools', 'Treasury yields slid on the print.', []],
    ['$AAPL announces a record buyback', 'Apple also raised its dividend.', ['Technology']],
    ['Costco same-store sales climb', 'Costco Wholesale reported monthly sales.', []],
  ]
  console.log(pad('SCORE', 6, 'right'), pad('TICKERS', 14), pad('TAGS', 34), 'HEADLINE')
  for (const [title, description, categories] of fixtures) {
    const tickers = extractTickers(title, description, categories, universe)
    const { score, signals } = scoreArticle(title, description, 2, tickers)
    console.log(
      pad(String(score), 6, 'right'),
      pad(tickers.join(',') || '-', 14),
      pad(signals.join(',') || '-', 34),
      title,
    )
  }

  rule('Timestamp parsing (every row must be the same instant)')
  for (const raw of [
    'Tue, 12 Aug 2025 14:03:00 GMT',
    '2025-08-12T14:03:00Z',
    '2025-08-12T14:03:00+00:00',
    '2025-08-12T14:03:00',
    '2025-08-12 14:03:00',
  ]) {
    const parsed = parseNewsTimestamp(raw)
    console.log(pad(raw, 32), parsed, new Date(parsed).toISOString())
    check(
      parsed === Date.parse('2025-08-12T14:03:00Z'),
      `timestamp "${raw}" parsed to ${new Date(parsed).toISOString()}, not 14:03 UTC`,
    )
  }
  console.log(pad('(unparseable)', 32), parseNewsTimestamp('not a date'))

  rule('Age ladder')
  const now = Date.now()
  const ladder = [30e3, 5 * 60e3, 3 * 3600e3, 2 * 86400e3, 9 * 86400e3, 400 * 86400e3]
  console.log(ladder.map((delta) => ageText(now - delta, now)).join('  '), ' | missing ->', ageText(0, now))

  rule('Diversity round-robin')
  const synth = (index: number, ticker: string, score: number): NewsArticle => ({
    id: `synthetic:${index}`,
    ticker,
    title: `Story ${index}`,
    source: 'Fixture Feed',
    time: '10:00',
    url: `https://example.test/${index}`,
    category: 'other',
    publishedAt: now - index * 60e3,
    score,
    signals: [],
    imageUrl: '',
    summary: '',
  })
  rule('Selected-story AI summary prompt')
  const summaryArticle = { ...synth(0, 'NVDA', 10), summary: 'Revenue increased 12%.' }
  const summaryPreview = { url: summaryArticle.url, text: 'Revenue increased 12% to $5 billion.', origin: 'article' as const, truncated: false }
  const summaryPrompt = buildNewsSummaryPrompt(summaryArticle, summaryPreview)
  check(summaryPrompt.includes(summaryPreview.text), 'AI summary includes the selected readable preview')
  check(summaryPrompt.includes('untrusted source material') && summaryPrompt.includes('Do not run tools'), 'AI summary treats publisher content as untrusted read-only evidence')
  check(buildNewsSummaryPrompt(summaryArticle).includes('Publisher summary only'), 'Fallback summary discloses limited coverage')
  check(buildNewsSummaryPrompt({ ...summaryArticle, summary: '' }).includes('Headline only'), 'Missing body is disclosed')
  check(!buildNewsSummaryPrompt(summaryArticle, { ...summaryPreview, url: 'https://example.test/another', text: 'WRONG STORY' }).includes('WRONG STORY'), 'Mismatched previews cannot leak another story')
  const boundedPrompt = buildNewsSummaryPrompt(summaryArticle, { ...summaryPreview, text: 'x'.repeat(30_000) })
  check(boundedPrompt.length < 20_000 && boundedPrompt.includes('truncated'), 'Large article prompts are bounded and disclose truncation')
  check(buildNewsSummaryPrompt(summaryArticle, { ...summaryPreview, truncated: true }).includes('Partial article'), 'Truncated previews disclose incomplete text')
  check(buildNewsSummaryPrompt(summaryArticle, { ...summaryPreview, text: '' }).includes('Publisher summary only'), 'Empty extracted text uses honest fallback coverage')
  check(buildNewsSummaryPrompt({ ...summaryArticle, title: String.fromCharCode(0).repeat(10_000) }, { ...summaryPreview, text: String.fromCharCode(0).repeat(30_000) }).length < 20_000, 'JSON escaping stays within the Agent IPC input limit')
  console.log('Selected article evidence, coverage, stale-preview isolation and input bounds checked')

  const flood = [
    ...Array.from({ length: 40 }, (_, i) => synth(i, 'NVDA', 20 - i)),
    ...Array.from({ length: 12 }, (_, i) => synth(100 + i, 'AAPL', 15)),
    ...Array.from({ length: 12 }, (_, i) => synth(200 + i, 'OTHER', 12)),
  ]
  const picked = selectDiverseOtherNews(flood)
  const spread = new Map<string, number>()
  for (const article of picked) spread.set(article.ticker, (spread.get(article.ticker) ?? 0) + 1)
  console.log(`in ${flood.length} -> out ${picked.length}   spread:`,
    [...spread].map(([key, count]) => `${key}=${count}`).join('  '))
  check(picked.length === OTHER_NEWS_LIMIT, `diversity returned ${picked.length}, expected ${OTHER_NEWS_LIMIT}`)
  check(
    (spread.get('NVDA') ?? 0) < 40,
    'diversity let one ticker take every slot — the round-robin is not draining buckets',
  )

  rule('Ticker search parsing')
  console.log(parseSearchSymbols('tsla, amd  nvda\nTSLA;a b c d e f g h i j k').join(' '))

  rule('Readable-text extraction')
  const html = `<html><body><nav><p>${'Skip me because I am navigation chrome.'.repeat(2)}</p></nav>
    <article><p>${'The first real paragraph of the story runs well past forty characters.'}</p>
    <p>short</p><p>${'A second substantial paragraph, also comfortably over the minimum length.'}</p>
    <p>${'The first real paragraph of the story runs well past forty characters.'}</p></article>
    <script>var noise = "ignored";</script></body></html>`
  const extracted = extractReadableText(html)
  console.log(extracted.text.split('\n\n').map((line, i) => `  ${i + 1}. ${line}`).join('\n'))
  check(
    extracted.text.split('\n\n').length === 2,
    'extractor should keep two paragraphs: the short one, the duplicate and the nav are all dropped',
  )
  check(!extracted.text.includes('navigation chrome'), 'extractor let <nav> text through')
}

/* -------------------------------------------------------------------- feeds */

async function runFeeds(force: boolean): Promise<void> {
  const started = Date.now()
  const { candidates, outcomes, errors } = await getOtherNews(force)
  rule(`RSS feeds — ${Date.now() - started}ms, ${errors.length} degraded`)

  console.log(
    pad('FEED', 26), pad('STATUS', 8), pad('PARSED', 7, 'right'), pad('KEPT', 5, 'right'),
    pad('TOP', 4, 'right'), pad('NO-DATE', 8, 'right'), ' DETAIL',
  )
  for (const outcome of outcomes) {
    const top = outcome.articles.reduce((best, a) => Math.max(best, a.score ?? 0), 0)
    const undated = outcome.articles.filter((a) => a.publishedAt === 0).length
    console.log(
      pad(outcome.feed.source, 26), pad(outcome.status, 8),
      pad(String(outcome.parsed), 7, 'right'), pad(String(outcome.articles.length), 5, 'right'),
      pad(String(top), 4, 'right'), pad(String(undated), 8, 'right'),
      ' ', outcome.reason || outcome.contentType,
    )
    check(
      undated === 0 || outcome.articles.length === 0,
      `${outcome.feed.source}: ${undated} article(s) had an unparseable date`,
    )
  }

  const withImages = candidates.filter((a) => a.imageUrl).length
  console.log(`\ncandidates ${candidates.length}   with images ${withImages}`)
  printDiversity(candidates)
}

function printDiversity(candidates: NewsArticle[]): void {
  const selected = selectDiverseOtherNews(candidates)
  const buckets = new Map<string, number>()
  for (const article of candidates) {
    const key = [...articleTickerSet(article)].sort()[0] ?? article.source
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  const biggest = [...buckets].sort((a, b) => b[1] - a[1]).slice(0, 3)
  rule('Diversity selection')
  console.log(
    `candidates ${candidates.length} -> selected ${selected.length}` +
      `   buckets ${buckets.size}   largest: ${biggest.map(([k, v]) => `${k}(${v})`).join(' ')}`,
  )
  check(selected.length <= OTHER_NEWS_LIMIT, `selection returned ${selected.length}, over the cap`)
}

/* --------------------------------------------------------------- whole page */

function printArticles(articles: NewsArticle[], limit: number): void {
  console.log(
    pad('AGE', 5, 'right'), pad('CAT', 10), pad('TICKER', 16), pad('SCORE', 5, 'right'),
    pad('TAGS', 26), pad('SOURCE', 24), 'HEADLINE',
  )
  for (const article of articles.slice(0, limit)) {
    console.log(
      pad(ageText(article.publishedAt), 5, 'right'),
      pad(article.category, 10),
      pad(article.ticker, 16),
      pad(article.score === null ? '-' : String(article.score), 5, 'right'),
      pad(signalText(article) || '-', 26),
      pad(article.source, 24),
      article.title.slice(0, 76),
    )
  }
}

async function runPage(holdings: string[], force: boolean): Promise<NewsArticle[]> {
  const started = Date.now()
  const envelope = await yahooProvider.newsPage({ tickers: holdings, force })
  const payload = envelope.data

  rule(`News page — ${Date.now() - started}ms`)
  console.log(
    `source ${envelope.meta.source}   freshness ${envelope.meta.freshness}   ` +
      `generated ${new Date(payload.generatedAt).toLocaleString()}`,
  )
  console.log(
    `articles ${payload.articles.length}   portfolio ${payload.counts.portfolio}   ` +
      `macro ${payload.counts.macro}   other ${payload.counts.other}`,
  )
  if (envelope.meta.failureReason) console.log(`note: ${envelope.meta.failureReason}`)

  rule('Lanes')
  for (const lane of payload.lanes) {
    console.log(
      pad(lane.label, 20),
      pad(`fresh ${lane.fresh.length}`, 10),
      pad(`stale ${lane.stale.length}`, 10),
      pad(`failed ${lane.failed.length}`, 11),
      [...lane.stale, ...lane.failed].join(' '),
    )
  }
  if (envelope.errors.length) {
    rule('Errors')
    for (const error of envelope.errors) {
      console.log(pad(error.symbol ?? '-', 26), pad(error.operation, 18), error.reason)
    }
  }

  rule('Macro lane, per symbol')
  console.log(
    "(yahoo-finance2@4 has no news module, so this reads Yahoo's per-symbol headline feed)",
  )
  for (const symbol of MACRO_SYMBOLS) {
    const count = payload.articles.filter(
      (a) => a.category === 'macro' && a.ticker === symbol.toUpperCase(),
    ).length
    console.log(pad(symbol, 12), count)
  }

  rule('Timestamp health, per lane')
  for (const lane of ['portfolio', 'macro', 'other'] as const) {
    const inLane = payload.articles.filter((a) => a.category === lane)
    const dated = inLane.filter((a) => a.publishedAt > 0).map((a) => a.publishedAt)
    const undated = inLane.length - dated.length
    console.log(
      pad(lane, 12), pad(`${inLane.length} articles`, 14), pad(`${undated} undated`, 13),
      dated.length
        ? `${new Date(Math.min(...dated)).toISOString().slice(0, 16)} .. ${new Date(Math.max(...dated)).toISOString().slice(0, 16)}`
        : '',
    )
  }

  rule('Merged, newest first (top 30)')
  printArticles([...payload.articles].sort((a, b) => b.publishedAt - a.publishedAt), 30)

  /* --- assertions ------------------------------------------------------- */
  const wanted = new Set(holdings.map((t) => t.toUpperCase()))
  const ids = new Set<string>()
  for (const article of payload.articles) {
    check(Boolean(article.id), `article "${article.title.slice(0, 40)}" has no id`)
    check(Boolean(article.title), 'an article came back with no title')
    check(!ids.has(article.id), `duplicate id survived dedupe: ${article.id}`)
    ids.add(article.id)
    check(
      article.publishedAt <= Date.now() + 3_600_000,
      `"${article.title.slice(0, 40)}" is dated in the future — a naive stamp read as local time`,
    )
    if (article.category === 'portfolio') {
      check(wanted.has(article.ticker), `portfolio article tagged ${article.ticker}, not a holding`)
    }
    if (article.category === 'portfolio' || article.category === 'macro') {
      check(article.score === null, `Yahoo-lane article carries a score (${article.score})`)
    }
    if (article.category === 'other') {
      check(article.score !== null, 'RSS-lane article came back unscored')
    }
  }
  check(
    payload.counts.other <= OTHER_NEWS_LIMIT,
    `other lane returned ${payload.counts.other}, over the ${OTHER_NEWS_LIMIT} cap`,
  )
  check(
    payload.counts.portfolio + payload.counts.macro + payload.counts.other ===
      payload.articles.length,
    'the per-lane counts do not sum to the article list',
  )

  rule('Export')
  const text = buildNewsExportText({
    portfolio: payload.articles.filter((a) => a.category === 'portfolio'),
    market: payload.articles.filter((a) => a.category === 'macro' || a.category === 'other'),
  })
  console.log(`${text.length} chars, ${text.split('\n').length} lines. First lines:`)
  console.log(text.split('\n').slice(2, 5).map((line) => `  ${line}`).join('\n'))

  return payload.articles
}

/* ------------------------------------------------------- optional extras */

async function runSearch(symbols: string[]): Promise<void> {
  const envelope = await yahooProvider.newsTickerSearch({ tickers: symbols, force: true })
  rule(`Ticker search: ${envelope.data.queried.join(' ')}`)
  console.log(
    `articles ${envelope.data.articles.length}   no articles: ${envelope.data.empty.join(' ') || '-'}` +
      `   failed: ${envelope.data.failed.join(' ') || '-'}`,
  )
  printArticles(envelope.data.articles, 15)
}

async function runPreview(articles: NewsArticle[], index: number): Promise<void> {
  const article = articles[index - 1]
  if (!article) {
    console.log(`\nNo article at position ${index}.`)
    return
  }
  const envelope = await yahooProvider.newsArticle({
    url: article.url,
    title: article.title,
    summary: article.summary,
  })
  rule(`Preview #${index}: ${article.title.slice(0, 60)}`)
  console.log(`${article.source} — ${article.url}`)
  console.log(
    `origin ${envelope.data.origin}   ${envelope.data.text.length} chars   ` +
      `truncated ${envelope.data.truncated}`,
  )
  if (envelope.errors.length) console.log(`note: ${envelope.errors[0]!.reason}`)
  console.log(`\n${envelope.data.text.slice(0, 400)}...`)
}

async function runImages(articles: NewsArticle[]): Promise<void> {
  const withImages = articles.filter((a) => a.imageUrl).slice(0, 5)
  rule(`Thumbnail proxy (${withImages.length} of ${articles.filter((a) => a.imageUrl).length} with images)`)
  let total = 0
  for (const article of withImages) {
    const envelope = await yahooProvider.newsThumbnail({ url: article.imageUrl })
    total += envelope.data.bytes
    const kind = envelope.data.dataUri.slice(5, envelope.data.dataUri.indexOf(';'))
    console.log(
      pad(article.source, 24),
      pad(envelope.data.bytes ? `${(envelope.data.bytes / 1024).toFixed(1)}KB` : 'failed', 10, 'right'),
      pad(kind || '-', 12),
      envelope.errors[0]?.reason ?? '',
    )
  }
  console.log(`\nrunning total ${(total / 1024).toFixed(1)}KB across ${withImages.length} images`)
}

/* --------------------------------------------------------------------- main */

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const flag = (name: string) => argv.includes(name)
  const valueOf = (name: string) => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : undefined
  }

  if (flag('--offline')) {
    await runNewsSecurityChecks()
    runOffline()
    return report()
  }

  if (flag('--feeds-only')) {
    await runFeeds(true)
    return report()
  }

  const explicit = argv.filter((value) => !value.startsWith('--') && !/^\d+$/.test(value))
  let holdings = explicit
  if (!holdings.length) {
    const portfolios = await yahooProvider.portfolio()
    const active = portfolios.data.portfolios.find((p) => p.id === portfolios.data.activeId)
    holdings = active?.tickers ?? portfolios.data.portfolios[0]?.tickers ?? []
    console.log(`Holdings from ${active?.name ?? 'the store'}: ${holdings.join(' ') || '(none)'}`)
  }

  const articles = await runPage(holdings, true)

  const search = valueOf('--search')
  if (search) await runSearch(parseSearchSymbols(search))

  const preview = valueOf('--preview')
  if (preview) await runPreview(articles, Number(preview) || 1)

  if (flag('--images')) await runImages(articles)

  report()
}

function report(): void {
  if (!failures.length) {
    console.log('\nAll checks passed.')
    return
  }
  console.log(`\n${failures.length} MISMATCH(ES):`)
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
