import { useState } from 'react'
import { FOREX_CURRENCIES, forexConversionRate } from '@shared/forex'
import type { ForexCurrency, ForexQuoteRow } from '@shared/forex'
import { Panel } from '@/components/ui/Panel'
import { Select } from '@/components/ui/Select'

const currencies = FOREX_CURRENCIES.map((currency) => ({ value: currency, label: currency }))
const formatRate = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 7 })

export function CurrencyConverter({ quotes }: { quotes: readonly ForexQuoteRow[] }) {
  const [from, setFrom] = useState<ForexCurrency>('SGD')
  const [to, setTo] = useState<ForexCurrency>('USD')
  const [amount, setAmount] = useState('1')
  const rate = forexConversionRate(quotes, from, to)
  const value = amount === '' ? NaN : Number(amount)
  const invalidAmount = amount !== '' && (!Number.isFinite(value) || value < 0)
  const converted = value * (rate ?? NaN)
  const result = !invalidAmount && Number.isFinite(converted)
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency: to, currencyDisplay: 'code' }).format(converted)
    : '—'

  return (
    <Panel title="Currency converter" className="shrink-0 lg:col-start-2 lg:row-start-1">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-x-2 gap-y-2 p-2">
        <label className="grid gap-1 text-2xs text-text-muted">
          From
          <Select value={from} options={currencies} onChange={setFrom} />
        </label>
        <button
          type="button"
          aria-label="Swap currencies"
          title="Swap currencies"
          className="no-drag h-7 w-8 border border-border-strong bg-surface-raised text-sm text-text hover:border-accent-dim focus-visible:border-accent focus-visible:outline-none"
          onClick={() => { setFrom(to); setTo(from) }}
        >
          ⇄
        </button>
        <label className="grid gap-1 text-2xs text-text-muted">
          To
          <Select value={to} options={currencies} onChange={setTo} />
        </label>
        <label className="grid gap-1 text-2xs text-text-muted">
          Amount
          <input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={invalidAmount}
            className="no-drag h-7 min-w-0 w-full border border-border-strong bg-surface-raised px-1 font-mono text-xs text-text outline-none hover:border-accent-dim focus:border-accent aria-invalid:border-warn"
          />
        </label>
        <div className="col-span-2 grid min-w-0 gap-1 text-2xs text-text-muted">
          Converted amount
          <output aria-label="Converted amount" title={result} className="block h-7 truncate border border-border bg-bg px-2 font-mono text-sm font-semibold leading-[26px] text-text">{result}</output>
        </div>
        <p className="col-span-full text-2xs tabular-nums text-text-muted">
          {rate === undefined ? 'Rate unavailable' : `1 ${from} = ${formatRate.format(rate)} ${to}`}
        </p>
      </div>
    </Panel>
  )
}
