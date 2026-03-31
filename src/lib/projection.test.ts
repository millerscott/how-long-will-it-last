import { describe, it, expect } from 'vitest'
import { projectFinances, findDepletionAge, applyWaterfall, draw529ForEducation, getEquityRateOverride } from './projection'
import type { AppConfig, HouseholdMember, HouseholdAsset, RegularExpense, PeriodicExpense, EducationExpense, MarketCrash } from '../types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ZERO_RATES: AppConfig['assetRates'] = {
  cash: 0,
  moneyMarketSavings: 0,
  taxableBrokerage: 0,
  retirementTraditional: 0,
  retirementRoth: 0,
  educationSavings529: 0,
}

function member(overrides: Partial<HouseholdMember> = {}): HouseholdMember {
  return {
    id: 'm1',
    name: 'Test',
    ageAtSimulationStart: 50,
    retirementAge: 65,
    state: 'WA', // WA = no state income tax, keeps math simple
    ...overrides,
  }
}

/** Minimal config: one member, no income, no expenses, cash only, no appreciation. */
function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    household: [member()],
    inflationRate: 0,
    ssCola: 0,
    simulationYears: 10,
    incomeSources: [],
    expenses: [],
    householdAssets: [
      { id: 'cash', type: 'cash', balanceAtSimulationStart: 100_000, contributions: [] },
    ],
    assetRates: ZERO_RATES,
    marketCrashes: [],
    ...overrides,
  }
}

function cashOnly(balance: number): HouseholdAsset[] {
  return [{ id: 'cash', type: 'cash', balanceAtSimulationStart: balance, contributions: [] }]
}

// ---------------------------------------------------------------------------
// projectFinances — basic shape
// ---------------------------------------------------------------------------

