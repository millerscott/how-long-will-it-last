import type { AppConfig } from '../types'
import { ASSET_TYPE_LABELS } from '../types'
import {
  calculateFederalTax,
  calculateStateTax,
  calculateFicaPerEarner,
  calculateAdditionalMedicare,
  type FilingStatus,
} from './tax'

export interface AssetBalance {
  label: string
  balance: number
}

export interface YearlySnapshot {
  age: number
  year: number
  income: number
  federalIncomeTax: number
  ficaTax: number
  stateIncomeTax: number
  expenses: number
  netCashFlow: number
  totalAssets: number
  assetBreakdown: AssetBalance[]
  depleted: boolean
}

export function projectFinances(config: AppConfig): YearlySnapshot[] {
  const { inflationRate, incomeSources, expenses, householdAssets, assetRates, household } = config

  const primaryMember = household[0]
  if (!primaryMember) return []

  const currentAge = primaryMember.ageAtSimulationStart
  const simulationEndAge = currentAge + config.simulationYears

  const filingStatus: FilingStatus = household.length >= 2 ? 'marriedFilingJointly' : 'single'
  const currentYear = new Date().getFullYear()
  const snapshots: YearlySnapshot[] = []

  // Track each account balance independently
  const accountBalances = new Map<string, number>(
    householdAssets.map((a) => [a.id, a.balanceAtSimulationStart])
  )
  const cashAsset = householdAssets.find((a) => a.type === 'cash')

  let depleted = false

  for (let age = currentAge; age <= simulationEndAge; age++) {
    const yearsElapsed = age - currentAge
    const year = currentYear + yearsElapsed

    // --- Income (tracked per member for state tax purposes) ---
    let income = 0
    const incomeByMember = new Map<string, number>()

    for (const src of incomeSources) {
      const member = household.find((m) => m.id === src.memberId)
      if (!member) continue
      const memberAge = member.ageAtSimulationStart + yearsElapsed
      const effectiveEndAge = src.endAge ?? member.retirementAge
      if (memberAge < src.startAge || memberAge > effectiveEndAge) continue
      const yearsOfGrowth = memberAge - member.ageAtSimulationStart
      const amount = src.annualAmount * Math.pow(1 + src.annualGrowthRate, yearsOfGrowth)
      income += amount
      incomeByMember.set(src.memberId, (incomeByMember.get(src.memberId) ?? 0) + amount)
    }

    // --- Taxes ---
    const federalIncomeTax = calculateFederalTax(income, filingStatus)

    let ficaTax = calculateAdditionalMedicare(income, filingStatus)
    for (const memberIncome of incomeByMember.values()) {
      ficaTax += calculateFicaPerEarner(memberIncome)
    }

    const statesWithIncome = new Set(
      [...incomeByMember.keys()].map((id) => household.find((m) => m.id === id)!.state)
    )
    let stateIncomeTax = 0
    if (statesWithIncome.size === 1) {
      const state = [...statesWithIncome][0]
      stateIncomeTax = calculateStateTax(income, state, filingStatus)
    } else {
      for (const [memberId, memberIncome] of incomeByMember) {
        const member = household.find((m) => m.id === memberId)!
        stateIncomeTax += calculateStateTax(memberIncome, member.state, filingStatus)
      }
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

    // Net cash flow (income after all taxes and expenses) flows into the cash account
    const netCashFlow = income - federalIncomeTax - ficaTax - stateIncomeTax - expenseTotal

    // --- Update account balances ---
    // 1. Contributions move from cash to each non-cash account
    let totalContributions = 0
    for (const asset of householdAssets) {
      if (asset.type === 'cash') continue
      const prev = accountBalances.get(asset.id) ?? 0
      accountBalances.set(asset.id, prev + asset.annualContribution)
      totalContributions += asset.annualContribution
    }

    // 2. Net cash flow (minus contributions) settles into cash
    if (cashAsset) {
      const prev = accountBalances.get(cashAsset.id) ?? 0
      accountBalances.set(cashAsset.id, prev + netCashFlow - totalContributions)
    }

    // 3. Apply appreciation to all accounts
    for (const asset of householdAssets) {
      const rate = assetRates[asset.type]
      const balance = accountBalances.get(asset.id) ?? 0
      accountBalances.set(asset.id, balance * (1 + rate))
    }

    const totalAssets = [...accountBalances.values()].reduce((s, b) => s + b, 0)

    const assetBreakdown: AssetBalance[] = householdAssets.map((a) => ({
      label: ASSET_TYPE_LABELS[a.type],
      balance: accountBalances.get(a.id) ?? 0,
    }))

    if (totalAssets <= 0 && !depleted) {
      depleted = true
    }

    snapshots.push({
      age,
      year,
      income,
      federalIncomeTax,
      ficaTax,
      stateIncomeTax,
      expenses: expenseTotal,
      netCashFlow,
      totalAssets: Math.max(0, totalAssets),
      assetBreakdown,
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
