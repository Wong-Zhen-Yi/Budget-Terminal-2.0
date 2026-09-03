import { useMemo, useState } from 'react'

import {
  priceAfterYieldShift,
  valueFixedRateBond,
  type BondPaymentFrequency,
  type FixedRateBondTerms,
} from '@shared/bonds'
import { Button } from '@/components/ui/Button'
import { Chip, type ChipTone } from '@/components/ui/Chip'
import { NumberInput } from '@/components/ui/NumberInput'
import { Panel } from '@/components/ui/Panel'
import { Select } from '@/components/ui/Select'
import { currency, decimals, plainPercent, signedCurrencyPrecise } from '@/lib/format'

const FREQUENCY_OPTIONS = [
  { value: '1', label: 'Annual' },
  { value: '2', label: 'Semiannual' },
  { value: '4', label: 'Quarterly' },
  { value: '12', label: 'Monthly' },
] as const

const SHIFTS = [-100, -50, 0, 50, 100] as const

function InputRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="grid grid-cols-[1fr_132px] items-center gap-2 border-b border-border/60 px-2 py-1.5">
      <span className="text-2xs text-text-muted">{label}</span>
      {children}
    </label>
  )
}

function ResultTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex min-w-0 flex-col border border-border bg-surface-raised px-2 py-2">
      <span className="truncate text-2xs text-text-muted">{label}</span>
      <span className="num truncate text-sm font-semibold text-text">{value}</span>
      <span className="truncate text-[10px] text-text-dim">{sub}</span>
    </div>
  )
}

function positionTone(position: 'discount' | 'par' | 'premium'): ChipTone {
  if (position === 'par') return 'accent'
  return position === 'premium' ? 'up' : 'warn'
}

export function BondCalculator({ marketYield }: { marketYield: number | null }) {
  const [terms, setTerms] = useState<FixedRateBondTerms>({
    faceValue: 1000,
    couponRatePct: 4,
    yieldPct: 4.25,
    maturityYears: 10,
    paymentsPerYear: 2,
  })

  const valuation = useMemo(() => valueFixedRateBond(terms), [terms])
  const sensitivity = useMemo(
    () => SHIFTS.map((shift) => ({
      shift,
      price: priceAfterYieldShift(terms, shift),
    })),
    [terms],
  )

  const update = <Key extends keyof FixedRateBondTerms>(
    key: Key,
    value: FixedRateBondTerms[Key],
  ) => setTerms((current) => ({ ...current, [key]: value }))

  const useMarket = () => {
    if (marketYield === null) return
    setTerms((current) => ({
      ...current,
      couponRatePct: marketYield,
      yieldPct: marketYield,
      maturityYears: 10,
      paymentsPerYear: 2,
    }))
  }

  return (
    <Panel
      title="Fixed-rate bond calculator"
      className="min-h-[1100px] xl:min-h-[390px]"
      actions={
        <Button onClick={useMarket} disabled={marketYield === null}>
          Use 10Y market yield
        </Button>
      }
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-12">
        <div className="border-b border-border xl:col-span-4 xl:border-r xl:border-b-0">
          <InputRow label="Face value">
            <NumberInput
              aria-label="Face value"
              value={terms.faceValue}
              onCommit={(value) => update('faceValue', value)}
              min={1}
              max={100_000_000}
              decimals={0}
              prefix="$"
            />
          </InputRow>
          <InputRow label="Annual coupon rate">
            <NumberInput
              aria-label="Annual coupon rate"
              value={terms.couponRatePct}
              onCommit={(value) => update('couponRatePct', value)}
              min={0}
              max={100}
              decimals={2}
              suffix="%"
            />
          </InputRow>
          <InputRow label="Yield to maturity">
            <NumberInput
              aria-label="Yield to maturity"
              value={terms.yieldPct}
              onCommit={(value) => update('yieldPct', value)}
              min={-20}
              max={100}
              decimals={2}
              suffix="%"
            />
          </InputRow>
          <InputRow label="Years to maturity">
            <NumberInput
              aria-label="Years to maturity"
              value={terms.maturityYears}
              onCommit={(value) => update('maturityYears', value)}
              min={0.08}
              max={100}
              decimals={2}
              suffix="yr"
            />
          </InputRow>
          <InputRow label="Coupon frequency">
            <Select
              aria-label="Coupon frequency"
              value={String(terms.paymentsPerYear)}
              options={FREQUENCY_OPTIONS}
              onChange={(value) => update('paymentsPerYear', Number(value) as BondPaymentFrequency)}
              className="w-[132px]"
            />
          </InputRow>
          <p className="px-2 py-2 text-[10px] leading-4 text-text-dim">
            Clean theoretical price. Maturity snaps to the nearest full coupon period;
            accrued interest, tax, credit and call features are excluded.
          </p>
        </div>

        <div className="flex min-h-0 flex-col gap-2 border-b border-border p-2 xl:col-span-5 xl:border-r xl:border-b-0">
          <div className="flex items-start gap-3 border-b border-border pb-2">
            <div className="min-w-0 flex-1">
              <p className="text-2xs text-text-muted">Calculated clean price</p>
              <p className="num truncate text-[28px] leading-8 font-bold text-text">
                {currency(valuation.price)}
              </p>
              <p className="text-2xs text-text-muted">
                {currency(valuation.price / terms.faceValue * 100, 2)} per $100 face
              </p>
            </div>
            <Chip tone={positionTone(valuation.pricePosition)} className="mt-1 uppercase">
              {valuation.pricePosition}
            </Chip>
          </div>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            <ResultTile
              label="Current yield"
              value={plainPercent(valuation.currentYieldPct, 2)}
              sub={`${currency(valuation.annualCoupon)} annual coupon`}
            />
            <ResultTile
              label="Coupon payment"
              value={currency(valuation.couponPayment)}
              sub={`${valuation.periods} total payments`}
            />
            <ResultTile
              label="Modified duration"
              value={`${decimals(valuation.modifiedDurationYears, 2)} yr`}
              sub={`Macaulay ${decimals(valuation.macaulayDurationYears, 2)} yr`}
            />
            <ResultTile
              label="DV01"
              value={currency(valuation.dv01, 4)}
              sub="price move per 1 bp"
            />
            <ResultTile
              label="Convexity"
              value={decimals(valuation.convexity, 2)}
              sub="curvature adjustment"
            />
            <ResultTile
              label="Lifetime interest"
              value={currency(valuation.totalInterest)}
              sub={`${decimals(valuation.effectiveMaturityYears, 2)} effective years`}
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-col xl:col-span-3">
          <div className="border-b border-border px-2 py-2">
            <p className="text-2xs font-semibold text-text">Parallel yield shock</p>
            <p className="text-[10px] text-text-dim">Exact repricing, not a duration estimate</p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {sensitivity.map(({ shift, price }) => {
              const change = price - valuation.price
              return (
                <div
                  key={shift}
                  className={`grid grid-cols-[72px_1fr_1fr] gap-2 border-b border-border/60 px-2 py-2 text-2xs ${
                    shift === 0 ? 'bg-surface-raised' : ''
                  }`}
                >
                  <span className={shift < 0 ? 'text-up' : shift > 0 ? 'text-down' : 'text-text-muted'}>
                    {shift > 0 ? '+' : ''}{shift} bp
                  </span>
                  <span className="num text-right text-text">{currency(price)}</span>
                  <span className={`num text-right ${change > 0 ? 'text-up' : change < 0 ? 'text-down' : 'text-text-dim'}`}>
                    {change === 0 ? currency(change) : signedCurrencyPrecise(change)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Panel>
  )
}
