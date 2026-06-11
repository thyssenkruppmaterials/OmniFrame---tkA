// Created and developed by Jai Singh
// Pure graph analysis for supply-chain networks — no three.js / React imports
// so it stays unit-testable and reusable outside the 3D scene.
import type {
  LinkHealth,
  LinkStatus,
  NetworkAnalysis,
  NodeRisk,
  RegionAnalysis,
  SupplyChainLink,
  SupplyChainNetwork,
  SupplyChainNode,
} from './types'

/** Capacity remaining after a capacity_loss/congestion disruption. */
export function effectiveCapacity(link: SupplyChainLink): number {
  const d = link.disruption
  if (!d) return link.capacityPerWeek
  if (d.kind === 'closure') return 0
  if (d.kind === 'capacity_loss' || d.kind === 'congestion') {
    return link.capacityPerWeek * Math.max(0, 1 - d.severity)
  }
  return link.capacityPerWeek
}

export function linkUtilization(link: SupplyChainLink): number {
  const cap = effectiveCapacity(link)
  if (cap <= 0) return link.flowPerWeek > 0 ? Number.POSITIVE_INFINITY : 0
  return link.flowPerWeek / cap
}

const BOTTLENECK_UTILIZATION = 0.9
const ELEVATED_UTILIZATION = 0.75

export function deriveLinkStatus(link: SupplyChainLink): LinkStatus {
  const d = link.disruption
  if (d && (d.kind === 'closure' || d.severity >= 0.9)) return 'broken'
  const utilization = linkUtilization(link)
  if (utilization >= BOTTLENECK_UTILIZATION) return 'bottleneck'
  if (d && d.kind === 'quality_hold') return 'bottleneck'
  if (utilization >= ELEVATED_UTILIZATION || (d && d.severity >= 0.3)) {
    return 'elevated'
  }
  return 'nominal'
}

/** How much of a lane's supply actually gets through, by status. */
const STATUS_PASS_FACTOR: Record<LinkStatus, number> = {
  nominal: 1,
  elevated: 0.85,
  bottleneck: 0.55,
  broken: 0,
}

function riskFromHealth(health: number): NodeRisk {
  if (health >= 0.9) return 'ok'
  if (health >= 0.7) return 'watch'
  if (health >= 0.4) return 'at_risk'
  return 'starved'
}

interface FlowGraph {
  inbound: Map<string, SupplyChainLink[]>
  outbound: Map<string, SupplyChainLink[]>
  /** Kahn topological order; cycle remainder appended in input order. */
  topo: string[]
}

function buildFlowGraph(
  nodes: SupplyChainNode[],
  links: SupplyChainLink[]
): FlowGraph {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const inbound = new Map<string, SupplyChainLink[]>()
  const outbound = new Map<string, SupplyChainLink[]>()
  for (const link of links) {
    if (!nodeIds.has(link.from) || !nodeIds.has(link.to)) continue
    inbound.set(link.to, [...(inbound.get(link.to) ?? []), link])
    outbound.set(link.from, [...(outbound.get(link.from) ?? []), link])
  }

  const inDegree = new Map<string, number>()
  for (const n of nodes) {
    inDegree.set(n.id, inbound.get(n.id)?.length ?? 0)
  }
  const queue = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id)
  const topo: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    topo.push(id)
    for (const link of outbound.get(id) ?? []) {
      const remaining = (inDegree.get(link.to) ?? 0) - 1
      inDegree.set(link.to, remaining)
      if (remaining === 0) queue.push(link.to)
    }
  }
  // Cycle fallback: append any unvisited nodes (processed with defaults)
  for (const n of nodes) {
    if (!topo.includes(n.id)) topo.push(n.id)
  }
  return { inbound, outbound, topo }
}

/**
 * Longest cumulative lead-time chain over the (topologically ordered)
 * graph, with the actual lanes on that chain so the UI can spotlight it.
 */
function longestLeadPath(graph: FlowGraph): {
  days: number
  linkIds: Set<string>
} {
  const pathDays = new Map<string, number>()
  const bestFeed = new Map<string, SupplyChainLink>()
  let bestDays = 0
  let bestEnd: string | null = null
  for (const id of graph.topo) {
    let best = 0
    let bestLink: SupplyChainLink | undefined
    for (const link of graph.inbound.get(id) ?? []) {
      const candidate = (pathDays.get(link.from) ?? 0) + link.leadTimeDays
      if (candidate > best) {
        best = candidate
        bestLink = link
      }
    }
    pathDays.set(id, best)
    if (bestLink) bestFeed.set(id, bestLink)
    if (best > bestDays) {
      bestDays = best
      bestEnd = id
    }
  }
  // Walk predecessors back to the source (the seen-guard halts on cycles)
  const linkIds = new Set<string>()
  let cursor = bestEnd
  while (cursor) {
    const feed = bestFeed.get(cursor)
    if (!feed || linkIds.has(feed.id)) break
    linkIds.add(feed.id)
    cursor = feed.from
  }
  return { days: bestDays, linkIds }
}

/**
 * Full network analysis: per-lane health, downstream impact propagation
 * (a broken lane starves everything fed by it, weighted by flow share),
 * and headline KPIs. Propagates in topological order (Kahn); any cycle
 * remainder is processed with the healths known at that point.
 */
