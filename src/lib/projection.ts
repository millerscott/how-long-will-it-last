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
  calculateRothConversionAmount,
  type FilingStatus,
} from './tax'

/** IRS Uniform Lifetime Table (2024+) — divisor by age for RMD calculation */
const RMD_DIVISORS: Record<number, number> = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9,
  78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7,
  84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
  90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9,
  96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4, 101: 6.0,
  102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1,
  108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4, 112: 3.3, 113: 3.1,
  114: 3.0, 115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3, 120: 2.0,
}

const RMD_START_AGE = 73

const EQUITY_ASSET_TYPES = new Set<AssetType>([
  'taxableBrokerage',
  'retirementTraditional',
  'retirementRoth',
  'educationSavings529',
])

/**
 * Returns the effective annual rate override for equity assets at the given age,
 * based on any active market crash or recovery period.
 * Returns null if no event covers the age (caller uses the normal rate).
 * First crash in the array wins on overlap.
 */
export function getEquityRateOverride(
  age: number,
  marketCrashes: AppConfig['marketCrashes'],
): number | null {
  for (const crash of marketCrashes) {
    const crashEnd = crash.startAge + crash.durationYears
    const recoveryEnd = crashEnd + crash.recoveryYears
    if (age >= crash.startAge && age < crashEnd) {
      return Math.pow(1 - crash.declinePercent, 1 / crash.durationYears) - 1
    }
    if (age >= crashEnd && age < recoveryEnd) {
      return Math.pow(1 / (1 - crash.declinePercent), 1 / crash.recoveryYears) - 1
    }
  }
  return null
}

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
  expenseBreakdown: IncomeBreakdownItem[]
  netCashFlow: number
  totalAssets: number
  assetBreakdown: AssetBalance[]
  rmdWithdrawn: number
  rothConverted: number
  depleted: boolean
  marketCrashActive: boolean
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
  annualExpenses = 0,
): { brokerageWithdrawn: number; traditionalWithdrawn: number } {
  const monthlyExpense = annualExpenses / 12

  // Compute reserve targets
  const cashAssetDef = householdAssets.find((a) => a.id === cashAssetId)!
  const cashTarget = Math.max(0, cashAssetDef.monthsReserve ?? 0) * monthlyExpense

  // MM accounts with a reserve: protected as sources (floor = target) and topped up as destinations
  const mmTargetMap = new Map<string, number>(
    householdAssets
      .filter((a) => a.type === 'moneyMarketSavings' && (a.monthsReserve ?? 0) > 0)
      .map((a) => [a.id, a.monthsReserve! * monthlyExpense])
  )

  const cashBalance = accountBalances.get(cashAssetId) ?? 0
  const cashShortfall = Math.max(0, cashTarget - cashBalance)
  let mmTopUpTotal = 0
  for (const [id, target] of mmTargetMap) {
    mmTopUpTotal += Math.max(0, target - (accountBalances.get(id) ?? 0))
  }

  const totalPullNeeded = cashShortfall + mmTopUpTotal
  if (totalPullNeeded <= 0) return { brokerageWithdrawn: 0, traditionalWithdrawn: 0 }

  const order: AssetType[] = primaryAge < 60
    ? ['moneyMarketSavings', 'taxableBrokerage', 'retirementRoth', 'retirementTraditional', 'educationSavings529']
    : ['moneyMarketSavings', 'taxableBrokerage', 'retirementTraditional', 'retirementRoth', 'educationSavings529']

  let remaining = totalPullNeeded
  let brokerageWithdrawn = 0
  let traditionalWithdrawn = 0

  for (const assetType of order) {
    if (remaining <= 0) break
    for (const asset of householdAssets.filter((a) => a.type === assetType)) {
      if (remaining <= 0) break
      const balance = accountBalances.get(asset.id) ?? 0
      // MM accounts with a reserve are only drainable above their floor; all other accounts are fully drainable
      const floor = mmTargetMap.get(asset.id) ?? 0
      const drainable = Math.max(0, balance - floor)
      if (drainable <= 0) continue
      const withdrawal = Math.min(drainable, remaining)
      accountBalances.set(asset.id, balance - withdrawal)
      if (assetType === 'taxableBrokerage') brokerageWithdrawn += withdrawal
      if (assetType === 'retirementTraditional') traditionalWithdrawn += withdrawal
      remaining -= withdrawal
    }
  }

  // Deposit all pulled funds into cash (may be less than totalPullNeeded if sources ran out)
  const pulledIntoCash = totalPullNeeded - remaining
  accountBalances.set(cashAssetId, cashBalance + pulledIntoCash)

  // Distribute from cash to MM-with-reserve accounts still below their target,
  // but only while cash stays at or above its own cashTarget
  for (const [id, target] of mmTargetMap) {
    const mmBalance = accountBalances.get(id) ?? 0
    const deficit = Math.max(0, target - mmBalance)
    if (deficit <= 0) continue
    const cashNow = accountBalances.get(cashAssetId) ?? 0
    const transfer = Math.min(deficit, Math.max(0, cashNow - cashTarget))
    if (transfer <= 0) continue
    accountBalances.set(id, mmBalance + transfer)
    accountBalances.set(cashAssetId, cashNow - transfer)
  }

  return { brokerageWithdrawn, traditionalWithdrawn }
}

