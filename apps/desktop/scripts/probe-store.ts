/**
 * Exercise the portfolio store end to end: clean initialization, then every
 * mutation the Portfolio page can make.
 *
 *   npm run probe:store
 *
 * Both data directories are redirected to scratch space, so fixtures never read
 * or write the real portfolio or legacy store.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { mkdir, readFile, rmdir, writeFile } from 'node:fs/promises'

const scratch = mkdtempSync(join(tmpdir(), 'bt-store-'))
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch

const {
  mutatePortfolios, readPortfolios, storePath,
  readPersonalFinance, mutatePersonalFinance, importUserData, exportUserData,
  clearUserData, resetStoreCache,
} = await import(
  '../electron/services/portfolioStore.js'
)

async function regressionChecks(): Promise<void> {
  const oldFolder = join(scratch, 'BudgetTerminal')
  await mkdir(oldFolder, { recursive: true })
  const oldData = JSON.stringify({
    portfolio_order: ['old'],
    portfolios: { old: { name: 'Legacy fixture', portfolio: ['TEST'], portfolio_tracker: { TEST: { shares: 99, avg_price: 10 } } } },
    net_worth: { cash: [{ desc: 'Legacy cash', amount: 999 }] },
  })
  await writeFile(join(oldFolder, 'user_data.json'), oldData)
  const initial = await readPortfolios()
  assert.equal(initial.portfolios.length, 1)
  assert.deepEqual(initial.portfolios[0].tickers, [])
  assert.deepEqual((await readPersonalFinance()).cash, [])
  assert.equal(await readFile(join(oldFolder, 'user_data.json'), 'utf8'), oldData)
  // First-run reads and a queued edit must share initialization.
  await Promise.all([
    ...Array.from({ length: 16 }, (_, index) => index % 2 ? readPersonalFinance() : readPortfolios()),
    mutatePortfolios({ type: 'setCash', portfolioId: 'portfolio_1', cashBalance: 1234 }),
  ])
  assert.equal((await readPortfolios()).portfolios[0].cashBalance, 1234)
  // Export reads issued before a blur-triggered write finishes include that edit.
  const pendingEdit = mutatePortfolios({ type: 'setCash', portfolioId: 'portfolio_1', cashBalance: 4321 })
  const exportSnapshot = await readPortfolios()
  assert.equal(exportSnapshot.portfolios[0].cashBalance, 4321)
  await pendingEdit
  await mutatePortfolios({ type: 'setCash', portfolioId: 'portfolio_1', cashBalance: 1234 })
  await mutatePersonalFinance({ type: 'addEntry', category: 'cash' })
  const baseline = await exportUserData()
  const disk = await readFile(storePath(), 'utf8')
  const damaged = JSON.parse(disk)
  damaged.portfolios.portfolio_1.holdings = { AAPL: { shares: 'broken' } }
  for (const invalid of [{}, { unrelated: true }, damaged]) {
    await assert.rejects(importUserData(invalid), /valid holdings store/)
    assert.deepEqual(await exportUserData(), baseline)
    assert.equal(await readFile(storePath(), 'utf8'), disk)
  }

  // A directory at the temporary file path reliably forces a save failure even
  // when the probe runs with elevated permissions.
  const blocked = `${storePath()}.${process.pid}.tmp`
  await mkdir(blocked)
  try {
    for (const write of [
      () => mutatePortfolios({ type: 'setCash', portfolioId: 'portfolio_1', cashBalance: 999 }),
      () => mutatePersonalFinance({ type: 'addEntry', category: 'cash' }),
      () => importUserData({ ...JSON.parse(disk), portfolios: {}, order: [] }),
      () => clearUserData(),
    ]) {
      await assert.rejects(write())
      assert.deepEqual(await exportUserData(), baseline)
      assert.equal(await readFile(storePath(), 'utf8'), disk)
    }
  } finally {
    await rmdir(blocked)
  }
  await mutatePortfolios({ type: 'rename', id: 'portfolio_1', name: 'After failure' })
  resetStoreCache()
  assert.equal((await readPortfolios()).portfolios[0].cashBalance, 1234)
  assert.equal((await readPersonalFinance()).cash.length, 1)

  // Valid current and v1 exports remain importable; concurrent v1 reads share
  // the finance backfill write just as first-run reads share their seed write.
  await importUserData(baseline)
  const legacy = JSON.parse(disk)
  legacy.version = 1
  delete legacy.personalFinance
  await importUserData(legacy)
  assert.equal((await readPortfolios()).portfolios[0].cashBalance, 1234)
  await writeFile(storePath(), JSON.stringify(legacy), 'utf8')
  resetStoreCache()
  await mkdir(blocked)
  await assert.rejects(readPortfolios())
  await rmdir(blocked)
  await Promise.all(Array.from({ length: 16 }, () => readPortfolios()))
  assert.equal(JSON.parse(await readFile(storePath(), 'utf8')).version, 2)
  assert.deepEqual((await readPersonalFinance()).cash, [])
  assert.equal((await readPortfolios()).portfolios[0].cashBalance, 1234)
  await clearUserData()
  console.log('Store regressions passed: import validation, save failures, concurrent initialization/backfill and retry.')
}

function show(label: string, payload: Awaited<ReturnType<typeof readPortfolios>>): void {
  console.log(`\n-- ${label}`)
  console.log(`   active=${payload.activeId}  main=${payload.mainId}`)
  for (const portfolio of payload.portfolios) {
    const positions = portfolio.tickers
      .map((ticker) => {
        const holding = portfolio.holdings[ticker]
        const flag = holding?.includeInWeight === false ? ' [excluded]' : ''
        return `${ticker}:${holding?.shares ?? 0}@${(holding?.avgPrice ?? 0).toFixed(2)}${flag}`
      })
      .join(' ')
    console.log(
      `   ${portfolio.readOnly ? '(ro) ' : '     '}${portfolio.id.padEnd(12)} ${portfolio.name.padEnd(14)} ` +
        `cash=${portfolio.cashBalance} margin=${portfolio.marginDebt} ` +
        `cashInWeight=${portfolio.includeCashInWeight}  ${positions || '(empty)'}`,
    )
  }
}

async function expectRejected(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
    console.log(`   FAIL  ${label} was allowed but should have been rejected`)
    process.exitCode = 1
  } catch (error) {
    console.log(`   ok    ${label} rejected: ${error instanceof Error ? error.message : error}`)
  }
}

async function main(): Promise<void> {
  await regressionChecks()
  console.log(`store path  : ${storePath()}`)

  show('initialized from the app store', await readPortfolios())

  const first = (await readPortfolios()).portfolios[0]
  const id = first.id

  show('addPosition NVDA', await mutatePortfolios({ type: 'addPosition', portfolioId: id, ticker: 'nvda' }))
  show(
    'setPosition NVDA 12 @ 180.55',
    await mutatePortfolios({
      type: 'setPosition',
      portfolioId: id,
      ticker: 'NVDA',
      shares: 12,
      avgPrice: 180.55,
    }),
  )
  show(
    'setPosition NVDA excluded from weight',
    await mutatePortfolios({
      type: 'setPosition',
      portfolioId: id,
      ticker: 'NVDA',
      includeInWeight: false,
    }),
  )
  show('setCash 12345.67', await mutatePortfolios({ type: 'setCash', portfolioId: id, cashBalance: 12345.67 }))
  show('setMargin 2000', await mutatePortfolios({ type: 'setMargin', portfolioId: id, marginDebt: 2000 }))
  show(
    'setIncludeCash false',
    await mutatePortfolios({ type: 'setIncludeCash', portfolioId: id, includeCashInWeight: false }),
  )
  show('create', await mutatePortfolios({ type: 'create', name: 'Broker Two' }))

  const created = (await readPortfolios()).portfolios.filter((p) => !p.readOnly).at(-1)!
  show('rename', await mutatePortfolios({ type: 'rename', id: created.id, name: 'Roth IRA' }))
  show('setMain', await mutatePortfolios({ type: 'setMain', id: created.id }))
  show('reorder', await mutatePortfolios({ type: 'reorder', order: [created.id, id] }))
  show('removePosition NVDA', await mutatePortfolios({ type: 'removePosition', portfolioId: id, ticker: 'NVDA' }))

  console.log('\n-- option tracker')
  show('addOption', await mutatePortfolios({ type: 'addOption', portfolioId: id }))
  const added = (await readPortfolios()).portfolios.find((p) => p.id === id)!.options.at(-1)!
  console.log(
    `   ok    new row defaults to ${added.strategy}/${added.status}, ${added.contracts} contract, ` +
      `opened ${added.openDate}`,
  )
  // Live marks are derived, never stored: a fresh row must read as unpriced.
  console.log(
    `   ${added.currentPrice === 0 && added.volume === 0 && added.openInterest === 0 && added.impliedVolatility === 0 ? 'ok   ' : 'FAIL '} live fields start empty`,
  )
  if (added.currentPrice !== 0) process.exitCode = 1

  await mutatePortfolios({
    type: 'setOption',
    portfolioId: id,
    rowId: added.rowId,
    patch: {
      ticker: ' spy ',
      strategy: 'Covered Call',
      expiry: '2026-12-18',
      strike: 640,
      contracts: 2,
      premium: 12.35,
      status: 'Open',
    },
  })
  const edited = (await readPortfolios()).portfolios
    .find((p) => p.id === id)!
    .options.find((option) => option.rowId === added.rowId)!
  console.log(
    `   ok    setOption -> ${edited.ticker} ${edited.strategy} ${edited.expiry} ` +
      `${edited.strike} x${edited.contracts} @ ${edited.premium} (${edited.status})`,
  )
  if (edited.ticker !== 'SPY') {
    console.log('   FAIL  the ticker was not trimmed and upper-cased')
    process.exitCode = 1
  }

  // A patch is partial: untouched fields survive, and a junk number is ignored rather
  // than blanking the cell the user did not edit.
  await mutatePortfolios({
    type: 'setOption',
    portfolioId: id,
    rowId: added.rowId,
    patch: { strike: Number.NaN, premium: 13.5 },
  })
  const patched = (await readPortfolios()).portfolios
    .find((p) => p.id === id)!
    .options.find((option) => option.rowId === added.rowId)!
  console.log(
    `   ${patched.strike === 640 && patched.premium === 13.5 && patched.ticker === 'SPY' ? 'ok   ' : 'FAIL '} ` +
      `a NaN strike is ignored and the rest of the row survives (strike=${patched.strike} premium=${patched.premium})`,
  )
  if (patched.strike !== 640 || patched.premium !== 13.5) process.exitCode = 1

  // The Combined view restates every portfolio's rows under a prefixed id, so the
  // Personal Finance page can key its live marks without two portfolios colliding.
  const combined = (await readPortfolios()).portfolios.find((p) => p.readOnly)
  if (combined) {
    console.log(
      `   ${combined.options.some((option) => option.rowId === `${id}:${added.rowId}`) ? 'ok   ' : 'FAIL '} ` +
        `Combined restates the row as ${id}:${added.rowId}`,
    )
  }

  await expectRejected('setOption on a removed row', async () => {
    await mutatePortfolios({ type: 'removeOption', portfolioId: id, rowId: added.rowId })
    return mutatePortfolios({
      type: 'setOption',
      portfolioId: id,
      rowId: added.rowId,
      patch: { premium: 1 },
    })
  })
  const afterRemove = (await readPortfolios()).portfolios.find((p) => p.id === id)!.options
  console.log(`   ok    removeOption left ${afterRemove.length} row(s)`)
  await expectRejected('addOption on the Combined view', () =>
    mutatePortfolios({ type: 'addOption', portfolioId: 'combined' }),
  )
  await expectRejected('setOption on an unknown portfolio', () =>
    mutatePortfolios({ type: 'setOption', portfolioId: 'portfolio_99', rowId: 'x', patch: {} }),
  )

  console.log('\n-- rejected edits')
  await expectRejected('duplicate ticker', () =>
    mutatePortfolios({ type: 'addPosition', portfolioId: id, ticker: first.tickers[0] ?? 'AAPL' }).then(() =>
      mutatePortfolios({ type: 'addPosition', portfolioId: id, ticker: first.tickers[0] ?? 'AAPL' }),
    ),
  )
  await expectRejected('unknown portfolio', () =>
    mutatePortfolios({ type: 'rename', id: 'portfolio_99', name: 'nope' }),
  )
  await expectRejected('editing the Combined view', () =>
    mutatePortfolios({ type: 'setCash', portfolioId: 'combined', cashBalance: 1 }),
  )

  // Fill to the cap, then confirm the next create is refused.
  const remaining = 5 - (await readPortfolios()).portfolios.filter((p) => !p.readOnly).length
  for (let i = 0; i < remaining; i += 1) await mutatePortfolios({ type: 'create' })
  await expectRejected('create beyond the cap', () => mutatePortfolios({ type: 'create' }))

  show('at the cap', await readPortfolios())

  // Delete down to one and confirm the last one is protected.
  for (const portfolio of (await readPortfolios()).portfolios.filter((p) => !p.readOnly).slice(1)) {
    await mutatePortfolios({ type: 'delete', id: portfolio.id })
  }
  const survivor = (await readPortfolios()).portfolios[0].id
  await expectRejected('deleting the last portfolio', () =>
    mutatePortfolios({ type: 'delete', id: survivor }),
  )

  show('final', await readPortfolios())
  console.log(`\nscratch cleaned: ${scratch}\n`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => rmSync(scratch, { recursive: true, force: true }))
