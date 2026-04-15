import type { AppConfig, AssetType, HouseholdMember, HealthcarePlan } from '../types'
import { ASSET_TYPE_LABELS, DEFAULT_HEALTHCARE_PLAN } from '../types'
import {
  calculateFederalTax,
  calculateStateTax,
  calculateFicaPerEarner,
  calculateAdditionalMedicare,
  calculateTaxableSocialSecurity,
  calculateCapitalGainsTax,
  calculateNiit,
  calculateRothConversionAmount,
  calculateIrmaa,
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
const EARLY_WITHDRAWAL_AGE = 59
const EARLY_WITHDRAWAL_PENALTY_RATE = 0.10
/** Age at which waterfall switches from Roth-before-Traditional to Traditional-before-Roth */
const WATERFALL_AGE_THRESHOLD = 60

const EQUITY_ASSET_TYPES = new Set<AssetType>([
  'taxableBrokerage',
  'retirementTraditional',
  'retirementRoth',
  'educationSavings529',
])

interface CrashRates {
  crashRate: number
  recoveryRate: number
  crashEnd: number
  recoveryEnd: number
}

/** Pre-compute crash/recovery rates so Math.pow is called once per crash, not once per year. */
export function precomputeCrashRates(marketCrashes: AppConfig['marketCrashes']): CrashRates[] {
  return marketCrashes.map((crash) => ({
    crashRate: Math.pow(1 - crash.declinePercent, 1 / crash.durationYears) - 1,
    recoveryRate: Math.pow(1 / (1 - crash.declinePercent), 1 / crash.recoveryYears) - 1,
    crashEnd: crash.startAge + crash.durationYears,
    recoveryEnd: crash.startAge + crash.durationYears + crash.recoveryYears,
  }))
}

/**
 * Returns the effective annual rate override for equity assets at the given age,
 * based on any active market crash or recovery period.
 * Returns null if no event covers the age (caller uses the normal rate).
 * First crash in the array wins on overlap.
 */
export function getEquityRateOverride(
  age: number,
  marketCrashes: AppConfig['marketCrashes'],
  crashRatesCache?: CrashRates[],
): number | null {
  const rates = crashRatesCache ?? precomputeCrashRates(marketCrashes)
  for (let i = 0; i < marketCrashes.length; i++) {
    const crash = marketCrashes[i]
    const r = rates[i]
    if (age >= crash.startAge && age < r.crashEnd) {
      return r.crashRate
    }
    if (age >= r.crashEnd && age < r.recoveryEnd) {
      return r.recoveryRate
    }
  }
  return null
}

export interface AssetBalance {
  label: string
  type: AssetType
  startBalance: number
  balance: number
  /** Net human-driven flow this year (contributions − withdrawals, excluding appreciation). */
  netFlow: number
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
  totalTax: number
  expenses: number
  expenseBreakdown: IncomeBreakdownItem[]
  netCashFlow: number
  totalAssets: number
  assetBreakdown: AssetBalance[]
  earlyWithdrawalPenalty: number
  rmdWithdrawn: number
  rothConverted: number
  depleted: boolean
  marketCrashActive: boolean
}

/**
 * Withdrawal waterfall: if cash is negative, draw from other accounts in tax-optimal order.
 *
 * Type-level order:
 *   Before age 60: Roth before Traditional (both carry early-withdrawal penalty, but Roth
 *   withdrawals are otherwise tax-free). At 60+: Traditional before Roth (preserve
 *   tax-free Roth growth longer, no early-withdrawal penalty).
 *
 * Within retirement account types (Traditional and Roth), accounts are sorted by owner age
 * when memberAgeMap is provided:
 *   1. Accounts owned by members >= 59 come first (no early-withdrawal penalty).
 *   2. Among penalized accounts, youngest member's accounts come first — this preserves
 *      the older member's balance so it can be accessed penalty-free once they turn 59.
 *
 * Returns the amounts withdrawn from each account type plus the total penalty-bearing
 * withdrawal amount so the caller can compute taxes and the 10% penalty.
 *
 * Mutates accountBalances in place.
 */
export function applyWaterfall(
  accountBalances: Map<string, number>,
  cashAssetId: string,
  householdAssets: AppConfig['householdAssets'],
  primaryAge: number,
  annualExpenses = 0,
  rothBasisMap?: Map<string, number>,
  memberAgeMap?: Map<string, number>,
  primaryMemberId?: string,
): { brokerageWithdrawn: number; traditionalWithdrawn: number; rothWithdrawn: number; rothPenaltyFreeWithdrawn: number; penaltyBearingWithdrawn: number } {
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
  if (totalPullNeeded <= 0) return { brokerageWithdrawn: 0, traditionalWithdrawn: 0, rothWithdrawn: 0, rothPenaltyFreeWithdrawn: 0, penaltyBearingWithdrawn: 0 }

  const order: AssetType[] = primaryAge < WATERFALL_AGE_THRESHOLD
    ? ['moneyMarketSavings', 'taxableBrokerage', 'retirementRoth', 'retirementTraditional', 'educationSavings529']
    : ['moneyMarketSavings', 'taxableBrokerage', 'retirementTraditional', 'retirementRoth', 'educationSavings529']

  let remaining = totalPullNeeded
  let brokerageWithdrawn = 0
  let traditionalWithdrawn = 0
  let rothWithdrawn = 0
  let rothPenaltyFreeWithdrawn = 0
  let penaltyBearingWithdrawn = 0

  for (const assetType of order) {
    if (remaining <= 0) break

    // For retirement account types, sort by owner age to minimize early-withdrawal penalties:
    // penalty-free owners (age >= 59) first, then youngest-first among those still under 59
    // so the older penalized member's balance is preserved until they turn 59.
    let accountsOfType = householdAssets.filter((a) => a.type === assetType)
    if (
      (assetType === 'retirementTraditional' || assetType === 'retirementRoth') &&
      memberAgeMap && primaryMemberId && accountsOfType.length > 1
    ) {
      accountsOfType = [...accountsOfType].sort((a, b) => {
        const ageA = memberAgeMap.get(a.memberId ?? primaryMemberId) ?? primaryAge
        const ageB = memberAgeMap.get(b.memberId ?? primaryMemberId) ?? primaryAge
        const freeA = ageA >= EARLY_WITHDRAWAL_AGE
        const freeB = ageB >= EARLY_WITHDRAWAL_AGE
        if (freeA !== freeB) return freeA ? -1 : 1   // penalty-free accounts drawn first
        if (!freeA && !freeB) return ageA - ageB      // both penalized: youngest first
        return 0
      })
    }

    for (const asset of accountsOfType) {
      if (remaining <= 0) break
      const balance = accountBalances.get(asset.id) ?? 0
      // MM accounts with a reserve are only drainable above their floor; all other accounts are fully drainable
      const floor = mmTargetMap.get(asset.id) ?? 0
      const drainable = Math.max(0, balance - floor)
      if (drainable <= 0) continue
      const withdrawal = Math.min(drainable, remaining)
      accountBalances.set(asset.id, balance - withdrawal)
      if (assetType === 'taxableBrokerage') brokerageWithdrawn += withdrawal
      if (assetType === 'retirementTraditional') {
        traditionalWithdrawn += withdrawal
        // Penalty applies if the account owner is under 59
        const ownerAge = memberAgeMap && primaryMemberId
          ? (memberAgeMap.get(asset.memberId ?? primaryMemberId) ?? primaryAge)
          : primaryAge
        if (ownerAge < EARLY_WITHDRAWAL_AGE) penaltyBearingWithdrawn += withdrawal
      }
      if (assetType === 'retirementRoth') {
        rothWithdrawn += withdrawal
        // Roth contributions can always be withdrawn penalty-free; only earnings are penalized
        if (rothBasisMap) {
          const basis = rothBasisMap.get(asset.id) ?? 0
          const fromBasis = Math.min(withdrawal, basis)
          rothBasisMap.set(asset.id, basis - fromBasis)
          rothPenaltyFreeWithdrawn += fromBasis
          // Roth earnings are penalized if the account owner is under 59
          const ownerAge = memberAgeMap && primaryMemberId
            ? (memberAgeMap.get(asset.memberId ?? primaryMemberId) ?? primaryAge)
            : primaryAge
          if (ownerAge < EARLY_WITHDRAWAL_AGE) penaltyBearingWithdrawn += withdrawal - fromBasis
        } else {
          // No basis tracking — treat entire withdrawal as penalty-free (conservative for test/legacy callers)
          rothPenaltyFreeWithdrawn += withdrawal
        }
      }
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

  return { brokerageWithdrawn, traditionalWithdrawn, rothWithdrawn, rothPenaltyFreeWithdrawn, penaltyBearingWithdrawn }
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

const MEDICARE_AGE = 65

/**
 * Resolves the age at which a member's employer healthcare coverage ends.
 * If the member is covered by another member's plan, uses that member's end age.
 */
function resolveEmployerCoverageEndAge(
  member: HouseholdMember,
  household: HouseholdMember[],
): number | null {
  const plan = member.healthcarePlan ?? DEFAULT_HEALTHCARE_PLAN
  if (!plan.enabled) return null
  if (plan.employerCoverage === 'none') return member.ageAtSimulationStart // no employer phase
  if (plan.employerCoverage === 'own') {
    return plan.employerCoverageEndAge ?? member.retirementAge
  }
  // Covered by another member's plan — find that member's end age
  const provider = household.find((m) => m.id === plan.employerCoverage)
  if (!provider) return member.ageAtSimulationStart
  const providerPlan = provider.healthcarePlan ?? DEFAULT_HEALTHCARE_PLAN
  const providerEndAge = providerPlan.employerCoverageEndAge ?? provider.retirementAge
  // Convert provider's end age to this member's age
  const ageDiff = member.ageAtSimulationStart - provider.ageAtSimulationStart
  return providerEndAge + ageDiff
}

/**
 * Calculates annual healthcare cost for a single member at a given age.
 * Returns the cost in base-year dollars (before healthcare inflation).
 */
function getBaseHealthcareCost(
  plan: HealthcarePlan,
  memberAge: number,
  employerEndAge: number,
): number {
  if (!plan.enabled) return 0

  const medicareStartAge = Math.max(employerEndAge, MEDICARE_AGE)
  let premium: number
  let outOfPocket: number
  if (memberAge < employerEndAge) {
    // Employer phase — only 'own' members pay a premium; covered members pay $0
    premium = plan.employerCoverage === 'own' ? plan.employerPremium * 12 : 0
    outOfPocket = plan.employerOutOfPocketAnnual
  } else if (memberAge < medicareStartAge) {
    // Pre-Medicare gap phase (only possible if employer coverage ended before 65)
    premium = plan.preMedicarePremium * 12
    outOfPocket = plan.preMedicareOutOfPocketAnnual
  } else {
    // Medicare phase — employer coverage has ended and member is 65+
    // (IRMAA added separately by caller)
    premium = plan.medicareSupplementPremium * 12
    outOfPocket = plan.medicareOutOfPocketAnnual
  }

  return premium + outOfPocket
}

/** Shared context passed to each simulation phase */
interface SimContext {
  config: AppConfig
  household: AppConfig['household']
  householdAssets: AppConfig['householdAssets']
  incomeSources: AppConfig['incomeSources']
  expenses: AppConfig['expenses']
  assetRates: AppConfig['assetRates']
  marketCrashes: AppConfig['marketCrashes']
  inflationRate: number
  healthcareInflationRate: number
  ssCola: number
  rothConversionTargetBracket: AppConfig['rothConversionTargetBracket']
  filingStatus: FilingStatus
  realMode: boolean
  currentAge: number
  simulationEndAge: number
  toEffectiveRate: (nominal: number) => number
  employerEndAges: Map<string, number>
  accountBalances: Map<string, number>
  rothBasisMap: Map<string, number>
  cashAsset: AppConfig['householdAssets'][number] | undefined
  primaryMember: HouseholdMember
  magiHistory: number[]
  crashRatesCache: CrashRates[]
}

interface IncomeResult {
  wageIncome: number
  ssIncome: number
  w2WageIncome: number
  interestIncome: number
  rmdWithdrawn: number
  income: number
  wageByMember: Map<string, number>
  w2WageByMember: Map<string, number>
  incomeBreakdown: IncomeBreakdownItem[]
}

function computeIncome(ctx: SimContext, yearsElapsed: number): IncomeResult {
  const { incomeSources, household, householdAssets, assetRates, toEffectiveRate, ssCola, simulationEndAge, accountBalances } = ctx

  let wageIncome = 0
  let ssIncome = 0
  let w2WageIncome = 0
  const wageByMember = new Map<string, number>()
  const w2WageByMember = new Map<string, number>()
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
      if (src.incomeType === 'wage') {
        w2WageIncome += amount
        w2WageByMember.set(src.memberId, (w2WageByMember.get(src.memberId) ?? 0) + amount)
      }
    }
  }
  if (ssIncome > 0) {
    incomeBreakdown.push({ label: 'Social Security', amount: ssIncome })
  }

  // Interest income (cash + money market — taxed annually as ordinary income)
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

  // RMD: forced withdrawal from traditional accounts for members age 73+.
  // NOTE: calculateRmd mutates accountBalances in place (reduces traditional IRA balances).
  // This is intentional — RMDs are effectively a withdrawal that settles into cash later
  // when netCashFlow is applied to the cash account.
  const rmdWithdrawn = calculateRmd(accountBalances, householdAssets, household, yearsElapsed)
  if (rmdWithdrawn > 0) {
    incomeBreakdown.push({ label: 'Required Minimum Distribution', amount: rmdWithdrawn })
  }

  const income = wageIncome + ssIncome + interestIncome + rmdWithdrawn

  return { wageIncome, ssIncome, w2WageIncome, interestIncome, rmdWithdrawn, income, wageByMember, w2WageByMember, incomeBreakdown }
}

interface InitialTaxResult {
  taxableWageIncome: number
  taxableW2WageIncome: number
  taxableSs: number
  federalIncomeTax: number
  ficaTax: number
  stateIncomeTax: number
  primaryStateBaseIncome: number
  preTaxPremiumByMember: Map<string, number>
}

function computeInitialTaxes(
  ctx: SimContext,
  yearsElapsed: number,
  inc: IncomeResult,
): InitialTaxResult {
  const { household, filingStatus, toEffectiveRate, healthcareInflationRate, employerEndAges, primaryMember } = ctx

  // Pre-tax employer healthcare premiums (Section 125 cafeteria plan)
  let preTaxPremiumTotal = 0
  const preTaxPremiumByMember = new Map<string, number>()
  for (const member of household) {
    const plan = member.healthcarePlan ?? DEFAULT_HEALTHCARE_PLAN
    if (!plan.enabled || plan.employerCoverage !== 'own') continue
    const memberAge = member.ageAtSimulationStart + yearsElapsed
    const employerEndAge = employerEndAges.get(member.id) ?? memberAge
    if (memberAge >= employerEndAge) continue
    const hcInflationRate = toEffectiveRate(healthcareInflationRate)
    const basePremium = plan.employerPremium * 12
    const inflatedPremium = basePremium * Math.pow(1 + hcInflationRate, yearsElapsed)
    const memberWages = inc.w2WageByMember.get(member.id) ?? 0
    const deduction = Math.min(inflatedPremium, memberWages)
    if (deduction > 0) {
      preTaxPremiumTotal += deduction
      preTaxPremiumByMember.set(member.id, deduction)
    }
  }

  // Pre-tax premiums reduce W-2 wages only (Section 125 cafeteria plan).
  // Non-W-2 'other' income is unaffected. Math.max guards against a
  // deduction that somehow exceeds the W-2 wage base.
  const taxableW2WageIncome = Math.max(0, inc.w2WageIncome - preTaxPremiumTotal)
  const taxableWageIncome = taxableW2WageIncome + (inc.wageIncome - inc.w2WageIncome)

  // Federal tax
  const taxableSs = calculateTaxableSocialSecurity(taxableWageIncome + inc.interestIncome, inc.ssIncome, filingStatus)
  const federalIncomeTax = calculateFederalTax(taxableWageIncome + inc.interestIncome + taxableSs, filingStatus)

  // FICA
  let ficaTax = calculateAdditionalMedicare(taxableW2WageIncome, filingStatus)
  for (const [memberId, memberWages] of inc.w2WageByMember) {
    const preTaxDeduction = preTaxPremiumByMember.get(memberId) ?? 0
    ficaTax += calculateFicaPerEarner(memberWages - preTaxDeduction)
  }

  // State tax: aggregate income by state, compute once per state
  const primaryState = primaryMember.state
  const incomeByState = new Map<string, number>()
  for (const [memberId, memberWages] of inc.wageByMember) {
    const member = household.find((m) => m.id === memberId)!
    const preTaxDeduction = preTaxPremiumByMember.get(memberId) ?? 0
    incomeByState.set(member.state, (incomeByState.get(member.state) ?? 0) + memberWages - preTaxDeduction)
  }
  incomeByState.set(primaryState, (incomeByState.get(primaryState) ?? 0) + inc.interestIncome)
  let stateIncomeTax = 0
  for (const [state, stateIncome] of incomeByState) {
    stateIncomeTax += calculateStateTax(stateIncome, state, filingStatus)
  }
  const primaryStateBaseIncome = incomeByState.get(primaryState) ?? 0

  return { taxableWageIncome, taxableW2WageIncome, taxableSs, federalIncomeTax, ficaTax, stateIncomeTax, primaryStateBaseIncome, preTaxPremiumByMember }
}

interface ExpenseResult {
  regularExpenseTotal: number
  educationExpenseTotal: number
  expenseTotal: number
  expenseBreakdown: IncomeBreakdownItem[]
}

function computeExpenses(ctx: SimContext, yearsElapsed: number, primaryAge: number): ExpenseResult {
  const { expenses, household, inflationRate, healthcareInflationRate, realMode, currentAge, toEffectiveRate, employerEndAges, filingStatus, magiHistory } = ctx

  let regularExpenseTotal = 0
  let educationExpenseTotal = 0
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

  // Healthcare expenses (per member, phase-based with healthcare-specific inflation + IRMAA)
  for (const member of household) {
    const plan = member.healthcarePlan ?? DEFAULT_HEALTHCARE_PLAN
    if (!plan.enabled) continue
    const memberAge = member.ageAtSimulationStart + yearsElapsed
    const employerEndAge = employerEndAges.get(member.id) ?? memberAge
    const baseCost = getBaseHealthcareCost(plan, memberAge, employerEndAge)
    if (baseCost <= 0 && memberAge < MEDICARE_AGE) continue

    const hcInflationRate = toEffectiveRate(healthcareInflationRate)
    const inflatedCost = baseCost * Math.pow(1 + hcInflationRate, yearsElapsed)

    let irmaaSurcharge = 0
    if (memberAge >= MEDICARE_AGE && memberAge >= employerEndAge) {
      const lookbackMagi = magiHistory.length >= 2
        ? magiHistory[magiHistory.length - 2]
        : magiHistory.length === 1
          ? magiHistory[0]
          : 0
      irmaaSurcharge = calculateIrmaa(lookbackMagi, filingStatus)
      if (realMode && yearsElapsed > 0) {
        irmaaSurcharge = irmaaSurcharge / Math.pow(1 + inflationRate, yearsElapsed)
      }
    }

    const memberHealthcareCost = inflatedCost + irmaaSurcharge
    regularExpenseTotal += memberHealthcareCost
    const label = household.length > 1 ? `Healthcare (${member.name || 'Member'})` : 'Healthcare'
    expenseBreakdown.push({ label, amount: memberHealthcareCost })
  }

  return { regularExpenseTotal, educationExpenseTotal, expenseTotal: regularExpenseTotal + educationExpenseTotal, expenseBreakdown }
}

interface AccountUpdateResult {
  rothConverted: number
  brokerageWithdrawn: number
  traditionalWithdrawn: number
  rothWithdrawn: number
  rothPenaltyFreeWithdrawn: number
  earlyWithdrawalPenalty: number
}

function updateAccounts(
  ctx: SimContext,
  primaryAge: number,
  netCashFlow: number,
  educationExpenseTotal: number,
  regularExpenseTotal: number,
  taxableWageIncome: number,
  interestIncome: number,
  taxableSs: number,
  incomeBreakdown: IncomeBreakdownItem[],
): AccountUpdateResult {
  const { householdAssets, accountBalances, cashAsset, rothBasisMap, rothConversionTargetBracket, filingStatus } = ctx

  // 1. Contributions
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
      if (asset.type === 'retirementRoth') {
        const prevBasis = rothBasisMap.get(asset.id) ?? 0
        rothBasisMap.set(asset.id, prevBasis + contribution)
      }
    }
  }

  // 2. Net cash flow settles into cash
  if (cashAsset) {
    const prev = accountBalances.get(cashAsset.id) ?? 0
    accountBalances.set(cashAsset.id, prev + netCashFlow - totalContributions)
  }

  // 2b. Education draw: 529 accounts reimburse cash
  if (educationExpenseTotal > 0 && cashAsset) {
    const covered = draw529ForEducation(accountBalances, householdAssets, educationExpenseTotal)
    if (covered > 0) {
      const prev = accountBalances.get(cashAsset.id) ?? 0
      accountBalances.set(cashAsset.id, prev + covered)
    }
  }

  // 2c. Roth conversion — move traditional → Roth to fill up to target bracket
  let rothConverted = 0
  if (rothConversionTargetBracket !== null && primaryAge < RMD_START_AGE) {
    const traditionalAccounts = householdAssets.filter((a) => a.type === 'retirementTraditional')
    const rothAccounts = householdAssets.filter((a) => a.type === 'retirementRoth')
    const totalTradBalance = traditionalAccounts.reduce((s, a) => s + (accountBalances.get(a.id) ?? 0), 0)

    if (totalTradBalance > 0 && rothAccounts.length > 0) {
      const baseOrdinary = taxableWageIncome + interestIncome + taxableSs
      rothConverted = calculateRothConversionAmount(baseOrdinary, totalTradBalance, filingStatus, rothConversionTargetBracket)

      if (rothConverted > 0) {
        for (const acct of traditionalAccounts) {
          const balance = accountBalances.get(acct.id) ?? 0
          if (balance <= 0) continue
          accountBalances.set(acct.id, balance - (balance / totalTradBalance) * rothConverted)
        }
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

  // 3. Withdrawal waterfall
  // Build a per-member age map so the waterfall can prefer penalty-free accounts
  // (members >= 59) and, among penalized accounts, draw from the youngest member first
  // (preserving the older member's balance until they reach penalty-free age).
  const yearsElapsed = primaryAge - ctx.currentAge
  const memberAgeMap = new Map<string, number>()
  for (const member of ctx.household) {
    memberAgeMap.set(member.id, member.ageAtSimulationStart + yearsElapsed)
  }
  const primaryMemberId = ctx.household[0]?.id

  let brokerageWithdrawn = 0
  let traditionalWithdrawn = 0
  let rothWithdrawn = 0
  let rothPenaltyFreeWithdrawn = 0
  let penaltyBearingWithdrawn = 0
  if (cashAsset) {
    ;({ brokerageWithdrawn, traditionalWithdrawn, rothWithdrawn, rothPenaltyFreeWithdrawn, penaltyBearingWithdrawn } =
      applyWaterfall(accountBalances, cashAsset.id, householdAssets, primaryAge, regularExpenseTotal, rothBasisMap, memberAgeMap, primaryMemberId))
  }

  // Early withdrawal penalty: 10% on the portion of retirement withdrawals whose
  // account owner is under age 59 (tracked per-account by applyWaterfall).
  const earlyWithdrawalPenalty = penaltyBearingWithdrawn * EARLY_WITHDRAWAL_PENALTY_RATE
  if (cashAsset && earlyWithdrawalPenalty > 0) {
    const prev = accountBalances.get(cashAsset.id) ?? 0
    accountBalances.set(cashAsset.id, prev - earlyWithdrawalPenalty)
  }

  if (brokerageWithdrawn > 0) {
    incomeBreakdown.push({ label: 'Capital Gains (Taxable Brokerage)', amount: brokerageWithdrawn })
  }
  if (traditionalWithdrawn > 0) {
    incomeBreakdown.push({ label: 'Traditional IRA Withdrawal', amount: traditionalWithdrawn })
  }

  return { rothConverted, brokerageWithdrawn, traditionalWithdrawn, rothWithdrawn, rothPenaltyFreeWithdrawn, earlyWithdrawalPenalty }
}

interface PostWaterfallTaxResult {
  capitalGainsTax: number
  niit: number
  stateCapitalGainsTax: number
  traditionalIraTax: number
  postWaterfallTaxes: number
}

function computePostWaterfallTaxes(
  ctx: SimContext,
  tax: InitialTaxResult,
  inc: IncomeResult,
  acct: AccountUpdateResult,
): PostWaterfallTaxResult {
  const { filingStatus, primaryMember, magiHistory } = ctx

  const totalTraditionalWithdrawn = inc.rmdWithdrawn + acct.rothConverted + acct.traditionalWithdrawn
  const baseOrdinaryIncome = tax.taxableWageIncome + inc.interestIncome + tax.taxableSs

  const capitalGainsTax = calculateCapitalGainsTax(acct.brokerageWithdrawn, baseOrdinaryIncome, filingStatus)

  const magi = baseOrdinaryIncome + acct.brokerageWithdrawn + totalTraditionalWithdrawn
  magiHistory.push(magi)
  const niit = calculateNiit(inc.interestIncome + acct.brokerageWithdrawn, magi, filingStatus)

  const primaryState = primaryMember.state
  const stateCapitalGainsTax = acct.brokerageWithdrawn > 0
    ? calculateStateTax(tax.primaryStateBaseIncome + acct.brokerageWithdrawn, primaryState, filingStatus)
      - calculateStateTax(tax.primaryStateBaseIncome, primaryState, filingStatus)
    : 0

  const taxableSsFinal = totalTraditionalWithdrawn > 0
    ? calculateTaxableSocialSecurity(tax.taxableWageIncome + inc.interestIncome + totalTraditionalWithdrawn, inc.ssIncome, filingStatus)
    : tax.taxableSs
  const traditionalIraFederalTax = totalTraditionalWithdrawn > 0
    ? calculateFederalTax(tax.taxableWageIncome + inc.interestIncome + taxableSsFinal + totalTraditionalWithdrawn, filingStatus)
      - tax.federalIncomeTax
    : 0
  const traditionalIraStateTax = totalTraditionalWithdrawn > 0
    ? calculateStateTax(tax.primaryStateBaseIncome + totalTraditionalWithdrawn, primaryState, filingStatus)
      - calculateStateTax(tax.primaryStateBaseIncome, primaryState, filingStatus)
    : 0
  const traditionalIraTax = traditionalIraFederalTax + traditionalIraStateTax

  const postWaterfallTaxes = capitalGainsTax + niit + stateCapitalGainsTax + traditionalIraTax
  return { capitalGainsTax, niit, stateCapitalGainsTax, traditionalIraTax, postWaterfallTaxes }
}

function applyAppreciation(ctx: SimContext, primaryAge: number): { equityOverride: number | null } {
  const { householdAssets, accountBalances, assetRates, marketCrashes, toEffectiveRate } = ctx
  const equityOverride = getEquityRateOverride(primaryAge, marketCrashes, ctx.crashRatesCache)
  for (const asset of householdAssets) {
    const nominalRate = (equityOverride !== null && EQUITY_ASSET_TYPES.has(asset.type))
      ? equityOverride
      : assetRates[asset.type]
    const rate = toEffectiveRate(nominalRate)
    const balance = accountBalances.get(asset.id) ?? 0
    accountBalances.set(asset.id, balance * (1 + rate))
  }
  return { equityOverride }
}

export function projectFinances(config: AppConfig): YearlySnapshot[] {
  const { inflationRate, healthcareInflationRate, ssCola, incomeSources, expenses, householdAssets, assetRates, household, marketCrashes, rothConversionTargetBracket } = config

  const primaryMember = household[0]
  if (!primaryMember) return []

  const realMode = config.simulationMode === 'real'
  const toEffectiveRate = (nominal: number) => realMode ? (1 + nominal) / (1 + inflationRate) - 1 : nominal

  const currentAge = primaryMember.ageAtSimulationStart
  const simulationEndAge = currentAge + config.simulationYears
  const filingStatus: FilingStatus = household.length >= 2 ? 'marriedFilingJointly' : 'single'
  const currentYear = new Date().getFullYear()
  const snapshots: YearlySnapshot[] = []

  const employerEndAges = new Map<string, number>()
  for (const member of household) {
    const endAge = resolveEmployerCoverageEndAge(member, household)
    if (endAge !== null) employerEndAges.set(member.id, endAge)
  }

  const magiHistory: number[] = []
  const accountBalances = new Map<string, number>(
    householdAssets.map((a) => [a.id, a.balanceAtSimulationStart])
  )
  const rothBasisMap = new Map<string, number>(
    householdAssets
      .filter((a) => a.type === 'retirementRoth')
      .map((a) => [a.id, a.rothContributionBasis ?? a.balanceAtSimulationStart])
  )
  const cashAsset = householdAssets.find((a) => a.type === 'cash')

  const ctx: SimContext = {
    config, household, householdAssets, incomeSources, expenses, assetRates,
    marketCrashes, inflationRate, healthcareInflationRate, ssCola,
    rothConversionTargetBracket, filingStatus, realMode, currentAge,
    simulationEndAge, toEffectiveRate, employerEndAges, accountBalances,
    rothBasisMap, cashAsset, primaryMember, magiHistory,
    crashRatesCache: precomputeCrashRates(marketCrashes),
  }

  let depleted = false

  for (let age = currentAge; age <= simulationEndAge; age++) {
    const yearsElapsed = age - currentAge

    // Capture start-of-year balances for net flow calculation
    const startBalances = new Map(accountBalances)

    // Phase 1: Income
    const inc = computeIncome(ctx, yearsElapsed)

    // Phase 2: Initial taxes (federal, FICA, state)
    const tax = computeInitialTaxes(ctx, yearsElapsed, inc)

    // Phase 3: Expenses
    const exp = computeExpenses(ctx, yearsElapsed, age)

    // Phase 4: Net cash flow → account updates (contributions, 529 draw, Roth conversion, waterfall)
    const netCashFlow = inc.income - tax.federalIncomeTax - tax.ficaTax - tax.stateIncomeTax - exp.expenseTotal
    const acct = updateAccounts(ctx, age, netCashFlow, exp.educationExpenseTotal, exp.regularExpenseTotal, tax.taxableWageIncome, inc.interestIncome, tax.taxableSs, inc.incomeBreakdown)

    // Phase 5: Post-waterfall taxes (capital gains, NIIT, traditional IRA)
    const pwTax = computePostWaterfallTaxes(ctx, tax, inc, acct)
    if (cashAsset && pwTax.postWaterfallTaxes > 0) {
      const prev = accountBalances.get(cashAsset.id) ?? 0
      accountBalances.set(cashAsset.id, prev - pwTax.postWaterfallTaxes)
    }

    // Capture pre-appreciation balances to compute human-driven net flow per account
    const preAppreciationBalances = new Map(accountBalances)

    // Phase 6: Apply appreciation
    const { equityOverride } = applyAppreciation(ctx, age)

    // Build snapshot
    const totalAssets = [...accountBalances.values()].reduce((s, b) => s + b, 0)
    if (totalAssets <= 0) {
      depleted = true
      for (const id of accountBalances.keys()) accountBalances.set(id, 0)
    }

    snapshots.push({
      age,
      year: currentYear + yearsElapsed,
      income: inc.income,
      incomeBreakdown: inc.incomeBreakdown,
      federalIncomeTax: tax.federalIncomeTax,
      capitalGainsTax: pwTax.capitalGainsTax,
      niit: pwTax.niit,
      traditionalIraTax: pwTax.traditionalIraTax,
      ficaTax: tax.ficaTax,
      stateIncomeTax: tax.stateIncomeTax + pwTax.stateCapitalGainsTax,
      totalTax: tax.federalIncomeTax + pwTax.capitalGainsTax + pwTax.niit + pwTax.traditionalIraTax + tax.ficaTax + tax.stateIncomeTax + pwTax.stateCapitalGainsTax + acct.earlyWithdrawalPenalty,
      earlyWithdrawalPenalty: acct.earlyWithdrawalPenalty,
      expenses: exp.expenseTotal,
      expenseBreakdown: exp.expenseBreakdown,
      netCashFlow: netCashFlow - pwTax.postWaterfallTaxes - acct.earlyWithdrawalPenalty,
      totalAssets: Math.max(0, totalAssets),
      assetBreakdown: householdAssets.map((a) => {
        const startBalance = startBalances.get(a.id) ?? 0
        const endBalance = accountBalances.get(a.id) ?? 0
        const netFlow = (preAppreciationBalances.get(a.id) ?? 0) - startBalance
        return {
          label: ASSET_TYPE_LABELS[a.type],
          type: a.type,
          startBalance,
          balance: endBalance,
          netFlow,
        }
      }),
      rmdWithdrawn: inc.rmdWithdrawn,
      rothConverted: acct.rothConverted,
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