/**
 * Draws up to amountNeeded from 529 accounts sequentially to cover education expenses.
 * Mutates accountBalances in place. Returns total amount drawn.
 */
export function draw529ForEducation(
  accountBalances: Map<string, number>,
  householdAssets: AppConfig['householdAssets'],
  amountNeeded: number,
): number {
  if (amountNeeded <= 0) return 0
  let remaining = amountNeeded
  for (const asset of householdAssets.filter((a) => a.type === 'educationSavings529')) {
    if (remaining <= 0) break
    const balance = accountBalances.get(asset.id) ?? 0
    if (balance <= 0) continue
    const withdrawal = Math.min(balance, remaining)
    accountBalances.set(asset.id, balance - withdrawal)
    remaining -= withdrawal
  }
  return amountNeeded - remaining
}

/**
 * Calculates and withdraws RMDs from traditional retirement accounts for each
 * household member who has reached RMD age (73+). Accounts are attributed to a
 * member via asset.memberId; unlinked accounts belong to the primary member.
 * Mutates accountBalances in place. Returns total amount withdrawn.
 */
export function calculateRmd(
  accountBalances: Map<string, number>,
  householdAssets: AppConfig['householdAssets'],
  household: AppConfig['household'],
  yearsElapsed: number,
): number {
  if (household.length === 0) return 0
  const primaryMemberId = household[0].id
  let totalRmd = 0

  for (const member of household) {
    const memberAge = member.ageAtSimulationStart + yearsElapsed
    if (memberAge < RMD_START_AGE) continue

    const divisor = RMD_DIVISORS[Math.min(memberAge, 120)] ?? RMD_DIVISORS[120]

    // Member owns explicitly-linked accounts, plus unlinked accounts if they're the primary member
    const memberAccounts = householdAssets.filter(
      (a) => a.type === 'retirementTraditional' &&
        (a.memberId === member.id || (!a.memberId && member.id === primaryMemberId))
    )

    let memberBalance = 0
    for (const acct of memberAccounts) {
      memberBalance += accountBalances.get(acct.id) ?? 0
    }
    if (memberBalance <= 0) continue

    const rmdAmount = memberBalance / divisor

    // Withdraw proportionally from this member's accounts
    for (const acct of memberAccounts) {
      const balance = accountBalances.get(acct.id) ?? 0
      if (balance <= 0) continue
      const share = balance / memberBalance
      accountBalances.set(acct.id, balance - share * rmdAmount)
    }

    totalRmd += rmdAmount
  }

  return totalRmd
}