export function analyzeNetwork(network: SupplyChainNetwork): NetworkAnalysis {
  const linkHealth = new Map<string, LinkHealth>()
  for (const link of network.links) {
    linkHealth.set(link.id, {
      status: deriveLinkStatus(link),
      utilization: linkUtilization(link),
    })
  }

  const graph = buildFlowGraph(network.nodes, network.links)
  const { inbound, topo } = graph

  const nodeHealth = new Map<string, number>()
  for (const id of topo) {
    const feeds = inbound.get(id) ?? []
    if (feeds.length === 0) {
      nodeHealth.set(id, 1)
      continue
    }
    const totalFlow = feeds.reduce((s, l) => s + l.flowPerWeek, 0)
    if (totalFlow <= 0) {
      nodeHealth.set(id, 1)
      continue
    }
    let health = 0
    for (const link of feeds) {
      const srcHealth = nodeHealth.get(link.from) ?? 1
      const pass = STATUS_PASS_FACTOR[linkHealth.get(link.id)!.status]
      health += (link.flowPerWeek / totalFlow) * srcHealth * pass
    }
    nodeHealth.set(id, health)
  }

  const nodeRisk = new Map<string, NodeRisk>()
  for (const n of network.nodes) {
    nodeRisk.set(n.id, riskFromHealth(nodeHealth.get(n.id) ?? 1))
  }

  // Critical path: longest cumulative lead time over the DAG
  const criticalPath = longestLeadPath(graph)

  let brokenLinks = 0
  let bottleneckLinks = 0
  let elevatedLinks = 0
  let flowAtRisk = 0
  let totalFlow = 0
  let utilizationWeighted = 0
  for (const link of network.links) {
    const health = linkHealth.get(link.id)!
    totalFlow += link.flowPerWeek
    if (health.status === 'broken') {
      brokenLinks++
      flowAtRisk += link.flowPerWeek
    } else if (health.status === 'bottleneck') {
      bottleneckLinks++
      flowAtRisk += link.flowPerWeek
    } else if (health.status === 'elevated') {
      elevatedLinks++
    }
    utilizationWeighted +=
      link.flowPerWeek *
      Math.min(2, Number.isFinite(health.utilization) ? health.utilization : 2)
  }

  const risks = [...nodeRisk.values()]
  return {
    linkHealth,
    nodeRisk,
    nodeHealth,
    criticalPathLinkIds: criticalPath.linkIds,
    kpis: {
      nodeCount: network.nodes.length,
      linkCount: network.links.length,
      brokenLinks,
      bottleneckLinks,
      elevatedLinks,
      flowAtRiskPct: totalFlow > 0 ? flowAtRisk / totalFlow : 0,
      avgUtilization: totalFlow > 0 ? utilizationWeighted / totalFlow : 0,
      criticalPathDays: criticalPath.days,
      nodesAtRisk: risks.filter((r) => r === 'at_risk').length,
      nodesStarved: risks.filter((r) => r === 'starved').length,
    },
  }
}

const AT_RISK_STATUSES: ReadonlySet<LinkStatus> = new Set([
  'broken',
  'bottleneck',
])

/**
 * Region (continent) focus analysis over an already-analyzed network.
 * `memberIds` is the set of node ids inside the region. Lanes partition
 * into intra (both ends inside), imports (into the region) and exports
 * (out of it); node risk stays the GLOBAL propagation so a site starved
 * by an upstream break on another continent still reads starved here.
 */
export function analyzeRegion(
  network: SupplyChainNetwork,
  analysis: NetworkAnalysis,
  memberIds: Set<string>
): RegionAnalysis {
  const intraLinks: SupplyChainLink[] = []
  let intraBroken = 0
  let intraBottleneck = 0
  let intraElevated = 0
  let intraFlow = 0
  let intraFlowAtRisk = 0
  let importLaneCount = 0
  let importFlow = 0
  let importFlowAtRisk = 0
  let exportLaneCount = 0
  let exportFlow = 0

  for (const link of network.links) {
    const fromIn = memberIds.has(link.from)
    const toIn = memberIds.has(link.to)
    if (!fromIn && !toIn) continue
    const status = analysis.linkHealth.get(link.id)?.status ?? 'nominal'
    const atRisk = AT_RISK_STATUSES.has(status)
    if (fromIn && toIn) {
      intraLinks.push(link)
      intraFlow += link.flowPerWeek
      if (atRisk) intraFlowAtRisk += link.flowPerWeek
      if (status === 'broken') intraBroken++
      else if (status === 'bottleneck') intraBottleneck++
      else if (status === 'elevated') intraElevated++
    } else if (toIn) {
      importLaneCount++
      importFlow += link.flowPerWeek
      if (atRisk) importFlowAtRisk += link.flowPerWeek
    } else {
      exportLaneCount++
      exportFlow += link.flowPerWeek
    }
  }

  const members = network.nodes.filter((n) => memberIds.has(n.id))
  const criticalPath = longestLeadPath(buildFlowGraph(members, intraLinks))

  let nodesAtRisk = 0
  let nodesStarved = 0
  for (const n of members) {
    const risk = analysis.nodeRisk.get(n.id)
    if (risk === 'at_risk') nodesAtRisk++
    else if (risk === 'starved') nodesStarved++
  }

  const inboundTotal = importFlow + intraFlow
  return {
    criticalPathLinkIds: criticalPath.linkIds,
    kpis: {
      nodeCount: members.length,
      intraLinkCount: intraLinks.length,
      intraBroken,
      intraBottleneck,
      intraElevated,
      intraFlowAtRiskPct: intraFlow > 0 ? intraFlowAtRisk / intraFlow : 0,
      importLaneCount,
      importFlowPerWeek: importFlow,
      importFlowAtRiskPct: importFlow > 0 ? importFlowAtRisk / importFlow : 0,
      exportLaneCount,
      exportFlowPerWeek: exportFlow,
      importDependencyPct: inboundTotal > 0 ? importFlow / inboundTotal : 0,
      criticalPathDays: criticalPath.days,
      nodesAtRisk,
      nodesStarved,
    },
  }
}
