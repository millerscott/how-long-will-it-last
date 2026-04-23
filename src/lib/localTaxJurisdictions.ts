import type { FilingStatus } from './tax'

export interface LocalJurisdiction {
  id: string
  name: string
}

export const LOCAL_JURISDICTIONS_BY_STATE: Record<string, LocalJurisdiction[]> = {
  OR: [{ id: 'OR_MULTNOMAH', name: 'Multnomah County' }],
}

export const ARTS_TAX_AMOUNT = 35
export const ARTS_TAX_INCOME_THRESHOLD = 1_000

const MULTNOMAH_SHS_THRESHOLD: Record<FilingStatus, number> = {
  single: 125_000,
  marriedFilingJointly: 200_000,
}

const MULTNOMAH_PFA_MID_THRESHOLD: Record<FilingStatus, number> = {
  single: 125_000,
  marriedFilingJointly: 200_000,
}

const MULTNOMAH_PFA_TOP_THRESHOLD: Record<FilingStatus, number> = {
  single: 250_000,
  marriedFilingJointly: 400_000,
}

function calculateMulTnomahTax(income: number, filingStatus: FilingStatus, artsTaxCount: number): number {
  const shsThreshold = MULTNOMAH_SHS_THRESHOLD[filingStatus]
  const pfaMidThreshold = MULTNOMAH_PFA_MID_THRESHOLD[filingStatus]
  const pfaTopThreshold = MULTNOMAH_PFA_TOP_THRESHOLD[filingStatus]

  // Supportive Housing Services (SHS) Metro Tax: 1% above threshold
  const shsTax = Math.max(0, income - shsThreshold) * 0.01

  // Preschool for All (PFA) Multnomah County Tax: 1.5% mid band, 3% above upper threshold
  let pfaTax = 0
  if (income > pfaMidThreshold) {
    pfaTax += (Math.min(income, pfaTopThreshold) - pfaMidThreshold) * 0.015
  }
  if (income > pfaTopThreshold) {
    pfaTax += (income - pfaTopThreshold) * 0.03
  }

  // Portland Arts Tax: $35 flat per eligible adult (income > $1,000)
  const artsTax = artsTaxCount * ARTS_TAX_AMOUNT

  return shsTax + pfaTax + artsTax
}

/**
 * Calculate local/county/city income tax.
 * @param income - Aggregated taxable income for this jurisdiction
 * @param jurisdiction - Jurisdiction ID (e.g. 'OR_MULTNOMAH')
 * @param filingStatus - Tax filing status
 * @param artsTaxCount - Number of adults eligible for flat Arts Tax (income > $1,000). Pass 0 for delta calculations.
 */
export function calculateLocalTax(
  income: number,
  jurisdiction: string,
  filingStatus: FilingStatus,
  artsTaxCount: number = 0,
): number {
  switch (jurisdiction) {
    case 'OR_MULTNOMAH': return calculateMulTnomahTax(income, filingStatus, artsTaxCount)
    default: return 0
  }
}
