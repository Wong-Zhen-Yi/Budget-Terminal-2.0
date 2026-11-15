import type { BackgroundRequest, SecFiling } from './contract.js'

export interface AnthropicRequest extends BackgroundRequest { force?: boolean }
export interface AnthropicSource { id: string; title: string; url: string; publishedAt: string }
export interface AnthropicFact { title: string; value: string; detail: string; source: string }
export interface AnthropicTopic { id: string; title: string; question: string; facts: AnthropicFact[] }
export interface AnthropicAnnouncement { title: string; url: string; date: string }
export interface AnthropicCheck { id: string; checkedAt: number | null; changed: boolean; error?: string }
export interface AnthropicPayload {
  reviewedAt: string
  nextReviewAt: string
  sources: AnthropicSource[]
  topics: AnthropicTopic[]
  quarters: Array<{ period: string; revenue: number; compute: number }>
  fundingRounds: Array<{ round: string; date: string; raised: number; valuation: number; source: string }>
  operatingMetrics: { asOf: string; source: string; customers100kLowerBound: number; customers1mLowerBound: number; netRevenueRetentionApprox: number }
  capitalSnapshot: { asOf: string; source: string; cash: number; shortTermInvestments: number; availableCredit: number; computeCommitments: number; commitmentsThrough2030: number; commitmentsNext12Months: number }
  announcements: AnthropicAnnouncement[]
  filings: SecFiling[]
  checks: AnthropicCheck[]
  reviewReasons: string[]
}

export const ANTHROPIC_REVIEWED_AT = '2026-11-15'
export const ANTHROPIC_NEXT_REVIEW = '2026-11-22'
export const ANTHROPIC_NEWS = 'https://www.anthropic.com/news'
export const ANTHROPIC_SOURCES: AnthropicSource[] = [
  { id: 'filing', title: 'SEC S-1/A · amendment 2', publishedAt: '2026-11-10', url: 'https://www.sec.gov/Archives/edgar/data/2130357/000162828026072484/anthropicpbc-sx1ax2.htm' },
  { id: 'factsheet', title: 'IPO financial & operating fact sheet', publishedAt: '2026-11', url: 'https://ipo.anthropic.com/documents/us/factsheet.pdf' },
  { id: 'roadshow', title: 'Proposed IPO roadshow', publishedAt: '2026-11-10', url: 'https://www.anthropic.com/news/roadshow-launch' },
  { id: 'funding', title: 'Series H funding announcement', publishedAt: '2026-05-28', url: 'https://www.anthropic.com/news/series-h' },
  { id: 'series-g', title: 'Series G funding', publishedAt: '2026-02-12', url: 'https://www.anthropic.com/news/anthropic-raises-30-billion-series-g-funding-380-billion-post-money-valuation' },
  { id: 'series-f', title: 'Series F funding', publishedAt: '2025-09-02', url: 'https://www.anthropic.com/news/anthropic-raises-series-f-at-usd183b-post-money-valuation' },
  { id: 'series-e', title: 'Series E funding', publishedAt: '2025-03-03', url: 'https://www.anthropic.com/news/anthropic-raises-series-e-at-usd61-5b-post-money-valuation' },
  { id: 'models', title: 'Claude Fable 5.2 & Mythos 5.2', publishedAt: '2026-11-09', url: 'https://www.anthropic.com/claude-fable-and-mythos-5-2' },
  { id: 'company', title: 'Company & governance', publishedAt: 'Undated · reviewed 2026-11-15', url: 'https://www.anthropic.com/company' },
  { id: 'safety', title: 'Responsible Scaling Policy', publishedAt: 'Living document · reviewed 2026-11-15', url: 'https://www.anthropic.com/responsible-scaling-policy' },
]

