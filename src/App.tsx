import { useState } from 'react'
import { useLocalStorage } from './hooks/useLocalStorage'
import { DEFAULT_CONFIG, type AppConfig } from './types'
import { projectFinances, findDepletionAge } from './lib/projection'
import ConfigPanel from './components/ConfigPanel'
import ProjectionTable from './components/ProjectionTable'

type Tab = 'config' | 'projection'

export default function App() {
  const [config, setConfig] = useLocalStorage<AppConfig>('hlwil-config', DEFAULT_CONFIG)
  const [tab, setTab] = useState<Tab>('config')

  const snapshots = projectFinances(config)
  const depletionAge = findDepletionAge(snapshots)

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-indigo-700 text-white px-6 py-4 shadow">
        <h1 className="text-2xl font-bold tracking-tight">How Long Will It Last?</h1>
        <p className="text-indigo-200 text-sm mt-0.5">Personal financial runway analysis</p>
      </header>

      {/* Depletion banner */}
      {depletionAge !== null ? (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-800 px-6 py-3 text-sm font-medium">
          Based on current inputs, funds are projected to run out at age{' '}
          <span className="font-bold">{depletionAge}</span>.
        </div>
      ) : (
        <div className="bg-green-100 border-l-4 border-green-500 text-green-800 px-6 py-3 text-sm font-medium">
          Based on current inputs, funds last through age{' '}
          <span className="font-bold">{config.lifeExpectancy}</span>.
        </div>
      )}

      {/* Tabs */}
      <nav className="flex gap-1 px-6 pt-4">
        {(['config', 'projection'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-t text-sm font-medium capitalize transition-colors ${
              tab === t
                ? 'bg-white border border-b-white border-gray-200 text-indigo-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <main className="bg-white border border-gray-200 rounded-b mx-6 mb-6 p-6">
        {tab === 'config' ? (
          <ConfigPanel config={config} onChange={setConfig} />
        ) : (
          <ProjectionTable snapshots={snapshots} />
        )}
      </main>
    </div>
  )
}
