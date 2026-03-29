import type { YearlySnapshot } from '../lib/projection'

interface Props {
  snapshots: YearlySnapshot[]
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default function ProjectionTable({ snapshots }: Props) {
  if (snapshots.length === 0) {
    return <p className="text-gray-400 italic text-sm">No data to display. Configure your inputs first.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-gray-500 uppercase border-b">
          <tr>
            <th className="py-2 pr-4">Age</th>
            <th className="py-2 pr-4">Year</th>
            <th className="py-2 pr-4 text-right">Income</th>
            <th className="py-2 pr-4 text-right">Expenses</th>
            <th className="py-2 pr-4 text-right">Net Cash Flow</th>
            <th className="py-2 pr-4 text-right">Total Assets</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => (
            <tr
              key={s.age}
              className={`border-b last:border-0 ${s.depleted ? 'bg-red-50 text-red-700' : 'hover:bg-gray-50'}`}
            >
              <td className="py-2 pr-4 font-medium">{s.age}</td>
              <td className="py-2 pr-4 text-gray-500">{s.year}</td>
              <td className="py-2 pr-4 text-right">{fmt.format(s.income)}</td>
              <td className="py-2 pr-4 text-right">{fmt.format(s.expenses)}</td>
              <td className={`py-2 pr-4 text-right font-medium ${s.netCashFlow < 0 ? 'text-red-600' : 'text-green-700'}`}>
                {fmt.format(s.netCashFlow)}
              </td>
              <td className="py-2 pr-4 text-right font-semibold">{fmt.format(s.totalAssets)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
