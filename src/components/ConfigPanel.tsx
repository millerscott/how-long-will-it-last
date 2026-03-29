import type { AppConfig, IncomeSource, Expense, Asset, Frequency } from '../types'

interface Props {
  config: AppConfig
  onChange: (config: AppConfig) => void
}

function currency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function uid() {
  return Math.random().toString(36).slice(2)
}

export default function ConfigPanel({ config, onChange }: Props) {
  function update(partial: Partial<AppConfig>) {
    onChange({ ...config, ...partial })
  }

  // ----- Income -----
  function addIncome() {
    const src: IncomeSource = { id: uid(), name: 'New income', amount: 0, frequency: 'monthly' }
    update({ incomeSources: [...config.incomeSources, src] })
  }
  function updateIncome(id: string, partial: Partial<IncomeSource>) {
    update({ incomeSources: config.incomeSources.map((s) => (s.id === id ? { ...s, ...partial } : s)) })
  }
  function removeIncome(id: string) {
    update({ incomeSources: config.incomeSources.filter((s) => s.id !== id) })
  }

  // ----- Expenses -----
  function addExpense() {
    const exp: Expense = { id: uid(), name: 'New expense', amount: 0, frequency: 'monthly', inflationAdjusted: true }
    update({ expenses: [...config.expenses, exp] })
  }
  function updateExpense(id: string, partial: Partial<Expense>) {
    update({ expenses: config.expenses.map((e) => (e.id === id ? { ...e, ...partial } : e)) })
  }
  function removeExpense(id: string) {
    update({ expenses: config.expenses.filter((e) => e.id !== id) })
  }

  // ----- Assets -----
  function addAsset() {
    const asset: Asset = { id: uid(), name: 'New asset', balance: 0, annualReturnRate: 0.06, annualWithdrawal: 0 }
    update({ assets: [...config.assets, asset] })
  }
  function updateAsset(id: string, partial: Partial<Asset>) {
    update({ assets: config.assets.map((a) => (a.id === id ? { ...a, ...partial } : a)) })
  }
  function removeAsset(id: string) {
    update({ assets: config.assets.filter((a) => a.id !== id) })
  }

  return (
    <div className="space-y-8">
      {/* ---- Basic settings ---- */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Basic Settings</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NumberField label="Current Age" value={config.currentAge} min={1} max={120}
            onChange={(v) => update({ currentAge: v })} />
          <NumberField label="Retirement Age" value={config.retirementAge} min={1} max={120}
            onChange={(v) => update({ retirementAge: v })} />
          <NumberField label="Life Expectancy" value={config.lifeExpectancy} min={1} max={120}
            onChange={(v) => update({ lifeExpectancy: v })} />
          <PercentField label="Inflation Rate" value={config.inflationRate}
            onChange={(v) => update({ inflationRate: v })} />
        </div>
      </section>

      {/* ---- Income sources ---- */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Income Sources</h2>
          <button onClick={addIncome} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">+ Add</button>
        </div>
        {config.incomeSources.length === 0 && (
          <p className="text-sm text-gray-400 italic">No income sources added.</p>
        )}
        <div className="space-y-3">
          {config.incomeSources.map((src) => (
            <div key={src.id} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded p-3">
              <input className="col-span-3 input" placeholder="Name" value={src.name}
                onChange={(e) => updateIncome(src.id, { name: e.target.value })} />
              <div className="col-span-2 relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input type="number" className="input pl-5 w-full" placeholder="Amount" value={src.amount || ''}
                  onChange={(e) => updateIncome(src.id, { amount: parseFloat(e.target.value) || 0 })} />
              </div>
              <select className="col-span-2 input" value={src.frequency}
                onChange={(e) => updateIncome(src.id, { frequency: e.target.value as Frequency })}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
              <NumberField label="" value={src.startAge ?? ''} placeholder="Start age" className="col-span-2"
                onChange={(v) => updateIncome(src.id, { startAge: v || undefined })} />
              <NumberField label="" value={src.endAge ?? ''} placeholder="End age" className="col-span-2"
                onChange={(v) => updateIncome(src.id, { endAge: v || undefined })} />
              <button onClick={() => removeIncome(src.id)} className="col-span-1 text-red-400 hover:text-red-600 text-lg leading-none">×</button>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Expenses ---- */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Expenses</h2>
          <button onClick={addExpense} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">+ Add</button>
        </div>
        {config.expenses.length === 0 && (
          <p className="text-sm text-gray-400 italic">No expenses added.</p>
        )}
        <div className="space-y-3">
          {config.expenses.map((exp) => (
            <div key={exp.id} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded p-3">
              <input className="col-span-4 input" placeholder="Name" value={exp.name}
                onChange={(e) => updateExpense(exp.id, { name: e.target.value })} />
              <div className="col-span-2 relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input type="number" className="input pl-5 w-full" placeholder="Amount" value={exp.amount || ''}
                  onChange={(e) => updateExpense(exp.id, { amount: parseFloat(e.target.value) || 0 })} />
              </div>
              <select className="col-span-2 input" value={exp.frequency}
                onChange={(e) => updateExpense(exp.id, { frequency: e.target.value as Frequency })}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
              <label className="col-span-3 flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={exp.inflationAdjusted}
                  onChange={(e) => updateExpense(exp.id, { inflationAdjusted: e.target.checked })} />
                Inflation adj.
              </label>
              <button onClick={() => removeExpense(exp.id)} className="col-span-1 text-red-400 hover:text-red-600 text-lg leading-none">×</button>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Assets ---- */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Assets / Investments</h2>
          <button onClick={addAsset} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">+ Add</button>
        </div>
        {config.assets.length === 0 && (
          <p className="text-sm text-gray-400 italic">No assets added.</p>
        )}
        <div className="space-y-3">
          {config.assets.map((asset) => (
            <div key={asset.id} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded p-3">
              <input className="col-span-3 input" placeholder="Name" value={asset.name}
                onChange={(e) => updateAsset(asset.id, { name: e.target.value })} />
              <div className="col-span-3 relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input type="number" className="input pl-5 w-full" placeholder="Balance"
                  value={asset.balance || ''}
                  onChange={(e) => updateAsset(asset.id, { balance: parseFloat(e.target.value) || 0 })} />
              </div>
              <PercentField label="" value={asset.annualReturnRate} className="col-span-2" placeholder="Return %"
                onChange={(v) => updateAsset(asset.id, { annualReturnRate: v })} />
              <div className="col-span-3 relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input type="number" className="input pl-5 w-full" placeholder="Annual withdrawal"
                  value={asset.annualWithdrawal || ''}
                  onChange={(e) => updateAsset(asset.id, { annualWithdrawal: parseFloat(e.target.value) || 0 })} />
              </div>
              <button onClick={() => removeAsset(asset.id)} className="col-span-1 text-red-400 hover:text-red-600 text-lg leading-none">×</button>
            </div>
          ))}
        </div>
      </section>

      {/* Summary row */}
      <section className="bg-indigo-50 rounded p-4 text-sm grid grid-cols-3 gap-4">
        <div>
          <p className="text-gray-500">Total annual income</p>
          <p className="font-semibold text-lg">
            {currency(config.incomeSources.reduce((s, i) => s + (i.frequency === 'monthly' ? i.amount * 12 : i.amount), 0))}
          </p>
        </div>
        <div>
          <p className="text-gray-500">Total annual expenses</p>
          <p className="font-semibold text-lg">
            {currency(config.expenses.reduce((s, e) => s + (e.frequency === 'monthly' ? e.amount * 12 : e.amount), 0))}
          </p>
        </div>
        <div>
          <p className="text-gray-500">Total assets</p>
          <p className="font-semibold text-lg">
            {currency(config.assets.reduce((s, a) => s + a.balance, 0))}
          </p>
        </div>
      </section>
    </div>
  )
}

// ---- Small reusable field components ----

interface NumberFieldProps {
  label: string
  value: number | string
  min?: number
  max?: number
  placeholder?: string
  className?: string
  onChange: (v: number) => void
}

function NumberField({ label, value, min, max, placeholder, className = '', onChange }: NumberFieldProps) {
  return (
    <div className={className}>
      {label && <label className="block text-xs text-gray-500 mb-1">{label}</label>}
      <input
        type="number"
        className="input w-full"
        value={value}
        min={min}
        max={max}
        placeholder={placeholder}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  )
}

interface PercentFieldProps {
  label: string
  value: number
  placeholder?: string
  className?: string
  onChange: (v: number) => void
}

function PercentField({ label, value, placeholder, className = '', onChange }: PercentFieldProps) {
  return (
    <div className={className}>
      {label && <label className="block text-xs text-gray-500 mb-1">{label}</label>}
      <div className="relative">
        <input
          type="number"
          className="input w-full pr-6"
          value={value !== 0 ? (value * 100).toFixed(1) : ''}
          step="0.1"
          placeholder={placeholder ?? '0.0'}
          onChange={(e) => onChange((parseFloat(e.target.value) || 0) / 100)}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
      </div>
    </div>
  )
}
