/**
 * Exercise the portfolio store end to end: seeding from the PySide6 file, then every
 * mutation the Portfolio page can make.
 *
 *   npm run probe:store
 *
 * APPDATA is redirected to a scratch directory first, so this reads your real
 * user_data.json (seeding only ever reads it) but never touches your real store.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const scratch = mkdtempSync(join(tmpdir(), 'bt-store-'))
process.env.APPDATA = scratch

const { legacyStorePath, mutatePortfolios, readPortfolios, storePath } = await import(
  '../electron/services/portfolioStore.js'
)

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
  console.log(`seed source : ${legacyStorePath()}`)
  console.log(`store path  : ${storePath()}`)

  show('seeded from the PySide6 store', await readPortfolios())

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
