import { useState } from 'react'
import type { AppConfig, HouseholdMember, IncomeSource, IncomeSourceType, HouseholdAsset, AssetType, ContributionPeriod, Expense, RegularExpense, EducationExpense, PeriodicExpense, ExpenseType, Frequency, HealthcarePlan } from '../types'
import { ASSET_TYPE_LABELS, ADDABLE_ASSET_TYPES, DEFAULT_HEALTHCARE_PLAN } from '../types'
import { US_STATES } from '../lib/states'
import CurrencyInput from './CurrencyInput'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { estimateSsBenefit } from '../lib/ssEstimate'

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

  function moveMember(id: string, direction: 'up' | 'down') {
    const arr = [...config.household]
    const idx = arr.findIndex((m) => m.id === id)
    const next = direction === 'up' ? idx - 1 : idx + 1
    if (next < 0 || next >= arr.length) return
    ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
    onChange({ ...config, household: arr })
  }

  // --- Income sources ---
  function memberWageSalary(memberId: string): number {
    return config.incomeSources
      .filter((s) => s.memberId === memberId && s.incomeType !== 'socialSecurity')
      .reduce((sum, s) => sum + s.annualAmount, 0)
  }

  function addIncome(memberId: string, member: HouseholdMember, type: IncomeSourceType = 'wage') {
    const isSS = type === 'socialSecurity'
    const startAge = isSS ? 67 : member.ageAtSimulationStart
    const annualAmount = isSS ? estimateSsBenefit(memberWageSalary(memberId), startAge) : 0
    const src: IncomeSource = {
      id: uid(),
      memberId,
      incomeType: type,
      name: isSS ? 'Social Security' : '',
      startAge,
      annualAmount,
      annualGrowthRate: 0.03,
      endAge: isSS ? undefined : member.retirementAge,
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
    const asset: HouseholdAsset = { id: uid(), type, balanceAtSimulationStart: 0, contributions: [] }
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

  function moveAsset(id: string, direction: 'up' | 'down') {
    const arr = [...config.householdAssets]
    const idx = arr.findIndex((a) => a.id === id)
    const next = direction === 'up' ? idx - 1 : idx + 1
    if (next < 1 || next >= arr.length) return // clamp to 1 so cash stays at index 0
    ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
    onChange({ ...config, householdAssets: arr })
  }

  function addContribution(assetId: string) {
    const asset = config.householdAssets.find((a) => a.id === assetId)!
    const newPeriod: ContributionPeriod = { id: uid(), startAge: 0, endAge: undefined, annualAmount: 0 }
    updateAsset(assetId, { contributions: [...asset.contributions, newPeriod] })
  }

  function updateContribution(assetId: string, periodId: string, partial: Partial<ContributionPeriod>) {
    const asset = config.householdAssets.find((a) => a.id === assetId)!
    updateAsset(assetId, {
      contributions: asset.contributions.map((c) => (c.id === periodId ? { ...c, ...partial } : c)),
    })
  }

  function removeContribution(assetId: string, periodId: string) {
    const asset = config.householdAssets.find((a) => a.id === assetId)!
    updateAsset(assetId, { contributions: asset.contributions.filter((c) => c.id !== periodId) })
  }

  // --- Healthcare ---
  function updateHealthcarePlan(memberId: string, partial: Partial<HealthcarePlan>) {
    const member = config.household.find((m) => m.id === memberId)!
    const plan = member.healthcarePlan ?? { ...DEFAULT_HEALTHCARE_PLAN }
    updateMember(memberId, { healthcarePlan: { ...plan, ...partial } })
  }

  // --- Expenses ---
  function addExpense() {
    const exp: RegularExpense = { id: uid(), name: 'New expense', amount: 0, expenseType: 'regular', frequency: 'monthly', inflationAdjusted: true }
    onChange({ ...config, expenses: [...config.expenses, exp] })
  }
  function updateExpense(id: string, partial: Partial<Expense>) {
    onChange({ ...config, expenses: config.expenses.map((e) => (e.id === id ? { ...e, ...partial } as Expense : e)) })
  }
  function removeExpense(id: string) {
    onChange({ ...config, expenses: config.expenses.filter((e) => e.id !== id) })
  }

  function moveExpense(id: string, direction: 'up' | 'down') {
    const arr = [...config.expenses]
    const idx = arr.findIndex((e) => e.id === id)
    const next = direction === 'up' ? idx - 1 : idx + 1
    if (next < 0 || next >= arr.length) return
    ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
    onChange({ ...config, expenses: arr })
  }
  function changeExpenseType(id: string, newType: ExpenseType) {
    const existing = config.expenses.find((e) => e.id === id)!
    const base = {
      id: existing.id,
      name: existing.name,
      amount: existing.amount,
      inflationAdjusted: existing.inflationAdjusted,
      startAge: existing.startAge,
      endAge: existing.endAge,
    }
    const updated: Expense =
      newType === 'periodic'
        ? { ...base, expenseType: 'periodic', intervalYears: 5 }
        : newType === 'education'
        ? { ...base, expenseType: 'education', frequency: 'monthly' }
        : { ...base, expenseType: 'regular', frequency: 'monthly' }
    onChange({ ...config, expenses: config.expenses.map((e) => (e.id === id ? updated : e)) })
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
                  {member.state !== 'OR' && (
                    <p className="text-xs text-amber-600 mt-1">State tax for this state is not yet supported</p>
                  )}
                </div>

                <div className="flex flex-col gap-0.5 shrink-0 mt-4">
                  <button
                    onClick={() => moveMember(member.id, 'up')}
                    disabled={i === 0}
                    className="px-1.5 py-0.5 text-xs leading-none rounded border bg-white text-gray-500 border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move up"
                  >▲</button>
                  <button
                    onClick={() => moveMember(member.id, 'down')}
                    disabled={i === config.household.length - 1}
                    className="px-1.5 py-0.5 text-xs leading-none rounded border bg-white text-gray-500 border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move down"
                  >▼</button>
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
                    onClick={() => addIncome(member.id, member, 'wage')}
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
                    <span className="col-span-2 text-xs text-gray-400">Type</span>
                    <span className="col-span-3 text-xs text-gray-400">Name</span>
                    <span className="col-span-3 text-xs text-gray-400">Annual Amount <span className="text-gray-300">(today's $)</span></span>
                    <span className="col-span-1 text-xs text-gray-400">Annual Growth</span>
                    <span className="col-span-1 text-xs text-gray-400">Start Age</span>
                    <span className="col-span-1 text-xs text-gray-400">End Age</span>
                    <span className="col-span-1" />
                  </div>
                )}

                {memberIncome.map((src) => {
                  const isSS = src.incomeType === 'socialSecurity'
                  const ssEstimate = isSS
                    ? estimateSsBenefit(memberWageSalary(member.id), src.startAge)
                    : 0
                  return (
                    <div key={src.id} className="space-y-1">
                      <div className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded p-2">
                        {/* Type badge */}
                        <div className="col-span-2">
                          <select
                            className="input text-xs w-full px-1"
                            value={src.incomeType ?? 'wage'}
                            onChange={(e) => {
                              const newType = e.target.value as IncomeSourceType
                              const updates: Partial<IncomeSource> = { incomeType: newType }
                              if (newType === 'socialSecurity') {
                                updates.startAge = member.retirementAge
                                updates.endAge = undefined
                              }
                              updateIncome(src.id, updates)
                            }}
                          >
                            <option value="wage">Wage</option>
                            <option value="socialSecurity">Social Security</option>
                            <option value="other">Other</option>
                          </select>
                        </div>

                        <input
                          className="col-span-3 input"
                          placeholder={isSS ? 'Social Security' : 'e.g. Salary'}
                          value={src.name}
                          onChange={(e) => updateIncome(src.id, { name: e.target.value })}
                        />

                        <div className="col-span-3">
                          <CurrencyInput
                            value={src.annualAmount}
                            onChange={(v) => updateIncome(src.id, { annualAmount: v })}
                          />
                        </div>

                        {/* Annual growth — hidden for SS (uses COLA from assumptions) */}
                        {isSS ? (
                          <div className="col-span-1 flex items-center pl-1">
                            <span className="text-xs text-gray-400 italic">SS COLA</span>
                          </div>
                        ) : (
                          <div className="col-span-1 relative">
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
                        )}

                        <input
                          type="number"
                          className="col-span-1 input"
                          placeholder={isSS ? '67' : String(member.ageAtSimulationStart)}
                          value={src.startAge || ''}
                          onChange={(e) => updateIncome(src.id, { startAge: parseInt(e.target.value) || 0 })}
                        />

                        <div className="col-span-1">
                          <input
                            type="number"
                            disabled={isSS}
                            className={`input w-full ${isSS ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''} ${!isSS && src.endAge !== undefined && src.endAge < src.startAge ? 'border-red-400 focus:ring-red-400' : ''}`}
                            placeholder={isSS ? 'N/A' : String(member.retirementAge)}
                            value={src.endAge ?? ''}
                            onChange={(e) => {
                              const val = e.target.value
                              updateIncome(src.id, { endAge: val === '' ? undefined : parseInt(val) || undefined })
                            }}
                          />
                          {!isSS && src.endAge !== undefined && src.endAge < src.startAge && (
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

                      {/* SS estimate hint */}
                      {isSS && (
                        <div className="flex items-center gap-2 px-2 pb-1">
                          <span className="text-xs text-gray-400">
                            Estimated at age {src.startAge}: {fmt.format(ssEstimate)}/yr
                          </span>
                          <button
                            onClick={() => updateIncome(src.id, { annualAmount: ssEstimate })}
                            className="text-xs text-indigo-500 hover:text-indigo-700 underline decoration-dashed"
                          >
                            ↻ Use estimate
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}

                {memberIncome.length > 0 && (
                  <p className="text-xs text-gray-400 pt-1">
                    Total current annual income:{' '}
                    <span className="font-medium text-gray-600">
                      {fmt.format(memberIncome.reduce((s, src) => s + src.annualAmount, 0))}
                    </span>
                  </p>
                )}
              </div>

              {/* Healthcare plan for this member */}
              {(() => {
                const plan = member.healthcarePlan ?? DEFAULT_HEALTHCARE_PLAN
                const otherMembers = config.household.filter((m) => m.id !== member.id)
                const isOwnEmployer = plan.employerCoverage === 'own'
                const isCoveredByOther = plan.employerCoverage !== 'own' && plan.employerCoverage !== 'none'
                const coveringMember = isCoveredByOther ? config.household.find((m) => m.id === plan.employerCoverage) : null
                const employerEndAge = isOwnEmployer
                  ? (plan.employerCoverageEndAge ?? member.retirementAge)
                  : isCoveredByOther && coveringMember
                    ? (coveringMember.healthcarePlan?.employerCoverageEndAge ?? coveringMember.retirementAge) + (member.ageAtSimulationStart - coveringMember.ageAtSimulationStart)
                    : member.ageAtSimulationStart
                const hasGapPhase = employerEndAge < 65
                return (
                  <div className="px-4 pb-4 space-y-2 border-t border-gray-100 pt-3">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={plan.enabled}
                          onChange={(e) => updateHealthcarePlan(member.id, { enabled: e.target.checked })}
                          className="rounded"
                        />
                        Healthcare Costs
                      </label>
                      {!plan.enabled && (
                        <span className="text-xs text-gray-400">Enable to model healthcare expenses for this member</span>
                      )}
                    </div>

                    {plan.enabled && (
                      <div className="bg-gray-50 rounded p-3 space-y-3">
                        {/* Coverage source selector (above the phase table) */}
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="flex items-center gap-2">
                            <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Employer coverage</label>
                            <select
                              className="input text-xs"
                              value={plan.employerCoverage}
                              onChange={(e) => updateHealthcarePlan(member.id, { employerCoverage: e.target.value })}
                            >
                              <option value="own">Own employer</option>
                              {otherMembers.map((m) => (
                                <option key={m.id} value={m.id}>Covered by {m.name || 'other member'}</option>
                              ))}
                              <option value="none">None / self-pay from start</option>
                            </select>
                          </div>
                          {isOwnEmployer && (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-gray-400 whitespace-nowrap">Ends age</span>
                              <input
                                type="number"
                                className="input text-xs w-16"
                                placeholder={String(member.retirementAge)}
                                value={plan.employerCoverageEndAge ?? ''}
                                onChange={(e) => updateHealthcarePlan(member.id, {
                                  employerCoverageEndAge: e.target.value === '' ? undefined : parseInt(e.target.value) || undefined,
                                })}
                              />
                            </div>
                          )}
                          {isCoveredByOther && coveringMember && (
                            <span className="text-xs text-gray-400">
                              until {coveringMember.name || 'other member'} stops working (your age {employerEndAge})
                            </span>
                          )}
                        </div>

                        {/* Phase table */}
                        <div className="space-y-2">
                          {/* Column headers */}
                          <div className="grid grid-cols-12 gap-2">
                            <div className="col-span-3" />
                            <span className="col-span-4 text-xs text-gray-400">Monthly Premium</span>
                            <span className="col-span-4 text-xs text-gray-400">Out-of-Pocket (/yr)</span>
                          </div>

                          {/* Employer phase */}
                          <div className="grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-3">
                              <span className="text-xs font-medium text-gray-600">Employer</span>
                              {plan.employerCoverage !== 'none' && (
                                <span className="block text-xs text-gray-400">until age {employerEndAge}</span>
                              )}
                            </div>
                            <div className="col-span-4">
                              {plan.employerCoverage === 'none' ? (
                                <span className="text-xs text-gray-400 italic">n/a</span>
                              ) : isOwnEmployer ? (
                                <CurrencyInput
                                  value={plan.employerPremium}
                                  onChange={(v) => updateHealthcarePlan(member.id, { employerPremium: v })}
                                />
                              ) : (
                                <span className="text-xs text-gray-400 italic">$0 (covered)</span>
                              )}
                            </div>
                            <div className="col-span-4">
                              {plan.employerCoverage === 'none' ? (
                                <span className="text-xs text-gray-400 italic">n/a</span>
                              ) : (
                                <CurrencyInput
                                  value={plan.employerOutOfPocketAnnual}
                                  onChange={(v) => updateHealthcarePlan(member.id, { employerOutOfPocketAnnual: v })}
                                />
                              )}
                            </div>
                          </div>

                          {/* Pre-Medicare gap phase */}
                          {hasGapPhase && (
                            <div className="grid grid-cols-12 gap-2 items-center">
                              <div className="col-span-3">
                                <span className="text-xs font-medium text-gray-600">Pre-Medicare</span>
                                <span className="block text-xs text-gray-400">age {employerEndAge}–64</span>
                              </div>
                              <div className="col-span-4">
                                <CurrencyInput
                                  value={plan.preMedicarePremium}
                                  onChange={(v) => updateHealthcarePlan(member.id, { preMedicarePremium: v })}
                                />
                              </div>
                              <div className="col-span-4">
                                <CurrencyInput
                                  value={plan.preMedicareOutOfPocketAnnual}
                                  onChange={(v) => updateHealthcarePlan(member.id, { preMedicareOutOfPocketAnnual: v })}
                                />
                              </div>
                            </div>
                          )}

                          {/* Medicare phase */}
                          <div className="grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-3">
                              <span className="text-xs font-medium text-gray-600">Medicare</span>
                              <span className="block text-xs text-gray-400">age {Math.max(employerEndAge, 65)}+</span>
                            </div>
                            <div className="col-span-4">
                              <CurrencyInput
                                value={plan.medicareSupplementPremium}
                                onChange={(v) => updateHealthcarePlan(member.id, { medicareSupplementPremium: v })}
                              />
                            </div>
                            <div className="col-span-4">
                              <CurrencyInput
                                value={plan.medicareOutOfPocketAnnual}
                                onChange={(v) => updateHealthcarePlan(member.id, { medicareOutOfPocketAnnual: v })}
                              />
                            </div>
                          </div>
                        </div>

                        {/* IRMAA note */}
                        <p className="text-xs text-gray-400 pt-1">
                          Medicare IRMAA surcharges are calculated automatically based on projected income.
                        </p>
                      </div>
                    )}
                  </div>
                )
              })()}
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
              <span className="col-span-3 text-xs text-gray-400">Account Type</span>
              <span className="col-span-3 text-xs text-gray-400">Balance at Start</span>
              <span className="col-span-4 text-xs text-gray-400">
                {config.household.length >= 2 ? 'Min. Balance (months of expenses) / Account Owner' : 'Min. Balance (months of expenses)'}
              </span>
              <span className="col-span-1" />
            </div>

            {/* Cash account — always present, non-removable */}
            {cashAsset && (() => {
              const startAge = config.household[0]?.ageAtSimulationStart ?? 0
              const baseAnnualExpenses = config.expenses.reduce((sum, e) => {
                if (e.expenseType === 'periodic') return sum
                if (e.expenseType === 'education') return sum  // covered by 529, not cash
                if (e.startAge !== undefined && e.startAge > startAge) return sum
                if (e.endAge !== undefined && e.endAge < startAge) return sum
                return sum + ((e as RegularExpense).frequency === 'monthly' ? e.amount * 12 : e.amount)
              }, 0)
              const cashReserveTarget = (cashAsset.monthsReserve ?? 0) * baseAnnualExpenses / 12
              return (
                <div className="grid grid-cols-12 gap-2 items-start bg-indigo-50 rounded p-2">
                  <div className="col-span-3 flex items-center gap-2 pt-1">
                    <span className="text-sm font-medium text-indigo-700">{ASSET_TYPE_LABELS.cash}</span>
                    <span className="text-xs text-indigo-400 bg-indigo-100 rounded px-1.5 py-0.5">primary</span>
                  </div>
                  <div className="col-span-3">
                    <CurrencyInput
                      value={cashAsset.balanceAtSimulationStart}
                      onChange={(v) => updateAsset(cashAsset.id, { balanceAtSimulationStart: v })}
                    />
                  </div>
                  <div className="col-span-4 flex flex-col gap-0.5">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        className="input text-sm w-full"
                        value={cashAsset.monthsReserve ?? ''}
                        onChange={(e) => updateAsset(cashAsset.id, {
                          monthsReserve: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)),
                        })}
                      />
                      <span className="text-xs text-gray-400 shrink-0">mo.</span>
                    </div>
                    {cashReserveTarget > 0 && (
                      <span className="text-xs text-gray-400">≈ {fmt.format(cashReserveTarget)}</span>
                    )}
                  </div>
                  <div className="col-span-1" />
                </div>
              )
            })()}

            {/* Other accounts */}
            {nonCashAssets.map((asset, nonCashIdx) => {
              const isMM = asset.type === 'moneyMarketSavings'
              const startAge = config.household[0]?.ageAtSimulationStart ?? 0
              const baseAnnualExpenses = config.expenses.reduce((sum, e) => {
                if (e.expenseType === 'periodic') return sum
                if (e.expenseType === 'education') return sum  // covered by 529, not cash
                if (e.startAge !== undefined && e.startAge > startAge) return sum
                if (e.endAge !== undefined && e.endAge < startAge) return sum
                return sum + ((e as RegularExpense).frequency === 'monthly' ? e.amount * 12 : e.amount)
              }, 0)
              const mmReserveTarget = isMM ? (asset.monthsReserve ?? 0) * baseAnnualExpenses / 12 : 0
              return (
              <div key={asset.id} className="bg-gray-50 rounded p-2 space-y-2">
                {/* Account header row */}
                <div className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-3 text-sm text-gray-700 pt-1">
                    {ASSET_TYPE_LABELS[asset.type]}
                  </div>
                  <div className="col-span-3">
                    <CurrencyInput
                      value={asset.balanceAtSimulationStart}
                      onChange={(v) => updateAsset(asset.id, { balanceAtSimulationStart: v })}
                    />
                  </div>
                  {isMM ? (
                    <div className="col-span-4 flex flex-col gap-0.5">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="0"
                          className="input text-sm w-full"
                          value={asset.monthsReserve ?? ''}
                          onChange={(e) => updateAsset(asset.id, {
                            monthsReserve: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)),
                          })}
                        />
                        <span className="text-xs text-gray-400 shrink-0">mo.</span>
                      </div>
                      {mmReserveTarget > 0 && (
                        <span className="text-xs text-gray-400">≈ {fmt.format(mmReserveTarget)}</span>
                      )}
                    </div>
                  ) : (asset.type === 'retirementTraditional' || asset.type === 'retirementRoth') && config.household.length >= 2 ? (
                    <div className="col-span-4">
                      <select
                        className="input text-sm w-full"
                        value={asset.memberId ?? ''}
                        onChange={(e) => updateAsset(asset.id, { memberId: e.target.value || undefined })}
                      >
                        <option value="">Household (primary)</option>
                        {config.household.map((m) => (
                          <option key={m.id} value={m.id}>{m.name || `Member ${config.household.indexOf(m) + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="col-span-4" />
                  )}
                  <div className="col-span-1 flex items-center gap-1 pt-1">
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => moveAsset(asset.id, 'up')}
                        disabled={nonCashIdx === 0}
                        className="px-1 py-0.5 text-xs leading-none rounded border bg-white text-gray-500 border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move up"
                      >▲</button>
                      <button
                        onClick={() => moveAsset(asset.id, 'down')}
                        disabled={nonCashIdx === nonCashAssets.length - 1}
                        className="px-1 py-0.5 text-xs leading-none rounded border bg-white text-gray-500 border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move down"
                      >▼</button>
                    </div>
                    <button
                      onClick={() => removeAsset(asset.id)}
                      className="text-red-400 hover:text-red-600 text-lg leading-none"
                    >×</button>
                  </div>
                </div>

                {/* Roth contribution basis row */}
                {asset.type === 'retirementRoth' && (
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-3 text-xs text-gray-500">
                      Contribution basis
                      <span className="block text-gray-400 font-normal leading-tight">penalty-free to withdraw</span>
                    </div>
                    <div className="col-span-3">
                      <CurrencyInput
                        value={asset.rothContributionBasis ?? asset.balanceAtSimulationStart}
                        onChange={(v) => updateAsset(asset.id, { rothContributionBasis: Math.min(v, asset.balanceAtSimulationStart) })}
                      />
                    </div>
                    <div className="col-span-5 text-xs text-gray-400">
                      Portion of balance from contributions (not earnings). Max: {fmt.format(asset.balanceAtSimulationStart)}.
                    </div>
                  </div>
                )}

                {/* Contribution periods */}
                <div className="pl-2 border-l-2 border-gray-200 ml-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400 font-medium">Annual Contributions (by age range)</span>
                    <button
                      onClick={() => addContribution(asset.id)}
                      className="text-xs text-indigo-500 hover:text-indigo-700"
                    >
                      + Add contribution period
                    </button>
                  </div>

                  {asset.contributions.length === 0 && (
                    <p className="text-xs text-gray-400 italic py-0.5">No contributions.</p>
                  )}

                  {asset.contributions.length > 0 && (
                    <div className="grid grid-cols-12 gap-2 px-1">
                      <span className="col-span-2 text-xs text-gray-400">Start Age</span>
                      <span className="col-span-2 text-xs text-gray-400">End Age</span>
                      <span className="col-span-2 text-xs text-gray-400">Annual Amount</span>
                      <span className="col-span-1" />
                    </div>
                  )}

                  {asset.contributions.map((period) => (
                    <div key={period.id} className="grid grid-cols-12 gap-2 items-center">
                      <input
                        type="number"
                        className="col-span-2 input"
                        placeholder="0"
                        value={period.startAge || ''}
                        onChange={(e) => updateContribution(asset.id, period.id, { startAge: parseInt(e.target.value) || 0 })}
                      />
                      <input
                        type="number"
                        className="col-span-2 input"
                        placeholder="End of sim"
                        value={period.endAge ?? ''}
                        onChange={(e) => {
                          const val = e.target.value
                          updateContribution(asset.id, period.id, { endAge: val === '' ? undefined : parseInt(val) || undefined })
                        }}
                      />
                      <div className="col-span-2">
                        <CurrencyInput
                          value={period.annualAmount}
                          onChange={(v) => updateContribution(asset.id, period.id, { annualAmount: v })}
                        />
                      </div>
                      <button
                        onClick={() => removeContribution(asset.id, period.id)}
                        className="col-span-1 text-red-400 hover:text-red-600 text-lg leading-none text-center"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              )
            })}

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
                {config.expenses.length > 0 && ` · ${fmt.format(config.expenses.filter((e) => e.expenseType !== 'periodic').reduce((s, e) => s + ((e as RegularExpense | EducationExpense).frequency === 'monthly' ? e.amount * 12 : e.amount), 0))} / year`}
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
            {config.expenses.length > 0 && (
              <div className="grid grid-cols-12 gap-2 px-1 mb-1">
                <span className="col-span-2 text-xs text-gray-400">Type</span>
                <span className="col-span-2 text-xs text-gray-400">Name</span>
                <span className="col-span-1 text-xs text-gray-400">Amount</span>
                <span className="col-span-2 text-xs text-gray-400">Freq / Every</span>
                <span className="col-span-1 text-xs text-gray-400">Start</span>
                <span className="col-span-1 text-xs text-gray-400">End</span>
                <span className="col-span-2 text-xs text-gray-400">Inflation Adjusted?</span>
                <span className="col-span-1" />
              </div>
            )}
            {config.expenses.map((exp, expIdx) => (
              <div key={exp.id} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded p-2">
                <select
                  className="col-span-2 input text-xs"
                  value={exp.expenseType}
                  onChange={(e) => changeExpenseType(exp.id, e.target.value as ExpenseType)}
                >
                  <option value="regular">Regular</option>
                  <option value="periodic">Periodic</option>
                  <option value="education">Education 529</option>
                </select>
                <input
                  className="col-span-2 input"
                  placeholder="Name"
                  value={exp.name}
                  onChange={(e) => updateExpense(exp.id, { name: e.target.value })}
                />
                <input
                  type="number"
                  className="col-span-1 input"
                  placeholder="0"
                  value={exp.amount || ''}
                  onChange={(e) => updateExpense(exp.id, { amount: parseFloat(e.target.value) || 0 })}
                />
                {exp.expenseType === 'periodic' ? (
                  <div className="col-span-2 flex items-center gap-1">
                    <input
                      type="number"
                      className="input w-full"
                      min="1"
                      step="1"
                      placeholder="5"
                      value={(exp as PeriodicExpense).intervalYears || ''}
                      onChange={(e) => updateExpense(exp.id, { intervalYears: Math.max(1, parseInt(e.target.value) || 1) } as Partial<PeriodicExpense>)}
                    />
                    <span className="text-xs text-gray-400 shrink-0">yrs</span>
                  </div>
                ) : (
                  <select
                    className="col-span-2 input"
                    value={(exp as RegularExpense | EducationExpense).frequency}
                    onChange={(e) => updateExpense(exp.id, { frequency: e.target.value as Frequency })}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                  </select>
                )}
                <input
                  type="number"
                  className="col-span-1 input"
                  placeholder="—"
                  value={exp.startAge ?? ''}
                  onChange={(e) => {
                    const val = e.target.value
                    updateExpense(exp.id, { startAge: val === '' ? undefined : parseInt(val) || undefined })
                  }}
                />
                <input
                  type="number"
                  className="col-span-1 input"
                  placeholder="—"
                  value={exp.endAge ?? ''}
                  onChange={(e) => {
                    const val = e.target.value
                    updateExpense(exp.id, { endAge: val === '' ? undefined : parseInt(val) || undefined })
                  }}
                />
                <div className="col-span-2 flex justify-left">
                  <input
                    type="checkbox"
                    checked={exp.inflationAdjusted}
                    onChange={(e) => updateExpense(exp.id, { inflationAdjusted: e.target.checked })}
                  />
                </div>
                <div className="col-span-1 flex items-center gap-1">
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => moveExpense(exp.id, 'up')}
                      disabled={expIdx === 0}
                      className="px-1 py-0.5 text-xs leading-none rounded border bg-white text-gray-500 border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move up"
                    >▲</button>
                    <button
                      onClick={() => moveExpense(exp.id, 'down')}
                      disabled={expIdx === config.expenses.length - 1}
                      className="px-1 py-0.5 text-xs leading-none rounded border bg-white text-gray-500 border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move down"
                    >▼</button>
                  </div>
                  <button onClick={() => removeExpense(exp.id)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                </div>
              </div>
            ))}
            {config.expenses.length > 0 && (() => {
              const regularAnnual = config.expenses
                .filter((e) => e.expenseType !== 'periodic')
                .reduce((s, e) => s + ((e as RegularExpense | EducationExpense).frequency === 'monthly' ? e.amount * 12 : e.amount), 0)
              const periodicExpenses = config.expenses.filter((e): e is PeriodicExpense => e.expenseType === 'periodic')
              const periodicTotal = periodicExpenses.reduce((s, e) => s + e.amount, 0)
              return (
                <div className="bg-indigo-50 rounded p-3 text-sm flex justify-between items-center">
                  <span className="text-gray-500">Total recurring annual expenses</span>
                  <span className="font-semibold">
                    {fmt.format(regularAnnual)}
                    {periodicTotal > 0 && (
                      <span className="text-gray-400 font-normal ml-2">+ {fmt.format(periodicTotal)} periodic</span>
                    )}
                  </span>
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
