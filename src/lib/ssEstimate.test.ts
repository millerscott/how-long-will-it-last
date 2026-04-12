import { describe, it, expect } from 'vitest'
import { estimateSsBenefit } from './ssEstimate'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert two integer dollar amounts are exactly equal. */
function expectDollars(actual: number, expected: number) {
  expect(actual).toBe(expected)
}

// ---------------------------------------------------------------------------
// Reference values computed from the 2026 PIA formula:
//   AIME = annualSalary / 12
//   PIA  = 90% of first $1,286 + 32% of $1,286–$7,749 + 15% above $7,749
//   FRA  = 67
//   Early reduction: −6.67%/yr for first 3 yrs, −5%/yr beyond
//   Late credit:     +8%/yr up to age 70 (max +24%)
//   Returns Math.round(monthlyPia × adjustment × 12)
// ---------------------------------------------------------------------------

describe('estimateSsBenefit', () => {
  it('returns 0 for zero salary', () => {
    expectDollars(estimateSsBenefit(0, 67), 0)
  })

  it('returns 0 for negative salary', () => {
    expectDollars(estimateSsBenefit(-50_000, 67), 0)
  })

  describe('PIA calculation (claim at FRA = 67)', () => {
    it('first bend point only — salary $15,432/yr (AIME = $1,286/mo)', () => {
      // PIA = 1,286 × 0.90 = 1,157.40 → annual = round(1,157.40 × 12) = 13,889
      expectDollars(estimateSsBenefit(15_432, 67), 13_889)
    })

    it('spans first and second bend points — salary $60,000/yr (AIME = $5,000/mo)', () => {
      // PIA = 1,286×0.90 + (5,000−1,286)×0.32 = 1,157.40 + 1,188.48 = 2,345.88
      // Annual = round(2,345.88 × 12) = 28,151
      expectDollars(estimateSsBenefit(60_000, 67), 28_151)
    })

    it('spans all three bend points — salary $120,000/yr (AIME = $10,000/mo)', () => {
      // PIA = 1,286×0.90 + (7,749−1,286)×0.32 + (10,000−7,749)×0.15
      //     = 1,157.40 + 2,068.16 + 337.65 = 3,563.21
      // Annual = round(3,563.21 × 12) = 42,759
      expectDollars(estimateSsBenefit(120_000, 67), 42_759)
    })
  })

  describe('early claiming reductions (salary $60,000)', () => {
    it('claims at 62 — maximum early reduction (30%)', () => {
      // 3 yrs × 6.67% + 2 yrs × 5% = 20% + 10% = 30% reduction
      // Monthly = 2,345.88 × 0.70 = 1,642.116 → annual = round(19,705.39) = 19,705
      expectDollars(estimateSsBenefit(60_000, 62), 19_705)
    })

    it('claims at 65 — 2 years early (13.33% reduction)', () => {
      // 2 yrs × 6.67% = 13.33% reduction → adjustment = 13/15
      // Monthly = 2,345.88 × 13/15 = 2,033.096 → annual = round(24,397.15) = 24,397
      expectDollars(estimateSsBenefit(60_000, 65), 24_397)
    })
  })

  describe('delayed claiming credits (salary $60,000)', () => {
    it('claims at 68 — 1 year late (+8%)', () => {
      // Monthly = 2,345.88 × 1.08 = 2,533.5504 → annual = round(30,402.60) = 30,403
      expectDollars(estimateSsBenefit(60_000, 68), 30_403)
    })

    it('claims at 70 — maximum delay (+24%)', () => {
      // Monthly = 2,345.88 × 1.24 = 2,908.8912 → annual = round(34,906.69) = 34,907
      expectDollars(estimateSsBenefit(60_000, 70), 34_907)
    })
  })

  describe('age clamping', () => {
    it('claiming age below 62 is treated as 62', () => {
      expect(estimateSsBenefit(60_000, 60)).toBe(estimateSsBenefit(60_000, 62))
    })

    it('claiming age above 70 is treated as 70', () => {
      expect(estimateSsBenefit(60_000, 75)).toBe(estimateSsBenefit(60_000, 70))
    })
  })

  it('higher salary produces higher benefit', () => {
    expect(estimateSsBenefit(100_000, 67)).toBeGreaterThan(estimateSsBenefit(60_000, 67))
  })

  it('later claiming produces higher benefit', () => {
    expect(estimateSsBenefit(60_000, 70)).toBeGreaterThan(estimateSsBenefit(60_000, 67))
    expect(estimateSsBenefit(60_000, 67)).toBeGreaterThan(estimateSsBenefit(60_000, 62))
  })
})
