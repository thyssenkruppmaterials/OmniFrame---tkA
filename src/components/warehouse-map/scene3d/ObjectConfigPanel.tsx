// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// ObjectConfigPanel — inspector for the selected scene object.
// ---------------------------------------------------------------------------
// Edit label, dimensions (cm), rotation, colour, floor; duplicate or delete.
// Pure DOM overlay; writes go through the scene-object mutations.
import { useState } from 'react'
import { Copy, Grid2x2, Sparkles, Trash2, X } from 'lucide-react'
import type { WarehouseSceneObject } from '../types'
import { CATALOG_BY_KIND } from './object-catalog'
import {
  FINISH_LABELS,
  mergeObjectStyle,
  readObjectStyle,
  type ObjectFinish,
} from './object-style'

interface ObjectConfigPanelProps {
  object: WarehouseSceneObject
  onUpdate: (
    id: string,
    patch: Partial<
      Omit<
        WarehouseSceneObject,
        'id' | 'map_id' | 'organization_id' | 'updated_at'
      >
    >
  ) => void
  onDuplicate: (object: WarehouseSceneObject) => void
  onArray: (count: number, dx: number, dy: number) => void
  onRemove: (id: string) => void
  onClose: () => void
}

function NumberField({
  label,
  value,
  step = 5,
  min = 1,
  onChange,
}: {
  label: string
  value: number
  step?: number
  min?: number
  onChange: (v: number) => void
}) {
  return (
    <label className='flex items-center justify-between gap-2 text-xs'>
      <span className='text-muted-foreground'>{label}</span>
      <input
        type='number'
        value={Math.round(value)}
        step={step}
        min={min}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (!Number.isNaN(v)) onChange(v)
        }}
        className='border-input bg-background w-20 rounded border px-1.5 py-0.5 text-right text-xs'
      />
    </label>
  )
}

