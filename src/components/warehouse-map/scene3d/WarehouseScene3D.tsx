// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// WarehouseScene3D — shell owning the <Canvas>, weather, quality, the editor
// (furniture library + gizmo + inspector), and the HUD. Drop-in replacement for
// the legacy <Warehouse3DView> (identical core props).
// ---------------------------------------------------------------------------
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Canvas } from '@react-three/fiber'
import {
  Activity,
  BarChart3,
  Box,
  Check,
  CloudSun,
  Compass,
  Download,
  Focus,
  Frame,
  HelpCircle,
  Layers,
  Move,
  Pencil,
  Plane,
  Play,
  Redo2,
  RotateCw,
  Ruler,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { configureTextBuilder } from 'troika-three-text'
import { useWarehouseMapStore } from '@/stores/warehouse-map-store'
import { supabase } from '@/lib/supabase/client'
import { warehouseMapService } from '@/lib/supabase/warehouse-map.service'
import { useGeolocation } from '@/features/weather/hooks/use-geolocation'
import { useWeather } from '@/features/weather/hooks/use-weather'
import type {
  AisleEdge,
  AisleNode,
  AssetPositionLatest,
  MapLayoutResponse,
  RoutePoint,
  WarehouseLocationMapping,
  WarehouseRack,
  WarehouseSceneObject,
} from '../types'
import { Compass as CompassWidget, ScaleBar } from './ViewWidgets'
import { WarehouseScene, type ObjectTransformPatch } from './WarehouseScene'
import { useCameraFocus } from './camera-focus.store'
import { computeBounds } from './coords'
import { readFloorPlan, type FloorPlanConfig } from './floor-plan'
import {
  aabbCenter,
  aabbSize,
  computeAlignment,
  computeDistribution,
  objectAABB,
  unionAABB,
  type AlignEdge,
} from './geometry'
import { useLayoutHistory } from './layout-history.store'
import { CATALOG_BY_KIND } from './object-catalog'
import {
  generateRackSystem,
  systemFootprint,
  type RackSystemConfig,
} from './rack-system'
import {
  QUALITY_PRESETS,
  RACK_BASE_HEIGHT,
  SHELF_SPACING,
  WORLD_SCALE,
  type CameraMode,
} from './scene-config'
import { useSceneObjects } from './use-scene-objects'
import { useWeatherScene } from './use-weather-scene'

// The editor's DOM overlays are all lazy — the feature chunk sits right at the
// 500 KB budget gate, and none of these are needed for first paint of the
// scene itself. Each is conditionally rendered, so the one-frame Suspense gap
// on first open is invisible.
const RackSystemDialog = lazy(() => import('./RackSystemDialog'))
const FurnitureLibraryPanel = lazy(() =>
  import('./FurnitureLibraryPanel').then((m) => ({
    default: m.FurnitureLibraryPanel,
  }))
)
const InsightsPanel = lazy(() =>
  import('./InsightsPanel').then((m) => ({ default: m.InsightsPanel }))
)
const LayersPanel = lazy(() =>
  import('./LayersPanel').then((m) => ({ default: m.LayersPanel }))
)
const MultiSelectToolbar = lazy(() =>
  import('./MultiSelectToolbar').then((m) => ({
    default: m.MultiSelectToolbar,
  }))
)
const ShortcutsDialog = lazy(() =>
  import('./ShortcutsDialog').then((m) => ({ default: m.ShortcutsDialog }))
)
const ObjectConfigPanel = lazy(() =>
  import('./ObjectConfigPanel').then((m) => ({ default: m.ObjectConfigPanel }))
)
const FloorPlanDialog = lazy(() => import('./FloorPlanDialog'))
const RackConfigPanel3D = lazy(() => import('./RackConfigPanel3D'))
// Scenario simulation (live pick tours) — its OWN chunk, not just a lazy
// member of feature-warehouse-3d: vite.config excludes scene3d/simulation/
// from the feature chunk because that chunk sits at the 500 KB gate.
const SimulationPanel = lazy(() => import('./simulation/SimulationPanel'))
const SimulationLayer = lazy(() => import('./simulation/SimulationLayer'))

export interface WarehouseScene3DProps {
  layout: MapLayoutResponse | null
  mappings: WarehouseLocationMapping[]
  routePolyline?: RoutePoint[] | null
  assetPositions?: AssetPositionLatest[]
  aisleNodes?: AisleNode[]
  aisleEdges?: AisleEdge[]
  highlightedBin?: string | null
  /** Whether the current user may edit the layout (gates the editor entirely). */
  canEdit?: boolean
  onCellClick?: (mappingId: string) => void
  onRackClick?: (rackId: string) => void
}

// Build troika <Text> SDF glyphs on the main thread instead of a blob worker.
// The worker path has two independent prod failure modes we have hit: a CSP
// without `worker-src blob:` blocks the worker's script ASYNCHRONOUSLY (the
// worker constructs, never runs, and troika dies with "init did not return a
// callable function" instead of falling back), and bundler minification can
// break the stringified worker bootstrap. The scene renders a handful of
// labels — main-thread SDF generation is imperceptible and unbreakable.
configureTextBuilder({ useWorker: false })

/**
 * Last line of defence for the whole 3D view: if anything inside the Canvas
 * throws (driver quirk, WebGL unavailable, a bad layout row), the user gets a
 * readable panel with a retry — never a silent black rectangle.
 */
class SceneCanvasBoundary extends Component<
  { onRetry: () => void; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className='flex h-full w-full flex-col items-center justify-center gap-3 bg-slate-100 p-6 text-center'>
        <p className='text-foreground text-sm font-medium'>
          The 3D view couldn&apos;t start.
        </p>
        <p className='text-muted-foreground max-w-md text-xs'>
          {this.state.error.message ||
            'WebGL may be unavailable on this device.'}{' '}
          You can retry, or switch to the 2D map from the toolbar.
        </p>
        <button
          type='button'
          onClick={() => {
            this.setState({ error: null })
            this.props.onRetry()
          }}
          className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium'
        >
          Retry 3D view
        </button>
      </div>
    )
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener?.('change', handler)
    return () => mq.removeEventListener?.('change', handler)
  }, [])
  return reduced
}

