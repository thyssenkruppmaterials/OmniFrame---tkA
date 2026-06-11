// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  analyzeNetwork,
  analyzeRegion,
  deriveLinkStatus,
  effectiveCapacity,
  linkUtilization,
} from './analysis'
import { DEMO_NETWORKS } from './demo-networks'
import type {
  SupplyChainLink,
  SupplyChainNetwork,
  SupplyChainNode,
} from './types'

function link(partial: Partial<SupplyChainLink>): SupplyChainLink {
  return {
    id: 'a->b',
    from: 'a',
    to: 'b',
    mode: 'sea',
    leadTimeDays: 5,
    capacityPerWeek: 100,
    flowPerWeek: 50,
    ...partial,
  }
}

function node(id: string, tier: number): SupplyChainNode {
  return {
    id,
    name: id,
    kind: 'factory',
    tier,
    lat: 0,
    lng: 0,
    country: 'X',
    capacityPerWeek: 100,
    throughputPerWeek: 80,
  }
}

describe('effectiveCapacity / linkUtilization', () => {
  it('returns full capacity without disruption', () => {
    expect(effectiveCapacity(link({}))).toBe(100)
    expect(linkUtilization(link({}))).toBe(0.5)
  })

  it('scales capacity down for congestion and capacity_loss', () => {
    expect(
      effectiveCapacity(
        link({ disruption: { kind: 'congestion', severity: 0.4, note: '' } })
      )
    ).toBeCloseTo(60)
    expect(
      effectiveCapacity(
        link({ disruption: { kind: 'capacity_loss', severity: 1, note: '' } })
      )
    ).toBe(0)
  })

  it('treats closures as zero capacity with infinite utilization', () => {
    const closed = link({
      disruption: { kind: 'closure', severity: 1, note: '' },
    })
    expect(effectiveCapacity(closed)).toBe(0)
    expect(linkUtilization(closed)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('deriveLinkStatus', () => {
  it('is nominal at low utilization', () => {
    expect(deriveLinkStatus(link({ flowPerWeek: 40 }))).toBe('nominal')
  })

  it('is elevated above 75% utilization', () => {
    expect(deriveLinkStatus(link({ flowPerWeek: 80 }))).toBe('elevated')
  })

  it('is bottleneck above 90% utilization', () => {
    expect(deriveLinkStatus(link({ flowPerWeek: 95 }))).toBe('bottleneck')
  })

  it('is bottleneck when congestion shrinks effective capacity', () => {
    // 50/100 nominal, but congestion 0.5 → 50/50 = 100%
    expect(
      deriveLinkStatus(
        link({ disruption: { kind: 'congestion', severity: 0.5, note: '' } })
      )
    ).toBe('bottleneck')
  })

  it('is broken on closure regardless of flow', () => {
    expect(
      deriveLinkStatus(
        link({
          flowPerWeek: 1,
          disruption: { kind: 'closure', severity: 1, note: '' },
        })
      )
    ).toBe('broken')
  })
})

describe('analyzeNetwork — impact propagation', () => {
  const chain: SupplyChainNetwork = {
    id: 't',
    name: 't',
    description: '',
    product: '',
    nodes: [node('src', 0), node('mid', 1), node('dst', 2)],
    links: [
      link({ id: 'src->mid', from: 'src', to: 'mid', flowPerWeek: 50 }),
      link({
        id: 'mid->dst',
        from: 'mid',
        to: 'dst',
        flowPerWeek: 50,
        disruption: { kind: 'closure', severity: 1, note: '' },
      }),
    ],
  }

  it('starves nodes fed only by a broken lane', () => {
    const a = analyzeNetwork(chain)
    expect(a.nodeRisk.get('src')).toBe('ok')
    expect(a.nodeRisk.get('mid')).toBe('ok')
    expect(a.nodeRisk.get('dst')).toBe('starved')
    expect(a.nodeHealth.get('dst')).toBe(0)
  })

  it('keeps dual-sourced nodes alive, weighted by flow share', () => {
    const dualSourced: SupplyChainNetwork = {
      ...chain,
      nodes: [node('a', 0), node('b', 0), node('dst', 1)],
      links: [
        link({
          id: 'a->dst',
          from: 'a',
          to: 'dst',
          flowPerWeek: 50,
          disruption: { kind: 'closure', severity: 1, note: '' },
        }),
        link({ id: 'b->dst', from: 'b', to: 'dst', flowPerWeek: 50 }),
      ],
    }
    const a = analyzeNetwork(dualSourced)
    // half the inbound flow is dead → health 0.5 → at_risk
    expect(a.nodeHealth.get('dst')).toBeCloseTo(0.5)
    expect(a.nodeRisk.get('dst')).toBe('at_risk')
  })

  it('propagates degradation downstream through healthy lanes', () => {
    const threeTier: SupplyChainNetwork = {
      ...chain,
      nodes: [node('src', 0), node('mid', 1), node('dst', 2)],
      links: [
        link({
          id: 'src->mid',
          from: 'src',
          to: 'mid',
          flowPerWeek: 50,
          disruption: { kind: 'closure', severity: 1, note: '' },
        }),
        link({ id: 'mid->dst', from: 'mid', to: 'dst', flowPerWeek: 50 }),
      ],
    }
    const a = analyzeNetwork(threeTier)
    expect(a.nodeRisk.get('mid')).toBe('starved')
    // dst's only feed comes from a starved node over a healthy lane
    expect(a.nodeRisk.get('dst')).toBe('starved')
  })

  it('computes the critical path as the longest lead-time chain', () => {
    const a = analyzeNetwork(chain)
    expect(a.kpis.criticalPathDays).toBe(10) // 5 + 5
  })

  it('exposes the lanes on the critical path', () => {
    const a = analyzeNetwork(chain)
    expect([...a.criticalPathLinkIds].sort()).toEqual(['mid->dst', 'src->mid'])
  })

  it('picks the longer branch when paths compete', () => {
    const forked: SupplyChainNetwork = {
      ...chain,
      nodes: [node('a', 0), node('b', 0), node('dst', 1)],
      links: [
        link({ id: 'a->dst', from: 'a', to: 'dst', leadTimeDays: 3 }),
        link({ id: 'b->dst', from: 'b', to: 'dst', leadTimeDays: 9 }),
      ],
    }
    const a = analyzeNetwork(forked)
    expect(a.kpis.criticalPathDays).toBe(9)
    expect([...a.criticalPathLinkIds]).toEqual(['b->dst'])
  })

  it('counts flow at risk from broken + bottleneck lanes', () => {
    const a = analyzeNetwork(chain)
    // one of two equal-flow lanes is broken → 50%
    expect(a.kpis.flowAtRiskPct).toBeCloseTo(0.5)
    expect(a.kpis.brokenLinks).toBe(1)
  })

  it('survives cycles without hanging', () => {
    const cyclic: SupplyChainNetwork = {
      ...chain,
      nodes: [node('a', 0), node('b', 1)],
      links: [
        link({ id: 'a->b', from: 'a', to: 'b' }),
        link({ id: 'b->a', from: 'b', to: 'a' }),
      ],
    }
    const a = analyzeNetwork(cyclic)
    expect(a.nodeRisk.size).toBe(2)
  })
})

describe('analyzeRegion — intra-continental focus', () => {
  // Region = {a, b}; x lives outside. x→a imports, a→b is domestic,
  // b→x exports. The import lane is broken.
  const regional: SupplyChainNetwork = {
    id: 'r',
    name: 'r',
    description: '',
    product: '',
    nodes: [node('x', 0), node('a', 1), node('b', 2)],
    links: [
      link({
        id: 'x->a',
        from: 'x',
        to: 'a',
        flowPerWeek: 60,
        leadTimeDays: 20,
        disruption: { kind: 'closure', severity: 1, note: '' },
      }),
      link({
        id: 'a->b',
        from: 'a',
        to: 'b',
        flowPerWeek: 40,
        leadTimeDays: 2,
      }),
      link({
        id: 'b->x',
        from: 'b',
        to: 'x',
        flowPerWeek: 30,
        leadTimeDays: 15,
      }),
    ],
  }
  const members = new Set(['a', 'b'])

  it('partitions lanes into intra / import / export', () => {
    const a = analyzeNetwork(regional)
    const r = analyzeRegion(regional, a, members)
    expect(r.kpis.nodeCount).toBe(2)
    expect(r.kpis.intraLinkCount).toBe(1)
    expect(r.kpis.importLaneCount).toBe(1)
    expect(r.kpis.exportLaneCount).toBe(1)
    expect(r.kpis.importFlowPerWeek).toBe(60)
    expect(r.kpis.exportFlowPerWeek).toBe(30)
  })

  it('measures import dependency and import risk', () => {
    const a = analyzeNetwork(regional)
    const r = analyzeRegion(regional, a, members)
    // 60 of 100 units arriving at region sites cross the border
    expect(r.kpis.importDependencyPct).toBeCloseTo(0.6)
    // the only import lane is broken
    expect(r.kpis.importFlowAtRiskPct).toBe(1)
    // the domestic lane itself is healthy
    expect(r.kpis.intraFlowAtRiskPct).toBe(0)
  })

  it('keeps globally-propagated node risk inside the region', () => {
    const a = analyzeNetwork(regional)
    const r = analyzeRegion(regional, a, members)
    // a is fed only by the broken import → starved, and that starvation
    // flows through to b even though both sit inside the region
    expect(a.nodeRisk.get('a')).toBe('starved')
    expect(r.kpis.nodesStarved).toBe(2)
  })

  it('computes the critical path over intra lanes only', () => {
    const a = analyzeNetwork(regional)
    const r = analyzeRegion(regional, a, members)
    expect(r.kpis.criticalPathDays).toBe(2) // a->b only; border lanes excluded
    expect([...r.criticalPathLinkIds]).toEqual(['a->b'])
  })

  it('handles a region with no imports', () => {
    const domestic: SupplyChainNetwork = {
      ...regional,
      nodes: [node('a', 0), node('b', 1)],
      links: [link({ id: 'a->b', from: 'a', to: 'b', flowPerWeek: 40 })],
    }
    const a = analyzeNetwork(domestic)
    const r = analyzeRegion(domestic, a, new Set(['a', 'b']))
    expect(r.kpis.importDependencyPct).toBe(0)
    expect(r.kpis.importFlowAtRiskPct).toBe(0)
  })
})

describe('demo networks', () => {
  it.each(DEMO_NETWORKS.map((d) => [d.id, d] as const))(
    '%s has consistent node references and analyzable topology',
    (_id, network) => {
      const ids = new Set(network.nodes.map((n) => n.id))
      expect(ids.size).toBe(network.nodes.length) // no duplicate ids
      for (const lk of network.links) {
        expect(ids.has(lk.from), `missing from-node ${lk.from}`).toBe(true)
        expect(ids.has(lk.to), `missing to-node ${lk.to}`).toBe(true)
        expect(lk.from).not.toBe(lk.to)
      }
      const a = analyzeNetwork(network)
      expect(a.kpis.nodeCount).toBe(network.nodes.length)
      expect(a.kpis.criticalPathDays).toBeGreaterThan(0)
      // every scenario ships with at least one visible problem
      expect(a.kpis.brokenLinks + a.kpis.bottleneckLinks).toBeGreaterThan(0)
    }
  )
})
