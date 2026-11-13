import { useState } from 'react'
import { equivalentHomePrice, monthlyMortgage } from '@shared/homebuyerScenario'
import { api } from '@/api/client'
import { currency } from '@/lib/format'

export function BuyerEconomics() {
  const [price, setPrice] = useState(400000)
  const [down, setDown] = useState(20)
  const [rate, setRate] = useState(7)
  const [years, setYears] = useState(30)
  const valid = Number.isFinite(price) && price > 0 && Number.isFinite(down) && down >= 0 && down < 100 && Number.isFinite(rate) && rate >= 0 && rate <= 20
  const principal = valid ? price * (1 - down / 100) : null
  const payment = principal === null ? null : monthlyMortgage(principal, rate, years)
  const rateSteps = [Math.max(0, rate - 1), rate, rate + 1]
  const steps = rateSteps.map(value => ({ rate: value, payment: principal === null ? null : monthlyMortgage(principal, value, years) }))
  const maximum = Math.max(1, ...steps.map(step => step.payment ?? 0))
  const sameBudget = valid ? equivalentHomePrice(price, down, rate, rate + 1, years) : null
  return <section className="hb-buyer" aria-labelledby="hb-buyer-title">
    <header><span className="hb-kicker">01 / The buyer</span><h2 id="hb-buyer-title">What does the buyer pay?</h2><p>Mortgage sensitivity · illustrative inputs</p></header>
    <div className="hb-payment"><output aria-label="Monthly principal and interest">{currency(payment)}</output><span>per month · principal & interest</span></div>
    <div className="hb-scenario-fields">
      <label>Home price · USD<input type="number" aria-label="Scenario home price" min="1" max="10000000" step="10000" value={Number.isFinite(price) ? price : ''} onChange={event => setPrice(event.target.valueAsNumber)} /></label>
      <label>Down payment · %<input type="number" aria-label="Scenario down payment" min="0" max="99" step="1" value={Number.isFinite(down) ? down : ''} onChange={event => setDown(event.target.valueAsNumber)} /></label>
      <label>Fixed rate · %<input type="number" aria-label="Scenario mortgage rate" min="0" max="20" step="0.25" value={Number.isFinite(rate) ? rate : ''} onChange={event => setRate(event.target.valueAsNumber)} /></label>
    </div>
    <div className="hb-term"><span>Loan term</span>{[15, 30].map(value => <button type="button" key={value} aria-pressed={years === value} onClick={() => setYears(value)}>{value} years</button>)}</div>
    <div className="hb-financed"><span>Amount financed</span><b>{currency(principal)}</b></div>
    <div className="hb-rate-ladder" aria-label="Mortgage rate sensitivity">{steps.map((step, index) => <div key={index} data-rate-step={index}><span>{Number.isFinite(step.rate) ? step.rate.toFixed(2) : '--'}%</span><div><i style={{ width: `${(step.payment ?? 0) / maximum * 100}%` }} /></div><b>{currency(step.payment)}</b></div>)}</div>
    <div className="hb-buying-power"><span>At +1 percentage point, same P&I budget buys</span><strong>{currency(sameBudget)}</strong><small>{sameBudget !== null && price > 0 ? `${((sameBudget / price - 1) * 100).toFixed(1)}% home price · same down-payment percentage` : 'Enter a valid price, down payment and rate.'}</small></div>
    <p className="hb-method">Scenario, not a lender quote. Excludes taxes, insurance, mortgage insurance, HOA fees and closing costs.</p>
    <button type="button" className="hb-source" onClick={() => void api.openExternal('https://www.consumerfinance.gov/ask-cfpb/how-do-mortgage-lenders-calculate-monthly-payments-en-1965/')}>Payment method · CFPB ↗</button>
  </section>
}
