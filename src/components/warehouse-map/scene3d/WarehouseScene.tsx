// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// WarehouseScene — the R3F scene graph (everything inside <Canvas>).
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type ThreeEvent } from '@react-three/fiber'
import type { Object3D } from 'three'
import type {
  AisleEdge,
  AisleNode,
  AssetPositionLatest,
  MapLayoutResponse,
  RoutePoint,
  SceneObjectKind,
  WarehouseLocationMapping,
  WarehouseSceneObject,
} from '../types'
import { CameraRig } from './CameraRig'
import { EditGizmo } from './EditGizmo'
import { LightingRig } from './LightingRig'
import { MeasureTool } from './MeasureTool'
import { ViewReporter } from './ViewReporter'
import { WeatherLayer } from './WeatherLayer'
import {
  attachPlacement,
  groundPlacement,
  paintStride,
  type BuildPlacement,
} from './build-mode'
import type { SceneBounds } from './coords'
import {
  isPlacementBlocked,
  readFloorPlan,
  type FloorPlanConfig,
} from './floor-plan'
import { CATALOG_BY_KIND } from './object-catalog'
import { BuildingShell } from './objects/BuildingShell'
import { FloorPlanBoundary } from './objects/FloorPlanBoundary'
import { FloorPlanEditor } from './objects/FloorPlanEditor'
import { GhostPreview } from './objects/GhostPreview'
import { Ground } from './objects/Ground'
import { AisleGraph3D, AssetMarker3D, Route3D } from './objects/Overlays'
import { RackInstanced } from './objects/RackInstanced'
import { SceneObject } from './objects/SceneObject'
import { UtilizationHeatmap } from './objects/UtilizationHeatmap'
import { ZoneVolume } from './objects/ZoneVolume'
import type { CameraMode, QualitySettings } from './scene-config'
import { WORLD_SCALE } from './scene-config'
import type { SceneAtmosphere } from './use-weather-scene'

export interface ObjectTransformPatch {
  position_x: number
  position_y: number
  position_z?: number
  rotation: number
}

export interface WarehouseSceneProps {
  layout: MapLayoutResponse | null
  mappings: WarehouseLocationMapping[]
  sceneObjects?: WarehouseSceneObject[]
  routePolyline?: RoutePoint[] | null
  assetPositions?: AssetPositionLatest[]
  aisleNodes?: AisleNode[]
  aisleEdges?: AisleEdge[]
  highlightedBin?: string | null
  selectedRackId?: string | null
  selectedObjectId?: string | null
  onCellClick?: (mappingId: string) => void
  onRackClick?: (rackId: string) => void
  // scene config
  bounds: SceneBounds
  atmosphere: SceneAtmosphere
  quality: QualitySettings
  cameraMode: CameraMode
  reducedMotion: boolean
  showAisleGraph: boolean
  showAssetPositions: boolean
  /** Layer keys that are hidden (racks/zones/aisles/assets/grid/weather + object categories). */
  hiddenLayers?: Record<string, boolean>
  /** Tint racks by slotting density (mapped bins / positions). */
  showHeatmap?: boolean
  /** Measure-tape mode active (caller pauses editing interaction). */
  measuring?: boolean
  // editing
  editing?: boolean
  placingKind?: SceneObjectKind | null
  /** Armed rack run/system: unrotated footprint for the ghost (world units). */
  placingSystem?: { width: number; depth: number; height: number } | null
  /** Pre-placement rotation of the ghost (degrees, R key). */
  placingRotation?: number
  gizmoMode?: 'translate' | 'rotate'
  gridSnapMeters?: number
  selectedObjectIds?: string[]
  onSelectObject?: (id: string | null) => void
  /** 3D edit mode: a rack was clicked (null = rack selection cleared). */
  onSelectRack?: (id: string | null) => void
  onToggleSelectObject?: (id: string) => void
  onPlaceAt?: (worldX: number, worldY: number, worldZ?: number) => void
  /** Place the armed rack system with its footprint center at the click. */
  onPlaceSystem?: (centerX: number, centerY: number) => void
  /** Alt-click quick delete (build mode). */
  onQuickDelete?: (id: string) => void
  /** Middle-click "pick block": start placing the hovered object's kind. */
  onPickKind?: (kind: SceneObjectKind) => void
  onCommitObjectTransform?: (id: string, patch: ObjectTransformPatch) => void
  onCommitRackTransform?: (id: string, patch: ObjectTransformPatch) => void
  /** Floor-plan envelope moved/resized via direct manipulation. */
  onCommitFloorPlan?: (next: FloorPlanConfig) => void
}

type Selection = { kind: 'object' | 'rack'; id: string; obj: Object3D } | null

