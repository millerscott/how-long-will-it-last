export interface HouseholdMember {
  id: string
  name: string
  ageAtSimulationStart: number
  retirementAge: number
  state: string
}

export type IncomeSourceType = 'wage' | 'socialSecurity' | 'other'

export interface IncomeSource {
  id: string
  memberId: string
  name: string
  incomeType?: IncomeSourceType
  /** Age at which this income begins */
  startAge: number
  /** Annual amount in base (simulation start) year dollars */
  annualAmount: number
  /** Expected annual growth rate, e.g. 0.03 for 3%. Ignored for socialSecurity (uses ssCola). */
  annualGrowthRate: number
  /** Age at which income ends. If omitted, ends at the member's retirementAge */
  endAge?: number
}

export type Frequency = 'monthly' | 'annual'

export type ExpenseType = 'regular' | 'periodic' | 'education'

interface ExpenseBase {
  id: string
  name: string
  amount: number
  inflationAdjusted: boolean
  startAge?: number
  endAge?: number
}

export interface RegularExpense extends ExpenseBase {
  expenseType: 'regular'
  frequency: Frequency
}

export interface PeriodicExpense extends ExpenseBase {
  expenseType: 'periodic'
  /** Recurs every N years (integer ≥ 1) */
  intervalYears: number
}

export interface EducationExpense extends ExpenseBase {
  expenseType: 'education'
  frequency: Frequency
}

export type Expense = RegularExpense | PeriodicExpense | EducationExpense

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

export interface ContributionPeriod {
  id: string
  startAge: number
  endAge?: number
  annualAmount: number
}

export interface HouseholdAsset {
  id: string
  type: AssetType
  balanceAtSimulationStart: number
  contributions: ContributionPeriod[]
  /** Months of annual expenses to hold as a minimum reserve. Cash and MM only; undefined or 0 = no reserve. */
  monthsReserve?: number
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
  ssCola: number
  simulationYears: number
  incomeSources: IncomeSource[]
  expenses: Expense[]
  householdAssets: HouseholdAsset[]
  assetRates: AssetRates
}

export const DEFAULT_CONFIG: AppConfig = {
  household: [],
  inflationRate: 0.03,
  ssCola: 0.025,
  simulationYears: 60,
  incomeSources: [],
  expenses: [],
  householdAssets: [
    { id: 'default-cash', type: 'cash', balanceAtSimulationStart: 0, contributions: [] },
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
