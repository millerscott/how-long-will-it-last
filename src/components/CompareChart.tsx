import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import type { SavedSimulation, AppConfig } from '../types'
import { projectFinances } from '../lib/projection'

interface Props {
  simulations: SavedSimulation[]
  mergeWithDefaults: (raw: AppConfig) => AppConfig
}

const COLORS = [
  '#6366f1', // indigo-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#f97316', // orange-500
  '#3b82f6', // blue-500
  '#84cc16', // lime-500
]

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

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: number }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded shadow-lg px-3 py-2 text-sm">
      <p className="font-medium mb-1">Age {label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex justify-between gap-4">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span className="font-mono">{fmtFull.format(entry.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function CompareChart({ simulations, mergeWithDefaults }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(simulations.map((s) => s.id)))

  // Keep selected set in sync when simulations change
  const validSelected = useMemo(() => {
    const validIds = new Set(simulations.map((s) => s.id))
    const filtered = new Set([...selected].filter((id) => validIds.has(id)))
    // If nothing selected, select all
    return filtered.size > 0 ? filtered : validIds
  }, [simulations, selected])

  const chartData = useMemo(() => {
    const results: { name: string; snapshots: { age: number; totalAssets: number }[] }[] = []

    for (const sim of simulations) {
      if (!validSelected.has(sim.id)) continue
      const config = mergeWithDefaults(sim.config)
      const snaps = projectFinances(config)
      results.push({
        name: sim.name,
        snapshots: snaps.map((s) => ({ age: s.age, totalAssets: s.totalAssets })),
      })
    }

    // Build chart data: one entry per age, with a key per simulation name
    const ageMap = new Map<number, Record<string, number>>()
    for (const r of results) {
      for (const s of r.snapshots) {
        const point = ageMap.get(s.age) ?? { age: s.age }
        point[r.name] = s.totalAssets
        ageMap.set(s.age, point)
      }
    }
    return [...ageMap.values()].sort((a, b) => a.age - b.age)
  }, [simulations, validSelected, mergeWithDefaults])

  const selectedSims = simulations.filter((s) => validSelected.has(s.id))

  const toggleSim = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  if (simulations.length < 2) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg font-medium mb-2">Create at least two simulations to compare</p>
        <p className="text-sm">Use the simulation switcher above to create additional simulations.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {simulations.map((sim, i) => (
          <label key={sim.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={validSelected.has(sim.id)}
              onChange={() => toggleSim(sim.id)}
              className="rounded"
            />
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span>{sim.name}</span>
          </label>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, left: 16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="age"
            label={{ value: 'Age', position: 'insideBottom', offset: -2, fontSize: 12 }}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            tickFormatter={fmtAxis}
            width={64}
            tick={{ fontSize: 11 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend fontSize={12} wrapperStyle={{ paddingTop: 12 }} />
          {selectedSims.map((sim, _i) => {
            const globalIndex = simulations.findIndex((s) => s.id === sim.id)
            return (
              <Line
                key={sim.id}
                type="monotone"
                dataKey={sim.name}
                stroke={COLORS[globalIndex % COLORS.length]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            )
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
