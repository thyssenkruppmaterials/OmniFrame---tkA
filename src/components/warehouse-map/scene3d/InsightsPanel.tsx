// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// InsightsPanel — live capacity/utilization analytics + layout validation.
// ---------------------------------------------------------------------------
// Read-only dashboard over the current layout: rack positions, footprint &
// floor utilization, object counts by category, occupancy, and a validation
// list (overlaps / out-of-bounds / clearance) where each issue is click-to-
// select. Powered by the pure, tested layout-analytics + layout-validation
// modules.
import { useMemo, useState } from 'react'
import { AlertTriangle, BarChart3, CircleAlert, X } from 'lucide-react'
import type {
  MapLayoutResponse,
  WarehouseLocationMapping,
  WarehouseSceneObject,
} from '../types'
import { computeAnalytics } from './layout-analytics'
import { validateLayout, type ValidationIssue } from './layout-validation'
import {
  CATALOG_BY_KIND,
  CATEGORY_LABEL,
  type ObjectCategory,
} from './object-catalog'

interface InsightsPanelProps {
  layout: MapLayoutResponse | null
  mappings: WarehouseLocationMapping[]
  objects: WarehouseSceneObject[]
  onSelectIssue: (issue: ValidationIssue) => void
  onClose: () => void
}

const categoryOf = (kind: string): ObjectCategory =>
  CATALOG_BY_KIND[kind]?.category ?? 'decor'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className='bg-muted/40 flex flex-col rounded-md px-2 py-1.5'>
      <span className='text-foreground text-sm font-semibold tabular-nums'>
        {value}
      </span>
      <span className='text-muted-foreground text-[10px]'>{label}</span>
    </div>
  )
}

export function InsightsPanel({
  layout,
  mappings,
  objects,
  onSelectIssue,
  onClose,
}: InsightsPanelProps) {
  const [clearanceCm, setClearanceCm] = useState(0)

  const analytics = useMemo(
    () => computeAnalytics(layout, mappings, objects, categoryOf),
    [layout, mappings, objects]
  )
  const issues = useMemo(
    () => validateLayout(layout, objects, { minClearance: clearanceCm }),
    [layout, objects, clearanceCm]
  )

  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const m2 = (v: number) => `${v.toFixed(v < 100 ? 1 : 0)} m²`

  return (
    <div className='bg-card/95 absolute top-16 right-4 z-10 flex max-h-[calc(100%-7rem)] w-72 flex-col rounded-lg border shadow-lg backdrop-blur-sm'>
      <div className='flex items-center justify-between border-b px-3 py-2'>
        <h3 className='flex items-center gap-1.5 text-sm font-semibold'>
          <BarChart3 className='h-4 w-4' /> Layout insights
        </h3>
        <button
          type='button'
          onClick={onClose}
          aria-label='Close insights'
          className='text-muted-foreground hover:text-foreground rounded p-0.5'
        >
          <X className='h-4 w-4' />
        </button>
      </div>

      <div className='flex-1 space-y-3 overflow-y-auto p-3'>
        <div className='grid grid-cols-3 gap-1.5'>
          <Stat label='Racks' value={String(analytics.rackCount)} />
          <Stat
            label='Positions'
            value={analytics.rackPositions.toLocaleString()}
          />
          <Stat label='Zones' value={String(analytics.zoneCount)} />
          <Stat label='Objects' value={String(analytics.objectCount)} />
          <Stat
            label='Mapped bins'
            value={analytics.mappedBins.toLocaleString()}
          />
          <Stat
            label='Active %'
            value={`${analytics.occupancyPct.toFixed(0)}%`}
          />
        </div>

        <div>
          <div className='text-muted-foreground mb-1 text-[10px] font-semibold uppercase'>
            Footprint
          </div>
          <div className='grid grid-cols-2 gap-1.5'>
            <Stat label='Building' value={m2(analytics.buildingAreaM2)} />
            <Stat
              label='Floor used'
              value={`${analytics.floorUtilizationPct.toFixed(0)}%`}
            />
            <Stat label='Racks' value={m2(analytics.rackFootprintM2)} />
            <Stat label='Objects' value={m2(analytics.objectFootprintM2)} />
          </div>
        </div>

        {Object.keys(analytics.objectsByCategory).length > 0 && (
          <div>
            <div className='text-muted-foreground mb-1 text-[10px] font-semibold uppercase'>
              Objects by category
            </div>
            <div className='space-y-0.5'>
              {Object.entries(analytics.objectsByCategory).map(([cat, n]) => (
                <div key={cat} className='flex justify-between text-xs'>
                  <span className='text-muted-foreground'>
                    {CATEGORY_LABEL[cat as ObjectCategory] ?? cat}
                  </span>
                  <span className='tabular-nums'>{n}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className='mb-1 flex items-center justify-between'>
            <span className='text-muted-foreground text-[10px] font-semibold uppercase'>
              Validation
            </span>
            <label className='text-muted-foreground flex items-center gap-1 text-[10px]'>
              clearance
              <input
                type='number'
                min={0}
                step={10}
                value={clearanceCm}
                onChange={(e) =>
                  setClearanceCm(Math.max(0, Number(e.target.value) || 0))
                }
                className='border-input bg-background w-12 rounded border px-1 py-0.5 text-right text-[10px]'
              />
              cm
            </label>
          </div>

          {issues.length === 0 ? (
            <div className='rounded-md bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700'>
              No issues — layout is clean.
            </div>
          ) : (
            <div className='space-y-1'>
              <div className='text-muted-foreground text-[11px]'>
                {errors.length} error{errors.length !== 1 ? 's' : ''} ·{' '}
                {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
              </div>
              {issues.slice(0, 40).map((issue) => (
                <button
                  key={issue.id}
                  type='button'
                  onClick={() => onSelectIssue(issue)}
                  className='hover:bg-muted flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px]'
                >
                  {issue.severity === 'error' ? (
                    <CircleAlert className='mt-px h-3.5 w-3.5 shrink-0 text-red-500' />
                  ) : (
                    <AlertTriangle className='mt-px h-3.5 w-3.5 shrink-0 text-amber-500' />
                  )}
                  <span>{issue.message}</span>
                </button>
              ))}
              {issues.length > 40 && (
                <div className='text-muted-foreground text-[10px]'>
                  +{issues.length - 40} more…
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
