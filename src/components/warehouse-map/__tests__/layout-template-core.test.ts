// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  snapshotFromLayout,
  templateStats,
  validateSnapshot,
  TEMPLATE_SNAPSHOT_VERSION,
} from '../layout-template-core'
import type {
  AisleEdge,
  AisleNode,
  MapLayoutResponse,
  WarehouseSceneObject,
} from '../types'

const layout = (): MapLayoutResponse =>
  ({
    map: {
      id: 'map-1',
      building_outline: [
        { x: 0, y: 0 },
        { x: 10000, y: 0 },
        { x: 10000, y: 8000 },
        { x: 0, y: 8000 },
      ],
      grid_settings: { size: 100, snap: true, visible: true },
      canvas_settings: {
        wall_height: 6,
        floor_plan: { width: 10000, depth: 8000 },
      },
      scale_factor: 1,
    },
    zones: [
      {
        id: 'zone-1',
        name: 'Storage',
        zone_type: 'storage',
        polygon: [
          { x: 0, y: 0 },
          { x: 5000, y: 0 },
          { x: 5000, y: 4000 },
        ],
        color: '#88aaff',
        opacity: 0.4,
        floor_level: 0,
        sort_order: 1,
      },
    ],
    racks: [
      {
        id: 'rack-1',
        zone_id: 'zone-1',
        label: 'A',
        rack_type: 'pallet',
        position_x: 100,
        position_y: 100,
        rotation: 0,
        width: 2240,
        height: 110,
        rows: 4,
        columns: 16,
        aisle: 'A',
        metadata: { appearance: { palletsPerBay: 2 } },
      },
      {
        id: 'rack-2',
        zone_id: 'zone-deleted', // dangling ref → must null out
        label: 'B',
        rack_type: 'shelving',
        position_x: 100,
        position_y: 800,
        rotation: 0,
        width: 720,
        height: 60,
        rows: 5,
        columns: 6,
        aisle: 'B',
        metadata: {},
      },
    ],
  }) as unknown as MapLayoutResponse

const sceneObjects: WarehouseSceneObject[] = [
  {
    id: 'obj-1',
    map_id: 'map-1',
    organization_id: 'org',
    kind: 'forklift_reach',
    label: 'Reach 1',
    position_x: 500,
    position_y: 500,
    position_z: 0,
    width: 280,
    depth: 122,
    height: 240,
    rotation: 90,
    color: '#c2342c',
    floor_level: 0,
    metadata: { style: { finish: 'chrome', glow: false } },
    updated_at: '',
  },
]

const nodes: AisleNode[] = [
  { id: 'n1', x: 100, y: 100, kind: 'aisle', label: null, floor_level: 0 },
  { id: 'n2', x: 900, y: 100, kind: 'dock', label: 'Dock', floor_level: 0 },
] as AisleNode[]

const edges: AisleEdge[] = [
  {
    id: 'e1',
    from_node_id: 'n1',
    to_node_id: 'n2',
    cost: 800,
    one_way: false,
    is_stair: false,
    is_elevator: false,
  },
  {
    id: 'e2',
    from_node_id: 'n1',
    to_node_id: 'n-deleted', // dangling → dropped
    cost: 1,
    one_way: false,
    is_stair: false,
    is_elevator: false,
  },
] as AisleEdge[]

describe('snapshotFromLayout', () => {
  it('captures the full layout document with remap refs', () => {
    const s = snapshotFromLayout(layout(), sceneObjects, nodes, edges)
    expect(s.version).toBe(TEMPLATE_SNAPSHOT_VERSION)
    expect(s.building_outline).toHaveLength(4)
    expect(s.canvas_settings).toMatchObject({ wall_height: 6 })
    expect(s.zones[0]).toMatchObject({ ref: 'zone-1', name: 'Storage' })
    expect(s.racks[0]).toMatchObject({
      zone_ref: 'zone-1',
      metadata: { appearance: { palletsPerBay: 2 } },
    })
    expect(s.scene_objects[0]).toMatchObject({
      kind: 'forklift_reach',
      rotation: 90,
      metadata: { style: { finish: 'chrome', glow: false } },
    })
    expect(s.aisle_nodes).toHaveLength(2)
  })

  it('nulls dangling zone refs and drops dangling edges', () => {
    const s = snapshotFromLayout(layout(), [], nodes, edges)
    expect(s.racks[1].zone_ref).toBeNull()
    expect(s.aisle_edges).toHaveLength(1)
    expect(s.aisle_edges[0]).toMatchObject({ from_ref: 'n1', to_ref: 'n2' })
  })
})

describe('templateStats', () => {
  it('counts entities and sums rack locations', () => {
    const s = snapshotFromLayout(layout(), sceneObjects, nodes, edges)
    const stats = templateStats(s)
    expect(stats).toMatchObject({
      zones: 1,
      racks: 2,
      locations: 4 * 16 + 5 * 6,
      scene_objects: 1,
      aisle_nodes: 2,
    })
    // floor_plan envelope wins: 100 m × 80 m
    expect(stats.area_m2).toBe(8000)
  })

  it('falls back to the layout bounding box without an envelope', () => {
    const l = layout()
    ;(l.map.canvas_settings as Record<string, unknown>).floor_plan = undefined
    l.map.building_outline = null
    const s = snapshotFromLayout(l, [], [], [])
    // bbox from zones+racks: x 0..5000 (50 m), y 0..4000 (40 m)
    expect(templateStats(s).area_m2).toBe(2000)
  })
})

describe('validateSnapshot', () => {
  it('round-trips a real snapshot', () => {
    const s = snapshotFromLayout(layout(), sceneObjects, nodes, edges)
    expect(validateSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })

  it('rejects garbage and fills missing arrays', () => {
    expect(validateSnapshot(null)).toBeNull()
    expect(validateSnapshot('nope')).toBeNull()
    expect(validateSnapshot({})).toBeNull()
    const minimal = validateSnapshot({ version: 1 })
    expect(minimal).not.toBeNull()
    expect(minimal!.zones).toEqual([])
    expect(minimal!.building_outline).toBeNull()
  })
})
