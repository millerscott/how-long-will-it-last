export type FilingStatus = 'single' | 'marriedFilingJointly'

interface Bracket {
  rate: number
  upTo: number
}

function applyBrackets(taxableIncome: number, brackets: Bracket[]): number {
  let tax = 0
  let prev = 0
  for (const { rate, upTo } of brackets) {
    if (taxableIncome <= prev) break
    const slice = Math.min(taxableIncome, upTo) - prev
    tax += slice * rate
    prev = upTo
  }
  return tax
}

// ---------------------------------------------------------------------------
// Federal (2026 tax year — IRS Rev. Proc. 25-32)
// ---------------------------------------------------------------------------

const FEDERAL_BRACKETS: Record<FilingStatus, Bracket[]> = {
  single: [
    { rate: 0.10, upTo: 12_400 },
    { rate: 0.12, upTo: 50_400 },
    { rate: 0.22, upTo: 105_700 },
    { rate: 0.24, upTo: 201_775 },
    { rate: 0.32, upTo: 256_225 },
    { rate: 0.35, upTo: 640_600 },
    { rate: 0.37, upTo: Infinity },
  ],
  marriedFilingJointly: [
    { rate: 0.10, upTo: 24_800 },
    { rate: 0.12, upTo: 100_800 },
    { rate: 0.22, upTo: 211_400 },
    { rate: 0.24, upTo: 403_550 },
    { rate: 0.32, upTo: 512_450 },
    { rate: 0.35, upTo: 768_700 },
    { rate: 0.37, upTo: Infinity },
  ],
}

const FEDERAL_STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single: 16_100,
  marriedFilingJointly: 32_200,
}

export function calculateFederalTax(grossIncome: number, filingStatus: FilingStatus): number {
  const taxable = Math.max(0, grossIncome - FEDERAL_STANDARD_DEDUCTION[filingStatus])
  return applyBrackets(taxable, FEDERAL_BRACKETS[filingStatus])
}

// ---------------------------------------------------------------------------
// Oregon (2026 tax year — Oregon DOR Form 150-206-436)
// ---------------------------------------------------------------------------

const OREGON_BRACKETS: Record<FilingStatus, Bracket[]> = {
  single: [
    { rate: 0.0475, upTo: 4_550 },
    { rate: 0.0675, upTo: 11_400 },
    { rate: 0.0875, upTo: 125_000 },
    { rate: 0.0990, upTo: Infinity },
  ],
  marriedFilingJointly: [
    { rate: 0.0475, upTo: 9_100 },
    { rate: 0.0675, upTo: 22_800 },
    { rate: 0.0875, upTo: 250_000 },
    { rate: 0.0990, upTo: Infinity },
  ],
}

const OREGON_STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single: 2_910,
  marriedFilingJointly: 5_820,
}

function calculateOregonTax(income: number, filingStatus: FilingStatus): number {
  const taxable = Math.max(0, income - OREGON_STANDARD_DEDUCTION[filingStatus])
  return applyBrackets(taxable, OREGON_BRACKETS[filingStatus])
}

// ---------------------------------------------------------------------------
// FICA (2026 tax year — SSA, IRS Rev. Proc. 25-32)
// Social Security and Medicare are calculated per-person (each earner has their
// own SS wage base cap). The Additional Medicare surtax uses combined household
// income against the filing-status threshold.
// ---------------------------------------------------------------------------

const SS_RATE = 0.062
const SS_WAGE_BASE = 184_500

const MEDICARE_RATE = 0.0145

const ADDITIONAL_MEDICARE_RATE = 0.009
const ADDITIONAL_MEDICARE_THRESHOLD: Record<FilingStatus, number> = {
  single: 200_000,
  marriedFilingJointly: 250_000,
}

/** FICA owed by a single earner on their wages (SS + Medicare, no surtax). */
export function calculateFicaPerEarner(wages: number): number {
  const ss = Math.min(wages, SS_WAGE_BASE) * SS_RATE
  const medicare = wages * MEDICARE_RATE
  return ss + medicare
}

