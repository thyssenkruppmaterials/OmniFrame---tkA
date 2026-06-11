// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// FurnitureLibraryPanel — the object catalog picker for the 3D editor.
// ---------------------------------------------------------------------------
// Click a kind to arm placement; the next click on the floor drops it. Grouped
// by category. Pure DOM overlay (not in the Canvas).
import { useMemo, useState } from 'react'
import { Blocks, Rows3, Search, Warehouse, X } from 'lucide-react'
import type { SceneObjectKind } from '../types'
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  OBJECT_CATALOG,
} from './object-catalog'
import { RACK_RUN_PRESETS, type RackSystemConfig } from './rack-system'

interface FurnitureLibraryPanelProps {
  placingKind: SceneObjectKind | null
  /** Key of the armed rack preset / 'system' when the dialog config is armed. */
  placingRackKey: string | null
  onPick: (kind: SceneObjectKind) => void
  onPickRack: (key: string, config: RackSystemConfig) => void
  onOpenRackSystem: () => void
  onClose: () => void
}

export function FurnitureLibraryPanel({
  placingKind,
  placingRackKey,
  onPick,
  onPickRack,
  onOpenRackSystem,
  onClose,
}: FurnitureLibraryPanelProps) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return OBJECT_CATALOG
    return OBJECT_CATALOG.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.kind.includes(q) ||
        e.description.toLowerCase().includes(q)
    )
  }, [query])

  return (
    <div className='bg-card/95 absolute top-16 left-4 z-10 flex max-h-[calc(100%-7rem)] w-60 flex-col rounded-lg border shadow-lg backdrop-blur-sm'>
      <div className='flex items-center justify-between border-b px-3 py-2'>
        <h3 className='text-sm font-semibold'>Add to layout</h3>
        <button
          type='button'
          onClick={onClose}
          aria-label='Close library'
          className='text-muted-foreground hover:text-foreground rounded p-0.5'
        >
          <X className='h-4 w-4' />
        </button>
      </div>

      <div className='relative px-2 pt-2'>
        <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-4 mt-1 h-3.5 w-3.5 -translate-y-1/2' />
        <input
          type='search'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search objects…'
          aria-label='Search objects'
          className='bg-muted/50 focus:ring-ring w-full rounded-md border py-1.5 pr-2 pl-7 text-xs focus:ring-1 focus:outline-none'
        />
      </div>

      {(placingKind || placingRackKey) && (
        <div className='bg-primary/10 text-primary border-primary/20 m-2 mb-0 rounded-md border px-2 py-1.5 text-[11px]'>
          {placingRackKey
            ? 'Click the floor to place the racking. '
            : 'Click the floor to place · drag to paint. '}
          <strong>R</strong> rotate &middot; <strong>Esc</strong> cancel.
        </div>
      )}

      <div className='flex-1 overflow-y-auto p-2'>
        {/* Racking — racks are first-class map entities (bins map to their
            cells), so they get their own section above the scene objects. */}
        <div className='mb-3'>
          <div className='text-muted-foreground mb-1 px-1 text-[10px] font-semibold tracking-wide uppercase'>
            Racking
          </div>
          <div className='grid grid-cols-2 gap-1.5'>
            {RACK_RUN_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type='button'
                onClick={() => onPickRack(preset.key, preset.config)}
                aria-pressed={placingRackKey === preset.key}
                title={preset.description}
                className={`flex flex-col items-center gap-1 rounded-md border p-2 text-[11px] transition-colors ${
                  placingRackKey === preset.key
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'hover:bg-muted text-foreground border-transparent'
                }`}
              >
                {preset.config.rack_type === 'pallet' ? (
                  <Warehouse className='h-5 w-5' />
                ) : (
                  <Rows3 className='h-5 w-5' />
                )}
                <span className='leading-tight'>{preset.label}</span>
              </button>
            ))}
          </div>
          <button
            type='button'
            onClick={onOpenRackSystem}
            aria-pressed={placingRackKey === 'system'}
            className={`mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[11px] font-medium transition-colors ${
              placingRackKey === 'system'
                ? 'border-primary bg-primary/10 text-primary'
                : 'hover:bg-muted text-foreground'
            }`}
          >
            <Blocks className='h-4 w-4' />
            Build rack system…
          </button>
        </div>

        {CATEGORY_ORDER.map((cat) => {
          const items = visible.filter((e) => e.category === cat)
          if (items.length === 0) return null
          return (
            <div key={cat} className='mb-3'>
              <div className='text-muted-foreground mb-1 px-1 text-[10px] font-semibold tracking-wide uppercase'>
                {CATEGORY_LABEL[cat]}
              </div>
              <div className='grid grid-cols-2 gap-1.5'>
                {items.map(({ kind, label, icon: Icon }) => (
                  <button
                    key={kind}
                    type='button'
                    onClick={() => onPick(kind)}
                    aria-pressed={placingKind === kind}
                    title={label}
                    className={`flex flex-col items-center gap-1 rounded-md border p-2 text-[11px] transition-colors ${
                      placingKind === kind
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'hover:bg-muted text-foreground border-transparent'
                    }`}
                  >
                    <Icon className='h-5 w-5' />
                    <span className='leading-tight'>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
