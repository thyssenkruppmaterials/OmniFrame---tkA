// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import type { PickTourLeg } from '../../types'
import {
  accumulateHeat,
  buildPath,
  buildTour,
  createAgent,
  heatCellKey,
  parseHeatCellKey,
  samplePath,
  scenarioKpis,
  tickAgent,
} from '../simulation/sim-core'

const rp = (x: number, y: number) => ({ x, y, floor: 0, node_id: 'n' })

describe('buildPath / samplePath', () => {
  it('accumulates arc length', () => {
    const p = buildPath([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 400 },
    ])
    expect(p.cum).toEqual([0, 300, 700])
    expect(p.total).toBe(700)
  })

  it('samples positions and headings along segments', () => {
    const p = buildPath([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 400 },
    ])
    expect(samplePath(p, 150)).toEqual({ x: 150, y: 0, headingDeg: 0 })
    const mid = samplePath(p, 500)
    expect(mid.x).toBe(300)
    expect(mid.y).toBe(200)
    expect(mid.headingDeg).toBeCloseTo(-90) // +y travel → -90° yaw
  })

  it('clamps to the ends', () => {
    const p = buildPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ])
    expect(samplePath(p, -5).x).toBe(0)
    expect(samplePath(p, 9999).x).toBe(100)
  })
})

describe('buildTour', () => {
  it('concatenates legs, skipping duplicate joints, with stops at leg ends', () => {
    const legs: PickTourLeg[] = [
      {
        from_bin: 'DOCK',
        to_bin: 'A1',
        cost: 0,
        polyline: [rp(0, 0), rp(100, 0)],
      },
      {
        from_bin: 'A1',
        to_bin: 'B2',
        cost: 0,
        polyline: [rp(100, 0), rp(100, 200)],
      },
    ]
    const tour = buildTour(legs)!
    expect(tour.path.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
    ])
    expect(tour.stops).toEqual([
      { bin: 'A1', distance: 100 },
      { bin: 'B2', distance: 300 },
    ])
  })

  it('returns null for degenerate tours', () => {
    expect(buildTour([])).toBeNull()
    expect(
      buildTour([{ from_bin: 'A', to_bin: 'A', cost: 0, polyline: [rp(5, 5)] }])
    ).toBeNull()
  })
})

const tourAgent = () => {
  const tour = buildTour([
    {
      from_bin: 'DOCK',
      to_bin: 'A1',
      cost: 0,
      polyline: [rp(0, 0), rp(200, 0)],
    },
    {
      from_bin: 'A1',
      to_bin: 'B2',
      cost: 0,
      polyline: [rp(200, 0), rp(400, 0)],
    },
  ])!
  return createAgent({
    id: 'a1',
    name: 'Picker 1',
    color: '#f00',
    path: tour.path,
    stops: tour.stops,
    speedMps: 1, // 100 world units/s
    pickSeconds: 5,
  })
}

describe('tickAgent', () => {
  it('walks to the first stop then picks', () => {
    const a = tourAgent()
    tickAgent(a, 1)
    expect(a.state).toBe('walking')
    expect(a.distance).toBe(100)
    expect(a.x).toBe(100)
    tickAgent(a, 1) // reaches stop 1 at d=200
    expect(a.state).toBe('picking')
    expect(a.distance).toBe(200)
    expect(a.picksDone).toBe(0)
  })

  it('rolls leftover time across phase boundaries', () => {
    const a = tourAgent()
    // 2s walk + 5s pick + 1s walk = 8s → 100 units past stop 1.
    tickAgent(a, 8)
    expect(a.state).toBe('walking')
    expect(a.picksDone).toBe(1)
    expect(a.distance).toBe(300)
    expect(a.elapsed).toBeCloseTo(8)
  })

  it('completes the tour and reports done', () => {
    const a = tourAgent()
    tickAgent(a, 4 + 10 + 1) // 4s walking + 2×5s picking + slack
    expect(a.state).toBe('done')
    expect(a.picksDone).toBe(2)
    expect(a.distance).toBe(400)
    // elapsed stops counting once done: 4s walk + 10s dwell.
    expect(a.elapsed).toBeCloseTo(14)
  })

  it('is frame-rate independent', () => {
    // 9.3s lands mid-pick at stop 2 — clear of exact phase boundaries, where
    // float accumulation could legitimately leave the two an ε apart.
    const whole = tourAgent()
    tickAgent(whole, 9.3)
    const chopped = tourAgent()
    for (let i = 0; i < 93; i++) tickAgent(chopped, 0.1)
    expect(chopped.distance).toBeCloseTo(whole.distance, 6)
    expect(chopped.picksDone).toBe(whole.picksDone)
    expect(chopped.state).toBe(whole.state)
  })
})

describe('scenarioKpis', () => {
  it('aggregates picks, distance, and pace', () => {
    const a = tourAgent()
    tickAgent(a, 8) // 1 pick done, 300 units walked
    const k = scenarioKpis([a], 8)
    expect(k.totalPicks).toBe(1)
    expect(k.targetPicks).toBe(2)
    expect(k.totalDistanceM).toBe(3)
    expect(k.metersPerPick).toBe(3)
    expect(k.picksPerHour).toBeCloseTo(1 / (8 / 3600))
    expect(k.done).toBe(false)
  })

  it('reports done when every agent finishes', () => {
    const a = tourAgent()
    tickAgent(a, 60)
    expect(scenarioKpis([a], 60).done).toBe(true)
  })
})

describe('congestion heat', () => {
  it('keys cells by grid coordinates', () => {
    expect(heatCellKey(250, 199, 100)).toBe('2:1')
    expect(parseHeatCellKey('2:1')).toEqual({ col: 2, row: 1 })
    expect(parseHeatCellKey('-3:7')).toEqual({ col: -3, row: 7 })
  })

  it('accumulates presence-seconds for active agents only', () => {
    const a = tourAgent()
    const heat = new Map<string, number>()
    tickAgent(a, 1) // at x=100
    accumulateHeat(heat, [a], 0.5, 100)
    accumulateHeat(heat, [a], 0.25, 100)
    expect(heat.get(heatCellKey(a.x, a.y, 100))).toBeCloseTo(0.75)
    tickAgent(a, 60) // done
    const before = new Map(heat)
    accumulateHeat(heat, [a], 1, 100)
    expect(heat).toEqual(before)
  })
})
