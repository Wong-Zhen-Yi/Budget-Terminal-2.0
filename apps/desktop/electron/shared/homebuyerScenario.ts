/** Fixed-rate, fully amortizing principal and interest; excludes ownership costs. */
export function monthlyMortgage(principal: number, annualRate: number, years: number): number | null {
  if (![principal, annualRate, years].every(Number.isFinite) || principal < 0 || annualRate < 0 || years <= 0) return null
  const payments = years * 12
  const rate = annualRate / 1200
  if (!rate) return principal / payments
  return principal * rate / -Math.expm1(-payments * Math.log1p(rate))
}

/** Hold the monthly P&I budget and down-payment percentage constant. */
export function equivalentHomePrice(price: number, downPercent: number, rate: number, nextRate: number, years: number): number | null {
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(downPercent) || downPercent < 0 || downPercent >= 100) return null
  const payment = monthlyMortgage(price * (1 - downPercent / 100), rate, years)
  const perDollar = monthlyMortgage(1 - downPercent / 100, nextRate, years)
  return payment === null || perDollar === null || perDollar <= 0 ? null : payment / perDollar
}