export function projectFinances(config: AppConfig): YearlySnapshot[] {
  const { inflationRate, ssCola, incomeSources, expenses, householdAssets, assetRates, household, marketCrashes, rothConversionTargetBracket } = config

  const primaryMember = household[0]
  if (!primaryMember) return []

  const realMode = config.simulationMode === 'real'
  /** Convert a nominal annual rate to an effective rate (real-adjusted when in real mode) */
  const toEffectiveRate = (nominal: number) => realMode ? (1 + nominal) / (1 + inflationRate) - 1 : nominal

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
      const growthRate = toEffectiveRate(isSS ? ssCola : src.annualGrowthRate)
      const amount = src.annualAmount * Math.pow(1 + growthRate, yearsOfGrowth)
      if (isSS) {
        ssIncome += amount
      } else {
        incomeBreakdown.push({ label: src.name, amount })
        wageIncome += amount
        wageByMember.set(src.memberId, (wageByMember.get(src.memberId) ?? 0) + amount)
      }
    }
    if (ssIncome > 0) {
      incomeBreakdown.push({ label: 'Social Security', amount: ssIncome })
    }

    // --- Interest income (cash + money market — taxed annually as ordinary income) ---
    let interestIncome = 0
    for (const asset of householdAssets) {
      if (asset.type === 'cash' || asset.type === 'moneyMarketSavings') {
        const balance = accountBalances.get(asset.id) ?? 0
        const interest = balance * toEffectiveRate(assetRates[asset.type])
        if (interest > 0) {
          interestIncome += interest
          incomeBreakdown.push({ label: `Interest (${ASSET_TYPE_LABELS[asset.type]})`, amount: interest })
        }
      }
    }

    // --- RMD: forced withdrawal from traditional accounts for members age 73+ ---
    // RMD reduces traditional balances; proceeds flow into cash via netCashFlow (included in income).
    // RMD taxes are computed post-waterfall alongside other traditional withdrawal taxes.
    const rmdWithdrawn = calculateRmd(accountBalances, householdAssets, household, yearsElapsed)
    if (rmdWithdrawn > 0) {
      incomeBreakdown.push({ label: 'Required Minimum Distribution', amount: rmdWithdrawn })
    }

    const income = wageIncome + ssIncome + interestIncome + rmdWithdrawn

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
    const primaryAge = currentAge + yearsElapsed
    let regularExpenseTotal = 0    // regular + periodic: flows through netCashFlow
    let educationExpenseTotal = 0  // education: drawn from 529 first, remainder from cash
    const expenseBreakdown: IncomeBreakdownItem[] = []

    for (const exp of expenses) {
      const effectiveStart = exp.startAge ?? currentAge
      if (primaryAge < effectiveStart) continue
      if (exp.endAge !== undefined && primaryAge > exp.endAge) continue

      if (exp.expenseType === 'periodic') {
        const yearsSinceFirst = primaryAge - effectiveStart
        if (yearsSinceFirst % exp.intervalYears !== 0) continue
        const inflated = exp.inflationAdjusted
          ? (realMode ? exp.amount : exp.amount * Math.pow(1 + inflationRate, yearsElapsed))
          : (realMode ? exp.amount / Math.pow(1 + inflationRate, yearsElapsed) : exp.amount)
        regularExpenseTotal += inflated
        expenseBreakdown.push({ label: exp.name, amount: inflated })
      } else {
        const annual = exp.frequency === 'monthly' ? exp.amount * 12 : exp.amount
        const inflated = exp.inflationAdjusted
          ? (realMode ? annual : annual * Math.pow(1 + inflationRate, yearsElapsed))
          : (realMode ? annual / Math.pow(1 + inflationRate, yearsElapsed) : annual)
        if (exp.expenseType === 'education') {
          educationExpenseTotal += inflated
        } else {
          regularExpenseTotal += inflated
        }
        expenseBreakdown.push({ label: exp.name, amount: inflated })
      }
    }

    const expenseTotal = regularExpenseTotal + educationExpenseTotal

    // Net cash flow (income after all taxes and expenses) flows into the cash account
    const netCashFlow = income - federalIncomeTax - ficaTax - stateIncomeTax - expenseTotal

    // --- Update account balances ---
    // 1. Contributions: apply the active period's amount for each non-cash account
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

    // 2b. Education draw: 529 accounts reimburse cash for education expenses
    if (educationExpenseTotal > 0 && cashAsset) {
      const covered = draw529ForEducation(accountBalances, householdAssets, educationExpenseTotal)
      if (covered > 0) {
        const prev = accountBalances.get(cashAsset.id) ?? 0
        accountBalances.set(cashAsset.id, prev + covered)
      }
    }

    // 2c. Roth conversion — move traditional → Roth to fill up to target bracket
    //     Only before RMD age; conversion itself doesn't change cash (only the tax bill does).
    let rothConverted = 0
    if (rothConversionTargetBracket !== null && primaryAge < RMD_START_AGE) {
      const traditionalAccounts = householdAssets.filter((a) => a.type === 'retirementTraditional')
      const rothAccounts = householdAssets.filter((a) => a.type === 'retirementRoth')
      const totalTradBalance = traditionalAccounts.reduce((s, a) => s + (accountBalances.get(a.id) ?? 0), 0)

      if (totalTradBalance > 0 && rothAccounts.length > 0) {
        const baseOrdinary = wageIncome + interestIncome + taxableSs
        rothConverted = calculateRothConversionAmount(baseOrdinary, totalTradBalance, filingStatus, rothConversionTargetBracket)

        if (rothConverted > 0) {
          // Withdraw proportionally from traditional accounts
          for (const acct of traditionalAccounts) {
            const balance = accountBalances.get(acct.id) ?? 0
            if (balance <= 0) continue
            accountBalances.set(acct.id, balance - (balance / totalTradBalance) * rothConverted)
          }
          // Deposit proportionally into Roth accounts (by balance; if all zero, put in first)
          const totalRothBalance = rothAccounts.reduce((s, a) => s + (accountBalances.get(a.id) ?? 0), 0)
          for (const acct of rothAccounts) {
            const balance = accountBalances.get(acct.id) ?? 0
            const share = totalRothBalance > 0 ? balance / totalRothBalance : 1 / rothAccounts.length
            accountBalances.set(acct.id, balance + share * rothConverted)
          }
          incomeBreakdown.push({ label: 'Roth Conversion', amount: rothConverted })
        }
      }
    }

    // 3. Withdrawal waterfall — uses regularExpenseTotal for reserve calculations
    //    (education costs are handled by 529 draw; including them would inflate reserve targets)
    let brokerageWithdrawn = 0
    let traditionalWithdrawn = 0
    if (cashAsset) {
      ;({ brokerageWithdrawn, traditionalWithdrawn } = applyWaterfall(accountBalances, cashAsset.id, householdAssets, primaryAge, regularExpenseTotal))
    }

    if (brokerageWithdrawn > 0) {
      incomeBreakdown.push({ label: 'Capital Gains (Taxable Brokerage)', amount: brokerageWithdrawn })
    }
    if (traditionalWithdrawn > 0) {
      incomeBreakdown.push({ label: 'Traditional IRA Withdrawal', amount: traditionalWithdrawn })
    }

    // Combine RMD + Roth conversion + waterfall traditional withdrawals for tax purposes
    const totalTraditionalWithdrawn = rmdWithdrawn + rothConverted + traditionalWithdrawn

    // 3b. Investment taxes: capital gains on brokerage liquidations + NIIT on all NII
    const baseOrdinaryIncome = wageIncome + interestIncome + taxableSs
    const capitalGainsTax = calculateCapitalGainsTax(
      brokerageWithdrawn,
      baseOrdinaryIncome,
      filingStatus,
    )
    // Traditional IRA distributions (RMD + waterfall) increase MAGI but are not NII themselves.
    // MAGI uses the original taxableSs here; it will be corrected in the traditionalIraFederalTax step below.
    const magi = baseOrdinaryIncome + brokerageWithdrawn + totalTraditionalWithdrawn
    const niit = calculateNiit(interestIncome + brokerageWithdrawn, magi, filingStatus)
    const stateCapitalGainsTax = calculateStateTax(brokerageWithdrawn, primaryState, filingStatus)

    // 3c. Traditional IRA withdrawal — taxed as ordinary income, with SS taxability recalculated
    // IRA withdrawals increase provisional income, which can push more SS benefits into taxable territory.
    // Recompute taxable SS with IRA withdrawals included, then take the delta vs. what was already charged.
    const taxableSsFinal = totalTraditionalWithdrawn > 0
      ? calculateTaxableSocialSecurity(wageIncome + interestIncome + totalTraditionalWithdrawn, ssIncome, filingStatus)
      : taxableSs
    const traditionalIraFederalTax = totalTraditionalWithdrawn > 0
      ? calculateFederalTax(wageIncome + interestIncome + taxableSsFinal + totalTraditionalWithdrawn, filingStatus)
        - federalIncomeTax
      : 0
    const baseStateIncome = wageIncome + interestIncome
    const traditionalIraStateTax = totalTraditionalWithdrawn > 0
      ? calculateStateTax(baseStateIncome + totalTraditionalWithdrawn, primaryState, filingStatus)
        - calculateStateTax(baseStateIncome, primaryState, filingStatus)
      : 0
    const traditionalIraTax = traditionalIraFederalTax + traditionalIraStateTax

    const postWaterfallTaxes = capitalGainsTax + niit + stateCapitalGainsTax + traditionalIraTax
    if (cashAsset && postWaterfallTaxes > 0) {
      const prev = accountBalances.get(cashAsset.id) ?? 0
      accountBalances.set(cashAsset.id, prev - postWaterfallTaxes)
    }

    // 4. Apply appreciation to all accounts (equity types use crash override when active)
    const equityOverride = getEquityRateOverride(primaryAge, marketCrashes)
    for (const asset of householdAssets) {
      const nominalRate = (equityOverride !== null && EQUITY_ASSET_TYPES.has(asset.type))
        ? equityOverride
        : assetRates[asset.type]
      const rate = toEffectiveRate(nominalRate)
      const balance = accountBalances.get(asset.id) ?? 0
      accountBalances.set(asset.id, balance * (1 + rate))
    }

    const totalAssets = [...accountBalances.values()].reduce((s, b) => s + b, 0)

    if (totalAssets <= 0) {
      depleted = true
      for (const id of accountBalances.keys()) accountBalances.set(id, 0)
    }

    const assetBreakdown: AssetBalance[] = householdAssets.map((a) => ({
      label: ASSET_TYPE_LABELS[a.type],
      balance: accountBalances.get(a.id) ?? 0,
    }))

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
      expenseBreakdown,
      netCashFlow,
      totalAssets: Math.max(0, totalAssets),
      assetBreakdown,
      rmdWithdrawn,
      rothConverted,
      depleted,
      marketCrashActive: equityOverride !== null,
    })

    if (depleted) break
  }

  return snapshots
}

/** Returns the age at which assets are first depleted, or null if they last. */
export function findDepletionAge(snapshots: YearlySnapshot[]): number | null {
  const hit = snapshots.find((s) => s.depleted)
  return hit ? hit.age : null
}
