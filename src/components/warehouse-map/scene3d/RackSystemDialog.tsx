// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// RackSystemDialog — configure a full racking system before placing it.
// ---------------------------------------------------------------------------
// Lazy-loaded (own chunk — the feature chunk is near the 500 KB gate). Inputs
// are in METERS for humans; the config is world units (~cm). Confirming arms
// the placement ghost — the system lands on the next floor click.
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { RackType } from '../types'
import {
  palletsPerBayOf,
  RACK_SYSTEM_DEFAULTS,
  systemFootprint,
  type RackSystemConfig,
} from './rack-system'

interface RackSystemDialogProps {
  onArm: (config: RackSystemConfig) => void
  onClose: () => void
}

const RACK_TYPES: { value: RackType; label: string }[] = [
  { value: 'pallet', label: 'Pallet rack' },
  { value: 'shelving', label: 'Shelving' },
  { value: 'cantilever', label: 'Cantilever' },
  { value: 'flow', label: 'Flow rack' },
]

function NumField({
  label,
  value,
  onChange,
  min = 1,
  max,
  step = 1,
  suffix,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
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
          max={max}
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

export default function RackSystemDialog({
  onArm,
  onClose,
}: RackSystemDialogProps) {
  const [cfg, setCfg] = useState<RackSystemConfig>(RACK_SYSTEM_DEFAULTS)
  const set = <K extends keyof RackSystemConfig>(
    k: K,
    v: RackSystemConfig[K]
  ) => setCfg((c) => ({ ...c, [k]: v }))

  const summary = useMemo(() => {
    const { width, depth } = systemFootprint(cfg)
    const aisles = cfg.backToBack
      ? Math.max(0, Math.ceil(cfg.runs / 2) - 1)
      : Math.max(0, cfg.runs - 1)
    return {
      w: (width / 100).toFixed(1),
      d: (depth / 100).toFixed(1),
      runs: cfg.runs,
      aisles,
      locations: cfg.runs * cfg.levels * cfg.bays * palletsPerBayOf(cfg),
    }
  }, [cfg])

  return (
    <div className='absolute inset-0 z-20 flex items-center justify-center bg-black/30 p-4'>
      <div className='bg-card w-[420px] max-w-full rounded-lg border shadow-xl'>
        <div className='flex items-center justify-between border-b px-4 py-3'>
          <h3 className='text-sm font-semibold'>Build rack system</h3>
          <button
            type='button'
            onClick={onClose}
            aria-label='Close'
            className='text-muted-foreground hover:text-foreground rounded p-0.5'
          >
            <X className='h-4 w-4' />
          </button>
        </div>

        <div className='grid grid-cols-3 gap-3 p-4'>
          <label className='col-span-2 flex flex-col gap-1 text-xs'>
            <span className='text-muted-foreground'>Rack type</span>
            <select
              value={cfg.rack_type}
              onChange={(e) => set('rack_type', e.target.value as RackType)}
              className='bg-muted/50 focus:ring-ring rounded-md border px-2 py-1.5 focus:ring-1 focus:outline-none'
            >
              {RACK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className='flex flex-col gap-1 text-xs'>
            <span className='text-muted-foreground'>Label prefix</span>
            <input
              type='text'
              value={cfg.labelPrefix}
              placeholder='e.g. WH5-'
              onChange={(e) => set('labelPrefix', e.target.value)}
              className='bg-muted/50 focus:ring-ring w-full rounded-md border px-2 py-1.5 focus:ring-1 focus:outline-none'
            />
          </label>

          <NumField
            label='Rack runs'
            value={cfg.runs}
            min={1}
            max={40}
            onChange={(v) => set('runs', Math.round(v))}
          />
          <NumField
            label='Bays per run'
            value={cfg.bays}
            min={1}
            max={60}
            onChange={(v) => set('bays', Math.round(v))}
          />
          <NumField
            label='Levels'
            value={cfg.levels}
            min={1}
            max={12}
            onChange={(v) => set('levels', Math.round(v))}
          />

          <label className='flex flex-col gap-1 text-xs'>
            <span className='text-muted-foreground'>Pallets per bay</span>
            <select
              value={palletsPerBayOf(cfg)}
              onChange={(e) => set('palletsPerBay', Number(e.target.value))}
              className='bg-muted/50 focus:ring-ring rounded-md border px-2 py-1.5 focus:ring-1 focus:outline-none'
            >
              <option value={1}>1 pallet</option>
              <option value={2}>2 pallets</option>
              <option value={3}>3 pallets</option>
            </select>
          </label>

          <NumField
            label='Bay width'
            value={cfg.bayWidth / 100}
            min={0.5}
            max={6}
            step={0.1}
            suffix='m'
            onChange={(v) => set('bayWidth', Math.round(v * 100))}
          />
          <NumField
            label='Rack depth'
            value={cfg.rackDepth / 100}
            min={0.3}
            max={4}
            step={0.1}
            suffix='m'
            onChange={(v) => set('rackDepth', Math.round(v * 100))}
          />
          <NumField
            label='Aisle width'
            value={cfg.aisleWidth / 100}
            min={1}
            max={8}
            step={0.1}
            suffix='m'
            onChange={(v) => set('aisleWidth', Math.round(v * 100))}
          />

          <label className='col-span-2 flex items-center gap-2 text-xs'>
            <input
              type='checkbox'
              checked={cfg.backToBack}
              onChange={(e) => set('backToBack', e.target.checked)}
            />
            <span>Back-to-back pairs (flue gap between paired runs)</span>
          </label>
          {cfg.backToBack && (
            <NumField
              label='Flue gap'
              value={cfg.flueGap / 100}
              min={0}
              max={1}
              step={0.05}
              suffix='m'
              onChange={(v) => set('flueGap', Math.round(v * 100))}
            />
          )}
        </div>

        <div className='bg-muted/40 text-muted-foreground mx-4 mb-3 rounded-md border px-3 py-2 text-[11px]'>
          Footprint{' '}
          <strong className='text-foreground'>
            {summary.w} × {summary.d} m
          </strong>{' '}
          · {summary.runs} runs · {summary.aisles} aisle
          {summary.aisles === 1 ? '' : 's'} ·{' '}
          <strong className='text-foreground'>{summary.locations}</strong>{' '}
          locations. Runs are lettered A, B, C… and bins map per level × bay.
        </div>

        <div className='flex justify-end gap-2 border-t px-4 py-3'>
          <button
            type='button'
            onClick={onClose}
            className='text-muted-foreground hover:bg-muted rounded-md border px-3 py-1.5 text-xs font-medium'
          >
            Cancel
          </button>
          <button
            type='button'
            onClick={() => onArm(cfg)}
            className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium'
          >
            Place on map…
          </button>
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
