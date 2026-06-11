// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// RackConfigPanel3D — full inspector for the selected rack in the 3D editor.
// ---------------------------------------------------------------------------
// Lazy-loaded (own chunk — the feature chunk sits at the 500 KB gate). Every
// aspect of the build is configurable here: structure (levels, bays, footprint,
// rotation, level height → total height) and look (post / shelf / beam colours,
// beams toggle). Geometry persists on warehouse_racks columns; the look lives
// in metadata.appearance (see rack-appearance.ts).
import { useState } from 'react'
import { Copy, Paintbrush, Trash2, X } from 'lucide-react'
import type { RackType, WarehouseRack } from '../types'
import {
  defaultRackAppearance,
  LEVEL_HEIGHT_MAX,
  LEVEL_HEIGHT_MIN,
  levelHeightAt,
  levelOffsets,
  mergeRackAppearance,
  readRackAppearance,
  type RackAppearance,
} from './rack-appearance'

interface RackConfigPanel3DProps {
  rack: WarehouseRack
  /** Bins mapped to this rack — deleting is blocked while any exist. */
  mappedCount: number
  onUpdate: (id: string, patch: Partial<WarehouseRack>) => void
  onDuplicate: (rack: WarehouseRack) => void
  onRemove: (rack: WarehouseRack) => void
  onClose: () => void
}

const RACK_TYPES: { value: RackType; label: string }[] = [
  { value: 'pallet', label: 'Pallet rack' },
  { value: 'shelving', label: 'Shelving' },
  { value: 'cantilever', label: 'Cantilever' },
  { value: 'flow', label: 'Flow rack' },
  { value: 'mezzanine', label: 'Mezzanine' },
]

function NumberField({
  label,
  value,
  step = 1,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string
  value: number
  step?: number
  min?: number
  max?: number
  suffix?: string
  onChange: (v: number) => void
}) {
  return (
    <label className='flex items-center justify-between gap-2 text-xs'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='flex items-center gap-1'>
        <input
          type='number'
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) onChange(v)
          }}
          className='border-input bg-background w-20 rounded border px-1.5 py-0.5 text-right text-xs'
        />
        {suffix && <span className='text-muted-foreground w-5'>{suffix}</span>}
      </span>
    </label>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className='flex items-center justify-between gap-2 text-xs'>
      <span className='text-muted-foreground'>{label}</span>
      <input
        type='color'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className='h-6 w-10 cursor-pointer rounded border'
      />
    </label>
  )
}

const round1 = (v: number) => Math.round(v * 10) / 10

