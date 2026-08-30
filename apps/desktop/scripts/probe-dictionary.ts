import assert from 'node:assert/strict'

import { CHART_PATTERN_CATALOG } from '../electron/shared/chartPatterns.js'
import {
  DICTIONARY_CATEGORIES,
  DICTIONARY_ENTRIES,
  DICTIONARY_ENTRY_BY_ID,
  getDictionaryEntry,
  searchDictionaryEntries,
} from '../electron/shared/dictionary.js'

const duplicateIds = DICTIONARY_ENTRIES.filter(
  (entry, index) => DICTIONARY_ENTRIES.findIndex((candidate) => candidate.entryId === entry.entryId) !== index,
)
const duplicateTerms = DICTIONARY_ENTRIES.filter(
  (entry, index) => DICTIONARY_ENTRIES.findIndex(
    (candidate) => candidate.term.toLowerCase() === entry.term.toLowerCase(),
  ) !== index,
)

assert.ok(DICTIONARY_ENTRIES.length >= 250)
assert.equal(DICTIONARY_CATEGORIES.length, 14)
assert.deepEqual(
  new Set(DICTIONARY_ENTRIES.map((entry) => entry.category)),
  new Set(DICTIONARY_CATEGORIES),
)
assert.deepEqual(duplicateIds, [])
assert.deepEqual(duplicateTerms, [])
assert.deepEqual(
  DICTIONARY_ENTRIES.map((entry) => entry.term),
  [...DICTIONARY_ENTRIES]
    .sort((left, right) => left.term.toLowerCase().localeCompare(right.term.toLowerCase()))
    .map((entry) => entry.term),
)

for (const entry of DICTIONARY_ENTRIES) {
  assert.ok(entry.entryId && entry.term && entry.definition && entry.whyItMatters)
  assert.ok(DICTIONARY_CATEGORIES.includes(entry.category as (typeof DICTIONARY_CATEGORIES)[number]))
  assert.equal(entry.entryId, entry.entryId.toLowerCase())
  assert.ok(entry.relatedEntryIds.every((entryId) => DICTIONARY_ENTRY_BY_ID.has(entryId)))
  assert.ok(!entry.relatedEntryIds.includes(entry.entryId))
}

const formulaEntry = getDictionaryEntry('price-to-earnings-ratio')
assert.ok(formulaEntry)
assert.deepEqual(
  new Set(formulaEntry.sections.map((section) => section.title)),
  new Set(['Formula', 'Variables', 'Worked example', 'Interpretation and limitation']),
)

const eventEntry = getDictionaryEntry('cpi-release')
assert.equal(eventEntry?.category, 'Macroeconomics & Economic Events')
assert.deepEqual(
  new Set(eventEntry.sections.map((section) => section.title)),
  new Set(['Publisher and cadence', 'How to read it', 'Typical market channels', 'Caution']),
)

const patternEntries = DICTIONARY_ENTRIES.filter((entry) => entry.chartPatternId)
assert.equal(patternEntries.length, CHART_PATTERN_CATALOG.length)
assert.deepEqual(
  new Set(patternEntries.map((entry) => entry.chartPatternId)),
  new Set(CHART_PATTERN_CATALOG.map((pattern) => pattern.id)),
)

assert.equal(searchDictionaryEntries().length, DICTIONARY_ENTRIES.length)
assert.equal(searchDictionaryEntries('P/E')[0]?.term, 'Price-to-Earnings Ratio')
assert.ok(searchDictionaryEntries('price earnings').some((entry) => entry.term === 'Price-to-Earnings Ratio'))
assert.equal(searchDictionaryEntries('RSI')[0]?.term, 'Relative Strength Index')
const macroResults = searchDictionaryEntries('inflation', 'Macroeconomics & Economic Events')
assert.ok(macroResults.length > 0)
assert.ok(macroResults.every((entry) => entry.category === 'Macroeconomics & Economic Events'))
assert.ok(macroResults.some((entry) => entry.term === 'CPI Release'))
assert.deepEqual(searchDictionaryEntries('term-that-does-not-exist-anywhere'), [])

console.log(`Dictionary probe passed: ${DICTIONARY_ENTRIES.length} entries across ${DICTIONARY_CATEGORIES.length} categories.`)