export function WarehouseScene3D({
  layout,
  mappings,
  routePolyline = null,
  assetPositions = [],
  aisleNodes = [],
  aisleEdges = [],
  highlightedBin = null,
  canEdit = true,
  onCellClick,
  onRackClick,
}: WarehouseScene3DProps) {
  const qc = useQueryClient()

  const cameraMode = useWarehouseMapStore((s) => s.cameraMode)
  const setCameraMode = useWarehouseMapStore((s) => s.setCameraMode)
  const sceneQuality = useWarehouseMapStore((s) => s.sceneQuality)
  const weatherOverlayEnabled = useWarehouseMapStore(
    (s) => s.weatherOverlayEnabled
  )
  const toggleWeatherOverlay = useWarehouseMapStore(
    (s) => s.toggleWeatherOverlay
  )
  const showAisleGraph = useWarehouseMapStore((s) => s.showAisleGraph)
  const showAssetPositions = useWarehouseMapStore((s) => s.showAssetPositions)
  const selectedRackId = useWarehouseMapStore((s) => s.selectedRackId)
  const editMode = useWarehouseMapStore((s) => s.editMode)
  const setEditMode = useWarehouseMapStore((s) => s.setEditMode)
  const placingKind = useWarehouseMapStore((s) => s.placingKind)
  const setPlacingKind = useWarehouseMapStore((s) => s.setPlacingKind)
  const selectedObjectId = useWarehouseMapStore((s) => s.selectedObjectId)
  const setSelectedObjectId = useWarehouseMapStore((s) => s.setSelectedObjectId)
  const selectedObjectIds = useWarehouseMapStore((s) => s.selectedObjectIds)
  const setSelectedObjects = useWarehouseMapStore((s) => s.setSelectedObjects)
  const toggleObjectSelection = useWarehouseMapStore(
    (s) => s.toggleObjectSelection
  )
  const setSelectedRackId = useWarehouseMapStore((s) => s.setSelectedRackId)

  const requestFocus = useCameraFocus((s) => s.requestFocus)
  const containerRef = useRef<HTMLDivElement>(null)

  const [sceneEpoch, setSceneEpoch] = useState(0)
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate'>(
    'translate'
  )
  // Pre-placement rotation of the build ghost (R / Q / E while placing).
  const [placingRotation, setPlacingRotation] = useState(0)
  useEffect(() => {
    setPlacingRotation(0)
  }, [placingKind])

  // ---- Rack placement (runs + full systems) ---------------------------------
  // Racks are first-class map entities, not scene objects — armed separately
  // and mutually exclusive with object placement.
  const [placingRack, setPlacingRack] = useState<{
    key: string
    config: RackSystemConfig
  } | null>(null)
  const [rackDialogOpen, setRackDialogOpen] = useState(false)
  useEffect(() => {
    // Arming a scene-object kind disarms the rack ghost.
    if (placingKind) setPlacingRack(null)
  }, [placingKind])

  const armRack = useCallback(
    (key: string, config: RackSystemConfig) => {
      setPlacingKind(null)
      setPlacingRotation(0)
      setPlacingRack({ key, config })
    },
    [setPlacingKind]
  )

  const placingSystem = useMemo(() => {
    if (!placingRack) return null
    const { width, depth } = systemFootprint(placingRack.config)
    return {
      width,
      depth,
      height:
        (placingRack.config.levels * SHELF_SPACING + RACK_BASE_HEIGHT) /
        WORLD_SCALE,
    }
  }, [placingRack])

  const [showInsights, setShowInsights] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [measuring, setMeasuring] = useState(false)
  const [showLayers, setShowLayers] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showFloorPlan, setShowFloorPlan] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [hiddenLayers, setHiddenLayers] = useState<Record<string, boolean>>({})
  const toggleLayer = useCallback(
    (key: string) =>
      setHiddenLayers((prev) => ({ ...prev, [key]: !prev[key] })),
    []
  )

  const { location } = useGeolocation()
  const { data: weather } = useWeather(location)

  const reducedMotion = usePrefersReducedMotion()
  const quality = QUALITY_PRESETS[reducedMotion ? 'low' : sceneQuality]
  const bounds = useMemo(() => computeBounds(layout), [layout])
  const editing = editMode === 'edit-objects'
  // Editing always gets the neutral daylight baseline — a storm (or night)
  // rolling in must never darken the canvas someone is laying out racks on.
  const atmosphere = useWeatherScene(weather, {
    span: bounds.span,
    enabled: weatherOverlayEnabled && !editing,
  })

  const mapId = layout?.map?.id ?? null
  const {
    objects,
    create,
    update,
    remove,
    restore,
    bulkUpdate,
    bulkRemove,
    bulkRestore,
    bulkCreate,
  } = useSceneObjects(mapId)

  const pushHistory = useLayoutHistory((s) => s.push)
  const undo = useLayoutHistory((s) => s.undo)
  const redo = useLayoutHistory((s) => s.redo)
  const canUndo = useLayoutHistory((s) => s.canUndo)
  const canRedo = useLayoutHistory((s) => s.canRedo)
  const clearHistory = useLayoutHistory((s) => s.clear)

  const grid = layout?.map?.grid_settings as
    | { size?: number; snap?: boolean }
    | undefined
  const gridSnapMeters = grid?.snap ? (grid.size ?? 0) * WORLD_SCALE : 0

  const selectedObject = useMemo(
    () => objects.find((o) => o.id === selectedObjectId) ?? null,
    [objects, selectedObjectId]
  )
  const selectedObjs = useMemo(
    () => objects.filter((o) => selectedObjectIds.includes(o.id)),
    [objects, selectedObjectIds]
  )

  // ---- Editor handlers ------------------------------------------------------

  const enterEdit = useCallback(() => {
    if (cameraMode === 'fly') setCameraMode('iso') // gizmo needs a controllable camera
    setSimulating(false) // a running scenario and the editor can't share the floor
    setEditMode('edit-objects')
  }, [cameraMode, setCameraMode, setEditMode])

  // Unique mapped bins on this layout — the pick-scenario sampling pool.
  const simBins = useMemo(
    () => Array.from(new Set(mappings.map((m) => m.storage_bin))).sort(),
    [mappings]
  )

  const exitEdit = useCallback(() => {
    setPlacingKind(null)
    setPlacingRack(null)
    setRackDialogOpen(false)
    setSelectedObjectId(null)
    setSelectedRackId(null)
    setEditMode('view')
  }, [setPlacingKind, setSelectedObjectId, setSelectedRackId, setEditMode])

  // Surface write failures (RLS denial, missing migration, network) instead of
  // letting the promise reject silently — placing/moving must never fail quietly.
  const reportError = (action: string) => (e: unknown) => {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    toast.error(`Couldn't ${action}.`, { description: msg })
  }

  // Create every run of the armed rack system, centered on the clicked point —
  // one undoable command for the whole system.
  const handlePlaceSystem = useCallback(
    async (centerX: number, centerY: number) => {
      if (!placingRack || !mapId) return
      const config = placingRack.config
      setPlacingRack(null) // disarm immediately (a system is a one-shot stamp)
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) throw new Error('Not authenticated')
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user.id)
          .maybeSingle()
        const orgId = (profile as { organization_id: string } | null)
          ?.organization_id
        if (!orgId) throw new Error('No organization for user')

        const generated = generateRackSystem(
          config,
          centerX,
          centerY,
          placingRotation
        )
        const created = await Promise.all(
          generated.map((g) =>
            warehouseMapService.createRack({
              map_id: mapId,
              organization_id: orgId,
              zone_id: null,
              ...g, // carries metadata.appearance (palletsPerBay)
            } as Parameters<typeof warehouseMapService.createRack>[0])
          )
        )
        qc.invalidateQueries({ queryKey: ['warehouse-map-layout', mapId] })
        toast.success(
          `Placed ${created.length} rack run${created.length === 1 ? '' : 's'}.`
        )
        const rows = [...created]
        pushHistory({
          label: `Place rack system (${rows.length} runs)`,
          undo: async () => {
            await Promise.all(
              rows.map((r) => warehouseMapService.deleteRack(r.id))
            )
            qc.invalidateQueries({ queryKey: ['warehouse-map-layout', mapId] })
          },
          redo: async () => {
            // Re-insert with the original ids so later undos stay valid.
            await Promise.all(
              rows.map((r) =>
                warehouseMapService.createRack(
                  r as unknown as Parameters<
                    typeof warehouseMapService.createRack
                  >[0]
                )
              )
            )
            qc.invalidateQueries({ queryKey: ['warehouse-map-layout', mapId] })
          },
        })
      } catch (e) {
        toast.error("Couldn't place that rack system.", {
          description: e instanceof Error ? e.message : 'Unknown error',
        })
      }
    },
    [placingRack, mapId, placingRotation, qc, pushHistory]
  )

  const handlePlaceAt = useCallback(
    async (worldX: number, worldY: number, worldZ = 0) => {
      if (!placingKind) return
      const entry = CATALOG_BY_KIND[placingKind]
      try {
        const created = await create({
          kind: placingKind,
          position_x: worldX,
          position_y: worldY,
          position_z: worldZ,
          rotation: placingRotation,
          width: entry?.width ?? 100,
          depth: entry?.depth ?? 100,
          height: entry?.height ?? 100,
          color: entry?.color ?? null,
        })
        if (created)
          pushHistory({
            label: `Add ${entry?.label ?? placingKind}`,
            undo: () => remove(created.id),
            redo: () => restore(created),
          })
      } catch (e) {
        reportError('add that object')(e)
      }
    },
    [placingKind, placingRotation, create, remove, restore, pushHistory]
  )

  const handleCommitObject = useCallback(
    (id: string, patch: ObjectTransformPatch) => {
      const before = objects.find((o) => o.id === id)
      const prev = before
        ? {
            position_x: before.position_x,
            position_y: before.position_y,
            position_z: before.position_z,
            rotation: before.rotation,
          }
        : null
      update(id, patch)
        .then(() => {
          if (prev)
            pushHistory({
              label: 'Move object',
              undo: () => update(id, prev),
              redo: () => update(id, patch),
            })
        })
        .catch(reportError('move that object'))
    },
    [objects, update, pushHistory]
  )

  const handleCommitRack = useCallback(
    async (id: string, patch: ObjectTransformPatch) => {
      const before = (layout?.racks ?? []).find((r) => r.id === id)
      const prev = before
        ? {
            position_x: before.position_x,
            position_y: before.position_y,
            rotation: before.rotation,
          }
        : null
      const next = {
        position_x: patch.position_x,
        position_y: patch.position_y,
        rotation: patch.rotation,
      }
      const apply = async (t: typeof next) => {
        await warehouseMapService.updateRack(id, t)
        if (mapId)
          qc.invalidateQueries({ queryKey: ['warehouse-map-layout', mapId] })
      }
      try {
        await apply(next)
        if (prev)
          pushHistory({
            label: 'Move rack',
            undo: () => apply(prev),
            redo: () => apply(next),
          })
      } catch (e) {
        reportError('move that rack')(e)
        if (mapId)
          qc.invalidateQueries({ queryKey: ['warehouse-map-layout', mapId] })
      }
    },
    [layout, qc, mapId, pushHistory]
  )

  // Envelope dragged/resized in-scene → persist to canvas_settings (undoable).
  const handleFloorPlanCommit = useCallback(
    async (next: FloorPlanConfig) => {
      const map = layout?.map
      if (!map) return
      const settings = (map.canvas_settings as Record<string, unknown>) ?? {}
      const prev = readFloorPlan(settings)
      const apply = async (fp: FloorPlanConfig) => {
        await warehouseMapService.updateMap(map.id, {
          canvas_settings: { ...settings, floor_plan: fp },
        })
        qc.invalidateQueries({ queryKey: ['warehouse-map-layout', map.id] })
      }
      try {
        await apply(next)
        if (prev)
          pushHistory({
            label: 'Move floor plan',
            undo: () => apply(prev),
            redo: () => apply(next),
          })
      } catch (e) {
        reportError('move the floor plan')(e)
      }
    },
    [layout, qc, pushHistory]
  )

  // ---- Rack inspector (full configurability: structure + look) --------------

  const selectedRack3D = useMemo(
    () =>
      editing && selectedRackId
        ? ((layout?.racks ?? []).find((r) => r.id === selectedRackId) ?? null)
        : null,
    [editing, selectedRackId, layout]
  )
  const selectedRackMappedCount = useMemo(
    () =>
      selectedRack3D
        ? mappings.filter((m) => m.rack_id === selectedRack3D.id).length
        : 0,
    [selectedRack3D, mappings]
  )

  // Generic, undoable rack patch — drives every field of the rack inspector.
  const handleRackConfigUpdate = useCallback(
    async (id: string, patch: Partial<WarehouseRack>) => {
      const before = (layout?.racks ?? []).find((r) => r.id === id) as
        | Record<string, unknown>
        | undefined
      const inverse: Record<string, unknown> = {}
      if (before) for (const k of Object.keys(patch)) inverse[k] = before[k]
      const apply = async (p: Partial<WarehouseRack>) => {
        await warehouseMapService.updateRack(id, p)
        if (mapId)
          qc.invalidateQueries({ queryKey: ['warehouse-map-layout', mapId] })
      }
      try {
        await apply(patch)
        if (before)
          pushHistory({
            label: 'Edit rack',
            undo: () => apply(inverse as Partial<WarehouseRack>),
            redo: () => apply(patch),
          })
      } catch (e) {
        reportError('update that rack')(e)
      }
    },
    [layout, mapId, qc, pushHistory]
  )

  const handleRackDuplicate = useCallback(
    async (rack: WarehouseRack) => {
      try {
        const { id: _id, updated_at: _u, ...rest } = rack
        const created = await warehouseMapService.createRack({
          ...rest,
          label: `${rack.label} copy`,
          position_x: rack.position_x + 40,
          position_y: rack.position_y + 40,
        } as Parameters<typeof warehouseMapService.createRack>[0])
        if (mapId)
          qc.invalidateQueries({ queryKey: ['warehouse-map-layout', mapId] })
        setSelectedRackId(created.id)
        pushHistory({
          label: 'Duplicate rack',
          undo: async () => {
            await warehouseMapService.deleteRack(created.id)
            if (mapId)
              qc.invalidateQueries({
                queryKey: ['warehouse-map-layout', mapId],
              })
          },
          redo: async () => {
            await warehouseMapService.createRack(
              created as unknown as Parameters<
                typeof warehouseMapService.createRack
              >[0]
            )
            if (mapId)
              qc.invalidateQueries({
                queryKey: ['warehouse-map-layout', mapId],
              })
          },
        })
      } catch (e) {
        reportError('duplicate that rack')(e)
      }
    },
    [mapId, qc, setSelectedRackId, pushHistory]
  )

  const handleRackRemove = useCallback(
    async (rack: WarehouseRack) => {
      setSelectedRackId(null)
      const refresh = () => {
        if (mapId)
          qc.invalidateQueries({ queryKey: ['warehouse-map-layout', mapId] })
      }
      try {
        await warehouseMapService.deleteRack(rack.id)
        refresh()
        pushHistory({
          label: `Delete rack ${rack.label}`,
          undo: async () => {
            // Re-insert with the original id so older undo entries stay valid.
            await warehouseMapService.createRack(
              rack as unknown as Parameters<
                typeof warehouseMapService.createRack
              >[0]
            )
            refresh()
          },
          redo: async () => {
            await warehouseMapService.deleteRack(rack.id)
            refresh()
          },
        })
      } catch (e) {
        reportError('delete that rack')(e)
      }
    },
    [mapId, qc, setSelectedRackId, pushHistory]
  )

  const handleDuplicate = useCallback(
    async (obj: (typeof objects)[number]) => {
      try {
        const created = await create({
          kind: obj.kind,
          label: obj.label ?? undefined,
          position_x: obj.position_x + 40,
          position_y: obj.position_y + 40,
          position_z: obj.position_z,
          width: obj.width,
          depth: obj.depth,
          height: obj.height,
          rotation: obj.rotation,
          color: obj.color ?? undefined,
        })
        if (created)
          pushHistory({
            label: 'Duplicate object',
            undo: () => remove(created.id),
            redo: () => restore(created),
          })
      } catch (e) {
        reportError('duplicate that object')(e)
      }
    },
    [create, remove, restore, pushHistory]
  )

  // Array/clone: stamp (count-1) copies of the selected object at fixed offsets.
  const handleArray = useCallback(
    async (count: number, dx: number, dy: number) => {
      const o = selectedObject
      if (!o || count < 2) return
      const copies = Array.from({ length: count - 1 }, (_, i) => ({
        kind: o.kind,
        label: o.label ?? undefined,
        position_x: o.position_x + dx * (i + 1),
        position_y: o.position_y + dy * (i + 1),
        position_z: o.position_z,
        width: o.width,
        depth: o.depth,
        height: o.height,
        rotation: o.rotation,
        color: o.color ?? undefined,
      }))
      try {
        const created = await bulkCreate(copies)
        if (created && created.length > 0) {
          setSelectedObjects([o.id, ...created.map((c) => c.id)])
          pushHistory({
            label: `Array ${created.length} copies`,
            undo: () => bulkRemove(created.map((c) => c.id)),
            redo: () => bulkRestore(created),
          })
        }
      } catch (e) {
        reportError('create the array')(e)
      }
    },
    [
      selectedObject,
      bulkCreate,
      bulkRemove,
      bulkRestore,
      setSelectedObjects,
      pushHistory,
    ]
  )

  const handleRemove = useCallback(
    async (id: string) => {
      const target = objects.find((o) => o.id === id)
      setSelectedObjectId(null)
      try {
        await remove(id)
        if (target)
          pushHistory({
            label: 'Delete object',
            undo: () => restore(target),
            redo: () => remove(id),
          })
      } catch (e) {
        reportError('delete that object')(e)
      }
    },
    [objects, remove, restore, setSelectedObjectId, pushHistory]
  )

  // Config-panel edits (resize/recolor/rename/elevation) — undoable as a unit.
  const handleConfigUpdate = useCallback(
    (
      id: string,
      patch: Partial<
        Omit<
          WarehouseSceneObject,
          'id' | 'map_id' | 'organization_id' | 'updated_at'
        >
      >
    ) => {
      const before = objects.find((o) => o.id === id) as
        | Record<string, unknown>
        | undefined
      const inverse: Record<string, unknown> = {}
      if (before) for (const k of Object.keys(patch)) inverse[k] = before[k]
      update(id, patch)
        .then(() => {
          if (before)
            pushHistory({
              label: 'Edit object',
              undo: () => update(id, inverse as typeof patch),
              redo: () => update(id, patch),
            })
        })
        .catch(reportError('update that object'))
    },
    [objects, update, pushHistory]
  )

  // Frame-selection (F): ease the camera to the selection (iso-aware), or to the
  // whole layout when nothing is selected.
  const handleFocus = useCallback(() => {
    if (selectedObjs.length) {
      const u = unionAABB(selectedObjs.map(objectAABB))
      if (u) {
        const c = aabbCenter(u)
        const s = aabbSize(u)
        requestFocus({
          cx: c.x * WORLD_SCALE,
          cz: c.z * WORLD_SCALE,
          radius: (Math.max(s.w, s.d) / 2) * WORLD_SCALE,
        })
        return
      }
    }
    requestFocus({
      cx: bounds.cx,
      cz: bounds.cz,
      radius: Math.max(bounds.span / 2, 2),
    })
  }, [selectedObjs, bounds, requestFocus])

  // DOM toolbar "fit to view" → frame the whole layout (the toolbar can't see
  // bounds; this shell can).
  const frameAllNonce = useCameraFocus((s) => s.frameAllNonce)
  const lastFrameAll = useRef(0)
  useEffect(() => {
    if (frameAllNonce === lastFrameAll.current) return
    lastFrameAll.current = frameAllNonce
    requestFocus({
      cx: bounds.cx,
      cz: bounds.cz,
      radius: Math.max(bounds.span / 2, 2),
    })
  }, [frameAllNonce, bounds, requestFocus])

  // Global keys (view + edit, ignored while typing): F frame · ? shortcuts help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      )
        return
      if (e.key === '?') {
        e.preventDefault()
        setShowShortcuts((v) => !v)
        return
      }
      if (e.key === 'Escape' && measuring) {
        setMeasuring(false)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        handleFocus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleFocus, measuring])

  // Export the current 3D view as a PNG (requires preserveDrawingBuffer below).
  const handleExportImage = useCallback(() => {
    const canvas = containerRef.current?.querySelector('canvas')
    if (!canvas) return
    try {
      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      const code = layout?.map?.warehouse_code || 'warehouse'
      a.download = `${code}-layout-${new Date().toISOString().slice(0, 10)}.png`
      a.click()
      toast.success('Layout image exported')
    } catch (e) {
      toast.error("Couldn't export image.", {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    }
  }, [layout])

  // Reset history when the map changes (commands reference the old map's rows).
  useEffect(() => {
    clearHistory()
  }, [mapId, clearHistory])

  // Click a validation issue → select the offending object/rack so the user can
  // jump straight to it.
  const handleSelectIssue = useCallback(
    (issue: { refs: string[] }) => {
      const objRef = issue.refs.find((r) => objects.some((o) => o.id === r))
      if (objRef) {
        setSelectedObjectId(objRef)
        return
      }
      const rackRef = issue.refs.find((r) =>
        (layout?.racks ?? []).some((rk) => rk.id === r)
      )
      if (rackRef) setSelectedRackId(rackRef)
    },
    [objects, layout, setSelectedObjectId, setSelectedRackId]
  )

  // ---- Batch operations on the multi-selection (one undoable command each) --

  type ObjPatch = Partial<
    Omit<
      WarehouseSceneObject,
      'id' | 'map_id' | 'organization_id' | 'updated_at'
    >
  >

  const runBatch = useCallback(
    async (label: string, patches: Record<string, ObjPatch>) => {
      const changes = Object.entries(patches).map(([id, patch]) => ({
        id,
        patch,
      }))
      if (changes.length === 0) return
      const prev = changes.map(({ id, patch }) => {
        const o = objects.find((x) => x.id === id) as
          | Record<string, unknown>
          | undefined
        const p: Record<string, unknown> = {}
        for (const k of Object.keys(patch)) p[k] = o?.[k]
        return { id, patch: p as ObjPatch }
      })
      try {
        await bulkUpdate(changes)
        pushHistory({
          label,
          undo: () => bulkUpdate(prev),
          redo: () => bulkUpdate(changes),
        })
      } catch (e) {
        reportError(label.toLowerCase())(e)
      }
    },
    [objects, bulkUpdate, pushHistory]
  )

  const handleAlign = useCallback(
    (edge: AlignEdge) => {
      const items = selectedObjs.map((o) => ({
        id: o.id,
        aabb: objectAABB(o),
        center: { x: o.position_x, z: o.position_y },
      }))
      const res = computeAlignment(items, edge)
      const patches: Record<string, ObjPatch> = {}
      for (const [id, c] of Object.entries(res))
        patches[id] = { position_x: c.x, position_y: c.z }
      void runBatch(`Align ${edge}`, patches)
    },
    [selectedObjs, runBatch]
  )

  const handleDistribute = useCallback(
    (axis: 'x' | 'z') => {
      const items = selectedObjs.map((o) => ({
        id: o.id,
        center: { x: o.position_x, z: o.position_y },
      }))
      const res = computeDistribution(items, axis)
      const patches: Record<string, ObjPatch> = {}
      for (const [id, c] of Object.entries(res))
        patches[id] = { position_x: c.x, position_y: c.z }
      void runBatch('Distribute', patches)
    },
    [selectedObjs, runBatch]
  )

  const handleBatchRecolor = useCallback(
    (color: string) => {
      const patches: Record<string, ObjPatch> = {}
      for (const o of selectedObjs) patches[o.id] = { color }
      void runBatch('Recolor', patches)
    },
    [selectedObjs, runBatch]
  )

  const handleBatchNudge = useCallback(
    (dx: number, dy: number) => {
      const patches: Record<string, ObjPatch> = {}
      for (const o of selectedObjs)
        patches[o.id] = {
          position_x: o.position_x + dx,
          position_y: o.position_y + dy,
        }
      void runBatch('Nudge', patches)
    },
    [selectedObjs, runBatch]
  )

  const handleBatchRotate = useCallback(
    (deg: number) => {
      const patches: Record<string, ObjPatch> = {}
      for (const o of selectedObjs)
        patches[o.id] = { rotation: (o.rotation ?? 0) + deg }
      void runBatch('Rotate', patches)
    },
    [selectedObjs, runBatch]
  )

  const handleBatchDelete = useCallback(async () => {
    const targets = [...selectedObjs]
    if (targets.length === 0) return
    setSelectedObjects([])
    try {
      await bulkRemove(targets.map((t) => t.id))
      pushHistory({
        label: `Delete ${targets.length} objects`,
        undo: () => bulkRestore(targets),
        redo: () => bulkRemove(targets.map((t) => t.id)),
      })
    } catch (e) {
      reportError('delete those objects')(e)
    }
  }, [selectedObjs, bulkRemove, bulkRestore, setSelectedObjects, pushHistory])

  const handleBatchDuplicate = useCallback(async () => {
    if (selectedObjs.length === 0) return
    try {
      const created = await bulkCreate(
        selectedObjs.map((o) => ({
          kind: o.kind,
          label: o.label ?? undefined,
          position_x: o.position_x + 40,
          position_y: o.position_y + 40,
          position_z: o.position_z,
          width: o.width,
          depth: o.depth,
          height: o.height,
          rotation: o.rotation,
          color: o.color ?? undefined,
        }))
      )
      if (created && created.length > 0) {
        setSelectedObjects(created.map((c) => c.id))
        pushHistory({
          label: `Duplicate ${created.length} objects`,
          undo: () => bulkRemove(created.map((c) => c.id)),
          redo: () => bulkRestore(created),
        })
      }
    } catch (e) {
      reportError('duplicate those objects')(e)
    }
  }, [
    selectedObjs,
    bulkCreate,
    bulkRemove,
    bulkRestore,
    setSelectedObjects,
    pushHistory,
  ])

  // Keyboard dispatcher (edit mode only; ignored while typing in a field):
  // ⌘Z/⌘⇧Z undo/redo · ⌘A select all · Esc cancel→deselect→exit · Del delete ·
  // D duplicate · Q/E rotate ∓ · arrows nudge (⇧ = ×10). Batch-aware.
  useEffect(() => {
    if (!editing || measuring) return
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return (
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      )
    }
    const nudgeStep = grid?.size && grid.size > 0 ? grid.size : 10
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) void redo()
        else void undo()
        return
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        void redo()
        return
      }
      if (meta && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelectedObjects(objects.map((o) => o.id))
        return
      }
      if (e.key === 'Escape') {
        if (placingRack) setPlacingRack(null)
        else if (placingKind) setPlacingKind(null)
        else if (selectedObjectIds.length) setSelectedObjects([])
        else exitEdit()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedObjectIds.length > 1) {
          e.preventDefault()
          void handleBatchDelete()
        } else if (selectedObjectId) {
          e.preventDefault()
          void handleRemove(selectedObjectId)
        }
        return
      }
      if ((e.key === 'd' || e.key === 'D') && !meta) {
        if (selectedObjectIds.length > 1) {
          e.preventDefault()
          void handleBatchDuplicate()
        } else if (selectedObject) {
          e.preventDefault()
          void handleDuplicate(selectedObject)
        }
        return
      }
      // While placing, R / Q / E spin the build ghost (Minecraft-style).
      const placingAnything = !!placingKind || !!placingRack
      if (placingAnything && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        setPlacingRotation((r) => (r + 90) % 360)
        return
      }
      if (placingAnything && (e.key === 'q' || e.key === 'Q')) {
        e.preventDefault()
        setPlacingRotation((r) => (r - (e.shiftKey ? 90 : 15) + 360) % 360)
        return
      }
      if (placingAnything && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault()
        setPlacingRotation((r) => (r + (e.shiftKey ? 90 : 15)) % 360)
        return
      }
      if ((e.key === 'q' || e.key === 'Q') && selectedObjs.length) {
        e.preventDefault()
        handleBatchRotate(e.shiftKey ? -90 : -15)
        return
      }
      if ((e.key === 'e' || e.key === 'E') && selectedObjs.length) {
        e.preventDefault()
        handleBatchRotate(e.shiftKey ? 90 : 15)
        return
      }
      if (e.key.startsWith('Arrow') && selectedObjs.length) {
        e.preventDefault()
        const s = nudgeStep * (e.shiftKey ? 10 : 1)
        if (e.key === 'ArrowLeft') handleBatchNudge(-s, 0)
        else if (e.key === 'ArrowRight') handleBatchNudge(s, 0)
        else if (e.key === 'ArrowUp') handleBatchNudge(0, -s)
        else if (e.key === 'ArrowDown') handleBatchNudge(0, s)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    editing,
    measuring,
    placingKind,
    placingRack,
    selectedObjectId,
    selectedObjectIds,
    selectedObject,
    selectedObjs,
    objects,
    grid,
    undo,
    redo,
    handleRemove,
    handleDuplicate,
    handleBatchDelete,
    handleBatchDuplicate,
    handleBatchRotate,
    handleBatchNudge,
    setSelectedObjects,
    setPlacingKind,
    exitEdit,
  ])

  return (
    <div
      ref={containerRef}
      className='relative h-full w-full overflow-hidden rounded-lg'
      style={{ background: atmosphere.background }}
    >
      <SceneCanvasBoundary
        key={sceneEpoch}
        onRetry={() => setSceneEpoch((e) => e + 1)}
      >
        <Canvas
          shadows={quality.shadowMapSize > 0}
          dpr={quality.dpr}
          // Render-on-demand: the scene is static most of the time, so frames are
          // produced only when something changes (controls, edits, tweens — drei
          // invalidates for its controls; WeatherLayer/Focuser/EditGizmo self-
          // invalidate while animating). Fly mode polls WASD every frame and
          // needs the continuous loop.
          frameloop={cameraMode === 'fly' ? 'always' : 'demand'}
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: true, // enables canvas.toDataURL() export
          }}
          onCreated={({ gl }) => {
            // GPU context loss must not leave a dead black canvas: preventDefault
            // opts into the browser's automatic context restoration, and three
            // re-uploads its resources on the restored event.
            gl.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault()
              toast.warning('3D view paused — graphics context was lost.', {
                description: 'Attempting to recover automatically…',
              })
            })
            gl.domElement.addEventListener('webglcontextrestored', () => {
              toast.success('3D view recovered.')
            })
          }}
        >
          <Suspense fallback={null}>
            <WarehouseScene
              layout={layout}
              mappings={mappings}
              sceneObjects={objects}
              routePolyline={routePolyline}
              assetPositions={assetPositions}
              aisleNodes={aisleNodes}
              aisleEdges={aisleEdges}
              highlightedBin={highlightedBin}
              selectedRackId={selectedRackId}
              selectedObjectId={selectedObjectId}
              onCellClick={onCellClick}
              onRackClick={onRackClick}
              bounds={bounds}
              atmosphere={atmosphere}
              quality={quality}
              cameraMode={cameraMode}
              reducedMotion={reducedMotion}
              showAisleGraph={showAisleGraph}
              showAssetPositions={showAssetPositions}
              hiddenLayers={hiddenLayers}
              showHeatmap={showHeatmap}
              measuring={measuring}
              editing={editing && !measuring}
              placingKind={placingKind}
              placingSystem={placingSystem}
              placingRotation={placingRotation}
              gizmoMode={gizmoMode}
              gridSnapMeters={gridSnapMeters}
              selectedObjectIds={selectedObjectIds}
              onSelectObject={setSelectedObjectId}
              onSelectRack={setSelectedRackId}
              onToggleSelectObject={toggleObjectSelection}
              onPlaceAt={handlePlaceAt}
              onPlaceSystem={(cx, cy) => void handlePlaceSystem(cx, cy)}
              onQuickDelete={handleRemove}
              onPickKind={setPlacingKind}
              onCommitObjectTransform={handleCommitObject}
              onCommitRackTransform={handleCommitRack}
              onCommitFloorPlan={(fp) => void handleFloorPlanCommit(fp)}
            />
            {simulating && <SimulationLayer />}
          </Suspense>
        </Canvas>
      </SceneCanvasBoundary>

      <SceneHud
        placing={!!placingKind || !!placingRack}
        cameraMode={cameraMode}
        onCameraMode={(m) => {
          // Fly mode can't coexist with the transform gizmo: three-stdlib
          // FlyControls ignores .enabled, so drei can't suspend it during a drag.
          if (editing && m === 'fly') return
          setCameraMode(m)
        }}
        weatherOn={weatherOverlayEnabled}
        onToggleWeather={toggleWeatherOverlay}
        weatherLabel={weather ? atmosphere.label : null}
        canEdit={canEdit}
        editing={editing}
        onEnterEdit={enterEdit}
        onExitEdit={exitEdit}
        gizmoMode={gizmoMode}
        onGizmoMode={setGizmoMode}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => void undo()}
        onRedo={() => void redo()}
        showInsights={showInsights}
        onToggleInsights={() => setShowInsights((v) => !v)}
        onFrame={handleFocus}
        showLayers={showLayers}
        onToggleLayers={() => setShowLayers((v) => !v)}
        onExport={handleExportImage}
        showHeatmap={showHeatmap}
        onToggleHeatmap={() => setShowHeatmap((v) => !v)}
        measuring={measuring}
        onToggleMeasure={() => setMeasuring((v) => !v)}
        onOpenFloorPlan={
          canEdit && layout ? () => setShowFloorPlan(true) : undefined
        }
        simulating={simulating}
        onToggleSimulate={layout ? () => setSimulating((v) => !v) : undefined}
      />

      <Suspense fallback={null}>
        {showLayers && (
          <LayersPanel
            hiddenLayers={hiddenLayers}
            onToggleLayer={toggleLayer}
            onClose={() => setShowLayers(false)}
          />
        )}

        {editing && !showLayers && (
          <FurnitureLibraryPanel
            placingKind={placingKind}
            placingRackKey={placingRack?.key ?? null}
            onPick={(kind) => setPlacingKind(kind)}
            onPickRack={armRack}
            onOpenRackSystem={() => setRackDialogOpen(true)}
            onClose={exitEdit}
          />
        )}

        {rackDialogOpen && (
          <RackSystemDialog
            onArm={(config) => {
              setRackDialogOpen(false)
              armRack('system', config)
            }}
            onClose={() => setRackDialogOpen(false)}
          />
        )}

        {editing && !selectedObject && selectedRack3D && (
          <RackConfigPanel3D
            rack={selectedRack3D}
            mappedCount={selectedRackMappedCount}
            onUpdate={(id, patch) => void handleRackConfigUpdate(id, patch)}
            onDuplicate={(r) => void handleRackDuplicate(r)}
            onRemove={(r) => void handleRackRemove(r)}
            onClose={() => setSelectedRackId(null)}
          />
        )}

        {editing && selectedObject && (
          <ObjectConfigPanel
            object={selectedObject}
            onUpdate={handleConfigUpdate}
            onDuplicate={handleDuplicate}
            onArray={handleArray}
            onRemove={handleRemove}
            onClose={() => setSelectedObjectId(null)}
          />
        )}

        {/* Insights — yields the right slot to the object/rack inspector when editing. */}
        {showInsights && !(editing && (selectedObject || selectedRack3D)) && (
          <InsightsPanel
            layout={layout}
            mappings={mappings}
            objects={objects}
            onSelectIssue={handleSelectIssue}
            onClose={() => setShowInsights(false)}
          />
        )}

        {editing && selectedObjectIds.length >= 2 && (
          <MultiSelectToolbar
            count={selectedObjectIds.length}
            onAlign={handleAlign}
            onDistribute={handleDistribute}
            onDuplicate={handleBatchDuplicate}
            onRecolor={handleBatchRecolor}
            onDelete={handleBatchDelete}
            onClear={() => setSelectedObjects([])}
          />
        )}

        {showShortcuts && (
          <ShortcutsDialog onClose={() => setShowShortcuts(false)} />
        )}

        {showFloorPlan && layout && (
          <FloorPlanDialog
            layout={layout}
            onClose={() => setShowFloorPlan(false)}
          />
        )}

        {simulating && layout && (
          <SimulationPanel
            mapId={layout.map.id}
            bins={simBins}
            onClose={() => setSimulating(false)}
          />
        )}
      </Suspense>

      {/* Compass + scale bar + shortcuts help, stacked just above the
          bottom-right nav hint. Bottom-left is reserved for the shell's
          Operational-Status legend and bottom-centre for the multi-select
          toolbar, so this corner (above the hint) is the only clear slot. */}
      <div className='absolute right-4 bottom-16 z-10 flex items-end gap-2'>
        <CompassWidget />
        <ScaleBar />
        <button
          type='button'
          onClick={() => setShowShortcuts(true)}
          title='Keyboard shortcuts (?)'
          aria-label='Keyboard shortcuts'
          className='bg-card/85 text-muted-foreground hover:text-foreground flex items-center rounded-full border p-2 shadow-sm backdrop-blur-sm transition-colors'
        >
          <HelpCircle className='h-4 w-4' />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HUD — camera mode, weather, and the edit-layout controls.
