// Social Security benefit estimation (2026 figures)
// Simplified formula: assumes current salary approximates career average earnings.
// For a precise figure users should check their SSA statement at ssa.gov.

const FRA = 67 // Full Retirement Age for anyone born 1960 or later

// 2026 PIA bend points (monthly AIME)
const BEND_1 = 1_286
const BEND_2 = 7_749

function calculatePia(annualSalary: number): number {
  const aime = annualSalary / 12
  let pia = 0
  pia += Math.min(aime, BEND_1) * 0.90
  pia += Math.max(0, Math.min(aime, BEND_2) - BEND_1) * 0.32
  pia += Math.max(0, aime - BEND_2) * 0.15
  return pia // monthly benefit at FRA
}

function claimingAdjustment(claimingAge: number): number {
  const yearsEarly = FRA - claimingAge
  const yearsLate = claimingAge - FRA

  if (yearsEarly > 0) {
    // First 3 years early: −6.67%/yr; beyond 3 years: −5%/yr
    const earlyTier1 = Math.min(yearsEarly, 3) * (5 / 9 / 100 * 12) // −6.67%/yr
    const earlyTier2 = Math.max(0, yearsEarly - 3) * (5 / 12 / 100 * 12) // −5%/yr
    return 1 - earlyTier1 - earlyTier2
  }

  if (yearsLate > 0) {
    // +8%/yr for each year delayed past FRA (max age 70)
    return 1 + Math.min(yearsLate, 3) * 0.08
  }

  return 1
}

/**
 * Estimates annual Social Security benefit in today's dollars.
 *
 * @param annualSalary  Current annual wage income (used as career earnings proxy)
 * @param claimingAge   Age at which benefits will be claimed (62–70)
 */
export function estimateSsBenefit(annualSalary: number, claimingAge: number): number {
  if (annualSalary <= 0) return 0
  const clampedAge = Math.max(62, Math.min(70, claimingAge))
  const monthlyPia = calculatePia(annualSalary)
  const adjusted = monthlyPia * claimingAdjustment(clampedAge)
  return Math.round(adjusted * 12)
}
