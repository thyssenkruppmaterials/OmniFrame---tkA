// Created and developed by Jai Singh
// Legend doubles as the lane filter: click a status or a transport mode to
// show/hide those lanes on the globe.
import { Plane, Ship, TrainFront, Truck } from 'lucide-react'
import type { LinkStatus, NodeRisk, TransportMode } from '../data/types'
import {
  MODE_LABELS,
  RISK_COLORS,
  RISK_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
} from '../palette'

const STATUSES: LinkStatus[] = ['nominal', 'elevated', 'bottleneck', 'broken']
const RISKS: NodeRisk[] = ['ok', 'watch', 'at_risk', 'starved']
const MODES: TransportMode[] = ['sea', 'air', 'road', 'rail']

const MODE_ICONS: Record<TransportMode, typeof Ship> = {
  sea: Ship,
  air: Plane,
  road: Truck,
  rail: TrainFront,
}

interface LegendPanelProps {
  visibleStatuses: Record<string, boolean>
  visibleModes: Record<string, boolean>
  onToggleStatus: (status: LinkStatus) => void
  onToggleMode: (mode: TransportMode) => void
}

export function LegendPanel({
  visibleStatuses,
  visibleModes,
  onToggleStatus,
  onToggleMode,
}: LegendPanelProps) {
  return (
    <div className='pointer-events-auto w-52 rounded-xl border border-white/10 bg-slate-950/70 p-3 shadow-xl backdrop-blur-md'>
      <p className='mb-2 text-[10px] font-semibold tracking-wider text-slate-400 uppercase'>
        Lane light-waves · click to filter
      </p>
      <div className='space-y-1'>
        {STATUSES.map((status) => {
          const visible = visibleStatuses[status] !== false
          return (
            <button
              key={status}
              type='button'
              onClick={() => onToggleStatus(status)}
              className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-opacity hover:bg-white/5 ${visible ? '' : 'opacity-35'}`}
            >
              <span
                className='h-1 w-6 rounded-full'
                style={{
                  backgroundColor: STATUS_COLORS[status],
                  boxShadow: `0 0 8px ${STATUS_COLORS[status]}`,
                }}
              />
              <span className='text-slate-200'>{STATUS_LABELS[status]}</span>
            </button>
          )
        })}
      </div>
      <p className='mt-3 mb-2 text-[10px] font-semibold tracking-wider text-slate-400 uppercase'>
        Transport · click to filter
      </p>
      <div className='grid grid-cols-2 gap-1'>
        {MODES.map((mode) => {
          const visible = visibleModes[mode] !== false
          const Icon = MODE_ICONS[mode]
          return (
            <button
              key={mode}
              type='button'
              onClick={() => onToggleMode(mode)}
              className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-opacity hover:bg-white/5 ${visible ? '' : 'opacity-35'}`}
            >
              <Icon className='h-3 w-3 text-slate-400' />
              <span className='text-slate-200'>{MODE_LABELS[mode]}</span>
            </button>
          )
        })}
      </div>
      <p className='mt-3 mb-2 text-[10px] font-semibold tracking-wider text-slate-400 uppercase'>
        Site health
      </p>
      <div className='grid grid-cols-2 gap-1'>
        {RISKS.map((risk) => (
          <div key={risk} className='flex items-center gap-1.5 text-xs'>
            <span
              className='h-2 w-2 rounded-full'
              style={{
                backgroundColor: RISK_COLORS[risk],
                boxShadow: `0 0 6px ${RISK_COLORS[risk]}`,
              }}
            />
            <span className='text-slate-300'>{RISK_LABELS[risk]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
