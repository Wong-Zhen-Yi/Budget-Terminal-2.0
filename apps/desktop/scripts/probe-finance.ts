/**
 * Print the Personal Finance page exactly as it renders, then exercise every write.
 *
 *   npm run probe:finance
 *
 * Run it beside the PySide6 app on its Personal Finance page and compare line by line:
 * the two should agree to the decimal. Note that the FX rate, the donut centre and the
 * brokerage silo all track live quotes, so compare against a simultaneous reading of
 * the reference rather than against yesterday's numbers.
 *
 * The mutation half redirects APPDATA to a scratch directory first, so it reads your
 * real user_data.json (seeding only ever reads it) but never touches your real store.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FinanceCurrency, PersonalFinancePayload } from '../electron/shared/contract.js'
import {
  billTotals,
  categoryTotal,
  goalNetWorth,
  marginTotal,
  portfolioBreakdown,
  siloBars,
  totalsCenter,
  totalsSeries,
  validRate,
} from '../electron/shared/financeMath.js'
import { yahooProvider } from '../electron/services/provider.js'

const PREFIX: Record<FinanceCurrency, string> = { SGD: 'S$', USD: '$' }

function money(value: number, currency: FinanceCurrency, digits = 2): string {
  return `${PREFIX[currency]}${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`
}

function rounded(value: number, currency: FinanceCurrency): string {
  return `${PREFIX[currency]}${Math.round(value).toLocaleString('en-US')}`
}

function pad(text: string, width: number, align: 'left' | 'right' = 'right'): string {
  return align === 'left' ? text.padEnd(width) : text.padStart(width)
}

function book(payload: PersonalFinancePayload) {
  return {
    cash: payload.cash,
    debt: payload.debt,
    recurringBills: payload.recurringBills,
    goal: payload.goal,
  }
}

/** The live half: everything the page prints, from the real store and real quotes. */
async function report(): Promise<void> {
  const financeEnvelope = await yahooProvider.personalFinance()
  const finance = financeEnvelope.data
  console.log(`store       : ${finance.sourcePath}`)

  const fxEnvelope = await yahooProvider.fx({})
  const rate = fxEnvelope.data.usdSgd
  console.log(
    validRate(rate)
      ? `FX          : 1 USD = ${rate.toFixed(4)} SGD  (${fxEnvelope.data.source})`
      : `FX          : unavailable — ${fxEnvelope.meta.failureReason ?? 'no rate'}`,
  )

  const portfolioEnvelope = await yahooProvider.portfolio()
  const portfolios = portfolioEnvelope.data.portfolios.filter((entry) => !entry.readOnly)
  const tickers = [...new Set(portfolios.flatMap((entry) => entry.tickers))]
  const quotes = tickers.length
    ? (await yahooProvider.quotes({ holdings: tickers })).data.holdings
    : {}

  const breakdown = portfolioBreakdown(portfolios, quotes)
  const display = finance.totalsCurrency
  const contents = book(finance)

  console.log(`\n-- Cash (SGD)   ${finance.cash.length} row(s)`)
  for (const row of finance.cash) {
    console.log(`   ${pad(row.desc, 22, 'left')} ${pad(money(row.amount, 'SGD'), 14)}`)
  }
  const cashTotal = categoryTotal(finance.cash)
  console.log(`   Cash total: ${money(cashTotal, 'SGD')}`)

  console.log(`\n-- Debt (SGD)   ${finance.debt.length} row(s)`)
  for (const row of finance.debt) {
    console.log(`   ${pad(row.desc, 22, 'left')} ${pad(money(row.amount, 'SGD'), 14)}`)
  }
  const debtTotal = categoryTotal(finance.debt)
  const margin = marginTotal(breakdown)
  if (margin <= 0) {
    console.log(`   Debt total: ${money(debtTotal, 'SGD')}`)
  } else if (!validRate(rate)) {
    console.log(`   Debt total: ${money(debtTotal, 'SGD')} + US$${margin.toFixed(2)} margin`)
  } else {
    const combined = debtTotal + margin * rate
    console.log(
      `   Debt total: ${money(combined, 'SGD')} (incl. US$${margin.toFixed(2)} margin)`,
    )
  }

  console.log(`\n-- Recurring Bills   ${finance.recurringBills.length} row(s)`)
  for (const row of finance.recurringBills) {
    console.log(
      `   ${pad(row.desc, 22, 'left')} ${pad(money(row.amount, row.currency), 12)}  ` +
        `${pad(row.frequency, 8, 'left')} ${row.currency}`,
    )
  }
  const bills = billTotals(finance.recurringBills, display, rate)
  console.log(
    bills.available
      ? `   Monthly total (${display}): ${money(bills.monthly, display)}    ` +
          `Annual total (${display}): ${money(bills.annual, display)}`
      : `   Monthly total (${display}): FX required    Annual total (${display}): FX required`,
  )

  console.log(`\n-- Portfolio breakdown (USD)`)
  for (const silo of breakdown) {
    console.log(
      `   ${pad(silo.name, 18, 'left')} stocks=${pad(silo.stocks.toFixed(2), 12)} ` +
        `cash=${pad(silo.cash.toFixed(2), 10)} options=${pad(silo.options.toFixed(2), 10)} ` +
        `margin=${pad(silo.marginDebt.toFixed(2), 10)}`,
    )
  }

  const slices = totalsSeries(contents, breakdown, display, rate)
  const centre = totalsCenter(slices)
  const magnitude = slices.reduce((sum, slice) => sum + slice.value, 0)
  console.log(`\n-- Totals (${display})`)
  for (const slice of slices) {
    const share = magnitude ? (slice.value / magnitude) * 100 : 0
    console.log(
      `   ${pad(slice.label, 22, 'left')} ${pad(money(slice.value, display), 16)}  ` +
        `${pad(`${share.toFixed(1)}%`, 7)}  ${slice.kind}${
          slice.includedInPortfolioNet ? ' (already netted)' : ''
        }  ${slice.color}`,
    )
  }
  console.log(`   Centre: ${rounded(centre, display)}  Total ${display}`)

  const goal = goalNetWorth(contents, breakdown, finance.goal.currency, rate)
  console.log(`\n-- Goal: ${finance.goal.title}`)
  if (!goal.available) {
    console.log('   FX required to value mixed currencies')
  } else if (finance.goal.targetAmount <= 0) {
    console.log('   Set a target to start tracking')
  } else {
    const remaining = finance.goal.targetAmount - goal.value
    console.log(
      `   ${rounded(goal.value, finance.goal.currency)} of ` +
        `${rounded(finance.goal.targetAmount, finance.goal.currency)} ${finance.goal.currency}`,
    )
    console.log(
      remaining <= 0
        ? '   Goal reached'
        : `   ${rounded(remaining, finance.goal.currency)} remaining | ` +
            `${Math.max(0, Math.min(100, (goal.value / finance.goal.targetAmount) * 100)).toFixed(1)}% complete`,
    )
  }

  const bars = siloBars(contents, breakdown, display, rate)
  console.log(`\n-- Personal Finance Silos (${display})   ${bars.length} bar(s), largest first`)
  for (const bar of [...bars].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))) {
    const segments = bar.segments
      ?.map((segment) => `${rounded(segment.value, display)} ${segment.color}`)
      .join(' + ')
    console.log(
      `   ${pad(bar.label, 22, 'left')} ${pad(rounded(bar.value, display), 12)}  ${bar.color}` +
        (segments ? `  [${segments}]` : ''),
    )
  }
}