export function ObjectConfigPanel({
  object,
  onUpdate,
  onDuplicate,
  onArray,
  onRemove,
  onClose,
}: ObjectConfigPanelProps) {
  const entry = CATALOG_BY_KIND[object.kind]
  const color = object.color ?? entry?.color ?? '#c0c7d0'
  const style = readObjectStyle(object.metadata)
  const setStyle = (patch: Parameters<typeof mergeObjectStyle>[1]) =>
    onUpdate(object.id, { metadata: mergeObjectStyle(object.metadata, patch) })

  const [arrCount, setArrCount] = useState(3)
  const [arrSpacing, setArrSpacing] = useState(() =>
    Math.round(object.width + 20)
  )
  const [arrAxis, setArrAxis] = useState<'x' | 'z'>('x')

  return (
    <div className='bg-card/95 absolute top-16 right-4 z-10 flex w-60 flex-col gap-3 rounded-lg border p-3 shadow-lg backdrop-blur-sm'>
      <div className='flex items-center justify-between'>
        <h3 className='text-sm font-semibold'>{entry?.label ?? object.kind}</h3>
        <button
          type='button'
          onClick={onClose}
          aria-label='Close inspector'
          className='text-muted-foreground hover:text-foreground rounded p-0.5'
        >
          <X className='h-4 w-4' />
        </button>
      </div>

      <label className='flex flex-col gap-1 text-xs'>
        <span className='text-muted-foreground'>Label</span>
        <input
          type='text'
          value={object.label ?? ''}
          placeholder={entry?.label ?? object.kind}
          onChange={(e) => onUpdate(object.id, { label: e.target.value })}
          className='border-input bg-background rounded border px-1.5 py-1 text-xs'
        />
      </label>

      <div className='flex flex-col gap-1.5'>
        <NumberField
          label='Width (cm)'
          value={object.width}
          onChange={(v) => onUpdate(object.id, { width: v })}
        />
        <NumberField
          label='Depth (cm)'
          value={object.depth}
          onChange={(v) => onUpdate(object.id, { depth: v })}
        />
        <NumberField
          label='Height (cm)'
          value={object.height}
          onChange={(v) => onUpdate(object.id, { height: v })}
        />
        <NumberField
          label='Rotation (°)'
          value={object.rotation}
          step={15}
          min={-360}
          onChange={(v) => onUpdate(object.id, { rotation: v })}
        />
        <NumberField
          label='Elevation (cm)'
          value={object.position_z}
          step={10}
          min={0}
          onChange={(v) => onUpdate(object.id, { position_z: v })}
        />
      </div>

      <label className='flex items-center justify-between gap-2 text-xs'>
        <span className='text-muted-foreground'>Colour</span>
        <input
          type='color'
          value={color}
          onChange={(e) => onUpdate(object.id, { color: e.target.value })}
          className='h-6 w-10 cursor-pointer rounded border'
        />
      </label>

      <div className='flex flex-col gap-1.5'>
        <div className='text-muted-foreground flex items-center gap-1 text-[10px] font-semibold uppercase'>
          <Sparkles className='h-3 w-3' /> Design
        </div>
        <label className='flex items-center justify-between gap-2 text-xs'>
          <span className='text-muted-foreground'>Finish</span>
          <select
            value={style.finish}
            onChange={(e) =>
              setStyle({ finish: e.target.value as ObjectFinish })
            }
            className='border-input bg-background w-32 rounded border px-1.5 py-0.5 text-xs'
          >
            {(Object.keys(FINISH_LABELS) as ObjectFinish[]).map((f) => (
              <option key={f} value={f}>
                {FINISH_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
        <label className='flex items-center justify-between gap-2 text-xs'>
          <span className='text-muted-foreground'>Neon glow</span>
          <input
            type='checkbox'
            checked={style.glow}
            onChange={(e) => setStyle({ glow: e.target.checked })}
          />
        </label>
      </div>

      <div className='border-t pt-2'>
        <div className='text-muted-foreground mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase'>
          <Grid2x2 className='h-3 w-3' /> Array
        </div>
        <div className='flex items-center gap-1.5 text-xs'>
          <label className='flex items-center gap-1'>
            <span className='text-muted-foreground'>×</span>
            <input
              type='number'
              min={2}
              max={50}
              value={arrCount}
              onChange={(e) =>
                setArrCount(Math.max(2, Number(e.target.value) || 2))
              }
              className='border-input bg-background w-12 rounded border px-1 py-0.5 text-right'
            />
          </label>
          <label className='flex items-center gap-1'>
            <input
              type='number'
              min={1}
              step={10}
              value={arrSpacing}
              onChange={(e) =>
                setArrSpacing(Math.max(1, Number(e.target.value) || 1))
              }
              className='border-input bg-background w-14 rounded border px-1 py-0.5 text-right'
            />
            <span className='text-muted-foreground'>cm</span>
          </label>
          <div className='ml-auto flex overflow-hidden rounded border'>
            {(['x', 'z'] as const).map((ax) => (
              <button
                key={ax}
                type='button'
                onClick={() => setArrAxis(ax)}
                className={`px-2 py-0.5 text-[11px] uppercase ${
                  arrAxis === ax
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                {ax}
              </button>
            ))}
          </div>
        </div>
        <button
          type='button'
          onClick={() =>
            onArray(
              arrCount,
              arrAxis === 'x' ? arrSpacing : 0,
              arrAxis === 'z' ? arrSpacing : 0
            )
          }
          className='hover:bg-muted mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs'
        >
          Create array
        </button>
      </div>

      <div className='flex gap-2 border-t pt-2'>
        <button
          type='button'
          onClick={() => onDuplicate(object)}
          className='hover:bg-muted flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs'
        >
          <Copy className='h-3.5 w-3.5' /> Duplicate
        </button>
        <button
          type='button'
          onClick={() => onRemove(object.id)}
          className='flex flex-1 items-center justify-center gap-1.5 rounded-md border border-red-200 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50'
        >
          <Trash2 className='h-3.5 w-3.5' /> Delete
        </button>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
