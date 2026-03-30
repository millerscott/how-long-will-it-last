export interface HouseholdMember {
  id: string
  name: string
  ageAtSimulationStart: number
  retirementAge: number
  state: string
}

export interface IncomeSource {
  id: string
  memberId: string
  name: string
  /** Age at which this income begins */
  startAge: number
  /** Annual amount in base (simulation start) year dollars */
  annualAmount: number
  /** Expected annual growth rate, e.g. 0.03 for 3% */
  annualGrowthRate: number
  /** Age at which income ends. If omitted, ends at the member's retirementAge */
  endAge?: number
}

export type Frequency = 'monthly' | 'annual'

export interface Expense {
  id: string
  name: string
  amount: number
  frequency: Frequency
  /** If true, grows with inflation each year */
  inflationAdjusted: boolean
}

export type AssetType =
  | 'cash'
  | 'moneyMarketSavings'
  | 'taxableBrokerage'
  | 'retirementTraditional'
  | 'retirementRoth'
  | 'educationSavings529'

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  cash: 'Cash',
  moneyMarketSavings: 'Money Market / Savings',
  taxableBrokerage: 'Taxable Brokerage',
  retirementTraditional: 'Retirement Account (Traditional)',
  retirementRoth: 'Retirement Account (Roth)',
  educationSavings529: 'Education Savings (529 Plan)',
}

export const ADDABLE_ASSET_TYPES: AssetType[] = [
  'moneyMarketSavings',
  'taxableBrokerage',
  'retirementTraditional',
  'retirementRoth',
  'educationSavings529',
]

export interface HouseholdAsset {
  id: string
  type: AssetType
  balanceAtSimulationStart: number
  annualContribution: number
}

export interface AssetRates {
  cash: number
  moneyMarketSavings: number
  taxableBrokerage: number
  retirementTraditional: number
  retirementRoth: number
  educationSavings529: number
}

export interface AppConfig {
  household: HouseholdMember[]
  inflationRate: number
  simulationYears: number
  incomeSources: IncomeSource[]
  expenses: Expense[]
  householdAssets: HouseholdAsset[]
  assetRates: AssetRates
}

export const DEFAULT_CONFIG: AppConfig = {
  household: [],
  inflationRate: 0.03,
  simulationYears: 60,
  incomeSources: [],
  expenses: [],
  householdAssets: [
    { id: 'default-cash', type: 'cash', balanceAtSimulationStart: 0, annualContribution: 0 },
  ],
  assetRates: {
    cash: 0,
    moneyMarketSavings: 0.04,
    taxableBrokerage: 0.07,
    retirementTraditional: 0.07,
    retirementRoth: 0.07,
    educationSavings529: 0.07,
  },
}
