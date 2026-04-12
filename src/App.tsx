import { useCallback, useMemo } from 'react'
import { useLocalStorage } from './hooks/useLocalStorage'
import { DEFAULT_CONFIG, type AppConfig, type SimulationStore, type SavedSimulation } from './types'
import { projectFinances, findDepletionAge } from './lib/projection'
import HouseholdPanel from './components/HouseholdPanel'
import ProjectionChart from './components/ProjectionChart'
import ProjectionTable from './components/ProjectionTable'
import ProjectionAssumptions from './components/ProjectionAssumptions'
import SimulationSwitcher from './components/SimulationSwitcher'
import CompareChart from './components/CompareChart'

type Tab = 'household' | 'projection' | 'compare'

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
  compare: 'Compare Simulations',
}

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

function createDefaultStore(): SimulationStore {
  const id = makeId()
  return {
    activeId: id,
    simulations: [{
      id,
      name: 'My Simulation',
      config: DEFAULT_CONFIG,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }],
  }
}

// Run migration eagerly at module load so localStorage side-effects don't
// occur inside a React state initializer (which strict mode double-invokes).
const STORE_KEY = 'hlwil-simulations'
const LEGACY_KEY = 'hlwil-config'

;(() => {
  if (localStorage.getItem(STORE_KEY)) return
  const legacyRaw = localStorage.getItem(LEGACY_KEY)
  if (!legacyRaw) return
  try {
    const legacyConfig = JSON.parse(legacyRaw) as AppConfig
    const id = makeId()
    const store: SimulationStore = {
      activeId: id,
      simulations: [{
        id,
        name: 'My Simulation',
        config: legacyConfig,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }],
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // Corrupted data — useLocalStorage will fall back to default
  }
})()

function uniqueName(desired: string, existing: string[], excludeId?: string): string {
  const taken = new Set(existing)
  if (excludeId === undefined && !taken.has(desired)) return desired
  let name = desired
  let i = 2
  while (taken.has(name)) {
    name = `${desired} (${i})`
    i++
  }
  return name
}

/** Apply DEFAULT_CONFIG deep-merge and migrations to a raw AppConfig */
function mergeWithDefaults(rawConfig: AppConfig): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    ...rawConfig,
    assetRates: { ...DEFAULT_CONFIG.assetRates, ...rawConfig.assetRates },
    householdAssets: (() => {
      const assets = rawConfig.householdAssets?.length
        ? rawConfig.householdAssets.some((a) => a.type === 'cash')
          ? rawConfig.householdAssets
          : [DEFAULT_CONFIG.householdAssets[0], ...rawConfig.householdAssets]
        : DEFAULT_CONFIG.householdAssets
      // Migrate flat annualContribution → contributions array
      return assets.map((a) => ({
        ...a,
        contributions: a.contributions ??
          ((a as any).annualContribution > 0
            ? [{ id: `${a.id}-0`, startAge: 0, endAge: undefined, annualAmount: (a as any).annualContribution }]
            : []),
      }))
    })(),
    // Ensure incomeType is set on all existing income sources (migration)
    incomeSources: (rawConfig.incomeSources ?? []).map((s) => ({ incomeType: 'wage' as const, ...s })),
    marketCrashes: rawConfig.marketCrashes ?? [],
    rothConversionTargetBracket: rawConfig.rothConversionTargetBracket ?? null,
    simulationMode: rawConfig.simulationMode ?? 'real',
    // Ensure expenseType and frequency are set on all existing expenses (migration)
    expenses: (rawConfig.expenses ?? []).map((e) => ({
      ...(!(e as any).expenseType ? { expenseType: 'regular' as const } : {}),
      ...(!(e as any).frequency && !(e as any).intervalYears ? { frequency: 'monthly' as const } : {}),
      ...e,
    })) as AppConfig['expenses'],
  }
}

export { mergeWithDefaults }

