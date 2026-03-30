import type { AppConfig, AssetType } from '../types'
import { ASSET_TYPE_LABELS } from '../types'
import {
  calculateFederalTax,
  calculateStateTax,
  calculateFicaPerEarner,
  calculateAdditionalMedicare,
  calculateTaxableSocialSecurity,
  calculateCapitalGainsTax,
  calculateNiit,
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
  capitalGainsTax: number
  niit: number
  traditionalIraTax: number
  ficaTax: number
  stateIncomeTax: number
  expenses: number
  netCashFlow: number
  totalAssets: number
  assetBreakdown: AssetBalance[]
  depleted: boolean
}

/**
 * Withdrawal waterfall: if cash is negative, draw from other accounts in tax-optimal order.
 * Before age 60: Roth before Traditional (both carry early-withdrawal penalty, but Roth
 * withdrawals are otherwise tax-free). At 60+: Traditional before Roth (preserve
 * tax-free Roth growth longer, no early-withdrawal penalty).
 *
 * Returns the amounts withdrawn from taxable brokerage and traditional retirement accounts
 * so the caller can compute the appropriate taxes post-waterfall.
 *
 * Mutates accountBalances in place.
 */
export function applyWaterfall(
  accountBalances: Map<string, number>,
  cashAssetId: string,
  householdAssets: AppConfig['householdAssets'],
  primaryAge: number,
): { brokerageWithdrawn: number; traditionalWithdrawn: number } {
  const cashBalance = accountBalances.get(cashAssetId) ?? 0
  if (cashBalance >= 0) return { brokerageWithdrawn: 0, traditionalWithdrawn: 0 }

  const order: AssetType[] = primaryAge < 60
    ? ['moneyMarketSavings', 'taxableBrokerage', 'retirementRoth', 'retirementTraditional', 'educationSavings529']
    : ['moneyMarketSavings', 'taxableBrokerage', 'retirementTraditional', 'retirementRoth', 'educationSavings529']

  let remaining = -cashBalance
  let brokerageWithdrawn = 0
  let traditionalWithdrawn = 0
  for (const assetType of order) {
    if (remaining <= 0) break
    for (const asset of householdAssets.filter((a) => a.type === assetType)) {
      if (remaining <= 0) break
      const balance = accountBalances.get(asset.id) ?? 0
      const withdrawal = Math.min(balance, remaining)
      accountBalances.set(asset.id, balance - withdrawal)
      if (assetType === 'taxableBrokerage') brokerageWithdrawn += withdrawal
      if (assetType === 'retirementTraditional') traditionalWithdrawn += withdrawal
      remaining -= withdrawal
    }
  }
  // If all sources exhausted, remaining deficit stays as negative cash → depleted trips
  accountBalances.set(cashAssetId, remaining > 0 ? -remaining : 0)
  return { brokerageWithdrawn, traditionalWithdrawn }
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

    // --- Interest income (cash + money market — taxed annually as ordinary income) ---
    let interestIncome = 0
    for (const asset of householdAssets) {
      if (asset.type === 'cash' || asset.type === 'moneyMarketSavings') {
        const balance = accountBalances.get(asset.id) ?? 0
        const interest = balance * assetRates[asset.type]
        if (interest > 0) {
          interestIncome += interest
          incomeBreakdown.push({ label: `Interest (${ASSET_TYPE_LABELS[asset.type]})`, amount: interest })
        }
      }
    }

    const income = wageIncome + ssIncome + interestIncome

    // --- Taxes ---
    // Federal: SS benefits are partially taxable based on provisional income
    const taxableSs = calculateTaxableSocialSecurity(wageIncome + interestIncome, ssIncome, filingStatus)
    const federalIncomeTax = calculateFederalTax(wageIncome + interestIncome + taxableSs, filingStatus)

    // FICA: applied only to wage income, not SS or interest
    let ficaTax = calculateAdditionalMedicare(wageIncome, filingStatus)
    for (const memberWages of wageByMember.values()) {
      ficaTax += calculateFicaPerEarner(memberWages)
    }

    // State tax: Oregon does not tax SS benefits — pass wage income + interest
    const statesWithIncome = new Set(
      [...wageByMember.keys()].map((id) => household.find((m) => m.id === id)!.state)
    )
    // Interest is attributed to the primary member's state
    const primaryState = primaryMember.state
    let stateIncomeTax = 0
    if (statesWithIncome.size === 1) {
      const state = [...statesWithIncome][0]
      stateIncomeTax = calculateStateTax(wageIncome + interestIncome, state, filingStatus)
    } else {
      for (const [memberId, memberWages] of wageByMember) {
        const member = household.find((m) => m.id === memberId)!
        stateIncomeTax += calculateStateTax(memberWages, member.state, filingStatus)
      }
      // Add interest income to primary member's state
      stateIncomeTax += calculateStateTax(interestIncome, primaryState, filingStatus)
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

    // 3. Withdrawal waterfall
    let brokerageWithdrawn = 0
    let traditionalWithdrawn = 0
    if (cashAsset) {
      ;({ brokerageWithdrawn, traditionalWithdrawn } = applyWaterfall(accountBalances, cashAsset.id, householdAssets, primaryAge))
    }

    if (brokerageWithdrawn > 0) {
      incomeBreakdown.push({ label: 'Capital Gains (Taxable Brokerage)', amount: brokerageWithdrawn })
    }
    if (traditionalWithdrawn > 0) {
      incomeBreakdown.push({ label: 'Traditional IRA Withdrawal', amount: traditionalWithdrawn })
    }

    // 3b. Investment taxes: capital gains on brokerage liquidations + NIIT on all NII
    const baseOrdinaryIncome = wageIncome + interestIncome + taxableSs
    const capitalGainsTax = calculateCapitalGainsTax(
      brokerageWithdrawn,
      baseOrdinaryIncome,
      filingStatus,
    )
    // Traditional IRA distributions increase MAGI (affecting NIIT threshold) but are not NII themselves
    const magi = baseOrdinaryIncome + brokerageWithdrawn + traditionalWithdrawn
    const niit = calculateNiit(interestIncome + brokerageWithdrawn, magi, filingStatus)
    const stateCapitalGainsTax = calculateStateTax(brokerageWithdrawn, primaryState, filingStatus)

    // 3c. Traditional IRA withdrawal — taxed as ordinary income (incremental, stacks on top of existing income)
    const traditionalIraFederalTax = traditionalWithdrawn > 0
      ? calculateFederalTax(baseOrdinaryIncome + traditionalWithdrawn, filingStatus)
        - calculateFederalTax(baseOrdinaryIncome, filingStatus)
      : 0
    const baseStateIncome = wageIncome + interestIncome
    const traditionalIraStateTax = traditionalWithdrawn > 0
      ? calculateStateTax(baseStateIncome + traditionalWithdrawn, primaryState, filingStatus)
        - calculateStateTax(baseStateIncome, primaryState, filingStatus)
      : 0
    const traditionalIraTax = traditionalIraFederalTax + traditionalIraStateTax

    const postWaterfallTaxes = capitalGainsTax + niit + stateCapitalGainsTax + traditionalIraTax
    if (cashAsset && postWaterfallTaxes > 0) {
      const prev = accountBalances.get(cashAsset.id) ?? 0
      accountBalances.set(cashAsset.id, prev - postWaterfallTaxes)
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
      capitalGainsTax,
      niit,
      traditionalIraTax,
      ficaTax,
      stateIncomeTax: stateIncomeTax + stateCapitalGainsTax,
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
