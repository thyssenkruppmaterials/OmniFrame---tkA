// Created and developed by Jai Singh
// Shared color tokens for the supply-chain map — consumed by both the DOM
// HUD (CSS) and the 3D scene (three Color uniforms), so the legend always
// matches the glass.
import type {
  LinkStatus,
  NodeKind,
  NodeRisk,
  TransportMode,
} from './data/types'

/** Lane light-wave colors by derived status. */
export const STATUS_COLORS: Record<LinkStatus, string> = {
  nominal: '#2bd9ff', // cool cyan — flow is healthy
  elevated: '#ffc53d', // amber — running hot
  bottleneck: '#ff7a1a', // ember orange — pinch point
  broken: '#ff3b4d', // red — lane down
}

export const STATUS_LABELS: Record<LinkStatus, string> = {
  nominal: 'Nominal',
  elevated: 'Elevated',
  bottleneck: 'Bottleneck',
  broken: 'Broken',
}

/** Node halo colors by propagated risk. */
export const RISK_COLORS: Record<NodeRisk, string> = {
  ok: '#3ae6a8',
  watch: '#ffc53d',
  at_risk: '#ff7a1a',
  starved: '#ff3b4d',
}

export const RISK_LABELS: Record<NodeRisk, string> = {
  ok: 'Healthy',
  watch: 'Watch',
  at_risk: 'At risk',
  starved: 'Starved',
}

export const KIND_LABELS: Record<NodeKind, string> = {
  source: 'Raw material source',
  supplier: 'Supplier',
  factory: 'Factory',
  port: 'Sea port',
  airport: 'Air hub',
  distribution_center: 'Distribution center',
  warehouse: 'Warehouse',
  market: 'Demand market',
}

/** Accent used for the node base disc, by what the node *is*. */
export const KIND_COLORS: Record<NodeKind, string> = {
  source: '#a78bfa',
  supplier: '#7dd3fc',
  factory: '#f0abfc',
  port: '#5eead4',
  airport: '#93c5fd',
  distribution_center: '#fcd34d',
  warehouse: '#fdba74',
  market: '#86efac',
}

export const MODE_LABELS: Record<TransportMode, string> = {
  sea: 'Ocean',
  air: 'Air',
  road: 'Road',
  rail: 'Rail',
}

/** Visual treatment of the lane lights — switchable live from the HUD. */
export type LaneStyle = 'pulse' | 'beam' | 'dash' | 'wave' | 'aurora'

export const LANE_STYLE_LABELS: Record<LaneStyle, string> = {
  pulse: 'Light waves',
  beam: 'Laser beams',
  dash: 'Energy dashes',
  wave: 'Ripple waves',
  aurora: 'Aurora flow',
}

/** Index handed to the lane shader's uStyle uniform. */
export const LANE_STYLE_INDEX: Record<LaneStyle, number> = {
  pulse: 0,
  beam: 1,
  dash: 2,
  wave: 3,
  aurora: 4,
}

/** Scene "command center" base palette. */
export const SCENE = {
  background: '#030714',
  globeBase: '#0b1430',
  globeRim: '#3450c8',
  atmosphere: '#3b6fff',
  landDot: '#5871c9',
  graticule: '#16224d',
  star: '#cdd8ff',
} as const
