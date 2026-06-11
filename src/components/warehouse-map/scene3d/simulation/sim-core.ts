// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Simulation core — pure pick-scenario math (no React, no three.js).
// ---------------------------------------------------------------------------
// Drives the "live scenario" mode of the 3D warehouse: virtual pickers walk
// real pick tours (computed by the existing `get_pick_tour` A* RPC over the
// aisle graph) at configurable speeds, dwell at each bin, and accumulate
// congestion heat over the floor. Everything works in PERSISTED WORLD UNITS
// (~cm) and seconds so it is directly testable; the render layer converts at
// the edges (× WORLD_SCALE), exactly like build-mode.ts.
import type { PickTourLeg, Point2D } from '../../types'

// ---- Paths -------------------------------------------------------------------

/** A polyline parameterised by cumulative arc length (world units). */
export interface SimPath {
  points: Point2D[]
  /** Cumulative distance from the start to points[i]. cum[0] = 0. */
  cum: number[]
  /** Total path length. */
  total: number
}

export function buildPath(points: Point2D[]): SimPath {
  const cum: number[] = []
  let total = 0
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const dx = points[i].x - points[i - 1].x
      const dy = points[i].y - points[i - 1].y
      total += Math.hypot(dx, dy)
    }
    cum.push(total)
  }
  return { points, cum, total }
}

export interface PathSample {
  x: number
  y: number
  /** Marker yaw in degrees: rotationY = heading · π/180 points +x along travel. */
  headingDeg: number
}

/** Position + travel heading at a distance along the path (clamped). */
export function samplePath(path: SimPath, dist: number): PathSample {
  const pts = path.points
  if (pts.length === 0) return { x: 0, y: 0, headingDeg: 0 }
  if (pts.length === 1 || dist <= 0)
    return { x: pts[0].x, y: pts[0].y, headingDeg: 0 }
  const d = Math.min(dist, path.total)
  let i = 1
  while (i < pts.length - 1 && path.cum[i] < d) i++
  // Walk back over zero-length joints so heading stays defined.
  let j = i
  while (j > 1 && path.cum[j] === path.cum[j - 1]) j--
  const a = pts[j - 1]
  const b = pts[j]
  const segLen = path.cum[j] - path.cum[j - 1]
  const t = segLen > 0 ? (d - path.cum[j - 1]) / segLen : 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  return {
    x: a.x + dx * t,
    y: a.y + dy * t,
    // + 0 normalises atan2's -0 (straight +x travel) to plain 0.
    headingDeg: segLen > 0 ? (Math.atan2(-dy, dx) * 180) / Math.PI + 0 : 0,
  }
}

// ---- Tours -------------------------------------------------------------------

export interface TourStop {
  bin: string
  /** Distance along the tour path where the agent stops to pick. */
  distance: number
}

/**
 * Concatenate a pick tour's legs into one path + the stop distance for each
 * bin (the end of every leg). Duplicate joint points between legs are skipped
 * so segment math never divides by zero.
 */
export function buildTour(
  legs: PickTourLeg[]
): { path: SimPath; stops: TourStop[] } | null {
  const points: Point2D[] = []
  const stopAtIndex: { bin: string; index: number }[] = []
  for (const leg of legs) {
    for (const p of leg.polyline ?? []) {
      const last = points[points.length - 1]
      if (!last || last.x !== p.x || last.y !== p.y)
        points.push({ x: p.x, y: p.y })
    }
    if (points.length > 0)
      stopAtIndex.push({ bin: leg.to_bin, index: points.length - 1 })
  }
  if (points.length < 2) return null
  const path = buildPath(points)
  return {
    path,
    stops: stopAtIndex.map((s) => ({
      bin: s.bin,
      distance: path.cum[s.index],
    })),
  }
}

// ---- Agents ------------------------------------------------------------------

export type SimAgentState = 'walking' | 'picking' | 'done'

export interface SimAgent {
  id: string
  name: string
  color: string
  path: SimPath
  stops: TourStop[]
  /** Walk speed, world units per second. */
  speed: number
  /** Dwell per pick, seconds. */
  pickSeconds: number
  // ---- live state (mutated by tickAgent for per-frame perf) ----
  state: SimAgentState
  distance: number
  elapsed: number
  dwell: number
  stopIndex: number
  picksDone: number
  x: number
  y: number
  headingDeg: number
}

