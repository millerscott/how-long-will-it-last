import { describe, it, expect } from 'vitest'
import {
  calculateFederalTax,
  calculateStateTax,
  calculateFicaPerEarner,
  calculateAdditionalMedicare,
  calculateTaxableSocialSecurity,
} from './tax'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert two dollar amounts match to the nearest cent. */
function expectDollars(actual: number, expected: number) {
  expect(actual).toBeCloseTo(expected, 2)
}

// ---------------------------------------------------------------------------
// Federal income tax (2026 brackets, IRS Rev. Proc. 25-32)
// Standard deductions: $16,100 single / $32,200 MFJ
// ---------------------------------------------------------------------------

describe('calculateFederalTax', () => {
  describe('single filer', () => {
    it('returns 0 for zero income', () => {
      expectDollars(calculateFederalTax(0, 'single'), 0)
    })

    it('returns 0 when income is at or below the standard deduction', () => {
      expectDollars(calculateFederalTax(16_100, 'single'), 0)
    })

    it('begins taxing at $1 above the standard deduction', () => {
      // Taxable = 1 → 10% × 1 = $0.10
      expectDollars(calculateFederalTax(16_101, 'single'), 0.10)
    })

    it('taxes only income above the standard deduction', () => {
      // Taxable = 16,200 - 16,100 = 100 → 10% × 100 = $10
      expectDollars(calculateFederalTax(16_200, 'single'), 10)
    })

    it('calculates tax correctly spanning two brackets — $50,000', () => {
      // Taxable = 50,000 - 16,100 = 33,900
      // 10% on 12,400 = 1,240.00
      // 12% on 21,500 (33,900 - 12,400) = 2,580.00
      // Total = 3,820.00
      expectDollars(calculateFederalTax(50_000, 'single'), 3_820)
    })

    it('calculates tax correctly spanning three brackets — $100,000', () => {
      // Taxable = 83,900
      // 10% on 12,400      = 1,240.00
      // 12% on 38,000      = 4,560.00
      // 22% on 33,500      = 7,370.00
      // Total = 13,170.00
      expectDollars(calculateFederalTax(100_000, 'single'), 13_170)
    })

    it('calculates tax at the top (37%) bracket — $700,000', () => {
      // Taxable = 683,900
      // 10% on  12,400  =  1,240.00
      // 12% on  38,000  =  4,560.00
      // 22% on  55,300  = 12,166.00
      // 24% on  96,075  = 23,058.00
      // 32% on  54,450  = 17,424.00
      // 35% on 384,375  = 134,531.25
      // 37% on  43,300  = 16,021.00
      // Total = 209,000.25
      expectDollars(calculateFederalTax(700_000, 'single'), 209_000.25)
    })
  })

  describe('married filing jointly', () => {
    it('returns 0 for zero income', () => {
      expectDollars(calculateFederalTax(0, 'marriedFilingJointly'), 0)
    })

    it('returns 0 when income is at or below the standard deduction', () => {
      expectDollars(calculateFederalTax(32_200, 'marriedFilingJointly'), 0)
    })

    it('begins taxing at $1 above the standard deduction', () => {
      // Taxable = 1 → 10% × 1 = $0.10
      expectDollars(calculateFederalTax(32_201, 'marriedFilingJointly'), 0.10)
    })

    it('calculates tax correctly — $100,000', () => {
      // Taxable = 100,000 - 32,200 = 67,800
      // 10% on 24,800 = 2,480.00
      // 12% on 43,000 = 5,160.00
      // Total = 7,640.00
      expectDollars(calculateFederalTax(100_000, 'marriedFilingJointly'), 7_640)
    })

    it('calculates tax correctly spanning four brackets — $250,000', () => {
      // Taxable = 217,800
      // 10% on  24,800  =  2,480.00
      // 12% on  76,000  =  9,120.00
      // 22% on 110,600  = 24,332.00
      // 24% on   6,400  =  1,536.00
      // Total = 37,468.00
      expectDollars(calculateFederalTax(250_000, 'marriedFilingJointly'), 37_468)
    })

    it('MFJ liability is lower than single on the same income', () => {
      const income = 150_000
      expect(calculateFederalTax(income, 'marriedFilingJointly'))
        .toBeLessThan(calculateFederalTax(income, 'single'))
    })
  })
})

// ---------------------------------------------------------------------------
// Oregon state income tax (2026 — Oregon DOR Form 150-206-436)
// Standard deductions: $2,910 single / $5,820 MFJ
// ---------------------------------------------------------------------------

