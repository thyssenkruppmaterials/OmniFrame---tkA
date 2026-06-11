// Created and developed by Jai Singh
import type { NetworkKpis, RegionKpis } from '../data/types'

interface KpiChip {
  label: string
  value: string
  tone?: 'ok' | 'warn' | 'bad'
}

const TONE_CLASS: Record<NonNullable<KpiChip['tone']>, string> = {
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-rose-400',
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function riskTone(value: number): KpiChip['tone'] {
  return value > 0.25 ? 'bad' : value > 0.08 ? 'warn' : 'ok'
}

function globalChips(kpis: NetworkKpis): KpiChip[] {
  return [
    { label: 'Nodes', value: String(kpis.nodeCount) },
    { label: 'Lanes', value: String(kpis.linkCount) },
    {
      label: 'Broken',
      value: String(kpis.brokenLinks),
      tone: kpis.brokenLinks > 0 ? 'bad' : 'ok',
    },
    {
      label: 'Bottlenecks',
      value: String(kpis.bottleneckLinks),
      tone: kpis.bottleneckLinks > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Flow at risk',
      value: pct(kpis.flowAtRiskPct),
      tone: riskTone(kpis.flowAtRiskPct),
    },
    {
      label: 'Avg utilization',
      value: pct(kpis.avgUtilization),
      tone: kpis.avgUtilization > 0.85 ? 'warn' : undefined,
    },
    { label: 'Critical path', value: `${kpis.criticalPathDays}d` },
    {
      label: 'Sites at risk',
      value: String(kpis.nodesAtRisk + kpis.nodesStarved),
      tone:
        kpis.nodesStarved > 0 ? 'bad' : kpis.nodesAtRisk > 0 ? 'warn' : 'ok',
    },
  ]
}

/** Region focus chips — the intra-continental story: domestic lane health
 *  plus how exposed the region is to supply crossing its border. */
function regionChips(kpis: RegionKpis): KpiChip[] {
  return [
    { label: 'Sites', value: String(kpis.nodeCount) },
    { label: 'Domestic lanes', value: String(kpis.intraLinkCount) },
    {
      label: 'Broken',
      value: String(kpis.intraBroken),
      tone: kpis.intraBroken > 0 ? 'bad' : 'ok',
    },
    {
      label: 'Bottlenecks',
      value: String(kpis.intraBottleneck),
      tone: kpis.intraBottleneck > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Flow at risk',
      value: pct(kpis.intraFlowAtRiskPct),
      tone: riskTone(kpis.intraFlowAtRiskPct),
    },
    {
      label: 'Import reliance',
      value: pct(kpis.importDependencyPct),
      tone:
        kpis.importDependencyPct > 0.75
          ? 'bad'
          : kpis.importDependencyPct > 0.5
            ? 'warn'
            : undefined,
    },
    {
      label: 'Imports at risk',
      value: kpis.importLaneCount > 0 ? pct(kpis.importFlowAtRiskPct) : '—',
      tone:
        kpis.importLaneCount > 0
          ? riskTone(kpis.importFlowAtRiskPct)
          : undefined,
    },
    {
      label: 'Export lanes',
      value: String(kpis.exportLaneCount),
    },
    { label: 'Critical path', value: `${kpis.criticalPathDays}d` },
    {
      label: 'Sites at risk',
      value: String(kpis.nodesAtRisk + kpis.nodesStarved),
      tone:
        kpis.nodesStarved > 0 ? 'bad' : kpis.nodesAtRisk > 0 ? 'warn' : 'ok',
    },
  ]
}

export function KpiBar({
  kpis,
  regionKpis,
}: {
  kpis: NetworkKpis
  /** When set, the bar tells the region's domestic story instead. */
  regionKpis?: RegionKpis | null
}) {
  const chips = regionKpis ? regionChips(regionKpis) : globalChips(kpis)

  return (
    <div className='pointer-events-auto flex flex-wrap gap-2'>
      {chips.map((chip) => (
        <div
          key={chip.label}
          className='flex items-baseline gap-1.5 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-1.5 shadow-lg backdrop-blur-md'
        >
          <span className='text-[10px] font-medium tracking-wider text-slate-400 uppercase'>
            {chip.label}
          </span>
          <span
            className={`text-sm font-semibold tabular-nums ${chip.tone ? TONE_CLASS[chip.tone] : 'text-slate-100'}`}
          >
            {chip.value}
          </span>
        </div>
      ))}
    </div>
  )
}
