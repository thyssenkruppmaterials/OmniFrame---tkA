// Created and developed by Jai Singh
// Ranked alert feed: broken / bottleneck / elevated lanes and starved /
// at-risk sites, worst first. Clicking an alert selects it on the globe
// (the inspector opens alongside). In region focus the feed narrows to
// alerts touching the focused continent.
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, TriangleAlert } from 'lucide-react'
import type {
  MapSelection,
  NetworkAnalysis,
  SupplyChainNetwork,
} from '../data/types'
import {
  MODE_LABELS,
  RISK_COLORS,
  RISK_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
} from '../palette'

interface AlertEntry {
  key: string
  selection: Exclude<MapSelection, null>
  /** Higher = worse; ties broken by flow volume. */
  rank: number
  flow: number
  color: string
  title: string
  subtitle: string
  note?: string
}

const LANE_RANK = { broken: 6, bottleneck: 4, elevated: 2 } as const
const NODE_RANK = { starved: 5, at_risk: 3 } as const

interface AlertsPanelProps {
  network: SupplyChainNetwork
  analysis: NetworkAnalysis
  /** When region-focused, only alerts touching these nodes are shown. */
  focusNodeIds: Set<string> | null
  selection: MapSelection
  onSelect: (selection: MapSelection) => void
}

export function AlertsPanel({
  network,
  analysis,
  focusNodeIds,
  selection,
  onSelect,
}: AlertsPanelProps) {
  const [open, setOpen] = useState(true)

  const alerts = useMemo(() => {
    const nodesById = new Map(network.nodes.map((n) => [n.id, n]))
    const entries: AlertEntry[] = []

    for (const link of network.links) {
      const status = analysis.linkHealth.get(link.id)?.status ?? 'nominal'
      if (!(status in LANE_RANK)) continue
      if (
        focusNodeIds &&
        !focusNodeIds.has(link.from) &&
        !focusNodeIds.has(link.to)
      ) {
        continue
      }
      const from = nodesById.get(link.from)
      const to = nodesById.get(link.to)
      entries.push({
        key: `link:${link.id}`,
        selection: { type: 'link', id: link.id },
        rank: LANE_RANK[status as keyof typeof LANE_RANK],
        flow: link.flowPerWeek,
        color: STATUS_COLORS[status],
        title: `${from?.name ?? link.from} → ${to?.name ?? link.to}`,
        subtitle: `${STATUS_LABELS[status]} · ${MODE_LABELS[link.mode]} · ${link.flowPerWeek.toLocaleString()} u/wk`,
        note: link.disruption?.note,
      })
    }

    for (const node of network.nodes) {
      const risk = analysis.nodeRisk.get(node.id) ?? 'ok'
      if (!(risk in NODE_RANK)) continue
      if (focusNodeIds && !focusNodeIds.has(node.id)) continue
      const health = analysis.nodeHealth.get(node.id) ?? 1
      entries.push({
        key: `node:${node.id}`,
        selection: { type: 'node', id: node.id },
        rank: NODE_RANK[risk as keyof typeof NODE_RANK],
        flow: node.throughputPerWeek,
        color: RISK_COLORS[risk],
        title: node.name,
        subtitle: `${RISK_LABELS[risk]} site · supply health ${Math.round(health * 100)}%`,
      })
    }

    return entries.sort((a, b) => b.rank - a.rank || b.flow - a.flow)
  }, [network, analysis, focusNodeIds])

  return (
    <div className='pointer-events-auto w-72 rounded-xl border border-white/10 bg-slate-950/70 shadow-xl backdrop-blur-md'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        className='flex w-full items-center gap-2 p-3 text-left'
      >
        <TriangleAlert
          className={`h-3.5 w-3.5 ${alerts.length ? 'text-amber-300' : 'text-slate-500'}`}
        />
        <span className='text-[10px] font-semibold tracking-wider text-slate-400 uppercase'>
          Alerts
        </span>
        <span className='rounded-full bg-white/10 px-1.5 text-[10px] font-semibold text-slate-200 tabular-nums'>
          {alerts.length}
        </span>
        {open ? (
          <ChevronUp className='ml-auto h-3.5 w-3.5 text-slate-500' />
        ) : (
          <ChevronDown className='ml-auto h-3.5 w-3.5 text-slate-500' />
        )}
      </button>
      {open && (
        <div className='max-h-64 space-y-1 overflow-y-auto px-2 pb-2'>
          {alerts.length === 0 && (
            <p className='px-1.5 pb-1 text-xs text-slate-500'>
              No active alerts{focusNodeIds ? ' in this region' : ''}.
            </p>
          )}
          {alerts.map((alert) => {
            const active =
              selection?.type === alert.selection.type &&
              selection.id === alert.selection.id
            return (
              <button
                key={alert.key}
                type='button'
                onClick={() => onSelect(alert.selection)}
                className={`flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-white/5 ${active ? 'bg-white/10' : ''}`}
              >
                <span
                  className='mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full'
                  style={{
                    backgroundColor: alert.color,
                    boxShadow: `0 0 6px ${alert.color}`,
                  }}
                />
                <span className='min-w-0'>
                  <span className='block truncate text-xs font-medium text-slate-100'>
                    {alert.title}
                  </span>
                  <span className='block truncate text-[10px] text-slate-400'>
                    {alert.subtitle}
                  </span>
                  {alert.note && (
                    <span className='block truncate text-[10px] text-slate-500 italic'>
                      {alert.note}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
