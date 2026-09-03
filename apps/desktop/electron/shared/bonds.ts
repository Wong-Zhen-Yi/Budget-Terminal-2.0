/**
 * Pure fixed-rate bond maths used by the Bonds page and its headless probe.
 *
 * Rates are expressed as percentages at the boundary (4.25 means 4.25%), while
 * duration is reported in years and DV01 is the price change for one basis point.
 * Coupons and yield compound at the selected payment frequency.
 */

export const BOND_PAYMENT_FREQUENCIES = [1, 2, 4, 12] as const
export type BondPaymentFrequency = (typeof BOND_PAYMENT_FREQUENCIES)[number]

export interface FixedRateBondTerms {
  faceValue: number
  couponRatePct: number
  yieldPct: number
  maturityYears: number
  paymentsPerYear: BondPaymentFrequency
}

export type BondPricePosition = 'discount' | 'par' | 'premium'

export interface FixedRateBondValuation {
  periods: number
  effectiveMaturityYears: number
  couponPayment: number
  annualCoupon: number
  price: number
  currentYieldPct: number
  macaulayDurationYears: number
  modifiedDurationYears: number
  dv01: number
  convexity: number
  totalInterest: number
  pricePosition: BondPricePosition
}

function requireFinite(label: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be a finite number.`)
}

/** Price and risk statistics for a plain-vanilla bond with no accrued interest. */
export function valueFixedRateBond(terms: FixedRateBondTerms): FixedRateBondValuation {
  requireFinite('Face value', terms.faceValue)
  requireFinite('Coupon rate', terms.couponRatePct)
  requireFinite('Yield', terms.yieldPct)
  requireFinite('Maturity', terms.maturityYears)

  if (terms.faceValue <= 0) throw new RangeError('Face value must be greater than zero.')
  if (terms.couponRatePct < 0) throw new RangeError('Coupon rate cannot be negative.')
  if (terms.maturityYears <= 0) throw new RangeError('Maturity must be greater than zero.')
  if (!BOND_PAYMENT_FREQUENCIES.includes(terms.paymentsPerYear)) {
    throw new RangeError('Payment frequency must be annual, semiannual, quarterly or monthly.')
  }

  const frequency = terms.paymentsPerYear
  const periodicYield = terms.yieldPct / 100 / frequency
  if (periodicYield <= -1) throw new RangeError('Yield is too negative for this payment frequency.')

  // The UI accepts fractional years. Snap them to the nearest full coupon period so the
  // cash-flow schedule remains internally consistent and expose that effective maturity.
  const periods = Math.max(1, Math.round(terms.maturityYears * frequency))
  const effectiveMaturityYears = periods / frequency
  const annualCoupon = terms.faceValue * terms.couponRatePct / 100
  const couponPayment = annualCoupon / frequency

  let price = 0
  let durationNumerator = 0
  let convexityNumerator = 0
  for (let period = 1; period <= periods; period += 1) {
    const cashFlow = couponPayment + (period === periods ? terms.faceValue : 0)
    const presentValue = cashFlow / (1 + periodicYield) ** period
    price += presentValue
    durationNumerator += (period / frequency) * presentValue
    convexityNumerator += presentValue * period * (period + 1)
  }

  const macaulayDurationYears = durationNumerator / price
  const modifiedDurationYears = macaulayDurationYears / (1 + periodicYield)
  const convexity = convexityNumerator /
    (price * (1 + periodicYield) ** 2 * frequency ** 2)
  const distanceFromPar = price - terms.faceValue
  const tolerance = Math.max(terms.faceValue * 0.00001, 0.005)

  return {
    periods,
    effectiveMaturityYears,
    couponPayment,
    annualCoupon,
    price,
    currentYieldPct: annualCoupon / price * 100,
    macaulayDurationYears,
    modifiedDurationYears,
    dv01: modifiedDurationYears * price * 0.0001,
    convexity,
    totalInterest: couponPayment * periods,
    pricePosition:
      Math.abs(distanceFromPar) <= tolerance
        ? 'par'
        : distanceFromPar < 0
          ? 'discount'
          : 'premium',
  }
}

/** Reprice one set of terms after a parallel yield shift expressed in basis points. */
export function priceAfterYieldShift(terms: FixedRateBondTerms, shiftBps: number): number {
  requireFinite('Yield shift', shiftBps)
  return valueFixedRateBond({
    ...terms,
    yieldPct: terms.yieldPct + shiftBps / 100,
  }).price
}