/** The write half, against a scratch store so the real one is never touched. */
async function exerciseWrites(): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'bt-finance-'))
  const realAppData = process.env.APPDATA
  process.env.APPDATA = scratch

  const { mutatePersonalFinance, readPersonalFinance, legacyStorePath, resetStoreCache, storePath } =
    await import('../electron/services/portfolioStore.js')
  // The report above already read the real store into the module cache; drop it so the
  // scratch directory genuinely exercises the seeding path.
  resetStoreCache()

  const expectRejected = async (label: string, run: () => Promise<unknown>): Promise<void> => {
    const before = JSON.stringify(await readPersonalFinance())
    try {
      await run()
      console.log(`   FAIL  ${label} was allowed but should have been rejected`)
      process.exitCode = 1
    } catch (error) {
      const after = JSON.stringify(await readPersonalFinance())
      const unchanged = before === after ? 'unchanged' : 'CHANGED — the write leaked'
      if (before !== after) process.exitCode = 1
      console.log(
        `   ok    ${label} rejected: ${error instanceof Error ? error.message : error} (${unchanged})`,
      )
    }
  }

  try {
    console.log(`\n\n=== writes against a scratch store ===`)
    console.log(`seed source : ${legacyStorePath()}`)
    console.log(`store path  : ${storePath()}`)

    const seeded = await readPersonalFinance()
    console.log(
      `\n-- seeded from the PySide6 store: ${seeded.cash.length} cash, ${seeded.debt.length} debt, ` +
        `${seeded.recurringBills.length} bill(s), totals=${seeded.totalsCurrency}, ` +
        `goal="${seeded.goal.title}" ${seeded.goal.targetAmount} ${seeded.goal.currency}`,
    )

    const added = await mutatePersonalFinance({ type: 'addEntry', category: 'cash' })
    const row = added.cash[added.cash.length - 1]
    console.log(`   addEntry cash    -> "${row.desc}" ${row.amount}`)

    const named = await mutatePersonalFinance({
      type: 'setEntry',
      category: 'cash',
      id: row.id,
      desc: 'Probe Account',
      amount: 1234.56,
    })
    const renamed = named.cash.find((entry) => entry.id === row.id)
    console.log(`   setEntry         -> "${renamed?.desc}" ${renamed?.amount}`)

    const withBill = await mutatePersonalFinance({ type: 'addBill' })
    const bill = withBill.recurringBills[withBill.recurringBills.length - 1]
    console.log(`   addBill          -> "${bill.desc}" ${bill.frequency} ${bill.currency}`)

    const billSet = await mutatePersonalFinance({
      type: 'setBill',
      id: bill.id,
      desc: 'Probe Bill',
      amount: 120,
      frequency: 'yearly',
      currency: 'USD',
    })
    const updated = billSet.recurringBills.find((entry) => entry.id === bill.id)
    console.log(
      `   setBill          -> "${updated?.desc}" ${updated?.amount} ${updated?.frequency} ${updated?.currency}` +
        `  (monthly equivalent ${(updated ? updated.amount / 12 : 0).toFixed(2)})`,
    )

    const usd = await mutatePersonalFinance({ type: 'setTotalsCurrency', currency: 'USD' })
    console.log(`   setTotalsCurrency-> ${usd.totalsCurrency}`)

    const goal = await mutatePersonalFinance({
      type: 'setGoal',
      title: 'Probe Goal',
      targetAmount: 250000,
      currency: 'USD',
    })
    console.log(
      `   setGoal          -> "${goal.goal.title}" ${goal.goal.targetAmount} ${goal.goal.currency}`,
    )

    console.log('\n-- rejected edits')
    await expectRejected('blank description', () =>
      mutatePersonalFinance({ type: 'setEntry', category: 'cash', id: row.id, desc: '   ' }),
    )
    await expectRejected('unknown row', () =>
      mutatePersonalFinance({ type: 'setEntry', category: 'debt', id: 'nope', amount: 1 }),
    )
    await expectRejected('unknown bill', () =>
      mutatePersonalFinance({ type: 'setBill', id: 'nope', amount: 1 }),
    )

    // Fill cash to the cap, then confirm the next add is refused.
    let rows = (await readPersonalFinance()).cash.length
    while (rows < 40) {
      await mutatePersonalFinance({ type: 'addEntry', category: 'cash' })
      rows += 1
    }
    await expectRejected('adding beyond the row cap', () =>
      mutatePersonalFinance({ type: 'addEntry', category: 'cash' }),
    )

    const removed = await mutatePersonalFinance({
      type: 'removeEntry',
      category: 'cash',
      id: row.id,
    })
    console.log(`\n   removeEntry      -> ${removed.cash.length} cash row(s) left`)
    const billsLeft = await mutatePersonalFinance({ type: 'removeBill', id: bill.id })
    console.log(`   removeBill       -> ${billsLeft.recurringBills.length} bill(s) left`)

    console.log(`\nscratch cleaned: ${scratch}\n`)
  } finally {
    if (realAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = realAppData
    resetStoreCache()
    rmSync(scratch, { recursive: true, force: true })
  }
}

await report()
await exerciseWrites()
