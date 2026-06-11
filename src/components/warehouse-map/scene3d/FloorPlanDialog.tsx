// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// FloorPlanDialog — plot the facility's maximum floor-plan envelope.
// ---------------------------------------------------------------------------
// Lazy-loaded (own chunk — the feature chunk is near the 500 KB gate). Sets
// the buildable envelope (width × depth + origin), display units, ceiling
// height, and the out-of-bounds placement lock. Persisted in
// warehouse_maps.canvas_settings (floor_plan + wall_height) — optionally also
// drawing the building outline as the same rectangle so the 3D shell matches.
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { warehouseMapService } from '@/lib/supabase/warehouse-map.service'
import type { MapLayoutResponse } from '../types'
import {
  DEFAULT_FLOOR_PLAN,
  displayToWorld,
  floorPlanAreaM2,
  floorPlanContains,
  floorPlanOutline,
  readFloorPlan,
  worldToDisplay,
  type FloorPlanConfig,
  type FloorPlanUnits,
} from './floor-plan'

interface FloorPlanDialogProps {
  layout: MapLayoutResponse
  onClose: () => void
}

function NumField({
  label,
  value,
  onChange,
  min,
  step = 1,
  suffix,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  step?: number
  suffix?: string
}) {
  return (
    <label className='flex flex-col gap-1 text-xs'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='flex items-center gap-1'>
        <input
          type='number'
          value={value}
          min={min}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) onChange(v)
          }}
          className='bg-muted/50 focus:ring-ring w-full rounded-md border px-2 py-1.5 focus:ring-1 focus:outline-none'
        />
        {suffix && <span className='text-muted-foreground'>{suffix}</span>}
      </span>
    </label>
  )
}

const round1 = (v: number) => Math.round(v * 10) / 10