export default function App() {
  const [store, setStore] = useLocalStorage<SimulationStore>(STORE_KEY, createDefaultStore())
  const [tab, setTab] = useLocalStorage<Tab>('hlwil-tab', 'household')

  const activeSimulation = store.simulations.find((s) => s.id === store.activeId) ?? store.simulations[0]
  const config = useMemo(() => mergeWithDefaults(activeSimulation.config), [activeSimulation.config])

  const setConfig = useCallback((newConfig: AppConfig) => {
    setStore((prev) => ({
      ...prev,
      simulations: prev.simulations.map((s) =>
        s.id === prev.activeId
          ? { ...s, config: newConfig, updatedAt: Date.now() }
          : s
      ),
    }))
  }, [setStore])

  const createSimulation = useCallback((name: string, fromConfig?: AppConfig) => {
    const id = makeId()
    const now = Date.now()
    setStore((prev) => {
      const finalName = uniqueName(name, prev.simulations.map((s) => s.name))
      const sim: SavedSimulation = {
        id,
        name: finalName,
        config: fromConfig ?? DEFAULT_CONFIG,
        createdAt: now,
        updatedAt: now,
      }
      return { activeId: id, simulations: [...prev.simulations, sim] }
    })
  }, [setStore])

  const loadSimulation = useCallback((id: string) => {
    setStore((prev) => ({ ...prev, activeId: id }))
  }, [setStore])

  const deleteSimulation = useCallback((id: string) => {
    setStore((prev) => {
      if (prev.simulations.length <= 1) return prev
      const remaining = prev.simulations.filter((s) => s.id !== id)
      return {
        activeId: prev.activeId === id ? remaining[0].id : prev.activeId,
        simulations: remaining,
      }
    })
  }, [setStore])

  const renameSimulation = useCallback((id: string, name: string) => {
    setStore((prev) => {
      const otherNames = prev.simulations.filter((s) => s.id !== id).map((s) => s.name)
      const finalName = uniqueName(name, otherNames)
      return {
        ...prev,
        simulations: prev.simulations.map((s) =>
          s.id === id ? { ...s, name: finalName } : s
        ),
      }
    })
  }, [setStore])

  const moveSimulation = useCallback((id: string, direction: 'up' | 'down') => {
    setStore((prev) => {
      const idx = prev.simulations.findIndex((s) => s.id === id)
      if (idx === -1) return prev
      const next = direction === 'up' ? idx - 1 : idx + 1
      if (next < 0 || next >= prev.simulations.length) return prev
      const sims = [...prev.simulations]
      ;[sims[idx], sims[next]] = [sims[next], sims[idx]]
      return { ...prev, simulations: sims }
    })
  }, [setStore])

  const duplicateSimulation = useCallback((id: string) => {
    setStore((prev) => {
      const source = prev.simulations.find((s) => s.id === id)
      if (!source) return prev
      const newId = makeId()
      const now = Date.now()
      const finalName = uniqueName(`${source.name} (copy)`, prev.simulations.map((s) => s.name))
      const copy: SavedSimulation = {
        id: newId,
        name: finalName,
        config: structuredClone(source.config),
        createdAt: now,
        updatedAt: now,
      }
      return {
        activeId: newId,
        simulations: [...prev.simulations, copy],
      }
    })
  }, [setStore])

  const snapshots = useMemo(() => projectFinances(config), [config])
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

      <SimulationSwitcher
        store={store}
        onLoad={loadSimulation}
        onCreate={createSimulation}
        onDelete={deleteSimulation}
        onRename={renameSimulation}
        onDuplicate={duplicateSimulation}
        onMove={moveSimulation}
      />

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
        {(['household', 'projection', 'compare'] as Tab[]).map((t) => (
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
        {tab === 'compare' && (
          <CompareChart simulations={store.simulations} mergeWithDefaults={mergeWithDefaults} />
        )}
      </main>
    </div>
  )
}
