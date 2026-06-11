// Created and developed by Jai Singh
// Right-hand inspector: deep details for the selected node or lane, plus a
// live disruption editor — inject a closure/congestion onto any lane and
// watch the light-waves and downstream risk re-propagate instantly.
import { Focus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { CONTINENT_LABELS, type Continent } from '../data/continents'
import type {
  LinkDisruption,
  MapSelection,
  NetworkAnalysis,
  SupplyChainNetwork,
} from '../data/types'
import {
  KIND_LABELS,
  MODE_LABELS,
  RISK_COLORS,
  RISK_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
} from '../palette'

interface InspectorPanelProps {
  network: SupplyChainNetwork
  analysis: NetworkAnalysis
  selection: Exclude<MapSelection, null>
  continentByNode: Map<string, Continent>
  focusContinent: Continent | null
  onFocusContinent: (continent: Continent) => void
  onSelect: (selection: MapSelection) => void
  onSetDisruption: (linkId: string, disruption: LinkDisruption | null) => void
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='flex items-center justify-between gap-2 text-xs'>
      <span className='text-slate-400'>{label}</span>
      <span className='text-right font-medium text-slate-100'>{value}</span>
    </div>
  )
}

const DISRUPTION_KINDS: Array<{
  value: LinkDisruption['kind']
  label: string
}> = [
  { value: 'closure', label: 'Closure' },
  { value: 'congestion', label: 'Congestion' },
  { value: 'capacity_loss', label: 'Capacity loss' },
  { value: 'quality_hold', label: 'Quality hold' },
]