describe('calculateStateTax — Oregon', () => {
  describe('single filer', () => {
    it('returns 0 for zero income', () => {
      expectDollars(calculateStateTax(0, 'OR', 'single'), 0)
    })

    it('returns 0 when income is at or below the standard deduction', () => {
      expectDollars(calculateStateTax(2_910, 'OR', 'single'), 0)
    })

    it('begins taxing at $1 above the standard deduction', () => {
      // Taxable = 1 → 4.75% × 1 = $0.0475
      expectDollars(calculateStateTax(2_911, 'OR', 'single'), 0.0475)
    })

    it('calculates tax correctly spanning three brackets — $50,000', () => {
      // Taxable = 50,000 - 2,910 = 47,090
      // 4.75% on  4,550  =   216.13
      // 6.75% on  6,850  =   462.38
      // 8.75% on 35,690  = 3,122.88
      // Total = 3,801.38
      expectDollars(calculateStateTax(50_000, 'OR', 'single'), 3_801.375)
    })

    it('calculates tax at the top (9.9%) bracket — $200,000', () => {
      // Taxable = 197,090
      // 4.75% on   4,550  =    216.13
      // 6.75% on   6,850  =    462.38
      // 8.75% on 113,600  =  9,940.00
      // 9.90% on  72,090  =  7,136.91
      // Total = 17,755.42
      expectDollars(calculateStateTax(200_000, 'OR', 'single'), 17_755.41)
    })
  })

  describe('married filing jointly', () => {
    it('returns 0 for zero income', () => {
      expectDollars(calculateStateTax(0, 'OR', 'marriedFilingJointly'), 0)
    })

    it('returns 0 when income is at or below the standard deduction', () => {
      expectDollars(calculateStateTax(5_820, 'OR', 'marriedFilingJointly'), 0)
    })

    it('begins taxing at $1 above the standard deduction', () => {
      // Taxable = 1 → 4.75% × 1 = $0.0475
      expectDollars(calculateStateTax(5_821, 'OR', 'marriedFilingJointly'), 0.0475)
    })

    it('calculates tax correctly — $150,000', () => {
      // Taxable = 144,180
      // 4.75% on  9,100  =    432.25
      // 6.75% on 13,700  =    924.75
      // 8.75% on 121,380 = 10,620.75
      // Total = 11,977.75
      expectDollars(calculateStateTax(150_000, 'OR', 'marriedFilingJointly'), 11_977.75)
    })
  })

  it('returns 0 for unsupported states', () => {
    expectDollars(calculateStateTax(100_000, 'CA', 'single'), 0)
    expectDollars(calculateStateTax(100_000, 'TX', 'single'), 0)
    expectDollars(calculateStateTax(100_000, 'WA', 'marriedFilingJointly'), 0)
  })
})

// ---------------------------------------------------------------------------
// FICA — per earner (2026: SS 6.2% up to $184,500, Medicare 1.45%)
// ---------------------------------------------------------------------------

describe('calculateFicaPerEarner', () => {
  it('returns 0 for zero wages', () => {
    expectDollars(calculateFicaPerEarner(0), 0)
  })

  it('calculates SS + Medicare correctly below the wage base — $50,000', () => {
    // SS:      50,000 × 0.062  = 3,100.00
    // Medicare: 50,000 × 0.0145 =   725.00
    // Total = 3,825.00
    expectDollars(calculateFicaPerEarner(50_000), 3_825)
  })

  it('caps Social Security at the wage base ($184,500)', () => {
    // SS:      184,500 × 0.062  = 11,439.00
    // Medicare: 200,000 × 0.0145 =  2,900.00
    // Total = 14,339.00
    expectDollars(calculateFicaPerEarner(200_000), 14_339)
  })

  it('SS does not grow above the wage base', () => {
    const atBase = calculateFicaPerEarner(184_500)
    const overBase = calculateFicaPerEarner(300_000)
    const ssAtBase = 184_500 * 0.062
    const ssOverBase = 184_500 * 0.062   // same SS
    const medicareAtBase = 184_500 * 0.0145
    const medicareOverBase = 300_000 * 0.0145
    expectDollars(atBase, ssAtBase + medicareAtBase)
    expectDollars(overBase, ssOverBase + medicareOverBase)
  })
})

// ---------------------------------------------------------------------------
// FICA — Additional Medicare surtax (0.9% above threshold)
// Thresholds: $200,000 single / $250,000 MFJ (statutory, not inflation-adjusted)
// ---------------------------------------------------------------------------

