import type { AppConfig, AssetRates } from '../types'
import { ASSET_TYPE_LABELS } from '../types'
import PercentField from './PercentField'
import { useLocalStorage } from '../hooks/useLocalStorage'

interface Props {
  config: AppConfig
  onChange: (config: AppConfig) => void
}

function fmtPct(v: number) {
  return `${(v * 100).toFixed(1)}%`
}

export default function ProjectionAssumptions({ config, onChange }: Props) {
  const [open, setOpen] = useLocalStorage('hlwil-section-assumptions', false)

  function update(partial: Partial<AppConfig>) {
    onChange({ ...config, ...partial })
  }

  function updateRates(partial: Partial<AssetRates>) {
    update({ assetRates: { ...config.assetRates, ...partial } })
  }

  const nonCashRates = (Object.keys(config.assetRates) as (keyof AssetRates)[]).filter(
    (k) => k !== 'cash' && config.assetRates[k] !== 0
  )

  const summary = [
    `Inflation ${fmtPct(config.inflationRate)}`,
    `${config.simulationYears} yr simulation`,
    ...nonCashRates.map((k) => `${ASSET_TYPE_LABELS[k]} ${fmtPct(config.assetRates[k])}`),
  ].join(' · ')

  return (
    <div className="border border-gray-200 rounded-lg">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 rounded-lg transition-colors text-left"
      >
        <span className={`text-gray-400 transition-transform duration-200 text-xs ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="text-sm font-semibold text-gray-700 shrink-0">Assumptions</span>
        {!open && (
          <span className="text-xs text-gray-400 truncate">{summary}</span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-6 border-t border-gray-100">
          {/* Basic Settings */}
          <div className="pt-4">
            <h3 className="text-sm font-semibold text-gray-600 mb-3">Basic Settings</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <PercentField
                label="Inflation Rate"
                value={config.inflationRate}
                onChange={(v) => update({ inflationRate: v })}
              />
              <div>
                <label className="block text-xs text-gray-500 mb-1">Max Years to Run Simulation</label>
                <input
                  type="number"
                  className="input w-full"
                  min={1}
                  max={150}
                  value={config.simulationYears}
                  onChange={(e) => update({ simulationYears: parseInt(e.target.value) || 1 })}
                />
              </div>
            </div>
          </div>

          {/* Asset Appreciation Rates */}
          <div>
            <h3 className="text-sm font-semibold text-gray-600 mb-1">Asset Appreciation Rates</h3>
            <p className="text-xs text-gray-400 mb-3">Annual appreciation rate assumed for each account type.</p>
            <div className="space-y-2">
              {(Object.keys(config.assetRates) as (keyof AssetRates)[]).map((type) => (
                <div key={type} className="flex items-center gap-4">
                  <span className="text-sm text-gray-700 w-64 shrink-0">{ASSET_TYPE_LABELS[type]}</span>
                  <PercentField
                    label=""
                    value={config.assetRates[type]}
                    className="w-32"
                    onChange={(v) => updateRates({ [type]: v })}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
