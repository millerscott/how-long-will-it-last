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
  hooks/
    useLocalStorage.ts          — Generic typed localStorage hook
  components/
    HouseholdPanel.tsx          — Household members, income sources, assets, expenses (3 collapsible sections)
    ProjectionAssumptions.tsx   — Collapsible assumptions panel (inflation, sim years, asset rates)
    ProjectionChart.tsx         — Recharts stacked area chart (asset projection by type)
    ProjectionTable.tsx         — Year-by-year results table with clickable tax/asset popovers
    PercentField.tsx            — Shared % input component (stores as decimal, displays ×100)
  App.tsx                       — Root: localStorage state, deep-merge migration, tab nav, stat boxes
  index.css                     — Tailwind base + .input component class
```

## Core types (`src/types.ts`)
- `HouseholdMember`: `{ id, name, ageAtSimulationStart, retirementAge, state }`
- `IncomeSource`: `{ id, memberId, name, startAge, annualAmount, annualGrowthRate, endAge? }`
- `Expense`: `{ id, name, amount, frequency: 'monthly'|'annual', inflationAdjusted }`
- `AssetType`: `'cash' | 'moneyMarketSavings' | 'taxableBrokerage' | 'retirementTraditional' | 'retirementRoth' | 'educationSavings529'`
- `HouseholdAsset`: `{ id, type, balanceAtSimulationStart, annualContribution }`
- `AssetRates`: one rate (decimal) per `AssetType`
- `AppConfig`: `{ household, inflationRate, simulationYears, incomeSources, expenses, householdAssets, assetRates }`
- `DEFAULT_CONFIG`: includes one non-removable `cash` account, default rates (529 plan defaults to 7%)

## Key conventions
- All config lives in one `AppConfig` object in localStorage.
- The simulation in `projection.ts` is pure — takes `AppConfig`, returns `YearlySnapshot[]`.
- IDs use `Math.random().toString(36).slice(2)`.
- Monetary display uses `Intl.NumberFormat` with `style: 'currency'`.
- Percent values stored as decimals (e.g. `0.06` for 6%), displayed × 100.
- Balance/currency inputs use `CurrencyInput` (defined in `HouseholdPanel.tsx`) — `type="text"` + `inputMode="numeric"`, comma-formatted on blur.
- Percent inputs use `PercentField` component (`src/components/PercentField.tsx`).
- Collapsible sections use a `▶` chevron (rotates 90° when open) with an inline summary when collapsed.
- Controlled selects that reset after selection use a `useState('')` value reset — never `e.target.value = ''`.

## Simulation engine (`src/lib/projection.ts`)
- Driven by primary household member's `ageAtSimulationStart` + `simulationYears`.
- Tracks per-account balances in a `Map<string, number>`.
- Each year: compute income → taxes → expenses → net cash flow → apply contributions → settle net into cash → apply per-type appreciation rates.
- `YearlySnapshot`: `{ age, year, income, federalIncomeTax, ficaTax, stateIncomeTax, expenses, netCashFlow, totalAssets, assetBreakdown: AssetBalance[], depleted }`
- `findDepletionAge(snapshots)` — returns first age where `depleted === true`

## Tax calculations (`src/lib/tax.ts`) — 2026 figures
- `calculateFederalTax(grossIncome, filingStatus)` — standard deduction $16,100 single / $32,200 MFJ, 7-bracket progressive
- `calculateStateTax(income, state, filingStatus)` — Oregon only (returns 0 for other states)
- `calculateFicaPerEarner(wages)` — SS 6.2% capped at $184,500 + Medicare 1.45%
- `calculateAdditionalMedicare(totalHouseholdWages, filingStatus)` — 0.9% above $200k/$250k
- Filing status: MFJ if 2+ household members, single otherwise
- Oregon state tax: combined MFJ return if all earners in same state; otherwise per-member

## App-level localStorage migration (`src/App.tsx`)
On every load, `rawConfig` is deep-merged with `DEFAULT_CONFIG` so new fields added after initial save are always present:
```typescript
const merged: AppConfig = {
  ...DEFAULT_CONFIG,
  ...rawConfig,
  assetRates: { ...DEFAULT_CONFIG.assetRates, ...rawConfig.assetRates },
  householdAssets: rawConfig.householdAssets?.length
    ? rawConfig.householdAssets.some((a) => a.type === 'cash')
      ? rawConfig.householdAssets
      : [DEFAULT_CONFIG.householdAssets[0], ...rawConfig.householdAssets]
    : DEFAULT_CONFIG.householdAssets,
}
```

## UI structure
- **Header**: app title + subtitle
- **Stat boxes** (4): Starting Assets, Assets in 20 Years, Assets in 40 Years, How Long Will It Last? (age + year of depletion, or "Outlasts simulation"). Red for bad outcomes, green for good.
- **Tabs**: Household Setup | Projection
  - **Household Setup**: 3 collapsible sections — Household Members (with income sources per member), Household Assets, Household Expenses
  - **Projection**: stacked area chart → collapsible Assumptions panel (collapsed by default, shows summary inline) → Year-by-Year Detail table
- **Projection table columns**: Year · Age · Income · Total Tax · Net Income · Expenses · Net Cash Flow · Total Assets
- **Clickable popovers**: Total Tax (breakdown) and Total Assets (breakdown); use `position: fixed` anchored left or right based on viewport position

## Dev commands
```bash
npm run dev        # start dev server at localhost:5173
npm run build      # type-check + production build
npm run test       # run Vitest tests (34 tests in src/lib/tax.test.ts)
npm run preview    # serve production build locally
```
