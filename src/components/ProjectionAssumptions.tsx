import type { AppConfig, AssetRates, MarketCrash } from '../types'
import { ASSET_TYPE_LABELS } from '../types'
import PercentField from './PercentField'
import { useLocalStorage } from '../hooks/useLocalStorage'

function uid() {
  return crypto.randomUUID()
}

const PRESETS: Omit<MarketCrash, 'id'>[] = [
  { label: 'Mild correction', startAge: 65, declinePercent: 0.20, durationYears: 1, recoveryYears: 2 },
  { label: 'Moderate bear', startAge: 65, declinePercent: 0.40, durationYears: 2, recoveryYears: 4 },
  { label: 'Severe crash',  startAge: 65, declinePercent: 0.55, durationYears: 3, recoveryYears: 7 },
]

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

  function addCrash(preset: Omit<MarketCrash, 'id'>) {
    update({ marketCrashes: [...config.marketCrashes, { id: uid(), ...preset }] })
  }
  function updateCrash(id: string, partial: Partial<MarketCrash>) {
    update({ marketCrashes: config.marketCrashes.map((c) => c.id === id ? { ...c, ...partial } : c) })
  }
  function removeCrash(id: string) {
    update({ marketCrashes: config.marketCrashes.filter((c) => c.id !== id) })
  }

  const ASSET_SHORT_LABELS: Record<keyof AssetRates, string> = {
    cash: 'Cash',
    moneyMarketSavings: 'MM/Savings',
    taxableBrokerage: 'Brokerage',
    retirementTraditional: 'Trad. IRA',
    retirementRoth: 'Roth IRA',
    educationSavings529: '529',
  }

  const summaryParts: string[] = []
  // Basic Settings
  summaryParts.push(config.simulationMode === 'real' ? 'Real $' : 'Nominal $')
  summaryParts.push(`${config.simulationYears} yrs`)
  summaryParts.push(
    config.rothConversionTargetBracket !== null
      ? `Roth → ${(config.rothConversionTargetBracket * 100).toFixed(0)}% bracket`
      : 'Roth: off'
  )
  // Market Scenarios
  summaryParts.push(`${config.marketCrashes.length} crash scenario${config.marketCrashes.length !== 1 ? 's' : ''}`)
  // Rates
  summaryParts.push(`Inflation ${fmtPct(config.inflationRate)}`)
  summaryParts.push(`Healthcare ${fmtPct(config.healthcareInflationRate)}`)
  summaryParts.push(`SS COLA ${fmtPct(config.ssCola)}`)
  summaryParts.push(...(Object.keys(config.assetRates) as (keyof AssetRates)[]).map(
    (k) => `${ASSET_SHORT_LABELS[k]} ${fmtPct(config.assetRates[k])}`
  ))
  const summary = summaryParts.join(' · ')

  return (
    <div className="border border-gray-200 rounded-lg">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 rounded-lg transition-colors text-left"
      >
        <span className={`text-gray-400 transition-transform duration-200 text-xs mt-0.5 shrink-0 ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="text-sm font-semibold text-gray-700 shrink-0">Configuration</span>
        {!open && (
          <span className="text-xs text-gray-400">{summary}</span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-6 border-t border-gray-100">
          {/* Basic Settings */}
          <div className="pt-4">
            <h3 className="text-sm font-semibold text-gray-600 mb-3">Basic Settings</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Dollar Mode</label>
                <select
                  className="input w-full"
                  value={config.simulationMode}
                  onChange={(e) => update({ simulationMode: e.target.value as 'nominal' | 'real' })}
                >
                  <option value="nominal">Nominal (inflated)</option>
                  <option value="real">Real (today's dollars)</option>
                </select>
              </div>
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
              <div>
                <label className="block text-xs text-gray-500 mb-1">Optimize Roth Conversions</label>
                <select
                  className="input w-full"
                  value={config.rothConversionTargetBracket ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    update({ rothConversionTargetBracket: v === '' ? null : (parseFloat(v) as 0.12 | 0.22 | 0.24) })
                  }}
                >
                  <option value="">Off</option>
                  <option value="0.12">Fill to 12% bracket</option>
                  <option value="0.22">Fill to 22% bracket</option>
                  <option value="0.24">Fill to 24% bracket</option>
                </select>
              </div>
            </div>
          </div>

          {/* Market Scenarios */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-600">Market Scenarios</h3>
                <p className="text-xs text-gray-400 mt-0.5">Simulate crashes affecting equity accounts (brokerage, retirement, 529). Cash and money market are unaffected.</p>
              </div>
            </div>
            <div className="flex gap-2 mb-3">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => addCrash(preset)}
                  className="text-xs px-2.5 py-1 border border-gray-300 rounded hover:border-orange-400 hover:text-orange-700 transition-colors"
                >
                  + {preset.label}
                </button>
              ))}
            </div>

            {config.marketCrashes.length > 0 && (
              <>
                <div className="grid grid-cols-12 gap-2 px-1 mb-1">
                  <span className="col-span-3 text-xs text-gray-400">Label</span>
                  <span className="col-span-2 text-xs text-gray-400">Start Age</span>
                  <span className="col-span-2 text-xs text-gray-400">Decline %</span>
                  <span className="col-span-2 text-xs text-gray-400">Duration</span>
                  <span className="col-span-2 text-xs text-gray-400">Recovery</span>
                  <span className="col-span-1" />
                </div>
                <div className="space-y-2">
                  {config.marketCrashes.map((crash) => (
                    <div key={crash.id} className="grid grid-cols-12 gap-2 items-center bg-orange-50 rounded p-2">
                      <input
                        className="col-span-3 input text-sm"
                        placeholder="e.g. 2008 crash"
                        value={crash.label}
                        onChange={(e) => updateCrash(crash.id, { label: e.target.value })}
                      />
                      <input
                        type="number"
                        className="col-span-2 input"
                        min={0}
                        value={crash.startAge}
                        onChange={(e) => updateCrash(crash.id, { startAge: parseInt(e.target.value) || 0 })}
                      />
                      <div className="col-span-2">
                        <PercentField
                          label=""
                          value={crash.declinePercent}
                          onChange={(v) => updateCrash(crash.id, { declinePercent: v })}
                        />
                      </div>
                      <div className="col-span-2 flex items-center gap-1">
                        <input
                          type="number"
                          className="input w-full"
                          min={1}
                          step={1}
                          value={crash.durationYears}
                          onChange={(e) => updateCrash(crash.id, { durationYears: Math.max(1, parseInt(e.target.value) || 1) })}
                        />
                        <span className="text-xs text-gray-400 shrink-0">yr</span>
                      </div>
                      <div className="col-span-2 flex items-center gap-1">
                        <input
                          type="number"
                          className="input w-full"
                          min={1}
                          step={1}
                          value={crash.recoveryYears}
                          onChange={(e) => updateCrash(crash.id, { recoveryYears: Math.max(1, parseInt(e.target.value) || 1) })}
                        />
                        <span className="text-xs text-gray-400 shrink-0">yr</span>
                      </div>
                      <button
                        onClick={() => removeCrash(crash.id)}
                        className="col-span-1 text-red-400 hover:text-red-600 text-lg leading-none text-center"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Rates */}
          <div>
            <h3 className="text-sm font-semibold text-gray-600 mb-1">Rates</h3>
            <p className="text-xs text-gray-400 mb-3">Annual rates assumed for inflation, Social Security, and appreciation for each account type.</p>
            <div className="space-y-3">
              {/* Row 1: General inflation rates */}
              <div className="grid grid-cols-3 gap-4">
                <PercentField
                  label="Inflation Rate"
                  value={config.inflationRate}
                  onChange={(v) => update({ inflationRate: v })}
                />
                <PercentField
                  label="Healthcare Inflation"
                  value={config.healthcareInflationRate}
                  onChange={(v) => update({ healthcareInflationRate: v })}
                />
                <PercentField
                  label="Social Security COLA"
                  value={config.ssCola}
                  onChange={(v) => update({ ssCola: v })}
                />
              </div>
              {/* Row 2: Cash-like returns */}
              <div className="grid grid-cols-3 gap-4">
                <PercentField
                  label={ASSET_TYPE_LABELS.cash}
                  value={config.assetRates.cash}
                  onChange={(v) => updateRates({ cash: v })}
                />
                <PercentField
                  label={ASSET_TYPE_LABELS.moneyMarketSavings}
                  value={config.assetRates.moneyMarketSavings}
                  onChange={(v) => updateRates({ moneyMarketSavings: v })}
                />
              </div>
              {/* Row 3: Equity returns */}
              <div className="grid grid-cols-4 gap-4">
                {(['taxableBrokerage', 'retirementTraditional', 'retirementRoth', 'educationSavings529'] as const).map((type) => (
                  <div key={type}>
                    <PercentField
                      label={ASSET_TYPE_LABELS[type]}
                      value={config.assetRates[type]}
                      onChange={(v) => updateRates({ [type]: v })}
                    />
                    {type === 'taxableBrokerage' && (
                      <button
                        onClick={() => {
                          const rate = config.assetRates.taxableBrokerage
                          updateRates({ retirementTraditional: rate, retirementRoth: rate, educationSavings529: rate })
                        }}
                        className="text-[10px] text-indigo-500 hover:text-indigo-700 mt-0.5 cursor-pointer"
                      >
                        Sync to all equity
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