export function WarehouseScene({
  layout,
  mappings,
  sceneObjects = [],
  routePolyline = null,
  assetPositions = [],
  aisleNodes = [],
  aisleEdges = [],
  highlightedBin = null,
  selectedRackId = null,
  selectedObjectId = null,
  onCellClick,
  onRackClick,
  bounds,
  atmosphere,
  quality,
  cameraMode,
  reducedMotion,
  showAisleGraph,
  showAssetPositions,
  hiddenLayers = {},
  showHeatmap = false,
  measuring = false,
  editing = false,
  placingKind = null,
  placingSystem = null,
  placingRotation = 0,
  gizmoMode = 'translate',
  gridSnapMeters = 0,
  selectedObjectIds = [],
  onSelectObject,
  onSelectRack,
  onToggleSelectObject,
  onPlaceAt,
  onPlaceSystem,
  onQuickDelete,
  onPickKind,
  onCommitObjectTransform,
  onCommitRackTransform,
  onCommitFloorPlan,
}: WarehouseSceneProps) {
  const [selected, setSelected] = useState<Selection>(null)
  // Envelope drag in progress → camera pan must pause (like drag-painting).
  const [fpDragging, setFpDragging] = useState(false)

  // ---- Build mode (Minecraft-style placement) -------------------------------
  // Ghost preview position, drag-to-paint state, and the grid in world units.
  const placingEntry = placingKind ? CATALOG_BY_KIND[placingKind] : null
  const gridWorld = gridSnapMeters > 0 ? gridSnapMeters / WORLD_SCALE : 0
  const [ghost, setGhost] = useState<BuildPlacement | null>(null)
  const [painting, setPainting] = useState(false)
  const lastStampRef = useRef<BuildPlacement | null>(null)

  // Leaving placement mode clears the ghost and any in-flight paint stroke.
  useEffect(() => {
    if (!placingKind && !placingSystem) {
      setGhost(null)
      setPainting(false)
      lastStampRef.current = null
    }
  }, [placingKind, placingSystem])

  // End a paint stroke wherever the pointer is released.
  useEffect(() => {
    if (!painting) return
    const up = () => {
      setPainting(false)
      lastStampRef.current = null
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [painting])

  // The facility envelope: build-mode placements outside a locked floor plan
  // are rejected (the ghost reads red so the click never lands silently).
  const floorPlan = useMemo(
    () => readFloorPlan(layout?.map?.canvas_settings),
    [layout]
  )

  const placeAt = useCallback(
    (p: BuildPlacement) => {
      if (
        placingEntry &&
        isPlacementBlocked(
          floorPlan,
          p.position_x,
          p.position_y,
          placingEntry.width,
          placingEntry.depth,
          placingRotation
        )
      )
        return
      lastStampRef.current = p
      onPlaceAt?.(p.position_x, p.position_y, p.position_z)
    },
    [onPlaceAt, placingEntry, floorPlan, placingRotation]
  )

  // Ground hover/paint: snap the hit to the grid; while painting, stamp a new
  // copy once the pointer has moved a full footprint along either axis.
  const handleGroundBuildMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!placingEntry && !placingSystem) return
      const p = groundPlacement(
        e.point.x / WORLD_SCALE,
        e.point.z / WORLD_SCALE,
        gridWorld
      )
      setGhost((g) =>
        g &&
        g.position_x === p.position_x &&
        g.position_y === p.position_y &&
        g.position_z === p.position_z
          ? g
          : p
      )
      if (!placingEntry) return // rack systems place on click, never paint
      if (painting) {
        const last = lastStampRef.current
        if (last) {
          const stride = paintStride(placingEntry, placingRotation, gridWorld)
          if (
            Math.abs(p.position_x - last.position_x) >= stride.x ||
            Math.abs(p.position_y - last.position_y) >= stride.y
          )
            placeAt(p)
        } else {
          placeAt(p)
        }
      }
    },
    [placingEntry, placingSystem, gridWorld, painting, placingRotation, placeAt]
  )

  // Hovering an existing object while placing: resolve the Minecraft-style
  // attachment (top face stacks, side faces adjoin).
  const handleObjectBuildMove = useCallback(
    (obj: WarehouseSceneObject, e: ThreeEvent<PointerEvent>) => {
      if (!placingEntry) return
      const { placement } = attachPlacement(
        obj,
        e.point.x / WORLD_SCALE,
        e.point.z / WORLD_SCALE,
        e.point.y / WORLD_SCALE,
        placingEntry,
        gridWorld
      )
      setGhost(placement)
    },
    [placingEntry, gridWorld]
  )

  const handleObjectBuildPlace = useCallback(
    (obj: WarehouseSceneObject, e: ThreeEvent<PointerEvent>) => {
      if (!placingEntry) return
      const { placement } = attachPlacement(
        obj,
        e.point.x / WORLD_SCALE,
        e.point.z / WORLD_SCALE,
        e.point.y / WORLD_SCALE,
        placingEntry,
        gridWorld
      )
      placeAt(placement)
    },
    [placingEntry, gridWorld, placeAt]
  )

  // Group mappings by rack once.
  const mappingsByRack = useMemo(() => {
    const m = new Map<string, WarehouseLocationMapping[]>()
    for (const mp of mappings) {
      const arr = m.get(mp.rack_id)
      if (arr) arr.push(mp)
      else m.set(mp.rack_id, [mp])
    }
    return m
  }, [mappings])

  // Clear gizmo selection when leaving edit mode or when the object selection is
  // cleared externally (e.g. after a delete from the config panel).
  useEffect(() => {
    if (!editing) setSelected(null)
  }, [editing])
  useEffect(() => {
    if (selected?.kind === 'object' && selectedObjectId !== selected.id) {
      setSelected(null)
    }
  }, [selectedObjectId, selected])

  // Clear the gizmo selection if the selected item's layer is hidden (or the
  // object was deleted) — otherwise the gizmo floats over an unmounted Object3D
  // (and three-stdlib logs a per-frame "must be part of the scene graph" error).
  useEffect(() => {
    if (!selected) return
    if (selected.kind === 'rack') {
      if (hiddenLayers.racks) {
        setSelected(null)
        onSelectObject?.(null)
        onSelectRack?.(null)
      }
      return
    }
    const o = sceneObjects.find((s) => s.id === selected.id)
    const category = o
      ? (CATALOG_BY_KIND[o.kind]?.category ?? 'decor')
      : undefined
    if (!o || (category && hiddenLayers[category])) {
      setSelected(null)
      onSelectObject?.(null)
    }
  }, [hiddenLayers, selected, sceneObjects, onSelectObject, onSelectRack])

  const selectObject = useCallback(
    (id: string, obj: Object3D, additive: boolean) => {
      onSelectRack?.(null)
      if (additive && onToggleSelectObject) {
        onToggleSelectObject(id)
        setSelected(null) // multi-selection → no single-object gizmo
      } else {
        setSelected({ kind: 'object', id, obj })
        onSelectObject?.(id)
      }
    },
    [onSelectObject, onSelectRack, onToggleSelectObject]
  )
  const selectRack = useCallback(
    (id: string, obj: Object3D) => {
      // Placing a block/system must not steal rack selection.
      if (placingKind || placingSystem) return
      setSelected({ kind: 'rack', id, obj })
      onSelectObject?.(null)
      onSelectRack?.(id)
    },
    [onSelectObject, onSelectRack, placingKind, placingSystem]
  )

  const commit = useCallback(() => {
    if (!selected) return
    const o = selected.obj
    const rotationDeg = -((o.rotation.y * 180) / Math.PI)
    if (selected.kind === 'object') {
      onCommitObjectTransform?.(selected.id, {
        position_x: o.position.x / WORLD_SCALE,
        position_y: o.position.z / WORLD_SCALE,
        position_z: o.position.y / WORLD_SCALE,
        rotation: rotationDeg,
      })
    } else {
      const rack = (layout?.racks ?? []).find((r) => r.id === selected.id)
      if (!rack) return
      onCommitRackTransform?.(selected.id, {
        position_x: o.position.x / WORLD_SCALE - rack.width / 2,
        position_y: o.position.z / WORLD_SCALE - rack.height / 2,
        rotation: rotationDeg,
      })
    }
  }, [selected, layout, onCommitObjectTransform, onCommitRackTransform])

  const outline = layout?.map?.building_outline
  const wallHeight =
    (layout?.map?.canvas_settings as { wall_height?: number } | undefined)
      ?.wall_height ?? undefined
  const planeSize = bounds.span * 3 + 40

  return (
    <>
      <CameraRig
        bounds={bounds}
        mode={cameraMode}
        controlsEnabled={!painting && !fpDragging}
      />
      <ViewReporter />
      <LightingRig bounds={bounds} atmosphere={atmosphere} quality={quality} />
      {!hiddenLayers.weather && (
        <WeatherLayer
          bounds={bounds}
          atmosphere={atmosphere}
          quality={quality}
          reducedMotion={reducedMotion}
        />
      )}

      <Ground bounds={bounds} showGrid={!hiddenLayers.grid} />

      {/* Editing interaction plane: ghost-tracks + places queued objects
          (click or drag-to-paint) / deselects on empty click */}
      {editing && (
        <mesh
          position={[bounds.cx, 0.004, bounds.cz]}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={
            placingKind || placingSystem ? handleGroundBuildMove : undefined
          }
          onPointerOut={
            placingKind || placingSystem ? () => setGhost(null) : undefined
          }
          onPointerDown={(e: ThreeEvent<PointerEvent>) => {
            if (e.button !== 0) return
            if (placingSystem) {
              e.stopPropagation()
              const p = groundPlacement(
                e.point.x / WORLD_SCALE,
                e.point.z / WORLD_SCALE,
                gridWorld
              )
              if (
                isPlacementBlocked(
                  floorPlan,
                  p.position_x,
                  p.position_y,
                  placingSystem.width,
                  placingSystem.depth,
                  placingRotation
                )
              )
                return
              onPlaceSystem?.(p.position_x, p.position_y)
              return
            }
            if (!placingKind) return
            e.stopPropagation()
            setPainting(true)
            placeAt(
              groundPlacement(
                e.point.x / WORLD_SCALE,
                e.point.z / WORLD_SCALE,
                gridWorld
              )
            )
          }}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation()
            if (!placingKind && !placingSystem) {
              setSelected(null)
              onSelectObject?.(null)
              onSelectRack?.(null)
            }
          }}
        >
          <planeGeometry args={[planeSize, planeSize]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      {/* Minecraft-style placement ghost (scene objects AND rack systems) */}
      {(placingEntry || placingSystem) && ghost && (
        <GhostPreview
          placement={ghost}
          dims={
            placingEntry ?? {
              width: placingSystem!.width,
              depth: placingSystem!.depth,
              height: placingSystem!.height,
            }
          }
          rotationDeg={placingRotation}
          invalid={isPlacementBlocked(
            floorPlan,
            ghost.position_x,
            ghost.position_y,
            (placingEntry ?? placingSystem!).width,
            (placingEntry ?? placingSystem!).depth,
            placingRotation
          )}
        />
      )}

      {floorPlan?.enabled && !fpDragging && (
        <FloorPlanBoundary fp={floorPlan} />
      )}

      {/* Direct envelope manipulation — edit mode only, parked while placing */}
      {editing &&
        floorPlan?.enabled &&
        !placingKind &&
        !placingSystem &&
        onCommitFloorPlan && (
          <FloorPlanEditor
            fp={floorPlan}
            gridWorld={gridWorld}
            onCommit={onCommitFloorPlan}
            onDraggingChange={setFpDragging}
          />
        )}

      {outline && outline.length >= 3 && (
        <BuildingShell points={outline} wallHeight={wallHeight} />
      )}

      {!hiddenLayers.zones &&
        (layout?.zones ?? []).map((zone) => (
          <ZoneVolume key={zone.id} zone={zone} />
        ))}

      {!hiddenLayers.racks &&
        (layout?.racks ?? []).map((rack) => (
          <RackInstanced
            key={rack.id}
            rack={rack}
            mappings={mappingsByRack.get(rack.id) ?? []}
            highlightedBin={highlightedBin}
            selected={
              editing
                ? selected?.kind === 'rack' && selected.id === rack.id
                : selectedRackId === rack.id
            }
            editable={editing}
            onCellClick={onCellClick}
            onRackClick={onRackClick}
            onSelect3D={selectRack}
          />
        ))}

      {showHeatmap && !hiddenLayers.racks && (
        <UtilizationHeatmap racks={layout?.racks ?? []} mappings={mappings} />
      )}

      {/* Configurable scene objects (furniture / fixtures), filtered by layer. */}
      {sceneObjects
        .filter(
          (obj) => !hiddenLayers[CATALOG_BY_KIND[obj.kind]?.category ?? 'decor']
        )
        .map((obj) => (
          <SceneObject
            key={obj.id}
            obj={obj}
            editable={editing}
            placing={!!placingKind}
            selected={
              selectedObjectIds.includes(obj.id) ||
              (selected?.kind === 'object' && selected.id === obj.id)
            }
            onSelect={selectObject}
            onBuildHover={handleObjectBuildMove}
            onBuildPlace={handleObjectBuildPlace}
            onQuickDelete={onQuickDelete}
            onPickKind={onPickKind}
          />
        ))}

      {/* Single-object gizmo. Hidden in fly mode (FlyControls ignores .enabled)
          and when 2+ objects are selected (multi-select uses align/nudge/batch). */}
      {editing && cameraMode !== 'fly' && selectedObjectIds.length <= 1 && (
        <EditGizmo
          object={selected?.obj ?? null}
          mode={gizmoMode}
          gridSnapMeters={gridSnapMeters}
          onCommit={commit}
        />
      )}

      {showAisleGraph && !hiddenLayers.aisles && aisleNodes.length > 0 && (
        <AisleGraph3D nodes={aisleNodes} edges={aisleEdges} />
      )}

      {routePolyline && routePolyline.length >= 2 && (
        <Route3D points={routePolyline} />
      )}

      {showAssetPositions &&
        !hiddenLayers.assets &&
        assetPositions.map((p) => <AssetMarker3D key={p.asset_id} pos={p} />)}

      <MeasureTool active={measuring} bounds={bounds} />
    </>
  )
}

// Created and developed by Jai Singh
