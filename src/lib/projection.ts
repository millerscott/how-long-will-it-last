import type { AppConfig } from '../types'

export interface YearlySnapshot {
  age: number
  year: number
  income: number
  expenses: number
  netCashFlow: number
  totalAssets: number
  depleted: boolean
}

/**
 * Projects finances year-by-year from currentAge to lifeExpectancy.
 * Returns one snapshot per year. Once total assets hit zero the simulation
 * continues to show the deficit but marks `depleted = true`.
 */
export function projectFinances(config: AppConfig): YearlySnapshot[] {
  const {
    currentAge,
    lifeExpectancy,
    retirementAge,
    inflationRate,
    incomeSources,
    expenses,
    assets,
  } = config

  const currentYear = new Date().getFullYear()
  const snapshots: YearlySnapshot[] = []

  let totalAssets = assets.reduce((sum, a) => sum + a.balance, 0)
  let depleted = false

  for (let age = currentAge; age <= lifeExpectancy; age++) {
    const yearsElapsed = age - currentAge
    const year = currentYear + yearsElapsed
    const retired = age >= retirementAge

    // --- Income ---
    let income = 0
    for (const src of incomeSources) {
      const active =
        (src.startAge === undefined || age >= src.startAge) &&
        (src.endAge === undefined || age <= src.endAge)
      if (!active) continue
      const annual = src.frequency === 'monthly' ? src.amount * 12 : src.amount
      income += annual
    }

    // --- Expenses ---
    let expenseTotal = 0
    for (const exp of expenses) {
      const annual = exp.frequency === 'monthly' ? exp.amount * 12 : exp.amount
      const inflated = exp.inflationAdjusted
        ? annual * Math.pow(1 + inflationRate, yearsElapsed)
        : annual
      expenseTotal += inflated
    }

    const netCashFlow = income - expenseTotal

    // --- Asset growth & withdrawals ---
    let assetGrowth = 0
    let assetWithdrawals = 0
    for (const asset of assets) {
      assetGrowth += asset.balance * asset.annualReturnRate
      if (retired) assetWithdrawals += asset.annualWithdrawal
    }

    totalAssets = Math.max(0, totalAssets + assetGrowth + netCashFlow - assetWithdrawals)

    if (totalAssets === 0 && !depleted) {
      depleted = true
    }

    snapshots.push({
      age,
      year,
      income,
      expenses: expenseTotal,
      netCashFlow,
      totalAssets,
      depleted,
    })
  }

  return snapshots
}

/** Returns the age at which assets are first depleted, or null if they last. */
export function findDepletionAge(snapshots: YearlySnapshot[]): number | null {
  const hit = snapshots.find((s) => s.depleted)
  return hit ? hit.age : null
}