export default function RackConfigPanel3D({
  rack,
  mappedCount,
  onUpdate,
  onDuplicate,
  onRemove,
  onClose,
}: RackConfigPanel3DProps) {
  const appearance = readRackAppearance(rack)
  const isDefaultLook =
    JSON.stringify(appearance) ===
    JSON.stringify(defaultRackAppearance(rack.rack_type))
  const rows = Math.max(1, rack.rows)
  const totalHeightM = round1(levelOffsets(appearance, rows).total)
  const varyLevels = appearance.levelHeights !== null
  const [confirmDelete, setConfirmDelete] = useState(false)

  const setAppearance = (patch: Partial<RackAppearance>) =>
    onUpdate(rack.id, { metadata: mergeRackAppearance(rack, patch) })

  const setLevelHeight = (level: number, v: number) => {
    const heights = Array.from({ length: rows }, (_, i) =>
      levelHeightAt(appearance, i)
    )
    heights[level] = Math.min(Math.max(v, LEVEL_HEIGHT_MIN), LEVEL_HEIGHT_MAX)
    setAppearance({ levelHeights: heights })
  }

  return (
    <div className='bg-card/95 absolute top-16 right-4 z-10 flex max-h-[calc(100%-9rem)] w-64 flex-col gap-3 overflow-y-auto rounded-lg border p-3 shadow-lg backdrop-blur-sm'>
      <div className='flex items-center justify-between'>
        <h3 className='text-sm font-semibold'>Rack — {rack.label}</h3>
        <button
          type='button'
          onClick={onClose}
          aria-label='Close rack inspector'
          className='text-muted-foreground hover:text-foreground rounded p-0.5'
        >
          <X className='h-4 w-4' />
        </button>
      </div>

      <label className='flex flex-col gap-1 text-xs'>
        <span className='text-muted-foreground'>Label</span>
        <input
          type='text'
          value={rack.label}
          onChange={(e) => onUpdate(rack.id, { label: e.target.value })}
          className='border-input bg-background rounded border px-1.5 py-1 text-xs'
        />
      </label>

      <label className='flex flex-col gap-1 text-xs'>
        <span className='text-muted-foreground'>Rack type</span>
        <select
          value={rack.rack_type}
          onChange={(e) =>
            onUpdate(rack.id, { rack_type: e.target.value as RackType })
          }
          className='border-input bg-background rounded border px-1.5 py-1 text-xs'
        >
          {RACK_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <div className='flex flex-col gap-1.5'>
        <NumberField
          label='Levels'
          value={rack.rows}
          min={1}
          max={12}
          onChange={(v) =>
            onUpdate(rack.id, {
              rows: Math.min(Math.max(Math.round(v), 1), 12),
            })
          }
        />
        <NumberField
          label='Bays'
          value={rack.columns}
          min={1}
          max={60}
          onChange={(v) =>
            onUpdate(rack.id, {
              columns: Math.min(Math.max(Math.round(v), 1), 60),
            })
          }
        />
        <NumberField
          label='Width'
          value={round1(rack.width / 100)}
          min={0.5}
          step={0.5}
          suffix='m'
          onChange={(v) => onUpdate(rack.id, { width: Math.max(v, 0.5) * 100 })}
        />
        <NumberField
          label='Depth'
          value={round1(rack.height / 100)}
          min={0.3}
          step={0.1}
          suffix='m'
          onChange={(v) =>
            onUpdate(rack.id, { height: Math.max(v, 0.3) * 100 })
          }
        />
        <NumberField
          label='Rotation'
          value={Math.round(rack.rotation)}
          step={15}
          min={-360}
          max={360}
          suffix='°'
          onChange={(v) => onUpdate(rack.id, { rotation: v })}
        />
        {rack.rack_type === 'pallet' && (
          <label className='flex items-center justify-between gap-2 text-xs'>
            <span className='text-muted-foreground'>Pallets per bay</span>
            <select
              value={appearance.palletsPerBay ?? 'auto'}
              onChange={(e) =>
                setAppearance({
                  palletsPerBay:
                    e.target.value === 'auto' ? null : Number(e.target.value),
                })
              }
              className='border-input bg-background w-24 rounded border px-1.5 py-0.5 text-xs'
            >
              <option value='auto'>Auto</option>
              <option value={1}>1 pallet</option>
              <option value={2}>2 pallets</option>
              <option value={3}>3 pallets</option>
            </select>
          </label>
        )}
        {appearance.palletsPerBay !== null && (
          <div className='text-muted-foreground flex items-center justify-between text-[11px]'>
            <span>Bays (uprights align to these)</span>
            <span className='text-foreground font-medium tabular-nums'>
              {Math.ceil(Math.max(1, rack.columns) / appearance.palletsPerBay)}
            </span>
          </div>
        )}
        {!varyLevels && (
          <NumberField
            label='Level height'
            value={appearance.levelHeightM}
            min={LEVEL_HEIGHT_MIN}
            max={LEVEL_HEIGHT_MAX}
            step={0.1}
            suffix='m'
            onChange={(v) =>
              setAppearance({
                levelHeightM: Math.min(
                  Math.max(v, LEVEL_HEIGHT_MIN),
                  LEVEL_HEIGHT_MAX
                ),
              })
            }
          />
        )}
        <label className='flex items-center justify-between gap-2 text-xs'>
          <span className='text-muted-foreground'>Vary heights by level</span>
          <input
            type='checkbox'
            checked={varyLevels}
            onChange={(e) =>
              setAppearance({
                levelHeights: e.target.checked
                  ? Array.from({ length: rows }, (_, i) =>
                      levelHeightAt(appearance, i)
                    )
                  : null,
              })
            }
          />
        </label>
        {varyLevels &&
          Array.from({ length: rows }, (_, i) => (
            <NumberField
              key={i}
              label={i === 0 ? 'Level 1 (ground)' : `Level ${i + 1}`}
              value={levelHeightAt(appearance, i)}
              min={LEVEL_HEIGHT_MIN}
              max={LEVEL_HEIGHT_MAX}
              step={0.1}
              suffix='m'
              onChange={(v) => setLevelHeight(i, v)}
            />
          ))}
        <div className='text-muted-foreground flex items-center justify-between text-[11px]'>
          <span>Total build height</span>
          <span className='text-foreground font-medium tabular-nums'>
            {totalHeightM} m
          </span>
        </div>
      </div>

      <div className='flex flex-col gap-1.5 border-t pt-2'>
        <div className='text-muted-foreground flex items-center gap-1 text-[10px] font-semibold uppercase'>
          <Paintbrush className='h-3 w-3' /> Look
        </div>
        <ColorField
          label='Posts / frames'
          value={appearance.postColor}
          onChange={(v) => setAppearance({ postColor: v })}
        />
        <ColorField
          label='Shelf decks'
          value={appearance.shelfColor}
          onChange={(v) => setAppearance({ shelfColor: v })}
        />
        <ColorField
          label='Load beams'
          value={appearance.beamColor}
          onChange={(v) => setAppearance({ beamColor: v })}
        />
        <label className='flex items-center justify-between gap-2 text-xs'>
          <span className='text-muted-foreground'>Show load beams</span>
          <input
            type='checkbox'
            checked={appearance.showBeams}
            onChange={(e) => setAppearance({ showBeams: e.target.checked })}
          />
        </label>
        {!isDefaultLook && (
          <button
            type='button'
            onClick={() => setAppearance(defaultRackAppearance(rack.rack_type))}
            className='text-muted-foreground hover:text-foreground self-start text-[11px] underline'
          >
            Reset to default look
          </button>
        )}
      </div>

      <div className='flex flex-col gap-2 border-t pt-2'>
        {mappedCount > 0 && (
          <p className='text-muted-foreground text-[11px]'>
            {mappedCount} bin{mappedCount === 1 ? '' : 's'} mapped to this rack.
          </p>
        )}
        <div className='flex gap-2'>
          <button
            type='button'
            onClick={() => onDuplicate(rack)}
            className='hover:bg-muted flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs'
          >
            <Copy className='h-3.5 w-3.5' /> Duplicate
          </button>
          {mappedCount > 0 ? (
            <button
              type='button'
              disabled
              title='Unmap this rack’s bins before deleting it'
              className='flex flex-1 cursor-not-allowed items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs opacity-50'
            >
              <Trash2 className='h-3.5 w-3.5' /> Delete
            </button>
          ) : confirmDelete ? (
            <button
              type='button'
              onClick={() => onRemove(rack)}
              className='flex flex-1 items-center justify-center gap-1.5 rounded-md bg-red-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-red-700'
            >
              <Trash2 className='h-3.5 w-3.5' /> Confirm
            </button>
          ) : (
            <button
              type='button'
              onClick={() => setConfirmDelete(true)}
              className='flex flex-1 items-center justify-center gap-1.5 rounded-md border border-red-200 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50'
            >
              <Trash2 className='h-3.5 w-3.5' /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
