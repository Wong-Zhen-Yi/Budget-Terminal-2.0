import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import {
  buildPoliticsThemeFlow,
  filterPoliticsTrades,
  formatPoliticsAmount,
  formatPoliticsFlow,
  inferPoliticsTheme,
  normalizePoliticsTradeType,
  parsePoliticsAmount,
  parsePoliticsHtml,
  parsePoliticsParty,
  politicsClipboard,
  politicsFlowSlices,
  politicsTopCounts,
} from '../electron/shared/politics.js'

function equal(actual: unknown, expected: unknown, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const rawRows = [
  {
    _txId: 'one',
    politician: { firstName: 'Jane', lastName: 'Doe', party: 'Democrat' },
    issuer: { issuerTicker: 'AAPL:US', issuerName: 'Apple Inc' },
    chamber: 'house',
    txType: 'Purchase',
    value: 1_500_000,
    txDate: '2026-08-28T00:00:00Z',
    pubDate: '2026-08-29T00:00:00Z',
  },
  {
    _txId: 'two',
    politician: { firstName: 'John', lastName: 'Smith', party: 'R' },
    issuer: { issuerTicker: 'XOM', issuerName: 'Exxon Mobil Corp' },
    chamber: 'senate',
    txType: 'Partial Sale',
    value: '$250K',
    txDate: '2026-08-27',
    pubDate: '2026-08-30',
  },
  {
    _txId: 'three',
    politician: { firstName: 'Jane', lastName: 'Doe', party: 'D' },
    issuer: { issuerTicker: 'PRIVATE:', issuerName: 'Private Cyber Software Holdings' },
    chamber: 'house',
    txType: 'Exchange',
    value: 20_000,
    txDate: '2026-08-26',
    pubDate: '2026-08-28',
  },
]

const payload = `0:{"data":${JSON.stringify(rawRows)},"more":true}`
const fixture = `<html><script>self.__next_f.push(${JSON.stringify([1, payload])})</script></html>`

function checkParsing(): void {
  const parsed = parsePoliticsHtml(fixture)
  equal(parsed.rawCount, 3, 'raw count includes every Capitol Trades record')
  equal(parsed.trades.length, 3, 'all ticker-bearing records survive')
  equal(parsed.trades[0].ticker, 'AAPL', 'the market suffix is removed from a ticker')
  equal(parsed.trades[0].party, 'Democrat', 'party names normalize')
  equal(parsed.trades[0].theme, 'Technology', 'known tickers use the sector catalog')
  equal(parsed.trades[1].tradeType, 'Sale (Partial)', 'partial sales normalize before full sales')
  equal(parsed.trades[1].amountValue, 250_000, 'compact dollar values parse')
  equal(parsed.trades[2].theme, 'Technology', 'asset-description keywords infer a theme')
  equal(parsePoliticsHtml('<html>no RSC payload</html>').rawCount, 0, 'missing data parses empty')
}

function checkNormalization(): void {
  equal(parsePoliticsParty('I'), 'Independent', 'independent party')
  equal(parsePoliticsParty(''), 'Unknown', 'missing party')
  equal(normalizePoliticsTradeType('sell'), 'Sale (Full)', 'sell trade')
  equal(normalizePoliticsTradeType('buy'), 'Purchase', 'buy trade')
  equal(parsePoliticsAmount('$1.2B'), 1_200_000_000, 'billion amount')
  equal(parsePoliticsAmount('not known'), null, 'unknown amount')
  equal(formatPoliticsAmount(1_500_000), '$1.5M', 'million display')
  equal(formatPoliticsFlow(-250_000, true), '-$250K', 'signed flow display')
  equal(inferPoliticsTheme('ZZZ', 'Regional bank and mortgage lender'), 'Financials', 'keyword theme')
}

function checkPageMath(): void {
  const trades = parsePoliticsHtml(fixture).trades
  const jane = filterPoliticsTrades(trades, {
    politician: 'Jane Doe',
    ticker: '',
    chamber: 'All',
    party: 'All',
    tradeType: 'All',
    theme: 'All',
  })
  equal(jane.length, 2, 'politician filter is exact')
  equal(politicsTopCounts(trades, 'politician')[0][0], 'Jane Doe', 'top politician')
  equal(politicsTopCounts(trades, 'politician')[0][1], 2, 'top politician count')
  const flow = buildPoliticsThemeFlow(trades)
  equal(flow[0].theme, 'Technology', 'theme flow ranks by gross value')
  equal(flow[0].buy, 1_500_000, 'purchases add to buy flow')
  equal(flow[0].sell, 0, 'exchanges do not count as a sale')
  equal(flow.find((row) => row.theme === 'Energy')?.sell, 250_000, 'sales add to sell flow')
  equal(politicsFlowSlices(flow).length, 2, 'positive gross themes become donut slices')
  assert(politicsClipboard(trades).includes('Jane Doe | House | Democrat | AAPL'), 'export columns')
}

function runOffline(): void {
  checkParsing()
  checkNormalization()
  checkPageMath()
  console.log('offline checks passed: RSC parser, normalization, filters, summaries, theme flow, export')
}

async function runLive(): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'budget-terminal-politics-'))
  try {
    // Capitol Trades' Vercel edge challenges Node's bare TLS client. The shipped page uses
    // Electron's Chromium network stack, so the live probe runs the real service under the
    // same runtime rather than reporting a false HTTP 429 from `tsx`'s Node process.
    const require = createRequire(import.meta.url)
    const electronPath = require('electron') as string
    const helper = fileURLToPath(new URL('./probe-politics-electron.cjs', import.meta.url))
    const result = spawnSync(electronPath, [helper], {
      cwd: process.cwd(),
      env: { ...process.env, APPDATA: temporary },
      encoding: 'utf8',
      timeout: 60_000,
    })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.error) throw result.error
    equal(result.status, 0, 'Electron live probe exit code')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

runOffline()
if (!process.argv.includes('--offline')) await runLive()