/**
 * Additional Medicare surtax on combined household wages above the threshold.
 * Applied once at the household level, not per earner.
 */
export function calculateAdditionalMedicare(
  totalHouseholdWages: number,
  filingStatus: FilingStatus,
): number {
  const excess = Math.max(0, totalHouseholdWages - ADDITIONAL_MEDICARE_THRESHOLD[filingStatus])
  return excess * ADDITIONAL_MEDICARE_RATE
}

// ---------------------------------------------------------------------------
// Long-term capital gains (2026 — IRS Rev. Proc. 25-32 basis)
// Thresholds are based on *taxable* income (ordinary + gains).
// Ordinary income fills the lower brackets first; gains stack on top.
// ---------------------------------------------------------------------------

const LTCG_THRESHOLDS: Record<FilingStatus, { zero: number; fifteen: number }> = {
  single:               { zero: 49_450,  fifteen: 545_500 },
  marriedFilingJointly: { zero: 98_900,  fifteen: 613_700 },
}

export function calculateCapitalGainsTax(
  capitalGains: number,
  grossOrdinaryIncome: number,
  filingStatus: FilingStatus,
): number {
  if (capitalGains <= 0) return 0
  const ordinaryTaxable = Math.max(0, grossOrdinaryIncome - FEDERAL_STANDARD_DEDUCTION[filingStatus])
  const { zero, fifteen } = LTCG_THRESHOLDS[filingStatus]

  const gainsAt0   = Math.max(0, Math.min(capitalGains, zero - ordinaryTaxable))
  const gainsAbove0 = capitalGains - gainsAt0
  const gainsAt15  = Math.max(0, Math.min(gainsAbove0, fifteen - Math.max(ordinaryTaxable, zero)))
  const gainsAt20  = gainsAbove0 - gainsAt15

  return gainsAt15 * 0.15 + gainsAt20 * 0.20
}

// ---------------------------------------------------------------------------
// Net Investment Income Tax — NIIT (IRC §1411, statutory thresholds)
// 3.8% surtax on net investment income above MAGI threshold.
// Thresholds are NOT inflation-adjusted: $200,000 single / $250,000 MFJ.
// Applies to the lesser of NII or the excess of MAGI over the threshold.
// ---------------------------------------------------------------------------

const NIIT_THRESHOLD: Record<FilingStatus, number> = {
  single:               200_000,
  marriedFilingJointly: 250_000,
}

export function calculateNiit(
  netInvestmentIncome: number,
  magi: number,
  filingStatus: FilingStatus,
): number {
  if (netInvestmentIncome <= 0) return 0
  const excess = Math.max(0, magi - NIIT_THRESHOLD[filingStatus])
  return Math.min(netInvestmentIncome, excess) * 0.038
}

// ---------------------------------------------------------------------------
// Social Security taxability (IRS provisional income rules)
// ---------------------------------------------------------------------------

const SS_PROVISIONAL_THRESHOLDS: Record<FilingStatus, { lower: number; upper: number }> = {
  single:               { lower: 25_000, upper: 34_000 },
  marriedFilingJointly: { lower: 32_000, upper: 44_000 },
}

/**
 * Returns the taxable portion of Social Security benefits.
 * provisionalIncome = otherIncome + 0.5 × ssIncome
 * - Below lower threshold: 0% taxable
 * - Between thresholds: up to 50% of excess above lower threshold
 * - Above upper threshold: up to 85% of SS benefits
 */
export function calculateTaxableSocialSecurity(
  otherIncome: number,
  ssIncome: number,
  filingStatus: FilingStatus,
): number {
  if (ssIncome <= 0) return 0
  const { lower, upper } = SS_PROVISIONAL_THRESHOLDS[filingStatus]
  const provisional = otherIncome + 0.5 * ssIncome

  if (provisional <= lower) return 0

  if (provisional <= upper) {
    // 50% of excess above lower threshold, capped at 50% of SS
    return Math.min(0.5 * (provisional - lower), 0.5 * ssIncome)
  }

  // Above upper threshold: min of (85% of SS) or (50% of middle band + 85% of excess above upper)
  const midBand = 0.5 * (upper - lower)
  const aboveUpper = 0.85 * (provisional - upper)
  return Math.min(0.85 * ssIncome, midBand + aboveUpper)
}

