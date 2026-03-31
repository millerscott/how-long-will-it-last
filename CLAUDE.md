# How Long Will It Last? — Claude Code Guide

## Project purpose
A browser-only personal finance app that projects how long a user's money will last, given their income sources, expenses, and assets. No backend. All state persists in `localStorage` under key `hlwil-config`.

## Tech stack
- **React 19** + **TypeScript** (strict mode, `verbatimModuleSyntax`)
- **Vite** for bundling
- **Tailwind CSS v3** for styling (one custom component class: `.input` in `src/index.css`)
- **Recharts** for the stacked area chart
- **Vitest** for unit tests
- No UI component library — build from Tailwind utilities

## Project structure
```
src/
  types.ts                      — Core domain types (see below)
  lib/
    projection.ts               — Year-by-year simulation engine
    tax.ts                      — Federal + Oregon state + FICA tax calculations (2026 figures)
    states.ts                   — US states list (abbr + name)
    ssEstimate.ts               — Social Security benefit estimator
  hooks/
    useLocalStorage.ts          — Generic typed localStorage hook
  components/
    HouseholdPanel.tsx          — Household members, income sources, assets, expenses (3 collapsible sections)
    ProjectionAssumptions.tsx   — Collapsible assumptions panel (inflation, sim years, asset rates, market scenarios)
    ProjectionChart.tsx         — Recharts stacked area chart (asset projection by type)
    ProjectionTable.tsx         — Year-by-year results table with clickable popovers
    PercentField.tsx            — Shared % input component (stores as decimal, displays ×100)
    CurrencyInput.tsx           — Currency text input, comma-formatted on blur
  App.tsx                       — Root: localStorage state, deep-merge migration, tab nav, stat boxes
  index.css                     — Tailwind base + .input component class
```

## Core types (`src/types.ts`)
- `HouseholdMember`: `{ id, name, ageAtSimulationStart, retirementAge, state }`
- `IncomeSource`: `{ id, memberId, name, incomeType: 'wage'|'socialSecurity'|'other', startAge, annualAmount, annualGrowthRate, endAge? }`
- `Expense`: discriminated union — `RegularExpense | PeriodicExpense | EducationExpense`
  - `RegularExpense`: `{ expenseType: 'regular', frequency: 'monthly'|'annual', startAge?, endAge?, ... }`
  - `PeriodicExpense`: `{ expenseType: 'periodic', intervalYears: number, startAge?, endAge?, ... }`
  - `EducationExpense`: `{ expenseType: 'education', frequency: 'monthly'|'annual', startAge?, endAge?, ... }` — draws from 529 accounts first
- `AssetType`: `'cash' | 'moneyMarketSavings' | 'taxableBrokerage' | 'retirementTraditional' | 'retirementRoth' | 'educationSavings529'`
- `HouseholdAsset`: `{ id, type, balanceAtSimulationStart, contributions: ContributionPeriod[], monthsReserve? }`
  - `ContributionPeriod`: `{ id, startAge, endAge?, annualAmount }` — multiple periods per asset
  - `monthsReserve`: cash and MM only; waterfall tops up to this level before drawing from investments
- `AssetRates`: one rate (decimal) per `AssetType`
- `MarketCrash`: `{ id, label, startAge, declinePercent, durationYears, recoveryYears }` — overrides equity rates during crash/recovery
- `AppConfig`: `{ household, inflationRate, ssCola, simulationYears, incomeSources, expenses, householdAssets, assetRates, marketCrashes }`
- `DEFAULT_CONFIG`: includes one non-removable `cash` account, default rates (529 plan defaults to 7%), `marketCrashes: []`

## Key conventions
- All config lives in one `AppConfig` object in localStorage.
- The simulation in `projection.ts` is pure — takes `AppConfig`, returns `YearlySnapshot[]`.
- IDs use `Math.random().toString(36).slice(2)`.
- Monetary display uses `Intl.NumberFormat` with `style: 'currency'`.
- Percent values stored as decimals (e.g. `0.06` for 6%), displayed × 100.
- Balance/currency inputs use `CurrencyInput` (`src/components/CurrencyInput.tsx`) — `type="text"` + `inputMode="numeric"`, comma-formatted on blur.
- Percent inputs use `PercentField` component (`src/components/PercentField.tsx`).
- Collapsible sections use a `▶` chevron (rotates 90° when open) with an inline summary when collapsed.
- Controlled selects that reset after selection use a `useState('')` value reset — never `e.target.value = ''`.
- State tax warning: show `"State tax for this state is not yet supported"` when a member's state is not `'OR'`.

## Simulation engine (`src/lib/projection.ts`)
- Driven by primary household member's `ageAtSimulationStart` + `simulationYears`.
- Tracks per-account balances in a `Map<string, number>`.
- Per-year order of operations:
  1. If already depleted → push zero-balance snapshot and `continue` (balances frozen at 0)
  2. Compute income: wages (per member, per source) + Social Security (COLA growth) + interest (cash/MM)
  3. Compute taxes: federal, state, FICA, additional Medicare
  4. Compute expenses: age-gate all types; periodic fires every N years; education tracked separately
  5. Net cash flow = income − taxes − all expenses; settles into cash
  6. Apply contributions to non-cash accounts (deducted from cash)
  7. Education draw: `draw529ForEducation()` reimburses cash from 529 accounts
  8. Withdrawal waterfall: `applyWaterfall()` tops up cash/MM reserves then draws from investments in tax-optimal order
  9. Post-waterfall taxes: capital gains on brokerage liquidations, NIIT, state cap gains, incremental traditional IRA tax
  10. Apply appreciation: equity accounts use `getEquityRateOverride()` during market crashes/recoveries; cash/MM unaffected
