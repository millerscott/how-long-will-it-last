import { useState } from 'react'
import type { SimulationStore, AppConfig } from '../types'

interface Props {
  store: SimulationStore
  onLoad: (id: string) => void
  onCreate: (name: string, fromConfig?: AppConfig) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onDuplicate: (id: string) => void
  onMove: (id: string, direction: 'up' | 'down') => void
  onImportHousehold: (fromId: string) => void
}

export default function SimulationSwitcher({ store, onLoad, onCreate, onDelete, onRename, onDuplicate, onMove, onImportHousehold }: Props) {
  const [isCreating, setIsCreating] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [importSourceId, setImportSourceId] = useState<string | null>(null)
  const [confirmImport, setConfirmImport] = useState(false)

  const active = store.simulations.find((s) => s.id === store.activeId) ?? store.simulations[0]
  const activeIndex = store.simulations.findIndex((s) => s.id === store.activeId)

  const handleCreate = () => {
    const name = inputValue.trim()
    if (!name) return
    onCreate(name)
    setInputValue('')
    setIsCreating(false)
  }

  const handleRename = () => {
    const name = inputValue.trim()
    if (!name) return
    onRename(active.id, name)
    setInputValue('')
    setIsRenaming(false)
  }

  const handleDelete = () => {
    onDelete(active.id)
    setConfirmDelete(false)
  }

  const btnClass = 'px-2.5 py-1.5 text-xs font-medium rounded border transition-colors'

  return (
    <div className="flex items-center gap-3 px-6 py-3 bg-gray-50 border-b border-gray-200">
      {isCreating ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            className="input text-sm py-1.5 px-2.5 w-56"
            placeholder="Simulation name"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
              if (e.key === 'Escape') { setIsCreating(false); setInputValue('') }
            }}
          />
          <button onClick={handleCreate} className={`${btnClass} bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700`}>
            Create
          </button>
          <button onClick={() => { setIsCreating(false); setInputValue('') }} className={`${btnClass} bg-white text-gray-600 border-gray-300 hover:bg-gray-50`}>
            Cancel
          </button>
        </div>
      ) : isRenaming ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            className="input text-sm py-1.5 px-2.5 w-56"
            placeholder="New name"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') { setIsRenaming(false); setInputValue('') }
            }}
          />
          <button onClick={handleRename} className={`${btnClass} bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700`}>
            Save
          </button>
          <button onClick={() => { setIsRenaming(false); setInputValue('') }} className={`${btnClass} bg-white text-gray-600 border-gray-300 hover:bg-gray-50`}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Simulation</label>
          <select
            className="input text-sm py-1.5 px-2.5 min-w-[200px]"
            value={store.activeId}
            onChange={(e) => onLoad(e.target.value)}
          >
            {store.simulations.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <div className="flex flex-col gap-0.5">
            <button
              onClick={() => onMove(active.id, 'up')}
              disabled={activeIndex <= 0}
              className="px-1.5 py-0.5 text-xs leading-none rounded border bg-white text-gray-600 border-gray-300 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move up"
            >▲</button>
            <button
              onClick={() => onMove(active.id, 'down')}
              disabled={activeIndex >= store.simulations.length - 1}
              className="px-1.5 py-0.5 text-xs leading-none rounded border bg-white text-gray-600 border-gray-300 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move down"
            >▼</button>
          </div>

          <button
            onClick={() => { setIsCreating(true); setInputValue('') }}
            className={`${btnClass} bg-white text-gray-700 border-gray-300 hover:bg-gray-50`}
          >
            New
          </button>
          <button
            onClick={() => onDuplicate(active.id)}
            className={`${btnClass} bg-white text-gray-700 border-gray-300 hover:bg-gray-50`}
          >
            Duplicate
          </button>
          <button
            onClick={() => { setIsRenaming(true); setInputValue(active.name) }}
            className={`${btnClass} bg-white text-gray-700 border-gray-300 hover:bg-gray-50`}
          >
            Rename
          </button>

          {confirmDelete ? (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="text-red-600">Delete "{active.name}"?</span>
              <button onClick={handleDelete} className={`${btnClass} bg-red-600 text-white border-red-600 hover:bg-red-700`}>
                Yes
              </button>
              <button onClick={() => setConfirmDelete(false)} className={`${btnClass} bg-white text-gray-600 border-gray-300 hover:bg-gray-50`}>
                No
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={store.simulations.length <= 1}
              className={`${btnClass} bg-white text-red-600 border-gray-300 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              Delete
            </button>
          )}

          {/* Import household from another simulation */}
          {store.simulations.length > 1 && (
            confirmImport ? (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="text-amber-700">Replace household with "{store.simulations.find(s => s.id === importSourceId)?.name}"?</span>
                <button
                  onClick={() => { onImportHousehold(importSourceId!); setConfirmImport(false); setImportSourceId(null) }}
                  className={`${btnClass} bg-amber-600 text-white border-amber-600 hover:bg-amber-700`}
                >
                  Yes, import
                </button>
                <button onClick={() => { setConfirmImport(false); setImportSourceId(null) }} className={`${btnClass} bg-white text-gray-600 border-gray-300 hover:bg-gray-50`}>
                  Cancel
                </button>
              </span>
            ) : importSourceId ? (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="text-gray-500">Import household from</span>
                <select
                  className="input text-xs py-1 px-2"
                  value={importSourceId}
                  onChange={(e) => setImportSourceId(e.target.value)}
                >
                  {store.simulations.filter(s => s.id !== store.activeId).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <button onClick={() => setConfirmImport(true)} className={`${btnClass} bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700`}>
                  Import
                </button>
                <button onClick={() => setImportSourceId(null)} className={`${btnClass} bg-white text-gray-600 border-gray-300 hover:bg-gray-50`}>
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setImportSourceId(store.simulations.find(s => s.id !== store.activeId)!.id)}
                className={`${btnClass} bg-white text-gray-700 border-gray-300 hover:bg-gray-50`}
              >
                Import Household…
              </button>
            )
          )}
        </>
      )}
    </div>
  )
}