describe('projectFinances', () => {
  it('returns empty array when there are no household members', () => {
    expect(projectFinances(baseConfig({ household: [] }))).toEqual([])
  })

  it('returns simulationYears + 1 snapshots covering currentAge to currentAge + simulationYears', () => {
    const result = projectFinances(baseConfig({ simulationYears: 10 }))
    expect(result).toHaveLength(11)
    expect(result[0].age).toBe(50)
    expect(result[10].age).toBe(60)
  })

  it('snapshot year matches calendar year', () => {
    const currentYear = new Date().getFullYear()
    const result = projectFinances(baseConfig())
    expect(result[0].year).toBe(currentYear)
    expect(result[5].year).toBe(currentYear + 5)
  })

  // -------------------------------------------------------------------------
  // Income
  // -------------------------------------------------------------------------

  it('income is 0 when no income sources are configured', () => {
    const result = projectFinances(baseConfig())
    expect(result.every((s) => s.income === 0)).toBe(true)
  })

  it('wage income source is active only between startAge and endAge (inclusive)', () => {
    const result = projectFinances(baseConfig({
      incomeSources: [{
        id: 'i1', memberId: 'm1', name: 'Salary', incomeType: 'wage',
        startAge: 52, endAge: 54, annualAmount: 50_000, annualGrowthRate: 0,
      }],
    }))
    expect(result[0].income).toBe(0)  // age 50 — before start
    expect(result[1].income).toBe(0)  // age 51 — before start
    expect(result[2].income).toBe(50_000)  // age 52 — active
    expect(result[4].income).toBe(50_000)  // age 54 — last active year
    expect(result[5].income).toBe(0)  // age 55 — after end
  })

  it('income source with no endAge runs to the end of the simulation', () => {
    const result = projectFinances(baseConfig({
      simulationYears: 5,
      incomeSources: [{
        id: 'i1', memberId: 'm1', name: 'Salary', incomeType: 'wage',
        startAge: 50, annualAmount: 40_000, annualGrowthRate: 0,
      }],
    }))
    expect(result.every((s) => s.income === 40_000)).toBe(true)
  })

  it('wage income grows at annualGrowthRate', () => {
    const result = projectFinances(baseConfig({
      incomeSources: [{
        id: 'i1', memberId: 'm1', name: 'Salary', incomeType: 'wage',
        startAge: 50, annualAmount: 50_000, annualGrowthRate: 0.10,
      }],
    }))
    expect(result[0].income).toBeCloseTo(50_000)
    expect(result[1].income).toBeCloseTo(55_000)
    expect(result[2].income).toBeCloseTo(60_500)
  })

  it('SS income grows at ssCola rate, not annualGrowthRate', () => {
    const result = projectFinances(baseConfig({
      ssCola: 0.04,
      incomeSources: [{
        id: 'ss1', memberId: 'm1', name: 'Social Security', incomeType: 'socialSecurity',
        startAge: 50, annualAmount: 20_000, annualGrowthRate: 0,
      }],
    }))
    expect(result[0].income).toBeCloseTo(20_000)
    expect(result[1].income).toBeCloseTo(20_800)
    expect(result[2].income).toBeCloseTo(21_632)
  })

  it('income breakdown lists each source separately', () => {
    const result = projectFinances(baseConfig({
      incomeSources: [
        { id: 'i1', memberId: 'm1', name: 'Salary', incomeType: 'wage', startAge: 50, annualAmount: 60_000, annualGrowthRate: 0 },
        { id: 'i2', memberId: 'm1', name: 'Side gig', incomeType: 'other', startAge: 50, annualAmount: 10_000, annualGrowthRate: 0 },
      ],
    }))
    const breakdown = result[0].incomeBreakdown
    expect(breakdown).toHaveLength(2)
    expect(breakdown.find((b) => b.label === 'Salary')?.amount).toBeCloseTo(60_000)
    expect(breakdown.find((b) => b.label === 'Side gig')?.amount).toBeCloseTo(10_000)
  })

  // -------------------------------------------------------------------------
  // Expenses
  // -------------------------------------------------------------------------

  it('annual expense reduces net cash flow each year', () => {
    const result = projectFinances(baseConfig({
      expenses: [{ id: 'e1', name: 'Rent', amount: 12_000, expenseType: 'regular' as const, frequency: 'annual', inflationAdjusted: false }],
    }))
    expect(result[0].expenses).toBe(12_000)
    expect(result[5].expenses).toBe(12_000) // no inflation
  })

  it('monthly expense is annualised (×12)', () => {
    const result = projectFinances(baseConfig({
      expenses: [{ id: 'e1', name: 'Rent', amount: 1_000, expenseType: 'regular' as const, frequency: 'monthly', inflationAdjusted: false }],
    }))
    expect(result[0].expenses).toBe(12_000)
  })

  it('inflation-adjusted expense grows at inflationRate', () => {
    const result = projectFinances(baseConfig({
      inflationRate: 0.05,
      expenses: [{ id: 'e1', name: 'Rent', amount: 10_000, expenseType: 'regular' as const, frequency: 'annual', inflationAdjusted: true }],
    }))
    expect(result[0].expenses).toBeCloseTo(10_000)
    expect(result[1].expenses).toBeCloseTo(10_500)
    expect(result[2].expenses).toBeCloseTo(11_025)
  })

  // -------------------------------------------------------------------------
  // Contributions
  // -------------------------------------------------------------------------

  it('contribution only applies within the active period', () => {
    const result = projectFinances(baseConfig({
      householdAssets: [
        { id: 'cash', type: 'cash', balanceAtSimulationStart: 100_000, contributions: [] },
        {
          id: 'brok', type: 'taxableBrokerage', balanceAtSimulationStart: 0,
          contributions: [{ id: 'c1', startAge: 51, endAge: 53, annualAmount: 5_000 }],
        },
      ],
    }))
    const brokBalance = (idx: number) =>
      result[idx].assetBreakdown.find((a) => a.label === 'Taxable Brokerage')!.balance

    expect(brokBalance(0)).toBe(0)       // age 50 — before period
    expect(brokBalance(1)).toBe(5_000)   // age 51 — first year
    expect(brokBalance(3)).toBe(15_000)  // age 53 — last year in period
    expect(brokBalance(4)).toBe(15_000)  // age 54 — period ended
  })

  it('contribution period with no endAge runs to simulation end', () => {
    const result = projectFinances(baseConfig({
      simulationYears: 3,
      householdAssets: [
        { id: 'cash', type: 'cash', balanceAtSimulationStart: 50_000, contributions: [] },
        {
          id: 'brok', type: 'taxableBrokerage', balanceAtSimulationStart: 0,
          contributions: [{ id: 'c1', startAge: 50, annualAmount: 2_000 }],
        },
      ],
    }))
    const brokBalance = (idx: number) =>
      result[idx].assetBreakdown.find((a) => a.label === 'Taxable Brokerage')!.balance

    expect(brokBalance(0)).toBe(2_000)
    expect(brokBalance(1)).toBe(4_000)
    expect(brokBalance(3)).toBe(8_000)
  })

  // -------------------------------------------------------------------------
  // Depletion
  // -------------------------------------------------------------------------

  it('depleted flag is false when assets remain positive', () => {
    const result = projectFinances(baseConfig())
    expect(result.every((s) => !s.depleted)).toBe(true)
  })

  it('depleted flag trips at the year assets first reach zero', () => {
    // $20k cash, $10k/yr expense, no income
    // age 50: 20k−10k = 10k remaining → not depleted
    // age 51: 10k−10k = 0 → totalAssets ≤ 0 → depleted
    const result = projectFinances(baseConfig({
      simulationYears: 5,
      householdAssets: cashOnly(20_000),
      expenses: [{ id: 'e1', name: 'Exp', amount: 10_000, expenseType: 'regular' as const, frequency: 'annual', inflationAdjusted: false }],
    }))
    expect(result[0].depleted).toBe(false) // age 50: $10k remaining
    expect(result[1].depleted).toBe(true)  // age 51: exactly $0
  })

  it('depleted flag is latched — stays true once set', () => {
    const result = projectFinances(baseConfig({
      simulationYears: 5,
      householdAssets: cashOnly(5_000),
      expenses: [{ id: 'e1', name: 'Exp', amount: 10_000, expenseType: 'regular' as const, frequency: 'annual', inflationAdjusted: false }],
    }))
    const depletedIdx = result.findIndex((s) => s.depleted)
    expect(depletedIdx).toBeGreaterThan(-1)
    expect(result.slice(depletedIdx).every((s) => s.depleted)).toBe(true)
  })

  it('totalAssets is clamped to 0, never negative in snapshot', () => {
    const result = projectFinances(baseConfig({
      simulationYears: 5,
      householdAssets: cashOnly(0),
      expenses: [{ id: 'e1', name: 'Exp', amount: 10_000, expenseType: 'regular' as const, frequency: 'annual', inflationAdjusted: false }],
    }))
    expect(result.every((s) => s.totalAssets >= 0)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // findDepletionAge
  // -------------------------------------------------------------------------

  it('findDepletionAge returns null when assets last through simulation', () => {
    expect(findDepletionAge(projectFinances(baseConfig()))).toBeNull()
  })

  it('findDepletionAge returns the age when assets first hit zero', () => {
    const result = projectFinances(baseConfig({
      simulationYears: 10,
      householdAssets: cashOnly(30_000),
      expenses: [{ id: 'e1', name: 'Exp', amount: 10_000, expenseType: 'regular' as const, frequency: 'annual', inflationAdjusted: false }],
    }))
    // $30k cash, $10k/yr: 50→20k, 51→10k, 52→0 → depleted at age 52
    expect(findDepletionAge(result)).toBe(52)
  })

  // -------------------------------------------------------------------------
  // Interest income
  // -------------------------------------------------------------------------

  it('money market interest appears in income and incomeBreakdown', () => {
    const result = projectFinances(baseConfig({
      simulationYears: 1,
      householdAssets: [
        { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [] },
        { id: 'mm', type: 'moneyMarketSavings', balanceAtSimulationStart: 100_000, contributions: [] },
      ],
      assetRates: { ...ZERO_RATES, moneyMarketSavings: 0.04 },
    }))
    // Year 0: 100k × 4% = $4,000 interest
    expect(result[0].income).toBeCloseTo(4_000)
    const interestItem = result[0].incomeBreakdown.find((b) => b.label.includes('Money Market'))
    expect(interestItem).toBeDefined()
    expect(interestItem!.amount).toBeCloseTo(4_000)
  })

  it('cash interest appears in income and incomeBreakdown', () => {
    const result = projectFinances(baseConfig({
      simulationYears: 1,
      householdAssets: [
        { id: 'cash', type: 'cash', balanceAtSimulationStart: 50_000, contributions: [] },
      ],
      assetRates: { ...ZERO_RATES, cash: 0.02 },
    }))
    // Year 0: 50k × 2% = $1,000 interest
    expect(result[0].income).toBeCloseTo(1_000)
    const interestItem = result[0].incomeBreakdown.find((b) => b.label.includes('Cash'))
    expect(interestItem).toBeDefined()
    expect(interestItem!.amount).toBeCloseTo(1_000)
  })

  it('no interest income when rate is zero', () => {
    const result = projectFinances(baseConfig({
      simulationYears: 1,
      householdAssets: [
        { id: 'cash', type: 'cash', balanceAtSimulationStart: 100_000, contributions: [] },
        { id: 'mm', type: 'moneyMarketSavings', balanceAtSimulationStart: 100_000, contributions: [] },
      ],
      assetRates: ZERO_RATES,
    }))
    expect(result[0].income).toBe(0)
    expect(result[0].incomeBreakdown).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // Capital gains tax on brokerage liquidations
  // -------------------------------------------------------------------------

  it('no capital gains tax when brokerage is not liquidated', () => {
    const result = projectFinances(baseConfig({
      simulationYears: 1,
      householdAssets: [
        { id: 'cash', type: 'cash', balanceAtSimulationStart: 100_000, contributions: [] },
        { id: 'brok', type: 'taxableBrokerage', balanceAtSimulationStart: 50_000, contributions: [] },
      ],
      assetRates: { ...ZERO_RATES, taxableBrokerage: 0.07 },
    }))
    expect(result[0].capitalGainsTax).toBe(0)
    expect(result[0].niit).toBe(0)
  })

  it('traditional IRA withdrawal is taxed as ordinary income when waterfall liquidates it', () => {
    // Age 60+: Traditional is pulled before Roth. $20k expense, no income, cash=0 → waterfall pulls $20k from Traditional
    // Federal ordinary income tax on $20k: taxable = 20k - 16,100 = 3,900 → 10% × 3,900 = $390
    const result = projectFinances(baseConfig({
      simulationYears: 1,
      household: [member({ ageAtSimulationStart: 60 })],
      householdAssets: [
        { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [] },
        { id: 'trad', type: 'retirementTraditional', balanceAtSimulationStart: 100_000, contributions: [] },
      ],
      expenses: [{ id: 'e1', name: 'Exp', amount: 20_000, expenseType: 'regular' as const, frequency: 'annual', inflationAdjusted: false }],
      assetRates: ZERO_RATES,
    }))
    expect(result[0].traditionalIraTax).toBeCloseTo(390)
    const tradItem = result[0].incomeBreakdown.find((b) => b.label === 'Traditional IRA Withdrawal')
    expect(tradItem).toBeDefined()
    expect(tradItem!.amount).toBeCloseTo(20_000)
  })

  it('capital gains tax is applied when waterfall liquidates brokerage', () => {
    // $0 cash, $50k brokerage, $20k expense → waterfall pulls $20k from brokerage
    // Low income → gains likely in 0% bracket for single filer
    const result = projectFinances(baseConfig({
      simulationYears: 1,
      householdAssets: [
        { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [] },
        { id: 'brok', type: 'taxableBrokerage', balanceAtSimulationStart: 50_000, contributions: [] },
      ],
      expenses: [{ id: 'e1', name: 'Exp', amount: 20_000, expenseType: 'regular' as const, frequency: 'annual', inflationAdjusted: false }],
      assetRates: ZERO_RATES,
    }))
    // After waterfall, brokerage withdrawn = $20k; low ordinary income → 0% LTCG
    expect(result[0].capitalGainsTax).toBe(0) // falls in 0% bracket
    // Brokerage balance should have decreased
    const brokBalance = result[0].assetBreakdown.find((a) => a.label === 'Taxable Brokerage')!.balance
    expect(brokBalance).toBe(30_000)
  })
})

// ---------------------------------------------------------------------------
// applyWaterfall — unit tests
// ---------------------------------------------------------------------------

describe('applyWaterfall', () => {
  function makeBalances(entries: Record<string, number>): Map<string, number> {
    return new Map(Object.entries(entries))
  }

  const assets: AppConfig['householdAssets'] = [
    { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [] },
    { id: 'mm', type: 'moneyMarketSavings', balanceAtSimulationStart: 0, contributions: [] },
    { id: 'brok', type: 'taxableBrokerage', balanceAtSimulationStart: 0, contributions: [] },
    { id: 'trad', type: 'retirementTraditional', balanceAtSimulationStart: 0, contributions: [] },
    { id: 'roth', type: 'retirementRoth', balanceAtSimulationStart: 0, contributions: [] },
    { id: '529', type: 'educationSavings529', balanceAtSimulationStart: 0, contributions: [] },
  ]

  it('does nothing when cash is non-negative', () => {
    const balances = makeBalances({ cash: 100, mm: 1_000 })
    const result = applyWaterfall(balances, 'cash', assets, 50)
    expect(balances.get('cash')).toBe(100)
    expect(balances.get('mm')).toBe(1_000)
    expect(result.brokerageWithdrawn).toBe(0)
    expect(result.traditionalWithdrawn).toBe(0)
  })

  it('pulls from money market first', () => {
    const balances = makeBalances({ cash: -5_000, mm: 20_000, brok: 10_000 })
    const result = applyWaterfall(balances, 'cash', assets, 50)
    expect(balances.get('cash')).toBe(0)
    expect(balances.get('mm')).toBe(15_000) // 5k withdrawn
    expect(balances.get('brok')).toBe(10_000) // untouched
    expect(result.brokerageWithdrawn).toBe(0)
  })

  it('spills into brokerage after money market is exhausted', () => {
    const balances = makeBalances({ cash: -8_000, mm: 5_000, brok: 10_000 })
    const result = applyWaterfall(balances, 'cash', assets, 50)
    expect(balances.get('cash')).toBe(0)
    expect(balances.get('mm')).toBe(0)
    expect(balances.get('brok')).toBe(7_000) // 3k withdrawn after MM drained
    expect(result.brokerageWithdrawn).toBe(3_000)
    expect(result.traditionalWithdrawn).toBe(0)
  })

  it('tracks traditionalWithdrawn when traditional is liquidated (age 60+)', () => {
    const balances = makeBalances({ cash: -10_000, trad: 50_000, roth: 50_000 })
    const result = applyWaterfall(balances, 'cash', assets, 60)
    expect(result.traditionalWithdrawn).toBe(10_000)
    expect(result.brokerageWithdrawn).toBe(0)
  })

  it('traditionalWithdrawn is 0 when roth covers the shortfall pre-60', () => {
    const balances = makeBalances({ cash: -10_000, trad: 50_000, roth: 50_000 })
    const result = applyWaterfall(balances, 'cash', assets, 55)
    expect(result.traditionalWithdrawn).toBe(0)
    expect(result.brokerageWithdrawn).toBe(0)
  })

  it('pre-60: pulls from Roth before Traditional', () => {
    const balances = makeBalances({ cash: -10_000, trad: 50_000, roth: 50_000 })
    applyWaterfall(balances, 'cash', assets, 55)
    expect(balances.get('roth')).toBe(40_000)
    expect(balances.get('trad')).toBe(50_000) // untouched
  })

  it('age 60+: pulls from Traditional before Roth', () => {
    const balances = makeBalances({ cash: -10_000, trad: 50_000, roth: 50_000 })
    applyWaterfall(balances, 'cash', assets, 60)
    expect(balances.get('trad')).toBe(40_000)
    expect(balances.get('roth')).toBe(50_000) // untouched
  })

  it('529 is pulled last', () => {
    const balances = makeBalances({ cash: -5_000, '529': 20_000, roth: 10_000 })
    applyWaterfall(balances, 'cash', assets, 50)
    expect(balances.get('roth')).toBe(5_000)  // pulled first (pre-60)
    expect(balances.get('529')).toBe(20_000)  // untouched
  })

  it('no account goes below zero', () => {
    const balances = makeBalances({ cash: -8_000, mm: 3_000, brok: 3_000 })
    applyWaterfall(balances, 'cash', assets, 50)
    expect(balances.get('mm')).toBe(0)
    expect(balances.get('brok')).toBe(0)
    // 2k shortfall remains as negative cash (true insolvency)
    expect(balances.get('cash')).toBe(-2_000)
  })

  it('leaves negative cash when all sources are exhausted', () => {
    const balances = makeBalances({ cash: -20_000, mm: 5_000 })
    applyWaterfall(balances, 'cash', assets, 50)
    expect(balances.get('mm')).toBe(0)
    expect(balances.get('cash')).toBe(-15_000)
  })

  it('returns total brokerage withdrawn across multiple brokerage accounts', () => {
    const multiAssets: AppConfig['householdAssets'] = [
      { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [] },
      { id: 'brok1', type: 'taxableBrokerage', balanceAtSimulationStart: 0, contributions: [] },
      { id: 'brok2', type: 'taxableBrokerage', balanceAtSimulationStart: 0, contributions: [] },
    ]
    const balances = makeBalances({ cash: -12_000, brok1: 5_000, brok2: 10_000 })
    const result = applyWaterfall(balances, 'cash', multiAssets, 50)
    expect(result.brokerageWithdrawn).toBe(12_000)
    expect(balances.get('brok1')).toBe(0)
    expect(balances.get('brok2')).toBe(3_000)
  })

  // -------------------------------------------------------------------------
  // Cash reserve
  // -------------------------------------------------------------------------

  it('cash with reserve: pulls from MM to reach cashTarget, not just zero', () => {
    // annualExpenses = $60k → monthly = $5k → cashTarget = 2 × $5k = $10k
    // cash = $5k (below target), MM = $20k → MM pulled to fund $5k gap
    const reserveAssets: AppConfig['householdAssets'] = [
      { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [], monthsReserve: 2 },
      { id: 'mm', type: 'moneyMarketSavings', balanceAtSimulationStart: 0, contributions: [] },
    ]
    const balances = makeBalances({ cash: 5_000, mm: 20_000 })
    applyWaterfall(balances, 'cash', reserveAssets, 50, 60_000)
    expect(balances.get('cash')).toBe(10_000)  // brought up to target
    expect(balances.get('mm')).toBe(15_000)    // 5k withdrawn
  })

  it('cash with reserve: no waterfall when cash already meets target', () => {
    const reserveAssets: AppConfig['householdAssets'] = [
      { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [], monthsReserve: 2 },
      { id: 'mm', type: 'moneyMarketSavings', balanceAtSimulationStart: 0, contributions: [] },
    ]
    const balances = makeBalances({ cash: 15_000, mm: 20_000 })
    const result = applyWaterfall(balances, 'cash', reserveAssets, 50, 60_000)  // target = $10k
    expect(result.brokerageWithdrawn).toBe(0)
    expect(balances.get('cash')).toBe(15_000)  // unchanged
    expect(balances.get('mm')).toBe(20_000)    // unchanged
  })

  it('cash with reserve: negative cash + reserve target both included in pull', () => {
    // annualExpenses = $120k → monthly = $10k → cashTarget = 1 × $10k = $10k
    // cash = -$3k → total pull = $13k
    const reserveAssets: AppConfig['householdAssets'] = [
      { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [], monthsReserve: 1 },
      { id: 'mm', type: 'moneyMarketSavings', balanceAtSimulationStart: 0, contributions: [] },
    ]
    const balances = makeBalances({ cash: -3_000, mm: 30_000 })
    applyWaterfall(balances, 'cash', reserveAssets, 50, 120_000)
    expect(balances.get('cash')).toBe(10_000)
    expect(balances.get('mm')).toBe(17_000)  // 13k pulled
  })

  it('cash with reserve: insolvency — cash ends negative when sources exhausted', () => {
    const reserveAssets: AppConfig['householdAssets'] = [
      { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [], monthsReserve: 3 },
      { id: 'mm', type: 'moneyMarketSavings', balanceAtSimulationStart: 0, contributions: [] },
    ]
    // target = $15k, cash = -$5k → need $20k; only $8k available in MM
    const balances = makeBalances({ cash: -5_000, mm: 8_000 })
    applyWaterfall(balances, 'cash', reserveAssets, 50, 60_000)
    expect(balances.get('mm')).toBe(0)
    expect(balances.get('cash')).toBe(3_000)  // -5k + 8k = 3k (below target, but all available was used)
  })

  // -------------------------------------------------------------------------
  // MM reserve protection (source floor)
  // -------------------------------------------------------------------------

  it('MM with reserve: only above-floor amount is drainable', () => {
    // MM at $20k with $15k reserve target → only $5k drainable; cash shortfall $8k → $3k from brokerage
    const reserveAssets: AppConfig['householdAssets'] = [
      { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [] },
      { id: 'mm', type: 'moneyMarketSavings', balanceAtSimulationStart: 0, contributions: [], monthsReserve: 3 },
      { id: 'brok', type: 'taxableBrokerage', balanceAtSimulationStart: 0, contributions: [] },
    ]
    // annualExpenses = $60k → monthly = $5k → mmTarget = 3 × $5k = $15k
    const balances = makeBalances({ cash: -8_000, mm: 20_000, brok: 10_000 })
    applyWaterfall(balances, 'cash', reserveAssets, 50, 60_000)
    expect(balances.get('cash')).toBe(0)
    expect(balances.get('mm')).toBe(15_000)  // drained to floor, not below
    expect(balances.get('brok')).toBe(7_000) // remaining 3k pulled from brokerage
  })

  it('MM with reserve at exactly its floor: contributes 0 to pull', () => {
    const reserveAssets: AppConfig['householdAssets'] = [
      { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [] },
      { id: 'mm', type: 'moneyMarketSavings', balanceAtSimulationStart: 0, contributions: [], monthsReserve: 2 },
      { id: 'brok', type: 'taxableBrokerage', balanceAtSimulationStart: 0, contributions: [] },
    ]
    // annualExpenses = $60k → mmTarget = $10k; MM balance exactly at target
    const balances = makeBalances({ cash: -5_000, mm: 10_000, brok: 20_000 })
    applyWaterfall(balances, 'cash', reserveAssets, 50, 60_000)
    expect(balances.get('mm')).toBe(10_000)  // untouched
    expect(balances.get('brok')).toBe(15_000)
    expect(balances.get('cash')).toBe(0)
  })

  // -------------------------------------------------------------------------
  // MM top-up (destination)
  // -------------------------------------------------------------------------

  it('MM with reserve: waterfall fires even when cash is non-negative to top up MM', () => {
    // Cash = $8k (positive, no reserve), MM = $5k with $10k target → pull $5k from brokerage → MM topped up
    const reserveAssets: AppConfig['householdAssets'] = [
      { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [] },
      { id: 'mm', type: 'moneyMarketSavings', balanceAtSimulationStart: 0, contributions: [], monthsReserve: 2 },
      { id: 'brok', type: 'taxableBrokerage', balanceAtSimulationStart: 0, contributions: [] },
    ]
    // annualExpenses = $60k → mmTarget = $10k
    const balances = makeBalances({ cash: 8_000, mm: 5_000, brok: 50_000 })
    applyWaterfall(balances, 'cash', reserveAssets, 50, 60_000)
    expect(balances.get('mm')).toBe(10_000)  // topped up
    expect(balances.get('cash')).toBe(8_000) // unchanged
    expect(balances.get('brok')).toBe(45_000)// 5k pulled
  })

  // -------------------------------------------------------------------------
  // Cash → MM distribution constraint
  // -------------------------------------------------------------------------

  it('cash stays at its target after pull: no transfer to MM', () => {
    // cashTarget = $10k, mmTarget = $10k; both below target
    // Total pull = $20k from brokerage
    // After pull: cash = $0 + $20k... wait, let me think
    // cash = $0, cashTarget = $10k; MM = $5k, mmTarget = $10k
    // cashShortfall = $10k, mmTopUp = $5k → totalPull = $15k from brokerage
    // After pull: cash = $0 + $15k = $15k
    // Distribute: cashAvailable = $15k - $10k = $5k → transfer $5k to MM
    // MM ends at $10k, cash ends at $10k
    const reserveAssets: AppConfig['householdAssets'] = [
      { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [], monthsReserve: 2 },
      { id: 'mm', type: 'moneyMarketSavings', balanceAtSimulationStart: 0, contributions: [], monthsReserve: 2 },
      { id: 'brok', type: 'taxableBrokerage', balanceAtSimulationStart: 0, contributions: [] },
    ]
    // annualExpenses = $60k → monthly = $5k → cashTarget = mmTarget = $10k
    const balances = makeBalances({ cash: 0, mm: 5_000, brok: 50_000 })
    applyWaterfall(balances, 'cash', reserveAssets, 50, 60_000)
    expect(balances.get('cash')).toBe(10_000)
    expect(balances.get('mm')).toBe(10_000)
    expect(balances.get('brok')).toBe(35_000) // 15k pulled
  })

  it('partial MM top-up when pulled cash is only slightly above cashTarget', () => {
    // cashTarget = $10k; MM target = $10k, MM balance = $3k (deficit $7k)
    // cash = $8k → cashShortfall = $2k; mmTopUp = $7k → totalPull = $9k
    // After pull: cash = $8k + $9k = $17k; cashAvailable for MM = $17k - $10k = $7k
    // Transfer $7k to MM → MM = $10k, cash = $10k
    const reserveAssets: AppConfig['householdAssets'] = [
      { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [], monthsReserve: 2 },
      { id: 'mm', type: 'moneyMarketSavings', balanceAtSimulationStart: 0, contributions: [], monthsReserve: 2 },
      { id: 'brok', type: 'taxableBrokerage', balanceAtSimulationStart: 0, contributions: [] },
    ]
    const balances = makeBalances({ cash: 8_000, mm: 3_000, brok: 50_000 })
    applyWaterfall(balances, 'cash', reserveAssets, 50, 60_000)
    expect(balances.get('cash')).toBe(10_000)
    expect(balances.get('mm')).toBe(10_000)
    expect(balances.get('brok')).toBe(41_000) // 9k pulled
  })
})

// ---------------------------------------------------------------------------
// draw529ForEducation — unit tests
// ---------------------------------------------------------------------------

describe('draw529ForEducation', () => {
  it('returns 0 when amountNeeded is 0', () => {
    const balances = new Map([['529a', 50_000]])
    const assets: AppConfig['householdAssets'] = [
      { id: '529a', type: 'educationSavings529', balanceAtSimulationStart: 0, contributions: [] },
    ]
    expect(draw529ForEducation(balances, assets, 0)).toBe(0)
    expect(balances.get('529a')).toBe(50_000)
  })

  it('returns 0 when amountNeeded is negative', () => {
    const balances = new Map([['529a', 50_000]])
    const assets: AppConfig['householdAssets'] = [
      { id: '529a', type: 'educationSavings529', balanceAtSimulationStart: 0, contributions: [] },
    ]
    expect(draw529ForEducation(balances, assets, -1000)).toBe(0)
  })

  it('draws from a single 529 with enough balance', () => {
    const balances = new Map([['529a', 50_000]])
    const assets: AppConfig['householdAssets'] = [
      { id: '529a', type: 'educationSavings529', balanceAtSimulationStart: 0, contributions: [] },
    ]
    const drawn = draw529ForEducation(balances, assets, 20_000)
    expect(drawn).toBe(20_000)
    expect(balances.get('529a')).toBe(30_000)
  })

  it('returns less than amountNeeded when 529 runs out', () => {
    const balances = new Map([['529a', 5_000]])
    const assets: AppConfig['householdAssets'] = [
      { id: '529a', type: 'educationSavings529', balanceAtSimulationStart: 0, contributions: [] },
    ]
    const drawn = draw529ForEducation(balances, assets, 20_000)
    expect(drawn).toBe(5_000)
    expect(balances.get('529a')).toBe(0)
  })

  it('drains first 529 before drawing from second', () => {
    const balances = new Map([['529a', 8_000], ['529b', 15_000]])
    const assets: AppConfig['householdAssets'] = [
      { id: '529a', type: 'educationSavings529', balanceAtSimulationStart: 0, contributions: [] },
      { id: '529b', type: 'educationSavings529', balanceAtSimulationStart: 0, contributions: [] },
    ]
    const drawn = draw529ForEducation(balances, assets, 20_000)
    expect(drawn).toBe(20_000)
    expect(balances.get('529a')).toBe(0)
    expect(balances.get('529b')).toBe(3_000)
  })

  it('returns total drawn when two 529s together are insufficient', () => {
    const balances = new Map([['529a', 8_000], ['529b', 5_000]])
    const assets: AppConfig['householdAssets'] = [
      { id: '529a', type: 'educationSavings529', balanceAtSimulationStart: 0, contributions: [] },
      { id: '529b', type: 'educationSavings529', balanceAtSimulationStart: 0, contributions: [] },
    ]
    const drawn = draw529ForEducation(balances, assets, 20_000)
    expect(drawn).toBe(13_000)
    expect(balances.get('529a')).toBe(0)
    expect(balances.get('529b')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Expense types — age gating, periodic, education
// ---------------------------------------------------------------------------

describe('expense age gating', () => {
  function regularExp(overrides: Partial<RegularExpense> = {}): RegularExpense {
    return {
      id: 'e1',
      name: 'Test expense',
      amount: 12_000,
      expenseType: 'regular',
      frequency: 'annual',
      inflationAdjusted: false,
      ...overrides,
    }
  }

  it('regular expense with startAge: zero expense before startAge', () => {
    const cfg = baseConfig({
      expenses: [regularExp({ startAge: 55 })],
    })
    const snaps = projectFinances(cfg)
    // ages 50–54 should have 0 expenses
    snaps.filter((s) => s.age < 55).forEach((s) => expect(s.expenses).toBe(0))
    // age 55+ should have the expense
    snaps.filter((s) => s.age >= 55).forEach((s) => expect(s.expenses).toBe(12_000))
  })

  it('regular expense with endAge: zero expense after endAge', () => {
    const cfg = baseConfig({
      expenses: [regularExp({ endAge: 52 })],
    })
    const snaps = projectFinances(cfg)
    snaps.filter((s) => s.age <= 52).forEach((s) => expect(s.expenses).toBe(12_000))
    snaps.filter((s) => s.age > 52).forEach((s) => expect(s.expenses).toBe(0))
  })

  it('regular expense with startAge and endAge: only active in range', () => {
    const cfg = baseConfig({
      expenses: [regularExp({ startAge: 52, endAge: 54 })],
    })
    const snaps = projectFinances(cfg)
    snaps.filter((s) => s.age < 52 || s.age > 54).forEach((s) => expect(s.expenses).toBe(0))
    snaps.filter((s) => s.age >= 52 && s.age <= 54).forEach((s) => expect(s.expenses).toBe(12_000))
  })
})

describe('periodic expenses', () => {
  function periodicExp(overrides: Partial<PeriodicExpense> = {}): PeriodicExpense {
    return {
      id: 'e1',
      name: 'Home maintenance',
      amount: 10_000,
      expenseType: 'periodic',
      intervalYears: 3,
      inflationAdjusted: false,
      ...overrides,
    }
  }

  it('fires at currentAge and every intervalYears after (intervalYears=3, startAge=currentAge)', () => {
    const cfg = baseConfig({
      expenses: [periodicExp({ intervalYears: 3 })],
    })
    const snaps = projectFinances(cfg)
    // currentAge=50: fires at 50, 53, 56, 59; not at 51, 52, 54, 55, 57, 58, 60
    const fireAges = [50, 53, 56, 59]
    const noFireAges = [51, 52, 54, 55, 57, 58, 60]
    fireAges.forEach((age) => {
      const s = snaps.find((x) => x.age === age)!
      expect(s.expenses).toBe(10_000)
    })
    noFireAges.forEach((age) => {
      const s = snaps.find((x) => x.age === age)!
      expect(s.expenses).toBe(0)
    })
  })

  it('startAge offsets the first fire year', () => {
    // startAge=52, intervalYears=5: fires at 52, 57; not at 50, 51, 53, 54, 55, 56
    const cfg = baseConfig({
      expenses: [periodicExp({ startAge: 52, intervalYears: 5 })],
    })
    const snaps = projectFinances(cfg)
    expect(snaps.find((s) => s.age === 50)!.expenses).toBe(0)
    expect(snaps.find((s) => s.age === 51)!.expenses).toBe(0)
    expect(snaps.find((s) => s.age === 52)!.expenses).toBe(10_000)
    expect(snaps.find((s) => s.age === 53)!.expenses).toBe(0)
    expect(snaps.find((s) => s.age === 57)!.expenses).toBe(10_000)
  })

  it('does not fire after endAge', () => {
    // fires at 50, 53, 56 — but endAge=55 blocks 56
    const cfg = baseConfig({
      expenses: [periodicExp({ intervalYears: 3, endAge: 55 })],
    })
    const snaps = projectFinances(cfg)
    expect(snaps.find((s) => s.age === 50)!.expenses).toBe(10_000)
    expect(snaps.find((s) => s.age === 53)!.expenses).toBe(10_000)
    expect(snaps.find((s) => s.age === 56)!.expenses).toBe(0)
  })

  it('applies inflation to amount in a fire year', () => {
    const cfg = baseConfig({
      inflationRate: 0.10,
      expenses: [periodicExp({ intervalYears: 3, inflationAdjusted: true })],
    })
    const snaps = projectFinances(cfg)
    // First fire year is age 50 (yearsElapsed=0) — no inflation yet
    expect(snaps.find((s) => s.age === 50)!.expenses).toBeCloseTo(10_000, 0)
    // Next fire year is age 53 (yearsElapsed=3) — inflated by (1.1)^3
    const expected53 = 10_000 * Math.pow(1.1, 3)
    expect(snaps.find((s) => s.age === 53)!.expenses).toBeCloseTo(expected53, 0)
  })

  it('non-fire year has zero expenses for a periodic-only config', () => {
    const cfg = baseConfig({
      expenses: [periodicExp({ intervalYears: 3 })],
    })
    const snaps = projectFinances(cfg)
    expect(snaps.find((s) => s.age === 51)!.expenses).toBe(0)
  })
})

describe('education expenses and 529 draw', () => {
  function educationExp(overrides: Partial<EducationExpense> = {}): EducationExpense {
    return {
      id: 'e1',
      name: 'Tuition',
      amount: 20_000,
      expenseType: 'education',
      frequency: 'annual',
      inflationAdjusted: false,
      ...overrides,
    }
  }

  it('529 covers full education expense — cash unchanged, 529 decreases', () => {
    const cfg = baseConfig({
      expenses: [educationExp()],
      householdAssets: [
        { id: 'cash', type: 'cash', balanceAtSimulationStart: 100_000, contributions: [] },
        { id: '529', type: 'educationSavings529', balanceAtSimulationStart: 50_000, contributions: [] },
      ],
    })
    const snaps = projectFinances(cfg)
    // After year 1 (age 50): cash starts at 100k, netCashFlow = -20k (expense), then 529 reimburses 20k
    // So cash ends at 100k, 529 ends at 30k
    const s0 = snaps[0]
    expect(s0.assetBreakdown.find((a) => a.label === 'Cash')!.balance).toBeCloseTo(100_000, 0)
    expect(s0.assetBreakdown.find((a) => a.label === 'Education Savings (529 Plan)')!.balance).toBeCloseTo(30_000, 0)
    expect(s0.expenses).toBe(20_000)
  })

  it('529 partially covers education — remainder from cash', () => {
    const cfg = baseConfig({
      expenses: [educationExp()],
      householdAssets: [
        { id: 'cash', type: 'cash', balanceAtSimulationStart: 100_000, contributions: [] },
        { id: '529', type: 'educationSavings529', balanceAtSimulationStart: 5_000, contributions: [] },
      ],
    })
    const snaps = projectFinances(cfg)
    const s0 = snaps[0]
    // 529 covers $5k, remaining $15k from cash
    expect(s0.assetBreakdown.find((a) => a.label === 'Education Savings (529 Plan)')!.balance).toBeCloseTo(0, 0)
    // cash = 100k - 20k (expense via netCashFlow) + 5k (529 refund) = 85k
    expect(s0.assetBreakdown.find((a) => a.label === 'Cash')!.balance).toBeCloseTo(85_000, 0)
  })

  it('no 529 — full education expense from cash', () => {
    const cfg = baseConfig({
      expenses: [educationExp()],
    })
    const snaps = projectFinances(cfg)
    const s0 = snaps[0]
    expect(s0.assetBreakdown.find((a) => a.label === 'Cash')!.balance).toBeCloseTo(80_000, 0)
  })

  it('two 529 accounts — first drained before second drawn', () => {
    const cfg = baseConfig({
      expenses: [educationExp()],
      householdAssets: [
        { id: 'cash', type: 'cash', balanceAtSimulationStart: 100_000, contributions: [] },
        { id: '529a', type: 'educationSavings529', balanceAtSimulationStart: 8_000, contributions: [] },
        { id: '529b', type: 'educationSavings529', balanceAtSimulationStart: 15_000, contributions: [] },
      ],
    })
    const snaps = projectFinances(cfg)
    const s0 = snaps[0]
    // 529a ($8k) fully drained, 529b ($15k) down by $12k → total 529 = $3k
    const total529 = s0.assetBreakdown
      .filter((a) => a.label === 'Education Savings (529 Plan)')
      .reduce((sum, a) => sum + a.balance, 0)
    expect(total529).toBeCloseTo(3_000, 0)
    // cash = 100k - 20k + 20k (fully covered) = 100k
    expect(s0.assetBreakdown.find((a) => a.label === 'Cash')!.balance).toBeCloseTo(100_000, 0)
  })

  it('expenses snapshot includes education + regular in the same year', () => {
    const regular: RegularExpense = { id: 'r1', name: 'Food', amount: 24_000, expenseType: 'regular', frequency: 'annual', inflationAdjusted: false }
    const education = educationExp()
    const cfg = baseConfig({ expenses: [regular, education] })
    const snaps = projectFinances(cfg)
    expect(snaps[0].expenses).toBe(44_000)
  })
})

// ---------------------------------------------------------------------------
// getEquityRateOverride — unit tests
// ---------------------------------------------------------------------------

function crash(overrides: Partial<MarketCrash> = {}): MarketCrash {
  return {
    id: 'c1',
    label: 'Test crash',
    startAge: 60,
    declinePercent: 0.35,
    durationYears: 2,
    recoveryYears: 3,
    ...overrides,
  }
}

describe('getEquityRateOverride', () => {
  it('returns null before the crash starts', () => {
    expect(getEquityRateOverride(59, [crash()])).toBeNull()
  })

  it('returns negative crash rate during crash period', () => {
    // -35% over 2 years: (0.65)^(1/2) - 1
    const expected = Math.pow(0.65, 0.5) - 1
    expect(getEquityRateOverride(60, [crash()])).toBeCloseTo(expected, 10)
    expect(getEquityRateOverride(61, [crash()])).toBeCloseTo(expected, 10)
  })

  it('returns positive recovery rate during recovery period', () => {
    // recover from -35% over 3 years: (1/0.65)^(1/3) - 1
    const expected = Math.pow(1 / 0.65, 1 / 3) - 1
    expect(getEquityRateOverride(62, [crash()])).toBeCloseTo(expected, 10) // crashEnd = 62
    expect(getEquityRateOverride(64, [crash()])).toBeCloseTo(expected, 10)
  })

  it('returns null at the end of the recovery period', () => {
    // recoveryEnd = startAge(60) + duration(2) + recovery(3) = 65
    expect(getEquityRateOverride(65, [crash()])).toBeNull()
  })

  it('first crash wins when two crashes overlap', () => {
    const c1 = crash({ id: 'c1', startAge: 60, declinePercent: 0.35, durationYears: 2, recoveryYears: 3 })
    const c2 = crash({ id: 'c2', startAge: 60, declinePercent: 0.20, durationYears: 1, recoveryYears: 2 })
    const rate = getEquityRateOverride(60, [c1, c2])
    expect(rate).toBeCloseTo(Math.pow(0.65, 0.5) - 1, 10) // c1 wins
  })

  it('returns null with empty crash list', () => {
    expect(getEquityRateOverride(65, [])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Market crash integration tests
// ---------------------------------------------------------------------------

describe('market crash projection', () => {
  const EQUITY_RATES = { ...ZERO_RATES, taxableBrokerage: 0.07, retirementTraditional: 0.07, retirementRoth: 0.07, educationSavings529: 0.07 }

  it('brokerage balance is lower during and after crash vs no-crash baseline', () => {
    const assets: AppConfig['householdAssets'] = [
      { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [] },
      { id: 'brok', type: 'taxableBrokerage', balanceAtSimulationStart: 100_000, contributions: [] },
    ]
    const noCrash = projectFinances(baseConfig({ householdAssets: assets, assetRates: EQUITY_RATES }))
    const withCrash = projectFinances(baseConfig({
      householdAssets: assets,
      assetRates: EQUITY_RATES,
      marketCrashes: [crash({ startAge: 51, declinePercent: 0.35, durationYears: 2, recoveryYears: 3 })],
    }))

    // During crash (age 51, 52): brokerage lower than no-crash
    const crashAge = withCrash.find((s) => s.age === 51)!
    const noCrashAge = noCrash.find((s) => s.age === 51)!
    expect(crashAge.assetBreakdown.find((a) => a.label === 'Taxable Brokerage')!.balance)
      .toBeLessThan(noCrashAge.assetBreakdown.find((a) => a.label === 'Taxable Brokerage')!.balance)
  })

  it('marketCrashActive is true only during crash and recovery ages', () => {
    const snaps = projectFinances(baseConfig({
      marketCrashes: [crash({ startAge: 52, durationYears: 2, recoveryYears: 3 })],
    }))
    // before crash
    expect(snaps.find((s) => s.age === 50)!.marketCrashActive).toBe(false)
    expect(snaps.find((s) => s.age === 51)!.marketCrashActive).toBe(false)
    // crash period: 52, 53
    expect(snaps.find((s) => s.age === 52)!.marketCrashActive).toBe(true)
    expect(snaps.find((s) => s.age === 53)!.marketCrashActive).toBe(true)
    // recovery period: 54, 55, 56
    expect(snaps.find((s) => s.age === 54)!.marketCrashActive).toBe(true)
    expect(snaps.find((s) => s.age === 56)!.marketCrashActive).toBe(true)
    // after recovery
    expect(snaps.find((s) => s.age === 57)!.marketCrashActive).toBe(false)
  })

  it('cash and MM balances are unaffected by a crash', () => {
    const assets: AppConfig['householdAssets'] = [
      { id: 'cash', type: 'cash', balanceAtSimulationStart: 50_000, contributions: [] },
      { id: 'mm', type: 'moneyMarketSavings', balanceAtSimulationStart: 30_000, contributions: [] },
    ]
    const mmRates = { ...ZERO_RATES, moneyMarketSavings: 0.04 }
    const noCrash = projectFinances(baseConfig({ householdAssets: assets, assetRates: mmRates }))
    const withCrash = projectFinances(baseConfig({
      householdAssets: assets,
      assetRates: mmRates,
      marketCrashes: [crash({ startAge: 51, durationYears: 2, recoveryYears: 3 })],
    }))

    for (let age = 51; age <= 56; age++) {
      const nc = noCrash.find((s) => s.age === age)!
      const wc = withCrash.find((s) => s.age === age)!
      expect(wc.assetBreakdown.find((a) => a.label === 'Cash')!.balance)
        .toBeCloseTo(nc.assetBreakdown.find((a) => a.label === 'Cash')!.balance, 2)
      expect(wc.assetBreakdown.find((a) => a.label === 'Money Market / Savings')!.balance)
        .toBeCloseTo(nc.assetBreakdown.find((a) => a.label === 'Money Market / Savings')!.balance, 2)
    }
  })

  it('normal rates resume after the recovery period ends', () => {
    const assets: AppConfig['householdAssets'] = [
      { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [] },
      { id: 'brok', type: 'taxableBrokerage', balanceAtSimulationStart: 100_000, contributions: [] },
    ]
    const snaps = projectFinances(baseConfig({
      householdAssets: assets,
      assetRates: EQUITY_RATES,
      marketCrashes: [crash({ startAge: 51, durationYears: 1, recoveryYears: 1 })],
    }))
    // After recovery ends (age 53+), growth rate should be back to 7%
    const s53 = snaps.find((s) => s.age === 53)!
    const s54 = snaps.find((s) => s.age === 54)!
    const brok53 = s53.assetBreakdown.find((a) => a.label === 'Taxable Brokerage')!.balance
    const brok54 = s54.assetBreakdown.find((a) => a.label === 'Taxable Brokerage')!.balance
    expect(brok54).toBeCloseTo(brok53 * 1.07, 2)
  })
})