- Key exported functions:
  - `projectFinances(config)` → `YearlySnapshot[]`
  - `findDepletionAge(snapshots)` → age of first depletion or `null`
  - `applyWaterfall(accountBalances, cashAssetId, householdAssets, primaryAge, annualExpenses)` → `{ brokerageWithdrawn, traditionalWithdrawn }`
  - `draw529ForEducation(accountBalances, householdAssets, amountNeeded)` → amount drawn
  - `getEquityRateOverride(age, marketCrashes)` → override rate or `null`
- `YearlySnapshot`: `{ age, year, income, incomeBreakdown, federalIncomeTax, capitalGainsTax, niit, traditionalIraTax, ficaTax, stateIncomeTax, expenses, expenseBreakdown, netCashFlow, totalAssets, assetBreakdown, depleted, marketCrashActive }`

## Tax calculations (`src/lib/tax.ts`) — 2026 figures
- `calculateFederalTax(grossIncome, filingStatus)` — standard deduction $16,100 single / $32,200 MFJ, 7-bracket progressive
- `calculateStateTax(income, state, filingStatus)` — Oregon only (returns 0 for other states); add new states in the `switch` statement
- `calculateFicaPerEarner(wages)` — SS 6.2% capped at $184,500 + Medicare 1.45%
- `calculateAdditionalMedicare(totalHouseholdWages, filingStatus)` — 0.9% above $200k/$250k
- `calculateCapitalGainsTax(gains, ordinaryIncome, filingStatus)` — 2026 LTCG brackets
- `calculateNiit(netInvestmentIncome, magi, filingStatus)` — 3.8% above $200k/$250k MAGI
- `calculateTaxableSocialSecurity(otherIncome, ssIncome, filingStatus)` — provisional income formula
- Filing status: MFJ if 2+ household members, single otherwise

## Waterfall & reserves
- `applyWaterfall` fires when cash or any MM-with-reserve is below its target (`monthsReserve × annualExpenses / 12`)
- Pull order pre-60: MM (above floor) → taxable brokerage → Roth → Traditional → 529
- Pull order 60+: MM (above floor) → taxable brokerage → Traditional → Roth → 529
- After pulling, cash distributes to MM reserve accounts up to their targets
- `annualExpenses` passed to waterfall excludes education expenses (covered by 529 draw separately)

## Market crash simulation
- `MarketCrash` defines a start age, peak-to-trough decline %, crash duration (years), and recovery duration (years)
- Crash annual rate: `(1 − declinePercent)^(1/durationYears) − 1`; recovery rate: `(1/(1−declinePercent))^(1/recoveryYears) − 1`
- Affects equity assets only: `taxableBrokerage`, `retirementTraditional`, `retirementRoth`, `educationSavings529`
- Cash and MM rates are unaffected during crash/recovery
- Presets in `ProjectionAssumptions.tsx`: Mild (−20%, 1yr, 2yr), Moderate (−40%, 2yr, 4yr), Severe (−55%, 3yr, 7yr)
- `marketCrashActive: boolean` on each snapshot; orange `↓` indicator in the Age column of the projection table

## App-level localStorage migration (`src/App.tsx`)
On every load, `rawConfig` is deep-merged with `DEFAULT_CONFIG`. Current migration steps:
```typescript
householdAssets: // migrate flat annualContribution → contributions array; ensure cash account exists
incomeSources:   // ensure incomeType: 'wage' on all sources
expenses:        // ensure expenseType: 'regular' and frequency: 'monthly' on old flat expenses
marketCrashes:   rawConfig.marketCrashes ?? []
```

## UI structure
- **Header**: app title + subtitle
- **Stat boxes** (4): Starting Assets, Assets in 20 Years, Assets in 40 Years, How Long Will It Last?
- **Tabs**: Household Setup | Projection
  - **Household Setup**: 3 collapsible sections:
    - *Household Members*: member fields + income sources per member (type, name, amount, growth, start/end age); SS benefit estimator
    - *Household Assets*: cash (non-removable) + addable accounts; each has balance, min. reserve (months of expenses for cash/MM), and annual contribution periods (by age range)
    - *Household Expenses*: single-row per expense with columns Type · Name · Amount · Freq/Every · Inflation Adjusted? · Start · End; type options: Regular, Periodic, Education 529
  - **Projection**: chart → Assumptions panel → Year-by-Year Detail table
- **Assumptions panel** (collapsible): Basic Settings (inflation, SS COLA, sim years) · Asset Appreciation Rates (3-column grid) · Market Scenarios (preset buttons + per-crash row)
- **Projection table columns**: Year · Age (+ `↓` crash indicator) · Income · Total Tax · Net Income · Expenses · Net Cash Flow · Total Assets
- **Clickable popovers**: Income, Total Tax, Expenses, Total Assets — all use `position: fixed` anchored left or right based on viewport
  - Tax popover order: Federal Income Tax (incl. Traditional IRA) · FICA · State Income Tax · Capital Gains Tax · NIIT
  - Income popover: Social Security sources combined into one line

## Dev commands
```bash
npm run dev        # start dev server at localhost:5173
npm run build      # type-check + production build
npm run test       # run Vitest tests (148 tests across projection, tax, and waterfall)
npm run preview    # serve production build locally
```