export default function FloorPlanDialog({
  layout,
  onClose,
}: FloorPlanDialogProps) {
  const qc = useQueryClient()
  const map = layout.map

  const initial = useMemo<FloorPlanConfig>(() => {
    const existing = readFloorPlan(map.canvas_settings)
    if (existing) return existing
    // No envelope yet: seed from the building outline's bounding box so the
    // dialog opens pre-fit to what's already drawn.
    const outline = map.building_outline
    if (outline && outline.length >= 3) {
      const xs = outline.map((p) => p.x)
      const ys = outline.map((p) => p.y)
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      return {
        ...DEFAULT_FLOOR_PLAN,
        origin_x: minX,
        origin_y: minY,
        width: Math.max(...xs) - minX,
        depth: Math.max(...ys) - minY,
      }
    }
    return DEFAULT_FLOOR_PLAN
  }, [map])

  const initialCeilingM =
    (map.canvas_settings as { wall_height?: number } | null)?.wall_height ?? 5

  const [units, setUnits] = useState<FloorPlanUnits>(initial.units)
  const [width, setWidth] = useState(() =>
    round1(worldToDisplay(initial.width, initial.units))
  )
  const [depth, setDepth] = useState(() =>
    round1(worldToDisplay(initial.depth, initial.units))
  )
  const [originX, setOriginX] = useState(() =>
    round1(worldToDisplay(initial.origin_x, initial.units))
  )
  const [originY, setOriginY] = useState(() =>
    round1(worldToDisplay(initial.origin_y, initial.units))
  )
  const [ceiling, setCeiling] = useState(() =>
    round1(
      initial.units === 'ft'
        ? worldToDisplay(initialCeilingM * 100, 'ft')
        : initialCeilingM
    )
  )
  const [enabled, setEnabled] = useState(initial.enabled)
  const [lock, setLock] = useState(initial.lock_placements)
  const [saving, setSaving] = useState(false)

  // Re-express the current numbers when the user flips units.
  const switchUnits = (next: FloorPlanUnits) => {
    if (next === units) return
    const convert = (v: number) =>
      round1(worldToDisplay(displayToWorld(v, units), next))
    setWidth(convert(width))
    setDepth(convert(depth))
    setOriginX(convert(originX))
    setOriginY(convert(originY))
    setCeiling(convert(ceiling))
    setUnits(next)
  }

  const draft = useMemo<FloorPlanConfig>(
    () => ({
      enabled,
      origin_x: displayToWorld(originX, units),
      origin_y: displayToWorld(originY, units),
      width: Math.max(displayToWorld(width, units), 1),
      depth: Math.max(displayToWorld(depth, units), 1),
      units,
      lock_placements: lock,
    }),
    [enabled, originX, originY, width, depth, units, lock]
  )

  const areaM2 = floorPlanAreaM2(draft)

  // Surface content that the new envelope would strand outside it.
  const escapingRacks = useMemo(
    () =>
      (layout.racks ?? []).filter(
        (r) =>
          !floorPlanContains(
            draft,
            r.position_x + r.width / 2,
            r.position_y + r.height / 2,
            r.width,
            r.height,
            r.rotation
          )
      ).length,
    [layout.racks, draft]
  )

  const save = async (drawOutline: boolean) => {
    if (draft.width <= 0 || draft.depth <= 0) {
      toast.error('Width and depth must be positive.')
      return
    }
    setSaving(true)
    try {
      const ceilingM = displayToWorld(ceiling, units) / 100
      const canvas_settings = {
        ...((map.canvas_settings as Record<string, unknown>) ?? {}),
        floor_plan: draft,
        wall_height: Math.max(ceilingM, 2),
      }
      await warehouseMapService.updateMap(map.id, {
        canvas_settings,
        ...(drawOutline ? { building_outline: floorPlanOutline(draft) } : {}),
      })
      qc.invalidateQueries({ queryKey: ['warehouse-map-layout', map.id] })
      toast.success(
        drawOutline
          ? 'Floor plan saved and building outline drawn.'
          : 'Floor plan saved.'
      )
      onClose()
    } catch (e) {
      toast.error("Couldn't save the floor plan.", {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='absolute inset-0 z-20 flex items-center justify-center bg-black/30 p-4'>
      <div className='bg-card w-[440px] max-w-full rounded-lg border shadow-xl'>
        <div className='flex items-center justify-between border-b px-4 py-3'>
          <h3 className='text-sm font-semibold'>Floor plan envelope</h3>
          <button
            type='button'
            onClick={onClose}
            aria-label='Close'
            className='text-muted-foreground hover:text-foreground rounded p-0.5'
          >
            <X className='h-4 w-4' />
          </button>
        </div>

        <div className='flex flex-col gap-3 p-4'>
          <p className='text-muted-foreground text-xs'>
            The maximum buildable footprint of this facility. The boundary is
            drawn in the scene, frames the camera, and (when locked) blocks
            placements outside it.
          </p>

          <div className='grid grid-cols-3 gap-3'>
            <label className='flex flex-col gap-1 text-xs'>
              <span className='text-muted-foreground'>Units</span>
              <select
                value={units}
                onChange={(e) => switchUnits(e.target.value as FloorPlanUnits)}
                className='bg-muted/50 focus:ring-ring rounded-md border px-2 py-1.5 focus:ring-1 focus:outline-none'
              >
                <option value='m'>Meters</option>
                <option value='ft'>Feet</option>
              </select>
            </label>
            <NumField
              label='Width'
              value={width}
              min={1}
              onChange={setWidth}
              suffix={units}
            />
            <NumField
              label='Depth'
              value={depth}
              min={1}
              onChange={setDepth}
              suffix={units}
            />
          </div>

          <div className='grid grid-cols-3 gap-3'>
            <NumField
              label='Origin X'
              value={originX}
              onChange={setOriginX}
              suffix={units}
            />
            <NumField
              label='Origin Y'
              value={originY}
              onChange={setOriginY}
              suffix={units}
            />
            <NumField
              label='Ceiling height'
              value={ceiling}
              min={2}
              step={0.5}
              onChange={setCeiling}
              suffix={units}
            />
          </div>

          <div className='flex items-center gap-4'>
            <label className='flex items-center gap-2 text-xs'>
              <input
                type='checkbox'
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Show boundary
            </label>
            <label className='flex items-center gap-2 text-xs'>
              <input
                type='checkbox'
                checked={lock}
                onChange={(e) => setLock(e.target.checked)}
              />
              Block placements outside
            </label>
          </div>

          <div className='bg-muted/40 text-muted-foreground rounded-md border px-3 py-2 text-xs'>
            Floor area:{' '}
            <strong className='text-foreground'>
              {Math.round(areaM2).toLocaleString()} m²
            </strong>{' '}
            ({Math.round(areaM2 * 10.7639).toLocaleString()} sq ft)
            {escapingRacks > 0 && (
              <div className='mt-1 text-amber-600'>
                ⚠ {escapingRacks} rack{escapingRacks === 1 ? '' : 's'} currently
                outside this envelope.
              </div>
            )}
          </div>

          <div className='flex justify-end gap-2 pt-1'>
            <button
              type='button'
              onClick={() => void save(true)}
              disabled={saving}
              className='text-muted-foreground hover:text-foreground rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50'
              title='Also replace the building outline with this rectangle'
            >
              Save + draw outline
            </button>
            <button
              type='button'
              onClick={() => void save(false)}
              disabled={saving}
              className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50'
            >
              {saving ? 'Saving…' : 'Save floor plan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
