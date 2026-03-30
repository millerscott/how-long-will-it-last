interface PercentFieldProps {
  label: string
  value: number
  placeholder?: string
  className?: string
  onChange: (v: number) => void
}

export default function PercentField({ label, value, placeholder, className = '', onChange }: PercentFieldProps) {
  return (
    <div className={className}>
      {label && <label className="block text-xs text-gray-500 mb-1">{label}</label>}
      <div className="relative">
        <input
          type="number"
          className="input w-full pr-6"
          value={value !== 0 ? (value * 100).toFixed(1) : ''}
          step="0.1"
          placeholder={placeholder ?? '0.0'}
          onChange={(e) => onChange((parseFloat(e.target.value) || 0) / 100)}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
      </div>
    </div>
  )
}
