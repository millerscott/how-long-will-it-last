export interface HealthcarePlan {
  enabled: boolean
  /** 'own' = this member's employer, a memberId = covered by that member's plan, 'none' = no employer coverage */
  employerCoverage: 'own' | 'none' | string
  /** Monthly premium the employee pays for employer coverage (only used when employerCoverage === 'own') */
  employerPremium: number
  /** Age at which employer coverage ends (defaults to retirementAge; only used when employerCoverage === 'own') */
  employerCoverageEndAge?: number
  /** Monthly premium for individual ACA/private coverage between employer coverage ending and age 65 */
  preMedicarePremium: number
  /** Monthly premium for Medicare supplement (Part B + Part D + Medigap) at age 65+ */
  medicareSupplementPremium: number
  /** Annual out-of-pocket costs (deductibles, copays, prescriptions) — applies to all phases */
  outOfPocketAnnual: number
  /** Annual healthcare cost inflation rate (e.g. 0.055 for 5.5%) */
  healthcareInflationRate: number
}

export const DEFAULT_HEALTHCARE_PLAN: HealthcarePlan = {
  enabled: false,
  employerCoverage: 'own',
  employerPremium: 500,
  employerCoverageEndAge: undefined,
  preMedicarePremium: 800,
  medicareSupplementPremium: 400,
  outOfPocketAnnual: 3000,
  healthcareInflationRate: 0.055,
}

export interface HouseholdMember {
  id: string
  name: string
  ageAtSimulationStart: number
  retirementAge: number
  state: string
  healthcarePlan?: HealthcarePlan
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
  /** For retirement accounts: the household member this account belongs to. Unset accounts are attributed to the primary member. */
  memberId?: string
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

export interface MarketCrash {
  id: string
  label: string
  startAge: number
  /** Peak-to-trough total decline, e.g. 0.35 = 35% */
  declinePercent: number
  /** Years to reach the trough (≥ 1) */
  durationYears: number
  /** Years to recover back to pre-crash level (≥ 1) */
  recoveryYears: number
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
  marketCrashes: MarketCrash[]
  /** Fill traditional IRA up to this bracket ceiling each year via Roth conversion. Null = disabled. */
  rothConversionTargetBracket: 0.12 | 0.22 | 0.24 | null
  /** 'nominal' inflates expenses/income; 'real' deflates returns to show present-day dollars. */
  simulationMode: 'nominal' | 'real'
}

export interface SavedSimulation {
  id: string
  name: string
  config: AppConfig
  createdAt: number
  updatedAt: number
}

export interface SimulationStore {
  activeId: string
  simulations: SavedSimulation[]
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
  marketCrashes: [],
  rothConversionTargetBracket: null,
  simulationMode: 'real',
}
