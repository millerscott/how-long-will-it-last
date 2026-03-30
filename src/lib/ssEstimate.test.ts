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
//   PIA  = 90% of first $1,226 + 32% of $1,226–$7,391 + 15% above $7,391
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
    it('first bend point only — salary $14,712/yr (AIME = $1,226/mo)', () => {
      // PIA = 1,226 × 0.90 = 1,103.40 → annual = round(1,103.40 × 12) = 13,241
      expectDollars(estimateSsBenefit(14_712, 67), 13_241)
    })

    it('spans first and second bend points — salary $60,000/yr (AIME = $5,000/mo)', () => {
      // PIA = 1,226×0.90 + (5,000−1,226)×0.32 = 1,103.40 + 1,207.68 = 2,311.08
      // Annual = round(2,311.08 × 12) = 27,733
      expectDollars(estimateSsBenefit(60_000, 67), 27_733)
    })

    it('spans all three bend points — salary $120,000/yr (AIME = $10,000/mo)', () => {
      // PIA = 1,226×0.90 + 6,165×0.32 + 2,609×0.15 = 1,103.40 + 1,972.80 + 391.35 = 3,467.55
      // Annual = round(3,467.55 × 12) = 41,611
      expectDollars(estimateSsBenefit(120_000, 67), 41_611)
    })
  })

  describe('early claiming reductions (salary $60,000)', () => {
    it('claims at 62 — maximum early reduction (30%)', () => {
      // 3 yrs × 6.67% + 2 yrs × 5% = 20% + 10% = 30% reduction
      // Monthly = 2,311.08 × 0.70 = 1,617.756 → annual = round(19,413.07) = 19,413
      expectDollars(estimateSsBenefit(60_000, 62), 19_413)
    })

    it('claims at 65 — 2 years early (13.33% reduction)', () => {
      // 2 yrs × 6.67% = 13.33% reduction → adjustment = 13/15
      // Monthly = 2,311.08 × 13/15 = 2,002.936 → annual = round(24,035.23) = 24,035
      expectDollars(estimateSsBenefit(60_000, 65), 24_035)
    })
  })

  describe('delayed claiming credits (salary $60,000)', () => {
    it('claims at 68 — 1 year late (+8%)', () => {
      // Monthly = 2,311.08 × 1.08 = 2,495.966 → annual = round(29,951.60) = 29,952
      expectDollars(estimateSsBenefit(60_000, 68), 29_952)
    })

    it('claims at 70 — maximum delay (+24%)', () => {
      // Monthly = 2,311.08 × 1.24 = 2,865.739 → annual = round(34,388.87) = 34,389
      expectDollars(estimateSsBenefit(60_000, 70), 34_389)
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
