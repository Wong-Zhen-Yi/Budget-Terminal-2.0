import rawCatalog from './dictionaryCatalog.json'

export interface DictionarySection {
  title: string
  body: string
}

export interface DictionaryEntry {
  entryId: string
  term: string
  aliases: string[]
  category: string
  definition: string
  whyItMatters: string
  sections: DictionarySection[]
  keywords: string[]
  relatedEntryIds: string[]
  chartPatternId: string | null
}

export const DICTIONARY_CATEGORIES = [
  'Market Basics',
  'Instruments',
  'Trading & Execution',
  'Investing & Portfolio Management',
  'Risk & Performance',
  'Financial Statements',
  'Fundamental Analysis',
  'Valuation & Formulas',
  'Technical Indicators',
  'Chart & Candlestick Patterns',
  'Options',
  'Corporate Actions & Earnings',
  'Macroeconomics & Economic Events',
  'Behavioral Finance',
] as const

export const DICTIONARY_ENTRIES = rawCatalog as DictionaryEntry[]

export const DICTIONARY_ENTRY_BY_ID = new Map(
  DICTIONARY_ENTRIES.map((entry) => [entry.entryId, entry]),
)

const SEARCH_BLOB_BY_ID = new Map(
  DICTIONARY_ENTRIES.map((entry) => [
    entry.entryId,
    [
      entry.term,
      ...entry.aliases,
      entry.category,
      entry.definition,
      entry.whyItMatters,
      ...entry.keywords,
      ...entry.sections.flatMap((section) => [section.title, section.body]),
    ].join(' ').toLowerCase(),
  ]),
)

export function getDictionaryEntry(entryId: string): DictionaryEntry | undefined {
  return DICTIONARY_ENTRY_BY_ID.get(entryId.trim().toLowerCase())
}

export function searchDictionaryEntries(
  query = '',
  category = 'All categories',
): DictionaryEntry[] {
  const normalizedQuery = query.toLowerCase().trim().replace(/\s+/g, ' ')
  const candidates = DICTIONARY_ENTRIES.filter(
    (entry) => !category || category === 'All categories' || entry.category === category,
  )
  if (!normalizedQuery) return candidates

  const queryTokens = normalizedQuery.split(' ')
  return candidates
    .flatMap((entry) => {
      const term = entry.term.toLowerCase()
      const aliases = entry.aliases.map((alias) => alias.toLowerCase())
      const keywords = entry.keywords.map((keyword) => keyword.toLowerCase())
      const blob = SEARCH_BLOB_BY_ID.get(entry.entryId) ?? ''
      let rank: number
      if (term === normalizedQuery) rank = 0
      else if (term.startsWith(normalizedQuery)) rank = 10
      else if (aliases.includes(normalizedQuery)) rank = 20
      else if (aliases.some((alias) => alias.startsWith(normalizedQuery))) rank = 25
      else if (
        keywords.includes(normalizedQuery)
        || keywords.some((keyword) => keyword.startsWith(normalizedQuery))
      ) rank = 30
      else if (blob.includes(normalizedQuery)) rank = 40
      else if (queryTokens.every((token) => blob.includes(token))) rank = 50
      else return []
      return [{ entry, rank, term }]
    })
    .sort((left, right) => (
      left.rank - right.rank
      || left.term.localeCompare(right.term)
      || left.entry.term.localeCompare(right.entry.term)
    ))
    .map(({ entry }) => entry)
}
