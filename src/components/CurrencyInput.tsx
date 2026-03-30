import { useState } from 'react'

interface CurrencyInputProps {
  value: number
  onChange: (v: number) => void
}

function formatWithCommas(n: number): string {
  if (!n) return ''
  return Math.round(n).toLocaleString('en-US')
}

export default function CurrencyInput({ value, onChange }: CurrencyInputProps) {
  const [focused, setFocused] = useState(false)
  const [raw, setRaw] = useState('')

  const displayValue = focused ? raw : formatWithCommas(value)

  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
      <input
        type="text"
        inputMode="numeric"
        className="input pl-4 w-full"
        placeholder="0"
        value={displayValue}
        onFocus={() => {
          setRaw(value ? String(Math.round(value)) : '')
          setFocused(true)
        }}
        onChange={(e) => {
          const stripped = e.target.value.replace(/[^0-9]/g, '')
          setRaw(stripped)
          onChange(stripped ? parseInt(stripped, 10) : 0)
        }}
        onBlur={() => setFocused(false)}
      />
    </div>
  )
}
