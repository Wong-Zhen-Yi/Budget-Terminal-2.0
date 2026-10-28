import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type {
  Envelope,
  OptionPosition,
  PersonalFinanceMutation,
  PersonalFinancePayload,
  Portfolio,
} from '@shared/contract'
import { api, queryKeys } from '@/api/client'
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
  type FinanceBook,
} from '@shared/financeMath'
import { useFinanceMutation, useFxRate, usePersonalFinance } from '@/api/financeQueries'
import { useOptionQuotes } from '@/api/portfolioQueries'
import { usePortfolio, useQuotes } from '@/api/queries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { BillsPanel } from '@/components/finance/BillsPanel'
import { EntriesPanel } from '@/components/finance/EntriesPanel'
import { GoalPanel } from '@/components/finance/GoalPanel'
import { SilosPanel } from '@/components/finance/SilosPanel'
import { TotalsPanel } from '@/components/finance/TotalsPanel'
import { Button } from '@/components/ui/Button'
import { PrivateNumber } from '@/components/ui/NumberPrivacy'
import { money, moneyExplicit } from '@/lib/format'
import { easeOutCubic, useAnimatedProgress } from '@/lib/useAnimatedProgress'

const DONUT_ANIMATION_MS = 1000
const GOAL_ANIMATION_MS = 900

const emptyBook: PersonalFinancePayload = {
  cash: [],
  debt: [],
  recurringBills: [],
  totalsCurrency: 'SGD',
  goal: { title: 'Net Worth Goal', targetAmount: 0, currency: 'SGD' },
  sourcePath: '',
}

/** `_p6_update_debt_total`: the footer folds in brokerage margin, which is USD. */
function debtFooter(debtTotal: number, margin: number, rate: number | null) {
  if (margin <= 0) return <>Debt total: <PrivateNumber>{money(debtTotal, 'SGD')}</PrivateNumber></>
  if (!validRate(rate)) {
    return <>Debt total: <PrivateNumber>{money(debtTotal, 'SGD')}</PrivateNumber> + <PrivateNumber>{moneyExplicit(margin, 'USD')}</PrivateNumber> margin</>
  }
  const combined = debtTotal + margin * rate
  return <>Debt total: <PrivateNumber>{money(combined, 'SGD')}</PrivateNumber> (incl. <PrivateNumber>{moneyExplicit(margin, 'USD')}</PrivateNumber> margin)</>
}

