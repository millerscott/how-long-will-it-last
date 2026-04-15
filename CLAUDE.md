# How Long Will It Last? — Claude Code Guide

## Project purpose
A browser-only personal finance app that projects how long a user's money will last, given their income sources, expenses, and assets. No backend. All state persists in `localStorage`.

## Tech stack
- **React 19** + **TypeScript** (strict mode, `verbatimModuleSyntax`)
- **Vite** for bundling
- **Tailwind CSS v3** for styling (one custom component class: `.input` in `src/index.css`)
- **Recharts** for charts (stacked area for assets, line chart for comparison)
- **Vitest** for unit tests
- No UI component library — build from Tailwind utilities

## Project structure
```
src/
  types.ts                      — Core domain types (see below)
  lib/
    projection.ts               — Year-by-year simulation engine (~900 lines, phase-decomposed)
    tax.ts                      — Federal + Oregon state + FICA + IRMAA tax calculations (2026 figures)
    states.ts                   — US states list (abbr + name)
    ssEstimate.ts               — Social Security benefit estimator
    projection.test.ts          — Simulation engine tests
    tax.test.ts                 — Tax calculation tests
    ssEstimate.test.ts          — SS estimator tests
  hooks/
    useLocalStorage.ts          — Generic typed localStorage hook
  components/
    HouseholdPanel.tsx          — Household members, income, assets, expenses, healthcare (~1080 lines)
    ProjectionAssumptions.tsx   — Collapsible assumptions panel (inflation, sim years, asset rates, market scenarios)
    ProjectionChart.tsx         — Recharts stacked area chart (asset projection by type)
    ProjectionTable.tsx         — Year-by-year results table with clickable popovers
    SimulationSwitcher.tsx      — Simulation management bar (create, load, rename, duplicate, delete, reorder, import)
    CompareChart.tsx            — Multi-simulation comparison line chart
    PercentField.tsx            — Shared % input component (stores as decimal, displays ×100)
    CurrencyInput.tsx           — Currency text input, comma-formatted on blur
  App.tsx                       — Root: SimulationStore state, migration, derived config/setConfig, tabs, stat boxes
  index.css                     — Tailwind base + .input component class
```

