import { useState, useEffect, useRef } from 'react'
import type { YearlySnapshot } from '../lib/projection'

interface Props {
  snapshots: YearlySnapshot[]
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

interface PopoverState {
  age: number
  type: 'tax' | 'assets' | 'income' | 'expenses'
  top: number
  /** Set when anchoring to the left edge of the button */
  left?: number
  /** Set when anchoring to the right edge of the button (near right viewport edge) */
  right?: number
}

export default function ProjectionTable({ snapshots }: Props) {
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!popover) return
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [popover])

  if (snapshots.length === 0) {
    return <p className="text-gray-400 italic text-sm">No data to display. Configure your inputs first.</p>
  }

  function openPopover(e: React.MouseEvent, age: number, type: 'tax' | 'assets' | 'income' | 'expenses') {
    e.stopPropagation()
    if (popover?.age === age && popover?.type === type) {
      setPopover(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const anchorRight = rect.right > window.innerWidth / 2
    setPopover({
      age,
      type,
      top: rect.bottom + window.scrollY,
      left: anchorRight ? undefined : rect.left,
      right: anchorRight ? window.innerWidth - rect.right : undefined,
    })
  }

  const activeSnapshot = popover ? snapshots.find((s) => s.age === popover.age) : null

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-500 uppercase border-b">
            <tr>
              <th className="py-2 pr-4">Year</th>
              <th className="py-2 pr-4">Age</th>
              <th className="py-2 pr-4 text-right">
                Income
                <span className="ml-1 normal-case text-gray-400 font-normal">(click ↓)</span>
              </th>
              <th className="py-2 pr-4 text-right">
                Total Tax
                <span className="ml-1 normal-case text-gray-400 font-normal">(click ↓)</span>
              </th>
              <th className="py-2 pr-4 text-right">Net Income</th>
              <th className="py-2 pr-4 text-right">
                Expenses
                <span className="ml-1 normal-case text-gray-400 font-normal">(click ↓)</span>
              </th>
              <th className="py-2 pr-4 text-right">Net Cash Flow</th>
              <th className="py-2 pr-4 text-right">
                Total Assets
                <span className="ml-1 normal-case text-gray-400 font-normal">(click ↓)</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s) => {
              const totalTax = s.totalTax
              const incomeOpen = popover?.age === s.age && popover?.type === 'income'
              const taxOpen = popover?.age === s.age && popover?.type === 'tax'
              const expensesOpen = popover?.age === s.age && popover?.type === 'expenses'
              const assetsOpen = popover?.age === s.age && popover?.type === 'assets'
              const rowClass = s.depleted ? 'bg-red-50 text-red-700' : 'hover:bg-gray-50'

              const netIncome = s.income - totalTax

              return (
                <tr key={s.age} className={`border-b last:border-0 ${rowClass}`}>
                  <td className="py-2 pr-4 font-medium">{s.year}</td>
                  <td className="py-2 pr-4 text-gray-500">
                    {s.age}
                    {s.rmdWithdrawn > 0 && (
                      <span className="ml-1 text-purple-500 text-xs" title="RMD taken this year">R</span>
                    )}
                    {s.rothConverted > 0 && (
                      <span className="ml-1 text-emerald-600 text-xs" title="Roth conversion this year">↻</span>
                    )}
                    {s.marketCrashActive && (
                      <span className="ml-1 text-orange-500 text-xs" title="Market crash/recovery active">↓</span>
                    )}
                    {s.earlyWithdrawalPenalty > 0 && (
                      <span className="ml-1 text-red-500 text-xs" title="Early withdrawal penalty (10%) applied">⚠</span>
                    )}
                  </td>
                  {/* Income — clickable */}
                  <td className="py-2 pr-4 text-right">
                    <button
                      onClick={(e) => openPopover(e, s.age, 'income')}
                      className={`underline decoration-dashed underline-offset-2 cursor-pointer rounded px-1 -mx-1 transition-colors ${incomeOpen ? 'bg-emerald-100' : 'hover:bg-emerald-50'}`}
                    >
                      {fmt.format(s.income)}
                    </button>
                  </td>

                  {/* Total Tax — clickable */}
                  <td className="py-2 pr-4 text-right">
                    <button
                      onClick={(e) => openPopover(e, s.age, 'tax')}
                      className={`text-orange-700 underline decoration-dashed underline-offset-2 cursor-pointer rounded px-1 -mx-1 transition-colors ${taxOpen ? 'bg-orange-100' : 'hover:bg-orange-50'}`}
                    >
                      {fmt.format(totalTax)}
                    </button>
                  </td>

                  <td className="py-2 pr-4 text-right">{fmt.format(netIncome)}</td>
                  <td className="py-2 pr-4 text-right">
                    <button
                      onClick={(e) => openPopover(e, s.age, 'expenses')}
                      className={`underline decoration-dashed underline-offset-2 cursor-pointer rounded px-1 -mx-1 transition-colors ${expensesOpen ? 'bg-rose-100' : 'hover:bg-rose-50'}`}
                    >
                      {fmt.format(s.expenses)}
                    </button>
                  </td>
                  <td className={`py-2 pr-4 text-right font-medium ${s.netCashFlow < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {fmt.format(s.netCashFlow)}
                  </td>

                  {/* Total Assets — clickable */}
                  <td className="py-2 pr-4 text-right">
                    <button
                      onClick={(e) => openPopover(e, s.age, 'assets')}
                      className={`font-semibold underline decoration-dashed underline-offset-2 cursor-pointer rounded px-1 -mx-1 transition-colors ${assetsOpen ? 'bg-indigo-100' : 'hover:bg-indigo-50'}`}
                    >
                      {fmt.format(s.totalAssets)}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Fixed popover — rendered outside the overflow container */}
      {popover && activeSnapshot && (
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            top: popover.top - window.scrollY + 6,
            ...(popover.left !== undefined ? { left: popover.left } : { right: popover.right }),
          }}
          className="z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-48 text-sm max-w-lg"
        >
          {popover.type === 'income' ? (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Income Breakdown</p>
              <BreakdownRows rows={activeSnapshot.incomeBreakdown.map((i) => ({ label: i.label, value: i.amount }))} />
              <div className="border-t border-gray-100 mt-2 pt-2 flex justify-between font-semibold">
                <span>Total</span>
                <span>{fmt.format(activeSnapshot.incomeBreakdown.reduce((s, i) => s + i.amount, 0))}</span>
              </div>
            </>
          ) : popover.type === 'expenses' ? (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Expense Breakdown</p>
              {activeSnapshot.expenseBreakdown.length === 0
                ? <p className="text-gray-400 italic text-xs">No expenses this year.</p>
                : <BreakdownRows rows={activeSnapshot.expenseBreakdown.map((i) => ({ label: i.label, value: i.amount }))} />
              }
              {activeSnapshot.expenseBreakdown.length > 0 && (
                <div className="border-t border-gray-100 mt-2 pt-2 flex justify-between font-semibold">
                  <span>Total</span>
                  <span>{fmt.format(activeSnapshot.expenses)}</span>
                </div>
              )}
            </>
          ) : popover.type === 'tax' ? (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tax Breakdown</p>
              <BreakdownRows rows={[
                { label: 'Federal Income Tax', value: activeSnapshot.federalIncomeTax + activeSnapshot.traditionalIraTax },
                { label: 'FICA', value: activeSnapshot.ficaTax },
                { label: 'State Income Tax', value: activeSnapshot.stateIncomeTax },
                { label: 'Capital Gains Tax', value: activeSnapshot.capitalGainsTax },
                { label: 'Net Investment Income Tax', value: activeSnapshot.niit },
                { label: 'Early Withdrawal Penalty (10%)', value: activeSnapshot.earlyWithdrawalPenalty },
              ]} />
              <div className="border-t border-gray-100 mt-2 pt-2 flex justify-between font-semibold">
                <span>Total</span>
                <span>{fmt.format(activeSnapshot.totalTax)}</span>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Asset Breakdown</p>
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 gap-y-1 text-sm min-w-0">
                <span className="text-xs text-gray-400">Account</span>
                <span className="text-xs text-gray-400 text-right">Start</span>
                <span className="text-xs text-gray-400 text-right">Flow</span>
                <span className="text-xs text-gray-400 text-right">Growth</span>
                <span className="text-xs text-gray-400 text-right">End</span>
                {activeSnapshot.assetBreakdown.map((a) => {
                  const appreciation = a.balance - a.startBalance - a.netFlow
                  return (
                    <>
                      <span key={a.label + '-label'} className="text-gray-500 truncate">{a.label}</span>
                      <span key={a.label + '-start'} className="font-medium tabular-nums text-right text-gray-500">{fmt.format(a.startBalance)}</span>
                      <span
                        key={a.label + '-flow'}
                        className={`font-medium tabular-nums text-right ${a.netFlow > 0 ? 'text-green-600' : a.netFlow < 0 ? 'text-red-600' : 'text-gray-300'}`}
                      >
                        {a.netFlow === 0 ? '—' : (a.netFlow > 0 ? '+' : '') + fmt.format(a.netFlow)}
                      </span>
                      <span
                        key={a.label + '-growth'}
                        className={`font-medium tabular-nums text-right ${appreciation > 0 ? 'text-green-600' : appreciation < 0 ? 'text-red-600' : 'text-gray-300'}`}
                      >
                        {Math.round(appreciation) === 0 ? '—' : (appreciation > 0 ? '+' : '') + fmt.format(appreciation)}
                      </span>
                      <span key={a.label + '-end'} className="font-medium tabular-nums text-right">{fmt.format(a.balance)}</span>
                    </>
                  )
                })}
              </div>
              <div className="border-t border-gray-100 mt-2 pt-2 flex justify-between font-semibold">
                <span>Total</span>
                <span>{fmt.format(activeSnapshot.totalAssets)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

function BreakdownRows({ rows }: { rows: { label: string; value: number }[] }) {
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-6">
          <span className="text-gray-500">{r.label}</span>
          <span className="font-medium tabular-nums">{fmt.format(r.value)}</span>
        </div>
      ))}
    </div>
  )
}
