import { describe, it, expect } from 'vitest'
import { projectFinances, findDepletionAge, applyWaterfall } from './projection'
import type { AppConfig, HouseholdMember, HouseholdAsset } from '../types'

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
      expenses: [{ id: 'e1', name: 'Rent', amount: 12_000, frequency: 'annual', inflationAdjusted: false }],
    }))
    expect(result[0].expenses).toBe(12_000)
    expect(result[5].expenses).toBe(12_000) // no inflation
  })

  it('monthly expense is annualised (×12)', () => {
    const result = projectFinances(baseConfig({
      expenses: [{ id: 'e1', name: 'Rent', amount: 1_000, frequency: 'monthly', inflationAdjusted: false }],
    }))
    expect(result[0].expenses).toBe(12_000)
  })

  it('inflation-adjusted expense grows at inflationRate', () => {
    const result = projectFinances(baseConfig({
      inflationRate: 0.05,
      expenses: [{ id: 'e1', name: 'Rent', amount: 10_000, frequency: 'annual', inflationAdjusted: true }],
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
      expenses: [{ id: 'e1', name: 'Exp', amount: 10_000, frequency: 'annual', inflationAdjusted: false }],
    }))
    expect(result[0].depleted).toBe(false) // age 50: $10k remaining
    expect(result[1].depleted).toBe(true)  // age 51: exactly $0
  })

  it('depleted flag is latched — stays true once set', () => {
    const result = projectFinances(baseConfig({
      simulationYears: 5,
      householdAssets: cashOnly(5_000),
      expenses: [{ id: 'e1', name: 'Exp', amount: 10_000, frequency: 'annual', inflationAdjusted: false }],
    }))
    const depletedIdx = result.findIndex((s) => s.depleted)
    expect(depletedIdx).toBeGreaterThan(-1)
    expect(result.slice(depletedIdx).every((s) => s.depleted)).toBe(true)
  })

  it('totalAssets is clamped to 0, never negative in snapshot', () => {
    const result = projectFinances(baseConfig({
      simulationYears: 5,
      householdAssets: cashOnly(0),
      expenses: [{ id: 'e1', name: 'Exp', amount: 10_000, frequency: 'annual', inflationAdjusted: false }],
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
      expenses: [{ id: 'e1', name: 'Exp', amount: 10_000, frequency: 'annual', inflationAdjusted: false }],
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

  it('capital gains tax is applied when waterfall liquidates brokerage', () => {
    // $0 cash, $50k brokerage, $20k expense → waterfall pulls $20k from brokerage
    // Low income → gains likely in 0% bracket for single filer
    const result = projectFinances(baseConfig({
      simulationYears: 1,
      householdAssets: [
        { id: 'cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [] },
        { id: 'brok', type: 'taxableBrokerage', balanceAtSimulationStart: 50_000, contributions: [] },
      ],
      expenses: [{ id: 'e1', name: 'Exp', amount: 20_000, frequency: 'annual', inflationAdjusted: false }],
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
})