describe('calculateAdditionalMedicare', () => {
  it('returns 0 when income is below the single threshold', () => {
    expectDollars(calculateAdditionalMedicare(199_999, 'single'), 0)
    expectDollars(calculateAdditionalMedicare(200_000, 'single'), 0)
  })

  it('begins taxing at $1 above the single threshold', () => {
    // Excess = 1 → 0.9% × 1 = $0.009
    expectDollars(calculateAdditionalMedicare(200_001, 'single'), 0.009)
  })

  it('taxes only the excess above the single threshold — $250,000', () => {
    // Excess = 50,000 → 50,000 × 0.009 = 450
    expectDollars(calculateAdditionalMedicare(250_000, 'single'), 450)
  })

  it('returns 0 when MFJ income is below the MFJ threshold', () => {
    expectDollars(calculateAdditionalMedicare(249_999, 'marriedFilingJointly'), 0)
    expectDollars(calculateAdditionalMedicare(250_000, 'marriedFilingJointly'), 0)
  })

  it('begins taxing at $1 above the MFJ threshold', () => {
    // Excess = 1 → 0.9% × 1 = $0.009
    expectDollars(calculateAdditionalMedicare(250_001, 'marriedFilingJointly'), 0.009)
  })

  it('taxes only the excess above the MFJ threshold — $300,000', () => {
    // Excess = 50,000 → 50,000 × 0.009 = 450
    expectDollars(calculateAdditionalMedicare(300_000, 'marriedFilingJointly'), 450)
  })

  it('MFJ threshold is higher than single threshold', () => {
    const wages = 220_000
    expect(calculateAdditionalMedicare(wages, 'single'))
      .toBeGreaterThan(calculateAdditionalMedicare(wages, 'marriedFilingJointly'))
  })
})

// ---------------------------------------------------------------------------
// Social Security taxability (provisional income rules)
// Single thresholds: $25k lower / $34k upper
// MFJ thresholds:    $32k lower / $44k upper
// ---------------------------------------------------------------------------

describe('calculateTaxableSocialSecurity', () => {
  it('returns 0 when SS income is 0', () => {
    expectDollars(calculateTaxableSocialSecurity(50_000, 0, 'single'), 0)
  })

  it('returns 0 when provisional income is below the lower threshold (single)', () => {
    // provisional = 20,000 + 0.5 × 8,000 = 24,000 < 25,000
    expectDollars(calculateTaxableSocialSecurity(20_000, 8_000, 'single'), 0)
  })

  it('returns 0 at exactly the lower threshold (single)', () => {
    // provisional = 21,000 + 0.5 × 8,000 = 25,000
    expectDollars(calculateTaxableSocialSecurity(21_000, 8_000, 'single'), 0)
  })

  it('begins taxing $1 above the lower threshold (single)', () => {
    // provisional = 21,001 + 0.5 × 8,000 = 25,001 → taxable = min(0.5 × 1, 0.5 × 8,000) = 0.50
    expectDollars(calculateTaxableSocialSecurity(21_001, 8_000, 'single'), 0.50)
  })

  it('caps at 50% of SS in the middle tier (single)', () => {
    // provisional = 28,000 + 0.5 × 6,000 = 31,000 (between 25k and 34k)
    // taxable = min(0.5 × (31,000 - 25,000), 0.5 × 6,000) = min(3,000, 3,000) = 3,000
    expectDollars(calculateTaxableSocialSecurity(28_000, 6_000, 'single'), 3_000)
  })

  it('applies 85% tier above the upper threshold (single)', () => {
    // provisional = 40,000 + 0.5 × 20,000 = 50,000 > 34,000
    // midBand = 0.5 × (34,000 - 25,000) = 4,500
    // aboveUpper = 0.85 × (50,000 - 34,000) = 13,600
    // taxable = min(0.85 × 20,000, 4,500 + 13,600) = min(17,000, 18,100) = 17,000
    expectDollars(calculateTaxableSocialSecurity(40_000, 20_000, 'single'), 17_000)
  })

  it('returns 0 when provisional income is below the lower MFJ threshold', () => {
    // provisional = 24,000 + 0.5 × 14,000 = 31,000 < 32,000
    expectDollars(calculateTaxableSocialSecurity(24_000, 14_000, 'marriedFilingJointly'), 0)
  })

  it('begins taxing $1 above the lower MFJ threshold', () => {
    // provisional = 25,001 + 0.5 × 14,000 = 32,001
    // taxable = min(0.5 × 1, 0.5 × 14,000) = 0.50
    expectDollars(calculateTaxableSocialSecurity(25_001, 14_000, 'marriedFilingJointly'), 0.50)
  })

  it('applies 85% tier above the upper MFJ threshold', () => {
    // provisional = 50,000 + 0.5 × 30,000 = 65,000 > 44,000
    // midBand = 0.5 × (44,000 - 32,000) = 6,000
    // aboveUpper = 0.85 × (65,000 - 44,000) = 17,850
    // taxable = min(0.85 × 30,000, 6,000 + 17,850) = min(25,500, 23,850) = 23,850
    expectDollars(calculateTaxableSocialSecurity(50_000, 30_000, 'marriedFilingJointly'), 23_850)
  })

  it('MFJ lower threshold is higher than single lower threshold', () => {
    // Same income should result in less SS being taxable for MFJ
    const taxableSingle = calculateTaxableSocialSecurity(22_000, 8_000, 'single')
    const taxableMfj = calculateTaxableSocialSecurity(22_000, 8_000, 'marriedFilingJointly')
    expect(taxableSingle).toBeGreaterThan(taxableMfj)
  })
})
