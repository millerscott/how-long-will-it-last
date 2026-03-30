import { useState } from 'react'
import type { AppConfig, HouseholdMember, IncomeSource, HouseholdAsset, AssetType, Expense, Frequency } from '../types'
import { ASSET_TYPE_LABELS, ADDABLE_ASSET_TYPES } from '../types'
import { US_STATES } from '../lib/states'
import CurrencyInput from './CurrencyInput'
import { useLocalStorage } from '../hooks/useLocalStorage'

interface Props {
  config: AppConfig
  onChange: (config: AppConfig) => void
}

function uid() {
  return Math.random().toString(36).slice(2)
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default function HouseholdPanel({ config, onChange }: Props) {
  // --- Members ---
  function addMember() {
    const member: HouseholdMember = { id: uid(), name: '', ageAtSimulationStart: 40, retirementAge: 65, state: 'OR' }
    onChange({ ...config, household: [...config.household, member] })
  }

  function updateMember(id: string, partial: Partial<HouseholdMember>) {
    const member = config.household.find((m) => m.id === id)!
    const oldRetirementAge = member.retirementAge
    const newRetirementAge = partial.retirementAge

    const updatedIncomeSources =
      newRetirementAge !== undefined && newRetirementAge !== oldRetirementAge
        ? config.incomeSources.map((s) =>
            s.memberId === id && s.endAge === oldRetirementAge
              ? { ...s, endAge: newRetirementAge }
              : s
          )
        : config.incomeSources

    onChange({
      ...config,
      household: config.household.map((m) => (m.id === id ? { ...m, ...partial } : m)),
      incomeSources: updatedIncomeSources,
    })
  }

  function removeMember(id: string) {
    onChange({
      ...config,
      household: config.household.filter((m) => m.id !== id),
      incomeSources: config.incomeSources.filter((s) => s.memberId !== id),
    })
  }

  // --- Income sources ---
  function addIncome(memberId: string, member: HouseholdMember) {
    const src: IncomeSource = {
      id: uid(),
      memberId,
      name: '',
      startAge: member.ageAtSimulationStart,
      annualAmount: 0,
      annualGrowthRate: 0.03,
      endAge: member.retirementAge,
    }
    onChange({ ...config, incomeSources: [...config.incomeSources, src] })
  }

  function updateIncome(id: string, partial: Partial<IncomeSource>) {
    onChange({
      ...config,
      incomeSources: config.incomeSources.map((s) => (s.id === id ? { ...s, ...partial } : s)),
    })
  }

  function removeIncome(id: string) {
    onChange({ ...config, incomeSources: config.incomeSources.filter((s) => s.id !== id) })
  }

  // --- Household assets ---
  function addAsset(type: AssetType) {
    const asset: HouseholdAsset = { id: uid(), type, balanceAtSimulationStart: 0, annualContribution: 0 }
    onChange({ ...config, householdAssets: [...config.householdAssets, asset] })
  }

  function updateAsset(id: string, partial: Partial<HouseholdAsset>) {
    onChange({
      ...config,
      householdAssets: config.householdAssets.map((a) => (a.id === id ? { ...a, ...partial } : a)),
    })
  }

  function removeAsset(id: string) {
    onChange({ ...config, householdAssets: config.householdAssets.filter((a) => a.id !== id) })
  }

  // --- Expenses ---
  function addExpense() {
    const exp: Expense = { id: uid(), name: 'New expense', amount: 0, frequency: 'monthly', inflationAdjusted: true }
    onChange({ ...config, expenses: [...config.expenses, exp] })
  }
  function updateExpense(id: string, partial: Partial<Expense>) {
    onChange({ ...config, expenses: config.expenses.map((e) => (e.id === id ? { ...e, ...partial } : e)) })
  }
  function removeExpense(id: string) {
    onChange({ ...config, expenses: config.expenses.filter((e) => e.id !== id) })
  }

  const [membersOpen, setMembersOpen] = useLocalStorage('hlwil-section-members', true)
  const [assetsOpen, setAssetsOpen] = useLocalStorage('hlwil-section-assets', true)
  const [expensesOpen, setExpensesOpen] = useLocalStorage('hlwil-section-expenses', true)
  const [addAssetSelect, setAddAssetSelect] = useState('')

  const cashAsset = config.householdAssets.find((a) => a.type === 'cash')
  const nonCashAssets = config.householdAssets.filter((a) => a.type !== 'cash')

  return (
    <div className="space-y-4">

      {/* ════════════ Household Members ════════════ */}
      <div className="border border-gray-200 rounded-lg">
        <div className="flex items-center gap-3 bg-gray-50 px-4 py-3 rounded-lg">
          <button
            onClick={() => setMembersOpen((o) => !o)}
            className="flex items-center gap-3 flex-1 text-left hover:opacity-70 transition-opacity"
          >
            <span className={`text-gray-400 transition-transform duration-200 text-xs ${membersOpen ? 'rotate-90' : ''}`}>▶</span>
            <h2 className="text-sm font-semibold text-gray-700">Household Members</h2>
            {!membersOpen && (
              <span className="text-xs text-gray-400">
                {config.household.length} member{config.household.length !== 1 ? 's' : ''} · {config.incomeSources.length} income source{config.incomeSources.length !== 1 ? 's' : ''}
              </span>
            )}
          </button>
          <button
            onClick={addMember}
            className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 transition-colors"
          >
            + Add member
          </button>
        </div>

        {membersOpen && (
          <div className="p-4 border-t border-gray-100 space-y-4">
            {config.household.length === 0 && (
              <div className="text-center py-10 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
                No household members added yet.
              </div>
            )}

            <div className="space-y-6">
              {config.household.map((member, i) => {
                const memberIncome = config.incomeSources.filter((s) => s.memberId === member.id)
                return (
                  <div key={member.id} className="border border-gray-200 rounded-lg overflow-hidden">
              {/* Member header row */}
              <div className="flex items-center gap-3 bg-gray-50 p-4">
                <span className="text-gray-400 text-sm font-medium w-5 shrink-0">{i + 1}.</span>

                <div className="flex-1 min-w-0">
                  <label className="block text-xs text-gray-500 mb-1">Name</label>
                  <input
                    className="input w-full"
                    placeholder="e.g. Alex"
                    value={member.name}
                    onChange={(e) => updateMember(member.id, { name: e.target.value })}
                  />
                </div>

                <div className="w-24 shrink-0">
                  <label className="block text-xs text-gray-500 mb-1">Current Age</label>
                  <input
                    type="number"
                    className="input w-full"
                    min={0}
                    max={120}
                    value={member.ageAtSimulationStart}
                    onChange={(e) => updateMember(member.id, { ageAtSimulationStart: parseInt(e.target.value) || 0 })}
                  />
                </div>

                <div className="w-32 shrink-0">
                  <label className="block text-xs text-gray-500 mb-1">Retirement Age</label>
                  <input
                    type="number"
                    className="input w-full"
                    min={0}
                    max={120}
                    value={member.retirementAge}
                    onChange={(e) => updateMember(member.id, { retirementAge: parseInt(e.target.value) || 0 })}
                  />
                </div>

                <div className="w-52 shrink-0">
                  <label className="block text-xs text-gray-500 mb-1">State of Residency</label>
                  <select
                    className="input w-full"
                    value={member.state}
                    onChange={(e) => updateMember(member.id, { state: e.target.value })}
                  >
                    {US_STATES.map((s) => (
                      <option key={s.abbr} value={s.abbr}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={() => removeMember(member.id)}
                  className="text-red-400 hover:text-red-600 text-xl leading-none shrink-0 mt-4"
                  aria-label="Remove member"
                >
                  ×
                </button>
              </div>

              {/* Income sources for this member */}
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700">Income Sources</span>
                  <button
                    onClick={() => addIncome(member.id, member)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    + Add income
                  </button>
                </div>

                {memberIncome.length === 0 && (
                  <p className="text-xs text-gray-400 italic py-1">No income sources for this member.</p>
                )}

                {/* Column headers */}
                {memberIncome.length > 0 && (
                  <div className="grid grid-cols-12 gap-2 px-1 mb-1">
                    <span className="col-span-3 text-xs text-gray-400">Name</span>
                    <span className="col-span-2 text-xs text-gray-400">Annual Amount</span>
                    <span className="col-span-2 text-xs text-gray-400">Annual Growth</span>
                    <span className="col-span-2 text-xs text-gray-400">Start Age</span>
                    <span className="col-span-2 text-xs text-gray-400">End Age</span>
                    <span className="col-span-1" />
                  </div>
                )}

                {memberIncome.map((src) => (
                  <div key={src.id} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded p-2">
                    <input
                      className="col-span-3 input"
                      placeholder="e.g. Salary"
                      value={src.name}
                      onChange={(e) => updateIncome(src.id, { name: e.target.value })}
                    />

                    <div className="col-span-2">
                      <CurrencyInput
                        value={src.annualAmount}
                        onChange={(v) => updateIncome(src.id, { annualAmount: v })}
                      />
                    </div>

                    <div className="col-span-2 relative">
                      <input
                        type="number"
                        className="input pr-5 w-full"
                        placeholder="0.0"
                        step="0.1"
                        value={src.annualGrowthRate !== 0 ? (src.annualGrowthRate * 100).toFixed(1) : ''}
                        onChange={(e) => updateIncome(src.id, { annualGrowthRate: (parseFloat(e.target.value) || 0) / 100 })}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">%</span>
                    </div>

                    <input
                      type="number"
                      className="col-span-2 input"
                      placeholder={String(member.ageAtSimulationStart)}
                      value={src.startAge || ''}
                      onChange={(e) => updateIncome(src.id, { startAge: parseInt(e.target.value) || 0 })}
                    />

                    <div className="col-span-2">
                      <input
                        type="number"
                        className={`input w-full ${src.endAge !== undefined && src.endAge < src.startAge ? 'border-red-400 focus:ring-red-400' : ''}`}
                        placeholder={String(member.retirementAge)}
                        value={src.endAge ?? ''}
                        onChange={(e) => {
                          const val = e.target.value
                          updateIncome(src.id, { endAge: val === '' ? undefined : parseInt(val) || undefined })
                        }}
                      />
                      {src.endAge !== undefined && src.endAge < src.startAge && (
                        <p className="text-red-500 text-xs mt-0.5">Must be ≥ start age ({src.startAge})</p>
                      )}
                    </div>

                    <button
                      onClick={() => removeIncome(src.id)}
                      className="col-span-1 text-red-400 hover:text-red-600 text-lg leading-none text-center"
                    >
                      ×
                    </button>
                  </div>
                ))}

                {memberIncome.length > 0 && (
                  <p className="text-xs text-gray-400 pt-1">
                    Total current annual income:{' '}
                    <span className="font-medium text-gray-600">
                      {fmt.format(memberIncome.reduce((s, src) => s + src.annualAmount, 0))}
                    </span>
                  </p>
                )}
              </div>
            </div>
          )
        })}
        </div>
        </div>
      )}
      </div>

      {/* ════════════ Household Assets ════════════ */}
      <div className="border border-gray-200 rounded-lg">
        <div className="flex items-center gap-3 bg-gray-50 px-4 py-3 rounded-lg">
          <button
            onClick={() => setAssetsOpen((o) => !o)}
            className="flex items-center gap-3 flex-1 text-left hover:opacity-70 transition-opacity"
          >
            <span className={`text-gray-400 transition-transform duration-200 text-xs ${assetsOpen ? 'rotate-90' : ''}`}>▶</span>
            <h2 className="text-sm font-semibold text-gray-700">Household Assets</h2>
            {!assetsOpen && (
              <span className="text-xs text-gray-400">
                {fmt.format(config.householdAssets.reduce((s, a) => s + a.balanceAtSimulationStart, 0))} total starting assets
              </span>
            )}
          </button>
          <select
            className="input text-sm"
            value={addAssetSelect}
            onChange={(e) => {
              if (e.target.value) addAsset(e.target.value as AssetType)
              setAddAssetSelect('')
            }}
          >
            <option value="" disabled>+ Add account</option>
            {ADDABLE_ASSET_TYPES.map((t) => (
              <option key={t} value={t}>{ASSET_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        {assetsOpen && (
          <div className="p-4 border-t border-gray-100 space-y-2">
            {/* Column headers */}
            <div className="grid grid-cols-12 gap-2 px-1">
              <span className="col-span-5 text-xs text-gray-400">Account Type</span>
              <span className="col-span-3 text-xs text-gray-400">Balance at Start</span>
              <span className="col-span-3 text-xs text-gray-400">Annual Contribution</span>
              <span className="col-span-1" />
            </div>

            {/* Cash account — always present, non-removable */}
            {cashAsset && (
              <div className="grid grid-cols-12 gap-2 items-center bg-indigo-50 rounded p-2">
                <div className="col-span-5 flex items-center gap-2">
                  <span className="text-sm font-medium text-indigo-700">{ASSET_TYPE_LABELS.cash}</span>
                  <span className="text-xs text-indigo-400 bg-indigo-100 rounded px-1.5 py-0.5">primary</span>
                </div>
                <div className="col-span-3">
                  <CurrencyInput
                    value={cashAsset.balanceAtSimulationStart}
                    onChange={(v) => updateAsset(cashAsset.id, { balanceAtSimulationStart: v })}
                  />
                </div>
                <div className="col-span-3 flex items-center pl-2 text-xs text-gray-400 italic">
                  Dynamic (net cash flow)
                </div>
                <div className="col-span-1" />
              </div>
            )}

            {/* Other accounts */}
            {nonCashAssets.map((asset) => (
              <div key={asset.id} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded p-2">
                <div className="col-span-5 text-sm text-gray-700">
                  {ASSET_TYPE_LABELS[asset.type]}
                </div>
                <div className="col-span-3">
                  <CurrencyInput
                    value={asset.balanceAtSimulationStart}
                    onChange={(v) => updateAsset(asset.id, { balanceAtSimulationStart: v })}
                  />
                </div>
                <div className="col-span-3">
                  <CurrencyInput
                    value={asset.annualContribution}
                    onChange={(v) => updateAsset(asset.id, { annualContribution: v })}
                  />
                </div>
                <button
                  onClick={() => removeAsset(asset.id)}
                  className="col-span-1 text-red-400 hover:text-red-600 text-lg leading-none text-center"
                >
                  ×
                </button>
              </div>
            ))}

            {/* Total starting assets */}
            <div className="pt-1 flex justify-end">
              <span className="text-sm text-gray-500">
                Total starting assets:{' '}
                <span className="font-semibold text-gray-800">
                  {fmt.format(config.householdAssets.reduce((s, a) => s + a.balanceAtSimulationStart, 0))}
                </span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ════════════ Household Expenses ════════════ */}
      <div className="border border-gray-200 rounded-lg">
        <div className="flex items-center gap-3 bg-gray-50 px-4 py-3 rounded-lg">
          <button
            onClick={() => setExpensesOpen((o) => !o)}
            className="flex items-center gap-3 flex-1 text-left hover:opacity-70 transition-opacity"
          >
            <span className={`text-gray-400 transition-transform duration-200 text-xs ${expensesOpen ? 'rotate-90' : ''}`}>▶</span>
            <h2 className="text-sm font-semibold text-gray-700">Household Expenses</h2>
            {!expensesOpen && (
              <span className="text-xs text-gray-400">
                {config.expenses.length} expense{config.expenses.length !== 1 ? 's' : ''}
                {config.expenses.length > 0 && ` · ${fmt.format(config.expenses.reduce((s, e) => s + (e.frequency === 'monthly' ? e.amount * 12 : e.amount), 0))} / year`}
              </span>
            )}
          </button>
          <button onClick={addExpense} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">+ Add</button>
        </div>

        {expensesOpen && (
          <div className="p-4 border-t border-gray-100 space-y-3">
            {config.expenses.length === 0 && (
              <p className="text-sm text-gray-400 italic">No expenses added.</p>
            )}
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
            {config.expenses.length > 0 && (
              <div className="bg-indigo-50 rounded p-3 text-sm flex justify-between items-center">
                <span className="text-gray-500">Total annual expenses</span>
                <span className="font-semibold">
                  {fmt.format(config.expenses.reduce((s, e) => s + (e.frequency === 'monthly' ? e.amount * 12 : e.amount), 0))}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