// ---------------------------------------------------------------------------
// Roth conversion — bracket headroom calculation
// ---------------------------------------------------------------------------

/**
 * Returns how much traditional IRA balance can be converted to Roth while
 * staying within the target federal bracket. Conversion fills the bracket
 * exactly: if current taxable income already exceeds the ceiling, returns 0.
 * Does not model the SS knock-on effect (handled separately in the projection loop).
 */
export function calculateRothConversionAmount(
  grossOrdinaryIncome: number,
  traditionalBalance: number,
  filingStatus: FilingStatus,
  targetRate: 0.12 | 0.22 | 0.24,
): number {
  if (traditionalBalance <= 0) return 0
  const stdDeduction = FEDERAL_STANDARD_DEDUCTION[filingStatus]
  const currentTaxable = Math.max(0, grossOrdinaryIncome - stdDeduction)
  const ceiling = FEDERAL_BRACKETS[filingStatus].find((b) => b.rate === targetRate)?.upTo ?? 0
  const headroom = Math.max(0, ceiling - currentTaxable)
  return Math.min(headroom, traditionalBalance)
}

// ---------------------------------------------------------------------------
// IRMAA — Income-Related Monthly Adjustment Amount (2026 estimates)
// Medicare Part B and Part D surcharges based on MAGI (2-year lookback).
// Thresholds are inflation-adjusted annually by CMS.
// ---------------------------------------------------------------------------

interface IrmaaBracket {
  magiUpTo: number
  partBMonthly: number
  partDMonthly: number
}

const IRMAA_BRACKETS: Record<FilingStatus, IrmaaBracket[]> = {
  single: [
    { magiUpTo: 109_000, partBMonthly: 0,      partDMonthly: 0 },
    { magiUpTo: 137_000, partBMonthly: 81.20,  partDMonthly: 14.50 },
    { magiUpTo: 171_000, partBMonthly: 202.90, partDMonthly: 37.50 },
    { magiUpTo: 205_000, partBMonthly: 324.60, partDMonthly: 60.40 },
    { magiUpTo: 500_000, partBMonthly: 446.30, partDMonthly: 83.30 },
    { magiUpTo: Infinity, partBMonthly: 487.00, partDMonthly: 91.00 },
  ],
  marriedFilingJointly: [
    { magiUpTo: 218_000, partBMonthly: 0,      partDMonthly: 0 },
    { magiUpTo: 274_000, partBMonthly: 81.20,  partDMonthly: 14.50 },
    { magiUpTo: 342_000, partBMonthly: 202.90, partDMonthly: 37.50 },
    { magiUpTo: 410_000, partBMonthly: 324.60, partDMonthly: 60.40 },
    { magiUpTo: 750_000, partBMonthly: 446.30, partDMonthly: 83.30 },
    { magiUpTo: Infinity, partBMonthly: 487.00, partDMonthly: 91.00 },
  ],
}

/**
 * Returns the annual IRMAA surcharge for one person based on household MAGI.
 * In reality CMS uses MAGI from 2 years prior; the caller handles the lookback.
 */
export function calculateIrmaa(magi: number, filingStatus: FilingStatus): number {
  const brackets = IRMAA_BRACKETS[filingStatus]
  for (const bracket of brackets) {
    if (magi <= bracket.magiUpTo) {
      return (bracket.partBMonthly + bracket.partDMonthly) * 12
    }
  }
  const last = brackets[brackets.length - 1]
  return (last.partBMonthly + last.partDMonthly) * 12
}

// ---------------------------------------------------------------------------
// Public entry point — add more states here as needed
// ---------------------------------------------------------------------------

export function calculateStateTax(income: number, state: string, filingStatus: FilingStatus): number {
  switch (state) {
    case 'OR': return calculateOregonTax(income, filingStatus)
    default: return 0
  }
}