export function anthropicResearch(): AnthropicPayload {
  return {
    reviewedAt: ANTHROPIC_REVIEWED_AT, nextReviewAt: ANTHROPIC_NEXT_REVIEW, sources: ANTHROPIC_SOURCES,
    operatingMetrics: { asOf: '2026-09-30', source: 'factsheet', customers100kLowerBound: 11900, customers1mLowerBound: 1900, netRevenueRetentionApprox: 900 },
    // USD billions, approximate. Commitments are as of and subsequent to the balance-sheet date.
    capitalSnapshot: { asOf: '2026-09-30', source: 'factsheet', cash: 96, shortTermInvestments: 36, availableCredit: 15, computeCommitments: 900, commitmentsThrough2030: 451.6, commitmentsNext12Months: 70.7 },
    fundingRounds: [
      { round: 'Series E', date: '2025-03-03', raised: 3.5, valuation: 61.5, source: 'series-e' },
      { round: 'Series F', date: '2025-09-02', raised: 13, valuation: 183, source: 'series-f' },
      { round: 'Series G', date: '2026-02-12', raised: 30, valuation: 380, source: 'series-g' },
      { round: 'Series H', date: '2026-05-28', raised: 65, valuation: 965, source: 'funding' },
    ],
    // Billions of USD, rounded as presented in the November IPO fact sheet. These are quarterly flows.
    quarters: [
      { period: 'Q1 25', revenue: 0.4, compute: 0.9 }, { period: 'Q2 25', revenue: 0.8, compute: 1.4 },
      { period: 'Q3 25', revenue: 1.4, compute: 2.0 }, { period: 'Q4 25', revenue: 2.0, compute: 2.9 },
      { period: 'Q1 26', revenue: 4.7, compute: 3.4 }, { period: 'Q2 26', revenue: 11.6, compute: 5.6 },
      { period: 'Q3 26', revenue: 17.0, compute: 9.9 },
    ],
    topics: [
      { id: 'business', title: 'Business & adoption', question: 'Can enterprise demand sustain the pace?', facts: [
        { title: 'Business', value: 'Frontier AI', detail: 'Research and deployment of Claude models through subscriptions, developer usage and cloud distribution.', source: 'company' },
        { title: 'Leadership', value: 'Amodei co-founders', detail: 'Dario Amodei is CEO; Daniela Amodei is President, as identified in the November filing.', source: 'filing' },
        { title: 'Enterprise adoption', value: '>11,900', detail: 'Customers generating at least $100K of trailing-12-month revenue at September 30, 2026; >1,900 generated at least $1M.', source: 'factsheet' },
        { title: 'Expansion', value: '~900% NRR', detail: 'Company-defined net revenue retention at Q3 2026. A cohort expansion measure, not a forecast of future growth.', source: 'factsheet' },
        { title: 'Distribution', value: 'Three major clouds', detail: 'Claude is offered on AWS, Google Cloud and Microsoft Azure. AWS remains the primary cloud and training partner.', source: 'funding' },
        { title: 'What to watch', value: 'Repeat usage', detail: 'Research question: monitor durable enterprise expansion, competitive pricing and the cost of serving longer agent workflows.', source: 'factsheet' },
      ] },
      { id: 'capital', title: 'Capital & listing', question: 'What is funded, and what is still proposed?', facts: [
        { title: 'Last reviewed private round', value: '$965B', detail: 'Series H post-money valuation on May 28, 2026. A financing valuation, not a current traded market capitalization.', source: 'funding' },
        { title: 'Series H proceeds', value: '$65B', detail: 'Led by Altimeter, Dragoneer, Greenoaks and Sequoia. Includes $15B of previously committed hyperscaler investments; do not add those again.', source: 'funding' },
        { title: 'Proposed IPO', value: '$70–78 / share', detail: 'November 10 indicative price range for 825M shares. 801.35M primary shares; 23.65M secondary. Terms can change.', source: 'roadshow' },
        { title: 'Listing application', value: 'Nasdaq · ANT', detail: 'Proposed symbol only. Registration was not effective in the reviewed announcement. No public quote or confirmed trading date is supplied.', source: 'roadshow' },
        { title: 'Liquidity at Q3 2026', value: '~$132B', detail: 'Approximately $96B cash and equivalents plus $36B short-term investments. The ~$15B available credit facility is separate.', source: 'factsheet' },
        { title: 'Access & ownership', value: 'Private equity', detail: 'No verified public free float or live price. Cloud partners are diversified businesses, not pure-play substitutes for Anthropic ownership.', source: 'filing' },
      ] },
      { id: 'economics', title: 'Economics & compute', question: 'Does growth cover the infrastructure burden?', facts: [
        { title: 'Recognized revenue', value: '$33.242B', detail: 'Nine months ended September 30, 2026; unaudited. Revenue increased 1,206% from the comparable 2025 period.', source: 'filing' },
        { title: 'Run-rate revenue', value: '~$81B', detail: 'October 2026 operating metric: trailing 28-day usage fees ×13 plus monthly subscription fees ×12. Not annual GAAP revenue or contracted backlog.', source: 'factsheet' },
        { title: 'Quarterly profitability', value: '15% adjusted', detail: 'Q3 2026 adjusted operating margin is non-GAAP. Compute costs alone exclude personnel and other operating expenses.', source: 'factsheet' },
        { title: 'Compute commitments', value: '~$900B', detail: 'As of and subsequent to September 30, 2026; ~$451.6B expected before end-2030 and ~$70.7B due in the following 12 months. Multi-year obligations, not current capex.', source: 'factsheet' },
        { title: 'Supply architecture', value: 'Multi-chip', detail: 'AWS Trainium, Google TPUs, NVIDIA GPUs and AMD GPUs diversify compute supply; execution and capacity delivery remain key research questions.', source: 'factsheet' },
        { title: 'Accounting caution', value: 'Financing marks', detail: 'The filing records $94.3B in fair-value changes on notes, derivative liabilities and SAFEs in 9M 2026. Separate non-cash remeasurement from operating performance.', source: 'filing' },
      ] },
      { id: 'products', title: 'Products & research', question: 'Where does Claude turn capability into usage?', facts: [
        { title: 'Work surfaces', value: 'Code · Chat · Cowork', detail: 'Coding agents, conversational work and broader task execution sit alongside the developer platform and cloud distribution.', source: 'factsheet' },
        { title: 'Reviewed model release', value: 'Fable / Mythos 5.2', detail: 'Announced November 9, 2026 for demanding coding, finance and science workflows. Availability and pricing should be checked in the release.', source: 'models' },
        { title: 'Capability claims', value: 'Vendor reported', detail: 'Release benchmarks and workload cost claims depend on settings and evaluation design; they are not independent evidence of customer returns.', source: 'models' },
        { title: 'Research approach', value: 'Safety + capability', detail: 'Anthropic emphasizes interpretability, alignment and steerability, translating research into deployed systems.', source: 'company' },
        { title: 'Product diligence', value: 'Quality per dollar', detail: 'Research question: track real task completion, token consumption, latency, model replacement cycles and cloud availability after each release.', source: 'models' },
      ] },
      { id: 'risks', title: 'Risks & unknowns', question: 'What could break the operating thesis?', facts: [
        { title: 'Capital intensity', value: 'Capacity obligations', detail: 'Research question: compare committed compute payments with liquidity and cash generation; unused capacity could pressure returns.', source: 'factsheet' },
        { title: 'Governance', value: 'PBC + benefit trust', detail: 'The public benefit purpose and Long-Term Benefit Trust influence governance. Economic ownership alone does not describe control.', source: 'company' },
        { title: 'Safety policy', value: 'Living framework', detail: 'The Responsible Scaling Policy evolves. Review current safeguards, capability thresholds and published risk reports instead of assuming earlier pledges still apply.', source: 'safety' },
        { title: 'Market & execution', value: 'Open questions', detail: 'Research questions: model commoditization, cloud partner incentives, copyright exposure, regulation, security failures and customer concentration.', source: 'filing' },
        { title: 'Disclosure limits', value: 'No live valuation', detail: 'Private secondary prices, fully diluted current ownership and product-level margins are not verified by this dossier. Missing data is not zero.', source: 'filing' },
        { title: 'Next evidence', value: 'Final prospectus', detail: 'Check SEC amendments, effectiveness, pricing and exchange commencement before treating a proposed symbol as listed.', source: 'roadshow' },
      ] },
    ], announcements: [], filings: [], checks: [], reviewReasons: [],
  }
}