export function PersonalFinancePage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const financeQuery = usePersonalFinance()
  const portfolioQuery = usePortfolio()
  const fxQuery = useFxRate()
  const mutate = useFinanceMutation()
  const queryClient = useQueryClient()
  const pendingWrites = useRef(new Set<Promise<Envelope<PersonalFinancePayload>>>())
  const lastWriteError = useRef('')

  const finance = financeQuery.data?.data ?? emptyBook
  const portfolios = useMemo<Portfolio[]>(
    // The Combined aggregate restates the same holdings; counting it would double
    // every brokerage silo.
    () => (portfolioQuery.data?.data.portfolios ?? []).filter((entry) => !entry.readOnly),
    [portfolioQuery.data],
  )

  const tickers = useMemo(
    () => [...new Set(portfolios.flatMap((entry) => entry.tickers))],
    [portfolios],
  )
  const quotesQuery = useQuotes(tickers)

  // Options are only worth a round trip when the tracker actually holds something.
  const optionPositions = useMemo(
    () =>
      portfolios.flatMap((entry) =>
        entry.options.map((option) => ({
          rowId: `${entry.id}:${option.rowId}`,
          ticker: option.ticker,
          expiry: option.expiry,
          strike: option.strike,
          strategy: option.strategy,
        })),
      ),
    [portfolios],
  )
  const optionQuotesQuery = useOptionQuotes(optionPositions, optionPositions.length > 0)

  const rate = fxQuery.data?.data.usdSgd ?? null
  const display = finance.totalsCurrency

  /** Live marks folded into the stored contracts, so option equity can be valued. */
  const valued = useMemo<Portfolio[]>(() => {
    const quotes = optionQuotesQuery.data?.data.quotes ?? {}
    return portfolios.map((entry) => ({
      ...entry,
      options: entry.options.map((option): OptionPosition => {
        const live = quotes[`${entry.id}:${option.rowId}`]
        return live ? { ...option, ...live, hasMarketMark: true } : { ...option, hasMarketMark: false }
      }),
    }))
  }, [portfolios, optionQuotesQuery.data])

  const breakdown = useMemo(
    () => portfolioBreakdown(valued, quotesQuery.data?.data.holdings ?? {}),
    [valued, quotesQuery.data],
  )

  const book = useMemo<FinanceBook>(
    () => ({
      cash: finance.cash,
      debt: finance.debt,
      recurringBills: finance.recurringBills,
      goal: finance.goal,
    }),
    [finance],
  )

  const cashTotal = useMemo(() => categoryTotal(finance.cash), [finance.cash])
  const debtTotal = useMemo(() => categoryTotal(finance.debt), [finance.debt])
  const margin = useMemo(() => marginTotal(breakdown), [breakdown])
  const bills = useMemo(
    () => billTotals(finance.recurringBills, display, rate),
    [finance.recurringBills, display, rate],
  )
  const slices = useMemo(
    () => totalsSeries(book, breakdown, display, rate),
    [book, breakdown, display, rate],
  )
  const valuation = useMemo(() => goalNetWorth(book, breakdown, display, rate), [book, breakdown, display, rate])
  const netWorth = valuation.available ? valuation.value : totalsCenter(slices)
  const goal = useMemo(
    () => goalNetWorth(book, breakdown, finance.goal.currency, rate),
    [book, breakdown, finance.goal.currency, rate],
  )
  const bars = useMemo(
    () => siloBars(book, breakdown, display, rate),
    [book, breakdown, display, rate],
  )

  const donut = useAnimatedProgress(DONUT_ANIMATION_MS)
  const ring = useAnimatedProgress(GOAL_ANIMATION_MS, easeOutCubic)

  // Both charts play themselves in once per visit, like `_p6_on_show` does.
  const autoplayed = useRef(false)
  const replayDonut = donut.replay
  const replayRing = ring.replay
  useEffect(() => {
    if (autoplayed.current) return
    autoplayed.current = true
    replayDonut()
    replayRing()
  }, [replayDonut, replayRing])

  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    onStatusChange(
      [
        { label: 'Finance', envelope: financeQuery.data, loading: financeQuery.isFetching, error: financeQuery.error, enabled: financeQuery.isEnabled },
        { label: 'Holdings', envelope: portfolioQuery.data, loading: portfolioQuery.isFetching, error: portfolioQuery.error, enabled: portfolioQuery.isEnabled },
        { label: 'Quotes', envelope: quotesQuery.data, loading: quotesQuery.isFetching, error: quotesQuery.error, enabled: quotesQuery.isEnabled },
        { label: 'Option marks', envelope: optionQuotesQuery.data, loading: optionQuotesQuery.isFetching, error: optionQuotesQuery.error, enabled: optionPositions.length > 0 },
        { label: 'FX', envelope: fxQuery.data, loading: fxQuery.isFetching, error: fxQuery.error, enabled: fxQuery.isEnabled },
      ],
      finance.sourcePath,
    )
  }, [
    onStatusChange,
    optionQuotesQuery.data,
    optionQuotesQuery.isFetching,
    optionQuotesQuery.error,
    optionPositions.length,
    financeQuery.error,
    portfolioQuery.error,
    quotesQuery.error,
    fxQuery.error,
    financeQuery.isEnabled,
    portfolioQuery.isEnabled,
    quotesQuery.isEnabled,
    fxQuery.isEnabled,
    finance.sourcePath,
    financeQuery.data,
    financeQuery.isFetching,
    portfolioQuery.data,
    portfolioQuery.isFetching,
    quotesQuery.data,
    quotesQuery.isFetching,
    fxQuery.data,
    fxQuery.isFetching,
  ])

  /** Every edit goes through here so a refused write surfaces in one place. */
  const send = useCallback(
    async (mutation: PersonalFinanceMutation) => {
      setSaveStatus('')
      lastWriteError.current = ''
      const write = mutate(mutation)
      pendingWrites.current.add(write)
      try {
        const result = await write
        if (result.meta.failureReason) lastWriteError.current = result.meta.failureReason
        setError(result.meta.failureReason ?? '')
        return result
      } finally {
        pendingWrites.current.delete(write)
      }
    },
    [mutate],
  )

  const save = useCallback(async () => {
    if (saving) return
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setSaving(true)
    setSaveStatus('')
    try {
      await Promise.all([...pendingWrites.current])
      if (lastWriteError.current) throw new Error(lastWriteError.current)
      const current = await api.personalFinance()
      if (current.meta.freshness === 'failed') {
        throw new Error(current.meta.failureReason ?? 'Could not read personal finance.')
      }
      queryClient.setQueryData(queryKeys.personalFinance, current)
      const check = await api.verifyStoredData({ kind: 'personalFinance', expected: current.data })
      if (!check.data) throw new Error('Personal finance does not match the AppData file. Please retry Save.')
      setError('')
      setSaveStatus('Saved and verified in AppData.')
    } catch (cause) {
      setSaveStatus(cause instanceof Error ? cause.message : 'Could not verify the AppData file.')
    } finally {
      setSaving(false)
    }
  }, [queryClient, saving])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-center gap-2">
        <h1 className="text-sm font-semibold text-text">Personal Finance</h1>
        <Button className="ml-auto" onClick={() => void save()} disabled={saving}>
          {saving ? 'Checking...' : 'Save'}
        </Button>
        {saveStatus ? <span role="status" className={`text-2xs ${saveStatus.startsWith('Saved') ? 'text-up' : 'text-down'}`}>{saveStatus}</span> : null}
      </div>
      {error ? (
        <p className="shrink-0 border border-down bg-down-bg px-2 py-1 text-2xs text-down">
          {error}
        </p>
      ) : null}

      {/* Weights rather than even columns: Cash and Debt need room for the header's
          two buttons, Bills for four columns, Totals for the donut and its legend. */}
      <div className="flex min-h-0 flex-[2] gap-2">
        <EntriesPanel
          title="Cash (SGD)"
          className="min-h-0 flex-[62] min-w-[16rem]"
          rows={finance.cash}
          addVariant="positive"
          footer={<>Cash total: <PrivateNumber>{money(cashTotal, 'SGD')}</PrivateNumber></>}
          onAdd={() => void send({ type: 'addEntry', category: 'cash' })}
          onRemove={(id) => void send({ type: 'removeEntry', category: 'cash', id })}
          onSetDesc={(id, desc) => void send({ type: 'setEntry', category: 'cash', id, desc })}
          onSetAmount={(id, amount) => void send({ type: 'setEntry', category: 'cash', id, amount })}
        />
        <EntriesPanel
          title="Debt (SGD)"
          className="min-h-0 flex-[62] min-w-[16rem]"
          rows={finance.debt}
          addVariant="danger"
          footer={debtFooter(debtTotal, margin, rate)}
          onAdd={() => void send({ type: 'addEntry', category: 'debt' })}
          onRemove={(id) => void send({ type: 'removeEntry', category: 'debt', id })}
          onSetDesc={(id, desc) => void send({ type: 'setEntry', category: 'debt', id, desc })}
          onSetAmount={(id, amount) => void send({ type: 'setEntry', category: 'debt', id, amount })}
        />
        <BillsPanel
          className="min-h-0 flex-[88] min-w-[22rem]"
          rows={finance.recurringBills}
          totals={bills}
          display={display}
          onAdd={() => void send({ type: 'addBill' })}
          onRemove={(id) => void send({ type: 'removeBill', id })}
          onSetDesc={(id, desc) => void send({ type: 'setBill', id, desc })}
          onSetAmount={(id, amount) => void send({ type: 'setBill', id, amount })}
          onSetFrequency={(id, frequency) => void send({ type: 'setBill', id, frequency })}
          onSetCurrency={(id, currency) => void send({ type: 'setBill', id, currency })}
        />
        <TotalsPanel
          className="min-h-0 flex-[55] min-w-[18rem]"
          slices={slices}
          total={netWorth}
          complete={valuation.available}
          incompleteReason={valuation.reason}
          display={display}
          fx={fxQuery.data?.data}
          fxLoading={fxQuery.isFetching}
          fxError={fxQuery.data?.meta.failureReason ?? ''}
          animationProgress={donut.progress}
          onReplay={replayDonut}
          onSetCurrency={(currency) => void send({ type: 'setTotalsCurrency', currency })}
        />
        <GoalPanel
          className="min-h-0 flex-[51] min-w-[16rem]"
          goal={finance.goal}
          current={goal.value}
          available={goal.available}
          unavailableReason={goal.reason}
          animationProgress={ring.progress}
          onSetTitle={(title) => void send({ type: 'setGoal', title })}
          onSetTarget={(targetAmount) => void send({ type: 'setGoal', targetAmount })}
          onSetCurrency={(currency) => void send({ type: 'setGoal', currency })}
        />
      </div>

      <SilosPanel className="min-h-0 flex-1" bars={bars} display={display} complete={valuation.available} />
    </div>
  )
}