// ---------------------------------------------------------------------------

const CAMERA_MODES: { mode: CameraMode; label: string; Icon: typeof Box }[] = [
  { mode: 'iso', label: 'Isometric', Icon: Box },
  { mode: 'orbit', label: 'Orbit', Icon: Compass },
  { mode: 'fly', label: 'Fly', Icon: Plane },
]

function SceneHud({
  placing,
  cameraMode,
  onCameraMode,
  weatherOn,
  onToggleWeather,
  weatherLabel,
  canEdit,
  editing,
  onEnterEdit,
  onExitEdit,
  gizmoMode,
  onGizmoMode,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  showInsights,
  onToggleInsights,
  onFrame,
  showLayers,
  onToggleLayers,
  onExport,
  showHeatmap,
  onToggleHeatmap,
  measuring,
  onToggleMeasure,
  onOpenFloorPlan,
  simulating,
  onToggleSimulate,
}: {
  placing: boolean
  cameraMode: CameraMode
  onCameraMode: (m: CameraMode) => void
  weatherOn: boolean
  onToggleWeather: () => void
  weatherLabel: string | null
  canEdit: boolean
  editing: boolean
  onEnterEdit: () => void
  onExitEdit: () => void
  gizmoMode: 'translate' | 'rotate'
  onGizmoMode: (m: 'translate' | 'rotate') => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  showInsights: boolean
  onToggleInsights: () => void
  onFrame: () => void
  showLayers: boolean
  onToggleLayers: () => void
  onExport: () => void
  showHeatmap: boolean
  onToggleHeatmap: () => void
  measuring: boolean
  onToggleMeasure: () => void
  /** Open the floor-plan envelope dialog (absent when the user can't edit). */
  onOpenFloorPlan?: () => void
  /** Live pick-scenario mode (absent until a layout is loaded). */
  simulating?: boolean
  onToggleSimulate?: () => void
}) {
  return (
    <>
      {/* Camera mode switch */}
      <div
        className='bg-card/85 absolute top-4 left-4 flex items-center gap-1 rounded-lg border p-1 shadow-sm backdrop-blur-sm'
        role='group'
        aria-label='Camera mode'
      >
        {CAMERA_MODES.map(({ mode, label, Icon }) => {
          // Fly is unavailable while editing (the gizmo can't suspend FlyControls).
          const disabled = editing && mode === 'fly'
          return (
            <button
              key={mode}
              type='button'
              onClick={() => onCameraMode(mode)}
              disabled={disabled}
              aria-pressed={cameraMode === mode}
              title={disabled ? 'Fly is unavailable while editing' : label}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                cameraMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              <Icon className='h-3.5 w-3.5' />
              <span className='hidden sm:inline'>{label}</span>
            </button>
          )
        })}
        <div className='bg-border mx-0.5 h-5 w-px' />
        <button
          type='button'
          onClick={onFrame}
          title='Frame selection (F)'
          className='text-muted-foreground hover:bg-muted flex items-center rounded-md px-2 py-1.5 transition-colors'
        >
          <Focus className='h-3.5 w-3.5' />
        </button>
        <button
          type='button'
          onClick={onToggleLayers}
          aria-pressed={showLayers}
          title='Layers'
          className={`flex items-center rounded-md px-2 py-1.5 transition-colors ${
            showLayers
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          <Layers className='h-3.5 w-3.5' />
        </button>
        <button
          type='button'
          onClick={onToggleMeasure}
          aria-pressed={measuring}
          title='Measure tape'
          className={`flex items-center rounded-md px-2 py-1.5 transition-colors ${
            measuring
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          <Ruler className='h-3.5 w-3.5' />
        </button>
        <button
          type='button'
          onClick={onExport}
          title='Export view as PNG'
          className='text-muted-foreground hover:bg-muted flex items-center rounded-md px-2 py-1.5 transition-colors'
        >
          <Download className='h-3.5 w-3.5' />
        </button>
        {onOpenFloorPlan && (
          <button
            type='button'
            onClick={onOpenFloorPlan}
            title='Floor plan envelope (max footprint, ceiling, units)'
            className='text-muted-foreground hover:bg-muted flex items-center rounded-md px-2 py-1.5 transition-colors'
          >
            <Frame className='h-3.5 w-3.5' />
          </button>
        )}
      </div>

      {/* Top-right cluster: insights + weather + edit */}
      <div className='absolute top-4 right-4 flex items-center gap-2'>
        <button
          type='button'
          onClick={onToggleInsights}
          aria-pressed={showInsights}
          title='Layout insights & validation'
          className={`bg-card/85 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm transition-colors ${
            showInsights
              ? 'text-foreground'
              : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          <BarChart3 className='h-3.5 w-3.5' />
          <span className='hidden sm:inline'>Insights</span>
        </button>
        {!editing && onToggleSimulate && (
          <button
            type='button'
            onClick={onToggleSimulate}
            aria-pressed={simulating}
            title='Run live pick-path scenarios'
            className={`bg-card/85 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm transition-colors ${
              simulating
                ? 'text-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Play className='h-3.5 w-3.5' />
            <span className='hidden sm:inline'>Simulate</span>
          </button>
        )}
        <button
          type='button'
          onClick={onToggleHeatmap}
          aria-pressed={showHeatmap}
          title='Slotting-density heatmap'
          className={`bg-card/85 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm transition-colors ${
            showHeatmap
              ? 'text-foreground'
              : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          <Activity className='h-3.5 w-3.5' />
          <span className='hidden sm:inline'>Heatmap</span>
        </button>
        {editing ? (
          <div className='bg-card/85 flex items-center gap-1 rounded-lg border p-1 shadow-sm backdrop-blur-sm'>
            <button
              type='button'
              onClick={onUndo}
              disabled={!canUndo}
              title='Undo (⌘Z)'
              className='text-muted-foreground hover:bg-muted flex items-center rounded-md px-2 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40'
            >
              <Undo2 className='h-3.5 w-3.5' />
            </button>
            <button
              type='button'
              onClick={onRedo}
              disabled={!canRedo}
              title='Redo (⌘⇧Z)'
              className='text-muted-foreground hover:bg-muted flex items-center rounded-md px-2 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40'
            >
              <Redo2 className='h-3.5 w-3.5' />
            </button>
            <div className='bg-border mx-0.5 h-5 w-px' />
            <button
              type='button'
              onClick={() => onGizmoMode('translate')}
              aria-pressed={gizmoMode === 'translate'}
              title='Move'
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                gizmoMode === 'translate'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Move className='h-3.5 w-3.5' /> Move
            </button>
            <button
              type='button'
              onClick={() => onGizmoMode('rotate')}
              aria-pressed={gizmoMode === 'rotate'}
              title='Rotate'
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                gizmoMode === 'rotate'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <RotateCw className='h-3.5 w-3.5' /> Rotate
            </button>
            <button
              type='button'
              onClick={onExitEdit}
              title='Finish editing'
              className='flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700'
            >
              <Check className='h-3.5 w-3.5' /> Done
            </button>
          </div>
        ) : (
          <>
            <button
              type='button'
              onClick={onToggleWeather}
              aria-pressed={weatherOn}
              title='Toggle live weather atmosphere'
              className={`bg-card/85 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm transition-colors ${
                weatherOn ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              <CloudSun className='h-3.5 w-3.5' />
              <span className='capitalize'>
                {weatherOn ? (weatherLabel ?? 'Weather') : 'Weather off'}
              </span>
            </button>
            {canEdit && (
              <button
                type='button'
                onClick={onEnterEdit}
                title='Edit the floor layout'
                className='bg-card/85 text-foreground hover:bg-muted flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm transition-colors'
              >
                <Pencil className='h-3.5 w-3.5' /> Edit layout
              </button>
            )}
          </>
        )}
      </div>

      {/* Nav / edit hints */}
      <div
        className='bg-card/80 text-muted-foreground pointer-events-none absolute right-4 bottom-4 rounded-md border px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur-sm'
        role='note'
      >
        {editing && placing ? (
          <span>
            <strong className='text-foreground'>Click</strong> place &middot;{' '}
            <strong className='text-foreground'>drag</strong> paint &middot;{' '}
            <strong className='text-foreground'>click a block</strong> stack{' '}
            &middot; <strong className='text-foreground'>R</strong> rotate{' '}
            &middot; <strong className='text-foreground'>Esc</strong> done
          </span>
        ) : editing ? (
          <span>
            <strong className='text-foreground'>Click</strong> select &middot;{' '}
            <strong className='text-foreground'>⌥click</strong> delete &middot;{' '}
            <strong className='text-foreground'>drag gizmo</strong> {gizmoMode}{' '}
            &middot; <strong className='text-foreground'>Esc</strong> exit
          </span>
        ) : cameraMode === 'fly' ? (
          <span>
            <strong className='text-foreground'>WASD</strong> move &middot;{' '}
            <strong className='text-foreground'>drag</strong> look
          </span>
        ) : cameraMode === 'iso' ? (
          <span>
            <strong className='text-foreground'>Drag</strong> pan &middot;{' '}
            <strong className='text-foreground'>Scroll</strong> zoom
          </span>
        ) : (
          <span>
            <strong className='text-foreground'>Drag</strong> orbit &middot;{' '}
            <strong className='text-foreground'>Scroll</strong> zoom
          </span>
        )}
      </div>
    </>
  )
}

// Created and developed by Jai Singh
