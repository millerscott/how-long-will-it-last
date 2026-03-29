# How Long Will It Last? — Claude Code Guide

## Project purpose
A browser-only personal finance app that projects how long a user's money will last, given their income sources, expenses, assets, and life expectancy. No backend. All state persists in `localStorage`.

## Tech stack
- **React 19** + **TypeScript** (strict mode)
- **Vite** for bundling
- **Tailwind CSS v3** for styling (utility-first; one custom component class: `.input` defined in `src/index.css`)
- No UI component library — build from Tailwind utilities

## Project structure
```
src/
  types.ts              — Core domain types: AppConfig, IncomeSource, Expense, Asset
  lib/
    projection.ts       — Year-by-year simulation engine (projectFinances, findDepletionAge)
  hooks/
    useLocalStorage.ts  — Generic typed localStorage hook
  components/
    ConfigPanel.tsx     — Input forms for all config sections
    ProjectionTable.tsx — Year-by-year results table
  App.tsx               — Root: localStorage state, tab nav, depletion banner
  index.css             — Tailwind base + .input component class
```

## Key conventions
- All config lives in one `AppConfig` object (see `src/types.ts`) stored under the key `hlwil-config` in localStorage.
- The simulation in `src/lib/projection.ts` is pure — it takes `AppConfig` and returns `YearlySnapshot[]`. Keep it side-effect free.
- IDs on list items (income sources, expenses, assets) are random strings generated with `Math.random().toString(36).slice(2)`.
- Monetary display uses `Intl.NumberFormat` with `style: 'currency'`.
- Percent values are stored as decimals (e.g. `0.06` for 6%) and displayed multiplied by 100.

## Dev commands
```bash
npm run dev      # start dev server at localhost:5173
npm run build    # type-check + production build
npm run preview  # serve production build locally
```

## What's been built
- Basic settings: current age, retirement age, life expectancy, inflation rate
- Income sources with optional start/end age (supports salary, Social Security, pension, etc.)
- Expenses with monthly/annual toggle and optional inflation adjustment
- Assets with balance, expected annual return rate, and annual withdrawal in retirement
- Year-by-year projection table with red highlighting when assets are depleted
- Top-of-page banner always shows the headline result (age of depletion or "funds last")