const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

/** Only dated first-party article links; reject empty layouts and unexpected URL schemes. */
export function parseAnthropicNews(html: string): AnthropicAnnouncement[] {
  const found = new Map<string, AnthropicAnnouncement>()
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].flatMap(match => {
    try { const url = new URL(match[1], ANTHROPIC_NEWS); return url.origin === 'https://www.anthropic.com' ? [url] : [] } catch { return [] }
  })
  const add = (href: string, title: string, dateText: string) => {
    try {
      const url = new URL(href, ANTHROPIC_NEWS)
      const parsedDate = new Date(`${dateText} 00:00:00 GMT`)
      const published = /^20\d{2}-\d{2}-\d{2}$/.test(dateText) ? dateText : Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString().slice(0, 10) : ''
      if (url.origin === 'https://www.anthropic.com' && /^\/(?:news\/|research\/|claude-)[a-z0-9-]+$/.test(url.pathname) && published && title.trim()) {
        found.set(url.href, { title: plain(title), url: url.href, date: published })
      }
    } catch { /* Invalid source URL or date. */ }
  }
  // Semantic article cards bind each title to its own time element.
  for (const match of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    const card = match[1]
    const titleLink = [...card.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .find(link => /<h3\b/i.test(link[2]))
    const title = titleLink?.[2].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1]
    const published = card.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i)?.[1]
    if (titleLink && title && published) add(titleLink[1], title, plain(published))
  }
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const row = value as Record<string, unknown>
    if (typeof row.title === 'string' && typeof row.href === 'string' && typeof row.date === 'string') add(row.href, row.title, row.date)
    const slug = (row.slug as { current?: unknown } | undefined)?.current
    if (typeof row.title === 'string' && typeof row.publishedOn === 'string' && typeof slug === 'string'
      && row.articleType === 'news' && /^[a-z0-9-]+$/.test(slug) && /^20\d{2}-\d{2}-\d{2}$/.test(row.publishedOn)) {
      const url = links.find(link => link.pathname === `/news/${slug}` || link.pathname === `/${slug}`)
      if (url && !found.has(url.href)) add(url.href, row.title, row.publishedOn)
    }
    Object.values(row).forEach(visit)
  }
  // Decode JSON transport only. Never evaluate website scripts or borrow dates from adjacent articles.
  for (const match of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)/g)) {
    try {
      const payload = JSON.parse(match[1]) as unknown[]
      if (typeof payload[1] !== 'string') continue
      for (const line of payload[1].split('\n')) {
        const json = line.slice(line.indexOf(':') + 1)
        if (json.startsWith('[') || json.startsWith('{')) { try { visit(JSON.parse(json)) } catch { /* Non-JSON transport record. */ } }
      }
    } catch { /* A changed source format is rejected if no dated records remain. */ }
  }
  const rows = [...found.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40)
  if (!rows.length) throw new Error('No dated Anthropic announcements found; the source layout may have changed.')
  return rows
}

export function anthropicReviewReasons(data: AnthropicPayload, now = Date.now()): string[] {
  return [
    ...(now >= Date.parse(`${data.nextReviewAt}T00:00:00Z`) ? ['Scheduled weekly research review is due.'] : []),
    ...(data.announcements.some(row => row.date > data.reviewedAt) ? ['New announcements were published after the research review.'] : []),
    ...(data.filings.some(row => row.filedDate > data.reviewedAt) ? ['SEC filings newer than the research review require review.'] : []),
    ...data.checks.filter(row => row.changed).map(row => `${row.id} content changed since the research review.`),
  ]
}
