import { useLocalStorage } from './hooks/useLocalStorage'
import { DEFAULT_CONFIG, type AppConfig } from './types'
import { projectFinances, findDepletionAge } from './lib/projection'
import HouseholdPanel from './components/HouseholdPanel'
import ProjectionChart from './components/ProjectionChart'
import ProjectionTable from './components/ProjectionTable'
import ProjectionAssumptions from './components/ProjectionAssumptions'

type Tab = 'household' | 'projection'

function StatBox({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'bad' }) {
  const valueClass =
    tone === 'good' ? 'text-green-600' :
    tone === 'bad'  ? 'text-red-600' :
    'text-gray-900'
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 shadow-sm">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold leading-tight ${valueClass}`}>{value}</p>
    </div>
  )
}

const TAB_LABELS: Record<Tab, string> = {
  household: 'Household Setup',
  projection: 'Projection',
}

export default function App() {
  const [rawConfig, setConfig] = useLocalStorage<AppConfig>('hlwil-config', DEFAULT_CONFIG)
  // Merge with defaults so any fields added after initial save are always present.
  // Deep-merge nested objects; ensure the cash account always exists.
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
  const config: AppConfig = merged
  const [tab, setTab] = useLocalStorage<Tab>('hlwil-tab', 'household')

  const snapshots = projectFinances(config)
  const depletionAge = findDepletionAge(snapshots)

  const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  const startAssets = config.householdAssets.reduce((s, a) => s + a.balanceAtSimulationStart, 0)
  const assets20 = snapshots[20]?.totalAssets ?? null
  const assets40 = snapshots[40]?.totalAssets ?? null
  const depletionSnapshot = depletionAge !== null ? snapshots.find((s) => s.age === depletionAge) : null

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-indigo-700 text-white px-6 py-4 shadow">
        <h1 className="text-2xl font-bold tracking-tight">How Long Will It Last?</h1>
        <p className="text-indigo-200 text-sm mt-0.5">Personal financial runway analysis</p>
      </header>

      {/* Summary stat boxes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-6 py-4">
        <StatBox label="Starting Assets" value={fmt.format(startAssets)} />
        <StatBox
          label="Assets in 20 Years"
          value={assets20 !== null ? fmt.format(assets20) : '—'}
          tone={assets20 !== null && assets20 <= 0 ? 'bad' : 'neutral'}
        />
        <StatBox
          label="Assets in 40 Years"
          value={assets40 !== null ? fmt.format(assets40) : '—'}
          tone={assets40 !== null && assets40 <= 0 ? 'bad' : 'neutral'}
        />
        <StatBox
          label="How Long Will It Last?"
          value={depletionSnapshot ? `Age ${depletionAge} (${depletionSnapshot.year})` : 'Outlasts simulation'}
          tone={depletionAge !== null ? 'bad' : 'good'}
        />
      </div>

      {/* Tabs */}
      <nav className="flex gap-1 px-6 pt-4">
        {(['household', 'projection'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-t text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-white border border-b-white border-gray-200 text-indigo-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>

      <main className="bg-white border border-gray-200 rounded-b mx-6 mb-6 p-6">
        {tab === 'household' && <HouseholdPanel config={config} onChange={setConfig} />}
        {tab === 'projection' && (
          <div className="space-y-4">
            <ProjectionChart snapshots={snapshots} />
            <ProjectionAssumptions config={config} onChange={setConfig} />
            <div className="border-t border-gray-100 pt-4">
              <h2 className="text-lg font-semibold mb-3">Year-by-Year Detail</h2>
              <ProjectionTable snapshots={snapshots} />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
