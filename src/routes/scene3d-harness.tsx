// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// /scene3d-harness — DEV-ONLY testbed for the warehouse isometric 3D scene.
// Mounts <WarehouseScene3D> with a synthetic layout (no auth, no Supabase data)
// so rendering regressions ("scene is black", missing models, lighting bugs)
// can be reproduced and debugged in isolation. Renders nothing in production.
// ---------------------------------------------------------------------------
import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useWarehouseMapStore } from '@/stores/warehouse-map-store'
import type {
  MapLayoutResponse,
  WarehouseLocationMapping,
  WarehouseRack,
  WarehouseZone,
} from '@/components/warehouse-map/types'

const WarehouseScene3D = lazy(() =>
  import('@/components/warehouse-map/scene3d').then((m) => ({
    default: m.WarehouseScene3D,
  }))
)

// ?showcase — renders EVERY catalog kind in a grid (no DB) to smoke-test the
// parametric recipes.
const CatalogShowcase = lazy(() => import('./-scene3d-showcase'))

const NOW = '2026-01-01T00:00:00Z'

function rack(
  id: string,
  label: string,
  x: number,
  y: number,
  opts: Partial<WarehouseRack> = {}
): WarehouseRack {
  return {
    id,
    map_id: 'harness-map',
    zone_id: null,
    organization_id: 'harness-org',
    label,
    rack_type: 'pallet',
    position_x: x,
    position_y: y,
    rotation: 0,
    width: 320,
    height: 100,
    rows: 4,
    columns: 8,
    aisle: null,
    updated_at: NOW,
    metadata: {},
    ...opts,
  }
}

const RACKS: WarehouseRack[] = [
  rack('r1', 'A-01', 120, 140),
  rack('r2', 'A-02', 120, 320),
  rack('r3', 'B-01', 120, 500),
  rack('r4', 'C-01', 560, 140, { rotation: 90, width: 320, height: 100 }),
  rack('r5', 'D-01', 760, 420, {
    rows: 6,
    columns: 10,
    width: 420,
    height: 110,
  }),
]

const ZONES: WarehouseZone[] = [
  {
    id: 'z1',
    map_id: 'harness-map',
    organization_id: 'harness-org',
    name: 'Receiving',
    zone_type: 'receiving',
    polygon: [
      { x: 40, y: 40 },
      { x: 480, y: 40 },
      { x: 480, y: 110 },
      { x: 40, y: 110 },
    ],
    color: '#38bdf8',
    opacity: 0.3,
    floor_level: 0,
    sort_order: 0,
    updated_at: NOW,
  },
  {
    id: 'z2',
    map_id: 'harness-map',
    organization_id: 'harness-org',
    name: 'Shipping',
    zone_type: 'shipping',
    polygon: [
      { x: 700, y: 600 },
      { x: 1160, y: 600 },
      { x: 1160, y: 760 },
      { x: 700, y: 760 },
    ],
    color: '#f59e0b',
    opacity: 0.3,
    floor_level: 0,
    sort_order: 1,
    updated_at: NOW,
  },
]

const MAPPINGS: WarehouseLocationMapping[] = RACKS.flatMap((r) =>
  Array.from({ length: Math.min(r.rows * r.columns, 12) }, (_, i) => ({
    id: `${r.id}-m${i}`,
    organization_id: 'harness-org',
    map_id: 'harness-map',
    rack_id: r.id,
    warehouse_code: 'HARNESS',
    storage_bin: `${r.label}-${String(i + 1).padStart(2, '0')}`,
    rack_row: Math.floor(i / r.columns) + 1,
    rack_column: (i % r.columns) + 1,
    operational_status: 'active' as const,
    status_reason: null,
    status_changed_at: null,
    status_changed_by: null,
    updated_at: NOW,
    metadata: {},
  }))
)

const LAYOUT = {
  settings: {},
  map: {
    id: 'harness-map',
    organization_id: 'harness-org',
    warehouse_code: 'HARNESS',
    name: 'Scene3D Harness',
    is_default: true,
    scale_factor: 1,
    grid_settings: { size: 20, snap: true },
    canvas_settings: { wall_height: 5 },
    building_outline: [
      { x: 0, y: 0 },
      { x: 1200, y: 0 },
      { x: 1200, y: 800 },
      { x: 0, y: 800 },
    ],
    active_revision_id: null,
    active_background_asset_id: null,
    published_at: null,
    published_by: null,
    updated_at: NOW,
    created_by: 'harness',
  },
  active_background: null,
  zones: ZONES,
  racks: RACKS,
  current_revision_number: 1,
} as unknown as MapLayoutResponse

const isLocalhost = () =>
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname)

function Scene3DHarness() {
  // Dev server OR a locally-served production build (vite preview / start.py)
  // — needed to reproduce prod-bundle-only rendering bugs. Never serves on a
  // real deployment hostname.
  if (!import.meta.env.DEV && !isLocalhost()) return null
  // ?quality=low|medium|high — lets rendering bugs be bisected against the
  // quality tiers (shadows / soft shadows / particle counts).
  const params = new URLSearchParams(window.location.search)
  const q = params.get('quality')
  if (q === 'low' || q === 'medium' || q === 'high') {
    useWarehouseMapStore.setState({ sceneQuality: q })
  }
  if (params.has('showcase')) {
    return (
      <div className='h-screen w-screen'>
        <Suspense fallback={<div>Loading showcase…</div>}>
          <CatalogShowcase />
        </Suspense>
      </div>
    )
  }
  return (
    <div className='h-screen w-screen'>
      <Suspense
        fallback={<div data-testid='harness-loading'>Loading scene…</div>}
      >
        <WarehouseScene3D layout={LAYOUT} mappings={MAPPINGS} canEdit />
      </Suspense>
    </div>
  )
}

export const Route = createFileRoute('/scene3d-harness')({
  component: Scene3DHarness,
})

// Created and developed by Jai Singh