## Core types (`src/types.ts`)
- `HouseholdMember`: `{ id, name, ageAtSimulationStart, retirementAge, state, healthcarePlan? }`
- `HealthcarePlan`: `{ enabled, employerCoverage, employerPremium, employerCoverageEndAge?, employerOutOfPocketAnnual, preMedicarePremium, preMedicareOutOfPocketAnnual, medicareSupplementPremium, medicareOutOfPocketAnnual }`
  - `employerCoverage`: `'own'` (own employer) | `'none'` (no employer plan) | `memberId` (covered by another member's plan)
  - Three cost phases: employer → pre-Medicare gap → Medicare (age 65+)
- `IncomeSource`: `{ id, memberId, name, incomeType: 'wage'|'socialSecurity'|'other', startAge, annualAmount, annualGrowthRate, endAge? }`
  - `endAge` is **inclusive** — income is received at that age. Defaults to retirement age if omitted; SS defaults to end of sim.
- `Expense`: discriminated union — `RegularExpense | PeriodicExpense | EducationExpense`
  - `RegularExpense`: `{ expenseType: 'regular', frequency: 'monthly'|'annual', startAge?, endAge?, ... }`
  - `PeriodicExpense`: `{ expenseType: 'periodic', intervalYears: number, startAge?, endAge?, ... }`
  - `EducationExpense`: `{ expenseType: 'education', frequency: 'monthly'|'annual', startAge?, endAge?, ... }` — draws from 529 accounts first
  - `startAge` and `endAge` are both **inclusive**
- `AssetType`: `'cash' | 'moneyMarketSavings' | 'taxableBrokerage' | 'retirementTraditional' | 'retirementRoth' | 'educationSavings529'`
- `HouseholdAsset`: `{ id, type, memberId?, balanceAtSimulationStart, contributions: ContributionPeriod[], monthsReserve?, rothContributionBasis? }`
  - `ContributionPeriod`: `{ id, startAge, endAge?, annualAmount }` — multiple periods per asset; endAge is inclusive
  - `monthsReserve`: cash and MM only; waterfall tops up to this level before drawing from investments
  - `memberId`: links retirement accounts to a specific household member (for RMDs); unlinked = primary member
  - `rothContributionBasis`: Roth IRA only; tracks penalty-free withdrawal basis
- `AssetRates`: one rate (decimal) per `AssetType`
- `MarketCrash`: `{ id, label, startAge, declinePercent, durationYears, recoveryYears }` — overrides equity rates during crash/recovery
- `AppConfig`: `{ household, inflationRate, healthcareInflationRate, ssCola, simulationYears, incomeSources, expenses, householdAssets, assetRates, marketCrashes, rothConversionTargetBracket, simulationMode }`
  - `rothConversionTargetBracket`: `0.12 | 0.22 | 0.24 | null` — Roth conversion ladder fills traditional IRA income to this bracket ceiling
  - `simulationMode`: `'nominal'` (inflate expenses/income) | `'real'` (deflate returns to show today's dollars). Default is `'real'`.
- `SavedSimulation`: `{ id, name, config: AppConfig, createdAt, updatedAt }`
- `SimulationStore`: `{ activeId, simulations: SavedSimulation[] }`
- `DEFAULT_CONFIG`: includes one non-removable `cash` account, default rates, `marketCrashes: []`, `simulationMode: 'real'`

## Saved simulations & localStorage

### Storage keys
- `'hlwil-simulations'` — `SimulationStore` containing all saved simulations (primary)
- `'hlwil-tab'` — active tab name

### Migration (existing users)
On module load (outside React), if `'hlwil-simulations'` is absent but legacy `'hlwil-config'` exists, the legacy config is migrated into a `SimulationStore` with one simulation named "My Simulation", then the old key is removed.

### State management (App.tsx)
- `useLocalStorage<SimulationStore>` manages the store
- `config` is derived via `mergeWithDefaults(activeSimulation.config)` (deep-merge with `DEFAULT_CONFIG` + field migrations)
- `setConfig` is a wrapper that updates the active simulation's config within the store and sets `updatedAt`
- CRUD operations: `createSimulation`, `loadSimulation`, `deleteSimulation`, `renameSimulation`, `duplicateSimulation`, `moveSimulation`, `importHousehold`
- `mergeWithDefaults()` is exported for use by `CompareChart`

### Config migration (`mergeWithDefaults`)
On every load, active simulation's `rawConfig` is deep-merged with `DEFAULT_CONFIG`:
```typescript
householdAssets:         // migrate flat annualContribution → contributions array; ensure cash account exists
incomeSources:           // ensure incomeType: 'wage' on all sources
expenses:                // ensure expenseType: 'regular' and frequency: 'monthly' on old flat expenses
household:               // migrate old single outOfPocketAnnual → three phase-specific fields
marketCrashes:           rawConfig.marketCrashes ?? []
healthcareInflationRate: rawConfig.healthcareInflationRate ?? 0.055
rothConversionTargetBracket: rawConfig.rothConversionTargetBracket ?? null
simulationMode:          rawConfig.simulationMode ?? 'real'
```

## Key conventions
- The simulation in `projection.ts` is pure — takes `AppConfig`, returns `YearlySnapshot[]`.
- IDs use `Math.random().toString(36).slice(2)`.
- Monetary display uses `Intl.NumberFormat` with `style: 'currency'` — formatters are at module scope, not in component bodies.
- Percent values stored as decimals (e.g. `0.06` for 6%), displayed × 100.
- Balance/currency inputs use `CurrencyInput` (`src/components/CurrencyInput.tsx`) — `type="text"` + `inputMode="numeric"`, comma-formatted on blur.
- Percent inputs use `PercentField` component (`src/components/PercentField.tsx`).
- Collapsible sections use a `▶` chevron (rotates 90° when open) with an inline summary when collapsed.
- Controlled selects that reset after selection use a `useState('')` value reset — never `e.target.value = ''`.
- State tax warning: show `"State tax for this state is not yet supported"` when a member's state is not `'OR'`.
- Simulation names must be unique; `uniqueName()` appends `(2)`, `(3)`, etc. on collision.

## Simulation engine (`src/lib/projection.ts`)

### Architecture
The main loop in `projectFinances()` is decomposed into six phase functions that share a `SimContext` interface:
- `computeIncome(ctx, yearsElapsed)` → `IncomeResult`
- `computeInitialTaxes(ctx, yearsElapsed, inc)` → `InitialTaxResult`
- `computeExpenses(ctx, yearsElapsed, age)` → `ExpenseResult`
- `updateAccounts(ctx, age, netCashFlow, ...)` → `AccountUpdateResult`
- `computePostWaterfallTaxes(ctx, tax, inc, acct)` → `PostWaterfallTaxResult`
- `applyAppreciation(ctx, age)` → `{ equityOverride }`

`SimContext` holds all shared state: config fields, derived values (`filingStatus`, `realMode`, `toEffectiveRate`), mutable state (`accountBalances`, `rothBasisMap`, `magiHistory`), and precomputed data (`crashRatesCache`, `employerEndAges`).

### Per-year order of operations
1. If already depleted → `break` (simulation terminates when assets hit zero)
2. **Income**: wages (per member, per source) + Social Security (COLA growth) + interest (cash/MM) + RMDs (age 73+)
   - NOTE: `calculateRmd()` mutates `accountBalances` during the income phase (intentional — RMDs reduce traditional IRA balances before other phases run)
3. **Initial taxes**: federal income tax, FICA (per earner + additional Medicare), state tax (aggregated by state)
   - Pre-tax employer healthcare premiums (Section 125) reduce W-2 wages only, capped per member
4. **Expenses**: age-gate all types; periodic fires every N years; education tracked separately; healthcare per member (3-phase with IRMAA)
5. **Account updates**: net cash flow settles into cash → contributions to non-cash accounts → 529 draw for education → Roth conversion ladder → withdrawal waterfall → early withdrawal penalty (10% before age 59)
6. **Post-waterfall taxes**: capital gains on brokerage liquidations, NIIT, state capital gains (delta method), incremental traditional IRA tax (federal + state delta)
7. **Appreciation**: equity accounts use `getEquityRateOverride()` during market crashes/recoveries; cash/MM unaffected

### Net flow tracking
Each year captures `startBalances` (beginning of year) and `preAppreciationBalances` (after all human-driven changes). Per-account `netFlow = preAppreciation - start` gives the contribution/withdrawal amount excluding market growth.

### Key exported functions
- `projectFinances(config)` → `YearlySnapshot[]`
- `findDepletionAge(snapshots)` → age of first depletion or `null`
- `applyWaterfall(accountBalances, cashAssetId, householdAssets, primaryAge, annualExpenses, rothBasisMap?)` → `{ brokerageWithdrawn, traditionalWithdrawn, rothWithdrawn, rothPenaltyFreeWithdrawn }`
- `draw529ForEducation(accountBalances, householdAssets, amountNeeded)` → amount drawn
- `calculateRmd(accountBalances, householdAssets, household, yearsElapsed)` → total RMD withdrawn
- `getEquityRateOverride(age, marketCrashes, crashRatesCache?)` → override rate or `null`
- `precomputeCrashRates(marketCrashes)` → `CrashRates[]` (cached per simulation run)

### Key interfaces
- `YearlySnapshot`: `{ age, year, income, incomeBreakdown, federalIncomeTax, capitalGainsTax, niit, traditionalIraTax, ficaTax, stateIncomeTax, totalTax, expenses, expenseBreakdown, netCashFlow, totalAssets, assetBreakdown, earlyWithdrawalPenalty, rmdWithdrawn, rothConverted, depleted, marketCrashActive }`
- `AssetBalance`: `{ label, type, startBalance, balance, netFlow }` — per-account breakdown in each snapshot

### Named constants
- `EARLY_WITHDRAWAL_AGE = 59` — 10% penalty on traditional + Roth earnings withdrawn before this age
- `EARLY_WITHDRAWAL_PENALTY_RATE = 0.10`
- `WATERFALL_AGE_THRESHOLD = 60` — switches Roth-before-Traditional to Traditional-before-Roth
- `RMD_START_AGE = 73`
- `MEDICARE_AGE = 65`

### Simulation modes
- **Real mode** (`simulationMode: 'real'`): deflates all growth/interest rates by inflation to show present-day purchasing power. `toEffectiveRate(nominal) = (1 + nominal) / (1 + inflationRate) - 1`.
- **Nominal mode**: inflates expenses/income by inflation rate. `toEffectiveRate(nominal) = nominal`.

## Tax calculations (`src/lib/tax.ts`) — 2026 figures
- `calculateFederalTax(grossIncome, filingStatus)` — standard deduction $16,100 single / $32,200 MFJ, 7-bracket progressive
- `calculateStateTax(income, state, filingStatus)` — Oregon only (returns 0 for other states); add new states in the `switch` statement
  - Note: SS income is NOT included in state income (correct for Oregon; needs attention if adding states that tax SS)
- `calculateFicaPerEarner(wages)` — SS 6.2% capped at $184,500 + Medicare 1.45%
- `calculateAdditionalMedicare(totalHouseholdWages, filingStatus)` — 0.9% above $200k/$250k
- `calculateCapitalGainsTax(gains, ordinaryIncome, filingStatus)` — 2026 LTCG brackets (0%/15%/20%)
- `calculateNiit(netInvestmentIncome, magi, filingStatus)` — 3.8% above $200k/$250k MAGI
- `calculateTaxableSocialSecurity(otherIncome, ssIncome, filingStatus)` — provisional income formula
- `calculateRothConversionAmount(grossOrdinaryIncome, traditionalBalance, filingStatus, targetRate)` — bracket headroom for Roth conversion ladder
- `calculateIrmaa(magi, filingStatus)` — annual IRMAA surcharge (Part B + Part D) based on MAGI (2-year lookback handled by caller)
- Filing status: MFJ if 2+ household members, single otherwise

## Healthcare modeling
- Per-member, three cost phases: employer → pre-Medicare gap (if employer ends before 65) → Medicare (65+)
- `employerCoverage` can be `'own'`, `'none'`, or another member's ID (family plan)
- `resolveEmployerCoverageEndAge()` converts provider's end age to the covered member's age using age difference
- Healthcare costs inflate at `healthcareInflationRate` (default 5.5%), separate from general inflation
- Pre-tax employer premiums are deducted from W-2 wages for federal/FICA/state tax purposes (Section 125)
- IRMAA surcharges use a 2-year MAGI lookback (`magiHistory` array in SimContext)
- Healthcare end-age defaults to retirement age when blank (shown in UI as placeholder + label hint)

## Waterfall & reserves
- `applyWaterfall` fires when cash or any MM-with-reserve is below its target (`monthsReserve × annualExpenses / 12`)
- Pull order pre-60: MM (above floor) → taxable brokerage → Roth → Traditional → 529
- Pull order 60+: MM (above floor) → taxable brokerage → Traditional → Roth → 529
- Tracks `rothWithdrawn` and `rothPenaltyFreeWithdrawn` (from Roth contribution basis) for accurate early-withdrawal penalty
- After pulling, cash distributes to MM reserve accounts up to their targets
- `annualExpenses` passed to waterfall excludes education expenses (covered by 529 draw separately)

## RMD (Required Minimum Distributions)
- Traditional IRA accounts require distributions starting at age 73 (per IRS Uniform Lifetime Table)
- `calculateRmd()` computes per-member RMDs based on aggregate traditional balance per member
- Accounts are attributed to members via `asset.memberId`; unlinked accounts belong to the primary member
- Withdrawal is proportional across a member's accounts; funds are treated as income

## Market crash simulation
- `MarketCrash` defines a start age, peak-to-trough decline %, crash duration (years), and recovery duration (years)
- Crash/recovery rates are precomputed once per simulation run (`precomputeCrashRates`)
- Affects equity assets only: `taxableBrokerage`, `retirementTraditional`, `retirementRoth`, `educationSavings529`
- Cash and MM rates are unaffected during crash/recovery
- First crash in the array wins on overlap
- Presets in `ProjectionAssumptions.tsx`: Mild (−20%, 1yr, 2yr), Moderate (−40%, 2yr, 4yr), Severe (−55%, 3yr, 7yr)
- `marketCrashActive: boolean` on each snapshot; orange `↓` indicator in the Age column of the projection table

## UI structure
- **Header**: app title + subtitle
- **SimulationSwitcher**: bar below header with dropdown to switch simulations + New / Duplicate / Rename / Delete / Reorder / Import Household buttons
- **Stat boxes** (4): Starting Assets, Assets in 20 Years, Assets in 40 Years, How Long Will It Last?
- **Tabs**: Household Setup | Projection | Compare Simulations
  - **Household Setup**: 3 collapsible sections:
    - *Household Members*: member fields + income sources per member (type, name, amount, growth, start/last age); SS benefit estimator; healthcare plan per member
    - *Household Assets*: cash (non-removable) + addable accounts; each has balance, member owner, min. reserve (months of expenses for cash/MM), Roth basis, and annual contribution periods (by age range)
    - *Household Expenses*: single-row per expense with columns Type · Name · Amount · Freq/Every · Start · End (incl.) · Inflation Adjusted?; type options: Regular, Periodic, Education 529
  - **Projection**: chart → Assumptions panel → Year-by-Year Detail table
  - **Compare Simulations**: multi-simulation line chart with checkboxes to include/exclude simulations
- **Assumptions panel** (collapsible): Basic Settings (inflation, healthcare inflation, SS COLA, sim years, simulation mode) · Asset Appreciation Rates (3-column grid with sync checkbox) · Market Scenarios (preset buttons + per-crash row) · Roth Conversion Ladder (target bracket selector)
- **Projection table columns**: Year · Age (with indicators: R=RMD, ↻=Roth conversion, ↓=crash, ⚠=early withdrawal penalty) · Income · Total Tax · Net Income · Expenses · Net Cash Flow · Total Assets
- **Clickable popovers** (position: fixed, anchored left or right based on viewport):
  - Income: all sources + interest + RMD + Roth conversion
  - Total Tax: Federal Income Tax · FICA · State Income Tax · Capital Gains Tax · NIIT · Early Withdrawal Penalty
  - Expenses: all expense items + healthcare per member
  - Total Assets: 5-column grid (Account · Start · Flow · Growth · End) with per-account and total rows

## Known limitations / future considerations
- State tax only supports Oregon; other states return 0 (warning shown in UI)
- Post-waterfall state taxes (capital gains, traditional IRA withdrawals) are attributed to the primary member's state only
- SS income is excluded from state tax (correct for OR; needs attention for states that tax SS)
- Once assets are depleted the simulation terminates; it does not project annual shortfall
- IRMAA and NIIT thresholds are statutory (not inflation-adjusted in the code)

## Dev commands
```bash
npm run dev        # start dev server at localhost:5173
npm run build      # type-check + production build
npm run test       # run Vitest tests (190 tests across projection, tax, and waterfall)
npm run preview    # serve production build locally
```