export function createAgent(input: {
  id: string
  name: string
  color: string
  path: SimPath
  stops: TourStop[]
  speedMps: number
  pickSeconds: number
}): SimAgent {
  const start = samplePath(input.path, 0)
  return {
    id: input.id,
    name: input.name,
    color: input.color,
    path: input.path,
    stops: input.stops,
    speed: input.speedMps * 100, // m/s → world units/s
    pickSeconds: input.pickSeconds,
    state: 'walking',
    distance: 0,
    elapsed: 0,
    dwell: 0,
    stopIndex: 0,
    picksDone: 0,
    x: start.x,
    y: start.y,
    headingDeg: start.headingDeg,
  }
}

/**
 * Advance one agent by dt seconds (mutates in place — this runs every frame
 * for every agent). Walking consumes distance up to the next stop, picking
 * burns dwell, leftover time rolls into the next phase so KPI math stays
 * exact regardless of frame rate.
 */
export function tickAgent(agent: SimAgent, dt: number): void {
  let remaining = dt
  while (remaining > 0 && agent.state !== 'done') {
    agent.elapsed += remaining
    if (agent.state === 'picking') {
      if (agent.dwell > remaining) {
        agent.dwell -= remaining
        remaining = 0
      } else {
        agent.elapsed -= remaining - agent.dwell
        remaining -= agent.dwell
        agent.dwell = 0
        agent.picksDone += 1
        agent.stopIndex += 1
        agent.state =
          agent.stopIndex >= agent.stops.length &&
          agent.distance >= agent.path.total
            ? 'done'
            : 'walking'
      }
      continue
    }
    // walking
    const target =
      agent.stopIndex < agent.stops.length
        ? agent.stops[agent.stopIndex].distance
        : agent.path.total
    const gap = target - agent.distance
    const step = agent.speed * remaining
    if (step < gap) {
      agent.distance += step
      remaining = 0
    } else {
      const used = agent.speed > 0 ? gap / agent.speed : remaining
      agent.elapsed -= remaining - used
      remaining -= used
      agent.distance = target
      if (agent.stopIndex < agent.stops.length) {
        agent.state = 'picking'
        agent.dwell = agent.pickSeconds
      } else {
        agent.state = 'done'
      }
    }
  }
  const s = samplePath(agent.path, agent.distance)
  agent.x = s.x
  agent.y = s.y
  if (agent.state === 'walking') agent.headingDeg = s.headingDeg
}

// ---- Scenario KPIs -----------------------------------------------------------

export interface ScenarioKpis {
  totalPicks: number
  targetPicks: number
  /** Sum of walked distance across agents, meters. */
  totalDistanceM: number
  /** Walked meters per completed pick (0 until the first pick lands). */
  metersPerPick: number
  /** Completed picks per labour hour at the current pace. */
  picksPerHour: number
  done: boolean
}

export function scenarioKpis(
  agents: SimAgent[],
  clockSeconds: number
): ScenarioKpis {
  const totalPicks = agents.reduce((s, a) => s + a.picksDone, 0)
  const targetPicks = agents.reduce((s, a) => s + a.stops.length, 0)
  const totalDistanceM = agents.reduce((s, a) => s + a.distance, 0) / 100
  const labourHours = (clockSeconds * agents.length) / 3600
  return {
    totalPicks,
    targetPicks,
    totalDistanceM,
    metersPerPick: totalPicks > 0 ? totalDistanceM / totalPicks : 0,
    picksPerHour: labourHours > 0 ? totalPicks / labourHours : 0,
    done: agents.length > 0 && agents.every((a) => a.state === 'done'),
  }
}

// ---- Congestion heat ----------------------------------------------------------

/** Grid-cell key for the congestion map. */
export function heatCellKey(x: number, y: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`
}

export function parseHeatCellKey(key: string): { col: number; row: number } {
  const [col, row] = key.split(':')
  return { col: Number(col), row: Number(row) }
}

/** Accumulate presence-seconds for every active agent's current cell. */
export function accumulateHeat(
  heat: Map<string, number>,
  agents: SimAgent[],
  dt: number,
  cellSize: number
): void {
  for (const a of agents) {
    if (a.state === 'done') continue
    const key = heatCellKey(a.x, a.y, cellSize)
    heat.set(key, (heat.get(key) ?? 0) + dt)
  }
}

// Created and developed by Jai Singh
