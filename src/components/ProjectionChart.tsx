import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts'
import type { YearlySnapshot } from '../lib/projection'
import { ASSET_TYPE_LABELS } from '../types'
import { findDepletionAge } from '../lib/projection'

interface Props {
  snapshots: YearlySnapshot[]
}

// Consistent color per asset type label
const LABEL_COLORS: Record<string, string> = {
  [ASSET_TYPE_LABELS.cash]:                  '#94a3b8', // slate-400
  [ASSET_TYPE_LABELS.moneyMarketSavings]:    '#38bdf8', // sky-400
  [ASSET_TYPE_LABELS.taxableBrokerage]:      '#34d399', // emerald-400
  [ASSET_TYPE_LABELS.retirementTraditional]: '#fb923c', // orange-400
  [ASSET_TYPE_LABELS.retirementRoth]:        '#a78bfa', // violet-400
  [ASSET_TYPE_LABELS.educationSavings529]:   '#f9a8d4', // pink-300
}
const FALLBACK_COLORS = ['#60a5fa', '#f472b6', '#facc15', '#4ade80']

function fmtAxis(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return `$${v}`
}

const fmtFull = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

interface TooltipEntry {
  dataKey: string | number
  name: string
  value: number
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipEntry[]
  label?: number
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s, p) => s + p.value, 0)
  // Reverse so stacking order in tooltip matches visual (top item first)
  const rows = [...payload].reverse()
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-xl p-3 text-sm min-w-44">
      <p className="font-semibold text-gray-700 mb-2">Age {label}</p>
      <div className="space-y-1">
        {rows.map((p) => (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-gray-500">
              <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-medium tabular-nums">{fmtFull.format(p.value)}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-gray-100 mt-2 pt-2 flex justify-between font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{fmtFull.format(total)}</span>
      </div>
    </div>
  )
}

export default function ProjectionChart({ snapshots }: Props) {
  if (snapshots.length === 0) {
    return null
  }

  // Collect unique asset labels preserving order from first snapshot
  const allLabels = [...new Set(snapshots[0]?.assetBreakdown.map((a) => a.label) ?? [])]

  // Build chart data — group by label (sum if multiple accounts share a label)
  const chartData = snapshots.map((s) => {
    const point: Record<string, number> = { age: s.age, year: s.year }
    const grouped: Record<string, number> = {}
    for (const { label, balance } of s.assetBreakdown) {
      grouped[label] = (grouped[label] ?? 0) + Math.max(0, balance)
    }
    for (const label of allLabels) {
      point[label] = grouped[label] ?? 0
    }
    return point
  })

  const depletionAge = findDepletionAge(snapshots)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Asset Projection</h2>
        {depletionAge !== null && (
          <span className="text-sm text-red-600 font-medium">
            Assets depleted at age {depletionAge}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 16, bottom: 0 }}>
          <defs>
            {allLabels.map((label, i) => {
              const color = LABEL_COLORS[label] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
              return (
                <linearGradient key={label} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.85} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.4} />
                </linearGradient>
              )
            })}
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />

          <XAxis
            dataKey="age"
            tick={{ fontSize: 12, fill: '#6b7280' }}
            label={{ value: 'Age', position: 'insideBottomRight', offset: -4, fontSize: 12, fill: '#9ca3af' }}
          />

          <YAxis
            tickFormatter={fmtAxis}
            tick={{ fontSize: 12, fill: '#6b7280' }}
            width={64}
          />

          <Tooltip content={<CustomTooltip />} />

          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
            formatter={(value) => <span className="text-gray-600">{value}</span>}
          />

          {allLabels.map((label, i) => {
            const color = LABEL_COLORS[label] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
            return (
              <Area
                key={label}
                type="monotone"
                dataKey={label}
                name={label}
                stackId="assets"
                stroke={color}
                fill={`url(#grad-${i})`}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            )
          })}

          {depletionAge !== null && (
            <ReferenceLine
              x={depletionAge}
              stroke="#ef4444"
              strokeDasharray="4 3"
              strokeWidth={2}
              label={{ value: 'Depleted', position: 'insideTopRight', fontSize: 11, fill: '#ef4444' }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
