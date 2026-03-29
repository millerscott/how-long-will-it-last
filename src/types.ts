export type Frequency = 'monthly' | 'annual'

export interface IncomeSource {
  id: string
  name: string
  amount: number
  frequency: Frequency
  startAge?: number
  endAge?: number
}

export interface Expense {
  id: string
  name: string
  amount: number
  frequency: Frequency
  /** If true, grows with inflation each year */
  inflationAdjusted: boolean
}

export interface Asset {
  id: string
  name: string
  balance: number
  /** Expected annual return rate, e.g. 0.06 for 6% */
  annualReturnRate: number
  /** Annual withdrawal amount (0 if not being drawn down) */
  annualWithdrawal: number
}

export interface AppConfig {
  currentAge: number
  retirementAge: number
  lifeExpectancy: number
  inflationRate: number
  incomeSources: IncomeSource[]
  expenses: Expense[]
  assets: Asset[]
}

export const DEFAULT_CONFIG: AppConfig = {
  currentAge: 45,
  retirementAge: 65,
  lifeExpectancy: 90,
  inflationRate: 0.03,
  incomeSources: [],
  expenses: [],
  assets: [],
}
