import { useState } from 'react'

interface PercentFieldProps {
  label: string
  value: number
  placeholder?: string
  className?: string
  onChange: (v: number) => void
}

export default function PercentField({ label, value, placeholder, className = '', onChange }: PercentFieldProps) {
  const [editing, setEditing] = useState<string | null>(null)

  const displayValue = editing !== null ? editing : (value !== 0 ? (value * 100).toFixed(1) : '')

  function handleFocus() {
    setEditing(value !== 0 ? (value * 100).toFixed(1) : '')
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setEditing(e.target.value)
  }

  function handleBlur() {
    const parsed = parseFloat(editing ?? '')
    onChange(isNaN(parsed) ? 0 : parsed / 100)
    setEditing(null)
  }

  return (
    <div className={className}>
      {label && <label className="block text-xs text-gray-500 mb-1">{label}</label>}
      <div className="relative">
        <input
          type="number"
          className="input w-full pr-6"
          value={displayValue}
          step="0.1"
          placeholder={placeholder ?? '0.0'}
          onFocus={handleFocus}
          onChange={handleChange}
          onBlur={handleBlur}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
      </div>
    </div>
  )
}
