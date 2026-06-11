// Created and developed by Jai Singh

/** Physical role a node plays in the chain. Drives marker shape + color. */
export type NodeKind =
  | 'source' // mines, farms, raw material origins
  | 'supplier' // component / sub-assembly suppliers
  | 'factory' // final assembly / manufacturing
  | 'port' // sea ports
  | 'airport' // air freight hubs
  | 'distribution_center'
  | 'warehouse'
  | 'market' // retail / end-customer demand region

export type TransportMode = 'sea' | 'air' | 'road' | 'rail'

/** Derived health of a lane. Drives the light-wave color. */
export type LinkStatus = 'nominal' | 'elevated' | 'bottleneck' | 'broken'

/** Derived health of a node after impact propagation. */
export type NodeRisk = 'ok' | 'watch' | 'at_risk' | 'starved'

export interface LinkDisruption {
  kind: 'closure' | 'congestion' | 'capacity_loss' | 'quality_hold'
  /** 0..1 — how much of the lane is affected. >= 0.9 closure ≈ broken. */
  severity: number
  note: string
}

export interface SupplyChainNode {
  id: string
  name: string
  kind: NodeKind
  /** 0 = furthest upstream; increases downstream. Layout + propagation order. */
  tier: number
  lat: number
  lng: number
  country: string
  /** Units/week the node can process. */
  capacityPerWeek: number
  /** Units/week currently flowing through. */
  throughputPerWeek: number
  inventoryDaysOfSupply?: number
}

export interface SupplyChainLink {
  id: string
  from: string
  to: string
  mode: TransportMode
  leadTimeDays: number
  capacityPerWeek: number
  flowPerWeek: number
  disruption?: LinkDisruption
}

export interface SupplyChainNetwork {
  id: string
  name: string
  description: string
  product: string
  nodes: SupplyChainNode[]
  links: SupplyChainLink[]
}

export type MapSelection = { type: 'node' | 'link'; id: string } | null

export interface LinkHealth {
  status: LinkStatus
  /** flow / effective capacity, 0..1+ (can exceed 1 when over-subscribed). */
  utilization: number
}

export interface NetworkKpis {
  nodeCount: number
  linkCount: number
  brokenLinks: number
  bottleneckLinks: number
  elevatedLinks: number
  /** Share (0..1) of total network flow riding broken/bottleneck lanes. */
  flowAtRiskPct: number
  /** Flow-weighted mean lane utilization, 0..1+. */
  avgUtilization: number
  /** Longest cumulative lead time source → market (the chain's critical path). */
  criticalPathDays: number
  nodesAtRisk: number
  nodesStarved: number
}

export interface NetworkAnalysis {
  linkHealth: Map<string, LinkHealth>
  nodeRisk: Map<string, NodeRisk>
  /** 0..1 supply health per node after upstream impact propagation. */
  nodeHealth: Map<string, number>
  /** Lane ids making up the longest lead-time chain (the critical path). */
  criticalPathLinkIds: Set<string>
  kpis: NetworkKpis
}

/** KPIs for a region (continent) focus — the intra-continental view. */
export interface RegionKpis {
  nodeCount: number
  intraLinkCount: number
  intraBroken: number
  intraBottleneck: number
  intraElevated: number
  /** Share (0..1) of intra-region flow riding broken/bottleneck lanes. */
  intraFlowAtRiskPct: number
  importLaneCount: number
  importFlowPerWeek: number
  /** Share (0..1) of inbound cross-region flow on broken/bottleneck lanes. */
  importFlowAtRiskPct: number
  exportLaneCount: number
  exportFlowPerWeek: number
  /** Share (0..1) of all flow arriving at region sites that crosses in
   *  from outside — how exposed the region is to external supply. */
  importDependencyPct: number
  /** Longest lead-time chain using intra-region lanes only. */
  criticalPathDays: number
  nodesAtRisk: number
  nodesStarved: number
}

export interface RegionAnalysis {
  kpis: RegionKpis
  /** Critical path computed over the region's internal lanes only. */
  criticalPathLinkIds: Set<string>
}