export function InspectorPanel({
  network,
  analysis,
  selection,
  continentByNode,
  focusContinent,
  onFocusContinent,
  onSelect,
  onSetDisruption,
}: InspectorPanelProps) {
  const nodesById = new Map(network.nodes.map((n) => [n.id, n]))

  return (
    <div className='pointer-events-auto w-80 rounded-xl border border-white/10 bg-slate-950/80 p-4 shadow-2xl backdrop-blur-md'>
      {selection.type === 'node'
        ? (() => {
            const node = nodesById.get(selection.id)
            if (!node) return null
            const risk = analysis.nodeRisk.get(node.id) ?? 'ok'
            const health = analysis.nodeHealth.get(node.id) ?? 1
            const lanes = network.links.filter(
              (lk) => lk.from === node.id || lk.to === node.id
            )
            return (
              <>
                <div className='mb-1 flex items-start justify-between gap-2'>
                  <div>
                    <h3 className='text-sm font-semibold text-slate-50'>
                      {node.name}
                    </h3>
                    <p className='text-xs text-slate-400'>
                      {KIND_LABELS[node.kind]} · {node.country} · Tier{' '}
                      {node.tier}
                    </p>
                  </div>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-6 w-6 shrink-0 text-slate-400'
                    onClick={() => onSelect(null)}
                  >
                    <X className='h-3.5 w-3.5' />
                  </Button>
                </div>
                <Badge
                  variant='outline'
                  className='mb-3 border-current text-[10px] tracking-wide uppercase'
                  style={{ color: RISK_COLORS[risk] }}
                >
                  {RISK_LABELS[risk]} · supply health {Math.round(health * 100)}
                  %
                </Badge>
                <div className='space-y-1.5'>
                  <Row
                    label='Capacity'
                    value={`${node.capacityPerWeek.toLocaleString()} u/wk`}
                  />
                  <Row
                    label='Throughput'
                    value={`${node.throughputPerWeek.toLocaleString()} u/wk`}
                  />
                  {node.inventoryDaysOfSupply !== undefined && (
                    <Row
                      label='Inventory'
                      value={`${node.inventoryDaysOfSupply} days of supply`}
                    />
                  )}
                  {(() => {
                    const continent = continentByNode.get(node.id)
                    return continent ? (
                      <Row
                        label='Continent'
                        value={CONTINENT_LABELS[continent]}
                      />
                    ) : null
                  })()}
                </div>
                {(() => {
                  const continent = continentByNode.get(node.id)
                  if (!continent || focusContinent === continent) return null
                  return (
                    <Button
                      variant='outline'
                      size='sm'
                      className='mt-3 h-7 w-full text-xs'
                      onClick={() => onFocusContinent(continent)}
                    >
                      <Focus className='h-3 w-3' />
                      Focus {CONTINENT_LABELS[continent]}
                    </Button>
                  )
                })()}
                <Separator className='my-3 bg-white/10' />
                <p className='mb-1.5 text-[10px] font-semibold tracking-wider text-slate-400 uppercase'>
                  Connected lanes ({lanes.length})
                </p>
                <div className='max-h-44 space-y-1 overflow-y-auto pr-1'>
                  {lanes.map((lk) => {
                    const status =
                      analysis.linkHealth.get(lk.id)?.status ?? 'nominal'
                    const other = nodesById.get(
                      lk.from === node.id ? lk.to : lk.from
                    )
                    return (
                      <button
                        key={lk.id}
                        type='button'
                        onClick={() => onSelect({ type: 'link', id: lk.id })}
                        className='flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-white/5'
                      >
                        <span
                          className='h-1 w-4 shrink-0 rounded-full'
                          style={{ backgroundColor: STATUS_COLORS[status] }}
                        />
                        <span className='truncate text-slate-300'>
                          {lk.from === node.id ? '→' : '←'} {other?.name ?? '?'}
                        </span>
                        <span className='ml-auto shrink-0 text-[10px] text-slate-500'>
                          {MODE_LABELS[lk.mode]}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )
          })()
        : (() => {
            const link = network.links.find((lk) => lk.id === selection.id)
            if (!link) return null
            const health = analysis.linkHealth.get(link.id)
            const status = health?.status ?? 'nominal'
            const from = nodesById.get(link.from)
            const to = nodesById.get(link.to)
            const utilization = health?.utilization ?? 0
            return (
              <>
                <div className='mb-1 flex items-start justify-between gap-2'>
                  <div>
                    <h3 className='text-sm font-semibold text-slate-50'>
                      {from?.name} → {to?.name}
                    </h3>
                    <p className='text-xs text-slate-400'>
                      {MODE_LABELS[link.mode]} lane · {link.leadTimeDays} day
                      lead time
                    </p>
                  </div>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-6 w-6 shrink-0 text-slate-400'
                    onClick={() => onSelect(null)}
                  >
                    <X className='h-3.5 w-3.5' />
                  </Button>
                </div>
                <Badge
                  variant='outline'
                  className='mb-3 border-current text-[10px] tracking-wide uppercase'
                  style={{ color: STATUS_COLORS[status] }}
                >
                  {STATUS_LABELS[status]}
                </Badge>
                <div className='space-y-1.5'>
                  {(() => {
                    const cFrom = continentByNode.get(link.from)
                    const cTo = continentByNode.get(link.to)
                    if (!cFrom || !cTo) return null
                    return (
                      <Row
                        label='Corridor'
                        value={
                          cFrom === cTo
                            ? `Domestic · ${CONTINENT_LABELS[cFrom]}`
                            : `${CONTINENT_LABELS[cFrom]} → ${CONTINENT_LABELS[cTo]}`
                        }
                      />
                    )
                  })()}
                  <Row
                    label='Flow'
                    value={`${link.flowPerWeek.toLocaleString()} u/wk`}
                  />
                  <Row
                    label='Capacity'
                    value={`${link.capacityPerWeek.toLocaleString()} u/wk`}
                  />
                  <Row
                    label='Utilization'
                    value={
                      Number.isFinite(utilization)
                        ? `${Math.round(utilization * 100)}%`
                        : '∞ (lane closed)'
                    }
                  />
                </div>
                <div className='mt-2 h-1.5 overflow-hidden rounded-full bg-white/10'>
                  <div
                    className='h-full rounded-full transition-all'
                    style={{
                      width: `${Math.min(100, (Number.isFinite(utilization) ? utilization : 1) * 100)}%`,
                      backgroundColor: STATUS_COLORS[status],
                    }}
                  />
                </div>
                {link.disruption && (
                  <p className='mt-3 rounded-md border border-white/10 bg-white/5 p-2 text-xs leading-relaxed text-slate-300'>
                    {link.disruption.note}
                  </p>
                )}
                <Separator className='my-3 bg-white/10' />
                <p className='mb-2 text-[10px] font-semibold tracking-wider text-slate-400 uppercase'>
                  Simulate disruption
                </p>
                <div className='space-y-3'>
                  <div className='flex items-center gap-2'>
                    <Select
                      value={link.disruption?.kind ?? ''}
                      onValueChange={(kind) =>
                        onSetDisruption(link.id, {
                          kind: kind as LinkDisruption['kind'],
                          severity:
                            kind === 'closure'
                              ? 1
                              : (link.disruption?.severity ?? 0.5),
                          note:
                            link.disruption?.note ??
                            'What-if disruption (injected from the map)',
                        })
                      }
                    >
                      <SelectTrigger className='h-8 flex-1 text-xs'>
                        <SelectValue placeholder='Inject event…' />
                      </SelectTrigger>
                      <SelectContent>
                        {DISRUPTION_KINDS.map((k) => (
                          <SelectItem
                            key={k.value}
                            value={k.value}
                            className='text-xs'
                          >
                            {k.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {link.disruption && (
                      <Button
                        variant='outline'
                        size='sm'
                        className='h-8 text-xs'
                        onClick={() => onSetDisruption(link.id, null)}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  {link.disruption && link.disruption.kind !== 'closure' && (
                    <div>
                      <Label className='mb-1.5 flex justify-between text-xs text-slate-400'>
                        <span>Severity</span>
                        <span className='tabular-nums'>
                          {Math.round(link.disruption.severity * 100)}%
                        </span>
                      </Label>
                      <Slider
                        value={[link.disruption.severity * 100]}
                        min={5}
                        max={95}
                        step={5}
                        onValueChange={([v]) =>
                          onSetDisruption(link.id, {
                            ...link.disruption!,
                            severity: v / 100,
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              </>
            )
          })()}
    </div>
  )
}
