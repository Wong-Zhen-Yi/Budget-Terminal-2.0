/**
 * Verify the fixed-rate calculator behind the Bonds page.
 *
 *   npm run probe:bonds
 */
import assert from 'node:assert/strict'

import {
  priceAfterYieldShift,
  valueFixedRateBond,
  type FixedRateBondTerms,
} from '../electron/shared/bonds.js'

function near(actual: number, expected: number, tolerance: number, label: string): void {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, received ${actual}`,
  )
}

const parTerms: FixedRateBondTerms = {
  faceValue: 1000,
  couponRatePct: 5,
  yieldPct: 5,
  maturityYears: 5,
  paymentsPerYear: 2,
}

const par = valueFixedRateBond(parTerms)
near(par.price, 1000, 0.000001, 'coupon equal to yield prices at par')
near(par.currentYieldPct, 5, 0.000001, 'par current yield')
near(par.totalInterest, 250, 0.000001, 'lifetime coupon interest')
assert.equal(par.periods, 10)
assert.equal(par.pricePosition, 'par')
assert(par.modifiedDurationYears > 4 && par.modifiedDurationYears < 5)
assert(par.dv01 > 0)
assert(par.convexity > 0)

const premium = valueFixedRateBond({ ...parTerms, couponRatePct: 6, yieldPct: 4 })
const discount = valueFixedRateBond({ ...parTerms, couponRatePct: 3, yieldPct: 6 })
assert(premium.price > parTerms.faceValue, 'coupon above yield should price at a premium')
assert(discount.price < parTerms.faceValue, 'coupon below yield should price at a discount')
assert.equal(premium.pricePosition, 'premium')
assert.equal(discount.pricePosition, 'discount')

const down100 = priceAfterYieldShift(parTerms, -100)
const up100 = priceAfterYieldShift(parTerms, 100)
assert(down100 > par.price, 'price should rise when yield falls')
assert(up100 < par.price, 'price should fall when yield rises')

const zeroCoupon = valueFixedRateBond({
  faceValue: 1000,
  couponRatePct: 0,
  yieldPct: 5,
  maturityYears: 10,
  paymentsPerYear: 2,
})
near(zeroCoupon.price, 1000 / 1.025 ** 20, 0.000001, 'zero-coupon present value')
near(zeroCoupon.macaulayDurationYears, 10, 0.000001, 'zero-coupon Macaulay duration')

const fractional = valueFixedRateBond({ ...parTerms, maturityYears: 1.2 })
assert.equal(fractional.periods, 2, 'fractional maturity snaps to a full coupon period')
assert.equal(fractional.effectiveMaturityYears, 1)

assert.throws(
  () => valueFixedRateBond({ ...parTerms, faceValue: 0 }),
  /Face value must be greater than zero/,
)
assert.throws(
  () => valueFixedRateBond({ ...parTerms, paymentsPerYear: 3 as 2 }),
  /Payment frequency/,
)

console.log('Bonds probe passed')
console.log(`  par price       ${par.price.toFixed(2)}`)
console.log(`  modified duration ${par.modifiedDurationYears.toFixed(3)} years`)
console.log(`  DV01            ${par.dv01.toFixed(4)}`)
console.log(`  -100 bp / +100 bp ${down100.toFixed(2)} / ${up100.toFixed(2)}`)
