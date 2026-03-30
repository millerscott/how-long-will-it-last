import type { AppConfig, AssetType } from '../types'
import { ASSET_TYPE_LABELS } from '../types'
import {
  calculateFederalTax,
  calculateStateTax,
  calculateFicaPerEarner,
  calculateAdditionalMedicare,
  calculateTaxableSocialSecurity,
  type FilingStatus,
} from './tax'

export interface AssetBalance {
  label: string
  balance: number
}

export interface IncomeBreakdownItem {
  label: string
  amount: number
}

export interface YearlySnapshot {
  age: number
  year: number
  income: number
  incomeBreakdown: IncomeBreakdownItem[]
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
  const { inflationRate, ssCola, incomeSources, expenses, householdAssets, assetRates, household } = config

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
    // SS income is tracked separately: different growth rate, different tax treatment, no FICA
    let wageIncome = 0
    let ssIncome = 0
    const wageByMember = new Map<string, number>()
    const incomeBreakdown: IncomeBreakdownItem[] = []

    for (const src of incomeSources) {
      const member = household.find((m) => m.id === src.memberId)
      if (!member) continue
      const memberAge = member.ageAtSimulationStart + yearsElapsed
      const effectiveEndAge = src.endAge ?? simulationEndAge
      if (memberAge < src.startAge || memberAge > effectiveEndAge) continue
      const yearsOfGrowth = memberAge - member.ageAtSimulationStart
      const isSS = src.incomeType === 'socialSecurity'
      const growthRate = isSS ? ssCola : src.annualGrowthRate
      const amount = src.annualAmount * Math.pow(1 + growthRate, yearsOfGrowth)
      incomeBreakdown.push({ label: src.name, amount })
      if (isSS) {
        ssIncome += amount
      } else {
        wageIncome += amount
        wageByMember.set(src.memberId, (wageByMember.get(src.memberId) ?? 0) + amount)
      }
    }

    const income = wageIncome + ssIncome

    // --- Taxes ---
    // Federal: SS benefits are partially taxable based on provisional income
    const taxableSs = calculateTaxableSocialSecurity(wageIncome, ssIncome, filingStatus)
    const federalIncomeTax = calculateFederalTax(wageIncome + taxableSs, filingStatus)

    // FICA: applied only to wage income, not SS
    let ficaTax = calculateAdditionalMedicare(wageIncome, filingStatus)
    for (const memberWages of wageByMember.values()) {
      ficaTax += calculateFicaPerEarner(memberWages)
    }

    // State tax: Oregon does not tax SS benefits — pass only wage income
    const statesWithIncome = new Set(
      [...wageByMember.keys()].map((id) => household.find((m) => m.id === id)!.state)
    )
    let stateIncomeTax = 0
    if (statesWithIncome.size === 1) {
      const state = [...statesWithIncome][0]
      stateIncomeTax = calculateStateTax(wageIncome, state, filingStatus)
    } else {
      for (const [memberId, memberWages] of wageByMember) {
        const member = household.find((m) => m.id === memberId)!
        stateIncomeTax += calculateStateTax(memberWages, member.state, filingStatus)
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
    // 1. Contributions: apply the active period's amount for each non-cash account
    const primaryAge = currentAge + yearsElapsed
    let totalContributions = 0
    for (const asset of householdAssets) {
      if (asset.type === 'cash') continue
      const activePeriod = asset.contributions.find(
        (c) => primaryAge >= c.startAge && (c.endAge === undefined || primaryAge <= c.endAge)
      )
      const contribution = activePeriod?.annualAmount ?? 0
      if (contribution > 0) {
        const prev = accountBalances.get(asset.id) ?? 0
        accountBalances.set(asset.id, prev + contribution)
        totalContributions += contribution
      }
    }

    // 2. Net cash flow (minus contributions) settles into cash
    if (cashAsset) {
      const prev = accountBalances.get(cashAsset.id) ?? 0
      accountBalances.set(cashAsset.id, prev + netCashFlow - totalContributions)
    }

    // 3. Withdrawal waterfall: if cash is negative, draw from other accounts in
    //    tax-optimal order. Before 60: Roth before Traditional (Roth withdrawals
    //    are cheaper when both carry the early-withdrawal penalty). At 60+:
    //    Traditional before Roth (preserve tax-free Roth growth longer).
    //    NOTE: Traditional withdrawals would normally increase taxable income;
    //    this model does not do withdrawal-level tax attribution.
    if (cashAsset) {
      const cashBalance = accountBalances.get(cashAsset.id) ?? 0
      if (cashBalance < 0) {
        const WATERFALL_ORDER: AssetType[] = primaryAge < 60
          ? ['moneyMarketSavings', 'taxableBrokerage', 'retirementRoth', 'retirementTraditional', 'educationSavings529']
          : ['moneyMarketSavings', 'taxableBrokerage', 'retirementTraditional', 'retirementRoth', 'educationSavings529']
        let remaining = -cashBalance
        for (const assetType of WATERFALL_ORDER) {
          if (remaining <= 0) break
          for (const asset of householdAssets.filter((a) => a.type === assetType)) {
            if (remaining <= 0) break
            const balance = accountBalances.get(asset.id) ?? 0
            const withdrawal = Math.min(balance, remaining)
            accountBalances.set(asset.id, balance - withdrawal)
            remaining -= withdrawal
          }
        }
        // If all sources exhausted, remaining deficit stays as negative cash → depleted trips
        accountBalances.set(cashAsset.id, -remaining)
      }
    }

    // 4. Apply appreciation to all accounts
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
      incomeBreakdown,
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
