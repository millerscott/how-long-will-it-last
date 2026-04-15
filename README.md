# How Long Will It Last?

A personal finance projection tool that helps you understand how long your money will last. Model your household's income, expenses, assets, and taxes to see a year-by-year forecast of your financial runway.

Everything runs in the browser. No accounts, no servers, no data leaves your machine.

## Features

### Household Modeling
- Support for single or dual-income households
- Per-member retirement age, state of residence, and age tracking
- Multiple income sources per person: wages, Social Security, and other income
- Built-in Social Security benefit estimator based on current earnings and claiming age
- Income growth rates per source (e.g., annual raises)

### Asset Tracking
- Six account types: Cash, Money Market / Savings, Taxable Brokerage, Traditional IRA, Roth IRA, and 529 Education Savings
- Per-account contribution schedules with multiple age-range periods
- Configurable appreciation rates per account type
- Cash and money market reserve targets (in months of expenses) that the system automatically maintains
- Roth contribution basis tracking for accurate early withdrawal modeling

### Expense Management
- Regular expenses (monthly or annual)
- Periodic expenses that recur every N years (e.g., a new car every 7 years)
- Education expenses that automatically draw from 529 accounts first
- Per-expense inflation adjustment toggle
- Age-range gating on all expense types

### Healthcare Cost Modeling
- Three-phase lifecycle: employer coverage, pre-Medicare gap, and Medicare (age 65+)
- Family plan support (one member's employer plan can cover another)
- Separate healthcare inflation rate (defaults to 5.5%)
- IRMAA surcharge modeling for Medicare (based on 2-year income lookback)
- Per-member healthcare tracking for households with different coverage situations

### Tax Engine (2026 figures)
- Federal income tax with standard deduction and 7-bracket progressive rates
- FICA: Social Security (6.2% up to wage base) and Medicare (1.45%) per earner
- Additional Medicare tax (0.9%) on high-earning households
- Oregon state income tax (other states can be added)
- Long-term capital gains tax (0% / 15% / 20% brackets)
- Net Investment Income Tax (3.8% NIIT)
- Social Security taxability (provisional income formula)
- Pre-tax employer healthcare premium deductions (Section 125)
- Married filing jointly vs. single, determined by household size

### Retirement Account Features
- Required Minimum Distributions (RMDs) starting at age 73, per IRS Uniform Lifetime Table
- Roth conversion ladder: automatically converts traditional IRA funds to Roth up to a target tax bracket ceiling
- Early withdrawal penalty (10%) on traditional IRA and Roth earnings before age 59
- Tax-optimal withdrawal waterfall that changes strategy at age 60

### Withdrawal Waterfall
When cash runs low, the system automatically draws from accounts in a tax-efficient order:

**Before age 60:**
Money Market → Brokerage → Roth contributions (always penalty-free) → Traditional IRA → Roth earnings (last resort, preserve tax-free growth) → 529

**Age 60+:**
Money Market → Brokerage → Traditional IRA → Roth → 529

Roth contribution basis is drawn before Traditional because it is penalty- and tax-free. Roth earnings are saved for last because they represent the most valuable tax-free growth and should be preserved as long as possible.

In households where one member has passed the early withdrawal age (59) and the other has not, the system prefers the older member's retirement accounts to avoid penalties. Among members who are both under 59, the younger member's accounts are drawn first, preserving the older member's balance until they turn 59.

Reserve accounts (cash and money market) are topped up to their target levels before other spending.

### Market Crash Scenarios
- Model market downturns with configurable start age, severity, crash duration, and recovery period
- Three built-in presets: Mild (-20%), Moderate (-40%), Severe (-55%)
- Crashes affect equity accounts only (brokerage, retirement, 529); cash and money market are unaffected
- Multiple crash scenarios can be stacked

### Simulation Modes
- **Real (today's dollars)**: deflates investment returns by inflation so all numbers represent present-day purchasing power
- **Nominal**: inflates expenses and income, showing future dollar amounts

### Saved Simulations
- Save multiple named simulations to compare different scenarios
- Create, duplicate, rename, delete, and reorder simulations
- Import household data from one simulation into another
- All simulations persist in browser localStorage

### Comparison View
- Side-by-side total asset projection across multiple simulations
- Select which simulations to include via checkboxes
- Quickly see how different assumptions (retirement age, market crashes, spending levels) change outcomes

### Projection Output
- Stacked area chart showing asset allocation over time
- Year-by-year detail table with clickable breakdowns for:
  - **Income**: each source, interest, RMDs, Roth conversions
  - **Taxes**: federal, FICA, state, capital gains, NIIT, early withdrawal penalties
  - **Expenses**: each expense item plus healthcare costs per member
  - **Assets**: per-account start balance, net flow, growth, and end balance
- Visual indicators for RMD years, Roth conversions, market crashes, and early withdrawal penalties
- Depletion age warning when assets run out
- Summary stat boxes: starting assets, 20-year and 40-year projections, and depletion age

## Getting Started

```bash
npm install
npm run dev
```

The app runs at `http://localhost:5173`. All data is stored in your browser's localStorage.

## Development

```bash
npm run dev        # Start dev server
npm run build      # Type-check + production build
npm run test       # Run test suite
npm run preview    # Serve production build locally
```
