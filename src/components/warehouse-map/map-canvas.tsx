// Created and developed by Jai Singh
/**
 * MapCanvas — react-konva-based warehouse map renderer.
 *
 * Replaces the original HTML-div-with-CSS-transform implementation. Uses a
 * Konva Stage so we can scale to thousands of cells, draw real polygons,
 * support per-cell click, drag/rotate racks in edit mode, and stack overlays
 * (background image, route polylines, asset positions, aisle graph) cheaply.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  Stage,
  Layer,
  Line,
  Rect,
  Group,
  Text,
  Image as KonvaImage,
  Circle,
} from 'react-konva'
import { useWarehouseMapStore } from '@/stores/warehouse-map-store'
import { PolygonDrawLayer } from './polygon-draw-layer'
import { STATUS_COLORS } from './types'
import type {
  AisleEdge,
  AisleNode,
  AssetPositionLatest,
  EditMode,
  MapLayoutResponse,
  OperationalStatus,
  Point2D,
  RoutePoint,
  WarehouseLocationMapping,
  WarehouseRack,
  WarehouseZone,
} from './types'

const MIN_SCALE = 0.05
const MAX_SCALE = 8
const ZOOM_FACTOR = 1.05

interface MapCanvasProps {
  layout: MapLayoutResponse | null
  mappings: WarehouseLocationMapping[]
  readOnly?: boolean
  /** Slot rendered as a Layer above zones/racks. */
  routePolyline?: RoutePoint[] | null
  /** Slot rendered as a Layer for live asset positions. */
  assetPositions?: AssetPositionLatest[]
  /** Aisle graph to render when showAisleGraph is true. */
  aisleNodes?: AisleNode[]
  aisleEdges?: AisleEdge[]
  /** Optional cached background image element to draw under everything. */
  backgroundImage?: HTMLImageElement | null
  /** Called when a cell (specific mapping) is clicked. */
  onCellClick?: (mappingId: string) => void
  onCellRightClick?: (
    mappingId: string,
    pointer: { x: number; y: number }
  ) => void
  /** Called when a rack body (not a cell) is clicked. */
  onRackClick?: (rackId: string) => void
  onRackRightClick?: (rackId: string, pointer: { x: number; y: number }) => void
  /** Called when canvas empty space is right-clicked. */
  onEmptyRightClick?: (
    worldPoint: { x: number; y: number },
    pointer: { x: number; y: number }
  ) => void
  /** Called when a rack is dragged in edit-racks mode. */
  onRackMove?: (rackId: string, position: Point2D) => void
  /** Called when an aisle node is clicked in edit-aisles mode. */
  onAisleNodeClick?: (nodeId: string) => void
  /** Called when an aisle node is dragged in edit-aisles mode. */
  onAisleNodeMove?: (nodeId: string, position: Point2D) => void
  /** Called when empty space is clicked in edit-aisles mode. */
  onAisleAdd?: (worldPoint: Point2D) => void
  /** Called when a polygon is committed in edit-zones mode. */
  onZoneCommit?: (points: Point2D[]) => void
  /** Called when a building outline polygon is committed in edit-building mode. */
  onBuildingCommit?: (points: Point2D[]) => void
  /** Optional grid size (world units) for snapping in edit modes. */
  gridSnap?: number
}

export function MapCanvas({
  layout,
  mappings,
  readOnly = false,
  routePolyline = null,
  assetPositions = [],
  aisleNodes = [],
  aisleEdges = [],
  backgroundImage = null,
  onCellClick,
  onCellRightClick,
  onRackClick,
  onRackRightClick,
  onEmptyRightClick,
  onRackMove,
  onAisleNodeClick,
  onAisleNodeMove,
  onAisleAdd,
  onZoneCommit,
  onBuildingCommit,
  gridSnap = 0,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })

  const viewport = useWarehouseMapStore((s) => s.viewport)
  const setViewport = useWarehouseMapStore((s) => s.setViewport)
  const fitToView = useWarehouseMapStore((s) => s.fitToView)
  const editMode = useWarehouseMapStore((s) => s.editMode)
  const activeDataLayer = useWarehouseMapStore((s) => s.activeDataLayer)
  const selectedRackId = useWarehouseMapStore((s) => s.selectedRackId)
  const setSelectedRackId = useWarehouseMapStore((s) => s.setSelectedRackId)
  const highlightedBin = useWarehouseMapStore((s) => s.highlightedBin)
  const showAisleGraph = useWarehouseMapStore((s) => s.showAisleGraph)
  const showAssetPositions = useWarehouseMapStore((s) => s.showAssetPositions)
  const currentFloor = useWarehouseMapStore((s) => s.currentFloor)

  // ---- Resize ---------------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setSize({ w: Math.max(50, width), h: Math.max(50, height) })
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // ---- World bounds (for fit-to-view) --------------------------------------

  const worldBounds = useMemo(() => {
    if (!layout) return { x: 0, y: 0, width: 1000, height: 800 }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    if (layout.map?.building_outline) {
      for (const p of layout.map.building_outline) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    }
    for (const z of layout.zones ?? []) {
      for (const p of z.polygon ?? []) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    }
    for (const r of layout.racks ?? []) {
      minX = Math.min(minX, r.position_x)
      minY = Math.min(minY, r.position_y)
      maxX = Math.max(maxX, r.position_x + r.width)
      maxY = Math.max(maxY, r.position_y + r.height)
    }
    if (!isFinite(minX)) return { x: 0, y: 0, width: 1000, height: 800 }
    return {
      x: minX - 40,
      y: minY - 40,
      width: maxX - minX + 80,
      height: maxY - minY + 80,
    }
  }, [layout])

  // ---- Auto fit on first load -----------------------------------------------

  const initialFitDoneRef = useRef(false)
  useEffect(() => {
    if (!layout || initialFitDoneRef.current) return
    if (size.w < 50 || size.h < 50) return
    fitToView({
      ...worldBounds,
      containerWidth: size.w,
      containerHeight: size.h,
    })
    initialFitDoneRef.current = true
  }, [layout, size, worldBounds, fitToView])

  // ---- Wheel zoom-around-cursor --------------------------------------------

  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()
      const stage = stageRef.current
      if (!stage) return

      const oldScale = viewport.scale
      const pointer = stage.getPointerPosition()
      if (!pointer) return

      const direction = e.evt.deltaY < 0 ? 1 : -1
      const newScale = Math.max(
        MIN_SCALE,
        Math.min(
          MAX_SCALE,
          direction > 0 ? oldScale * ZOOM_FACTOR : oldScale / ZOOM_FACTOR
        )
      )

      const mousePointTo = {
        x: (pointer.x - viewport.x) / oldScale,
        y: (pointer.y - viewport.y) / oldScale,
      }
      const newPos = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      }
      setViewport({ x: newPos.x, y: newPos.y, scale: newScale })
    },
    [viewport, setViewport]
  )

  // ---- Drag-pan -------------------------------------------------------------

  const isDraggingRef = useRef(false)
  const handleMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
    // Pan with middle mouse OR left mouse on empty space (when not in an
    // active edit mode that needs left-click for placement).
    if (e.evt.button === 1) {
      e.evt.preventDefault()
      isDraggingRef.current = true
    }
  }, [])

  const handleStageDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      const stage = e.target as Konva.Stage
      setViewport({
        x: stage.x(),
        y: stage.y(),
        scale: viewport.scale,
      })
    },
    [viewport.scale, setViewport]
  )

  // ---- Click handler --------------------------------------------------------

  const stageToWorld = useCallback(
    (stagePoint: { x: number; y: number }) => ({
      x: (stagePoint.x - viewport.x) / viewport.scale,
      y: (stagePoint.y - viewport.y) / viewport.scale,
    }),
    [viewport]
  )

  const handleStageClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (e.target !== e.target.getStage()) return
      // Empty-space click
      if (editMode === 'edit-aisles' && onAisleAdd) {
        const stage = stageRef.current
        if (!stage) return
        const pointer = stage.getPointerPosition()
        if (!pointer) return
        onAisleAdd(stageToWorld(pointer))
      }
    },
    [editMode, onAisleAdd, stageToWorld]
  )

  const handleStageContextMenu = useCallback(
    (e: KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault()
      if (e.target !== e.target.getStage()) return
      const stage = stageRef.current
      if (!stage) return
      const pointer = stage.getPointerPosition()
      if (!pointer) return
      onEmptyRightClick?.(stageToWorld(pointer), pointer)
    },
    [onEmptyRightClick, stageToWorld]
  )

  // ---- Highlighted bin lookup -----------------------------------------------

  const highlightedMapping = useMemo(() => {
    if (!highlightedBin) return null
    return mappings.find((m) => m.storage_bin === highlightedBin) ?? null
  }, [highlightedBin, mappings])

  // ---- Pulse animation for highlighted cell --------------------------------

  const pulseRef = useRef<Konva.Circle>(null)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (t: number) => {
      const phase = ((t - start) % 1500) / 1500
      const opacity = 0.3 + 0.5 * Math.abs(Math.sin(phase * Math.PI * 2))
      pulseRef.current?.opacity(opacity)
      raf = requestAnimationFrame(tick)
    }
    if (highlightedMapping) raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [highlightedMapping])

  // ---- Filter zones/racks by current floor ---------------------------------

  const visibleZones = useMemo(
    () => (layout?.zones ?? []).filter((z) => z.floor_level === currentFloor),
    [layout?.zones, currentFloor]
  )
  const visibleRacks = useMemo(() => layout?.racks ?? [], [layout?.racks])
  const visibleAisleNodes = useMemo(
    () => aisleNodes.filter((n) => n.floor_level === currentFloor),
    [aisleNodes, currentFloor]
  )
  const visibleAisleEdges = useMemo(() => {
    const ids = new Set(visibleAisleNodes.map((n) => n.id))
    return aisleEdges.filter(
      (e) => ids.has(e.from_node_id) && ids.has(e.to_node_id)
    )
  }, [aisleEdges, visibleAisleNodes])

  // ---- Render ---------------------------------------------------------------

  return (
    <div
      ref={containerRef}
      className='relative h-full w-full overflow-hidden rounded-lg bg-slate-950 select-none'
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable={editMode === 'view'}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onDragEnd={handleStageDragEnd}
        onClick={handleStageClick}
        onTap={handleStageClick}
        onContextMenu={handleStageContextMenu}
        style={{
          cursor:
            editMode === 'view'
              ? isDraggingRef.current
                ? 'grabbing'
                : 'grab'
              : editMode === 'edit-aisles'
                ? 'crosshair'
                : 'default',
        }}
      >
        {/* Background image (under everything) */}
        {backgroundImage ? (
          <Layer listening={false}>
            <KonvaImage image={backgroundImage} opacity={0.6} />
          </Layer>
        ) : null}

        {/* Building outline */}
        {layout?.map?.building_outline &&
        layout.map.building_outline.length >= 3 ? (
          <Layer listening={false}>
            <Line
              points={flatten(layout.map.building_outline)}
              closed
              stroke='#475569'
              strokeWidth={2}
              dash={[6, 6]}
              fill='rgba(15,23,42,0.4)'
            />
          </Layer>
        ) : null}

        {/* Zones */}
        <Layer>
          {visibleZones.map((zone) => (
            <ZoneShape key={zone.id} zone={zone} editMode={editMode} />
          ))}
        </Layer>

        {/* Racks (and cells) */}
        <Layer>
          {visibleRacks.map((rack) => {
            const rackMappings = mappings.filter((m) => m.rack_id === rack.id)
            return (
              <RackShape
                key={rack.id}
                rack={rack}
                mappings={rackMappings}
                isSelected={selectedRackId === rack.id}
                editMode={editMode}
                readOnly={readOnly}
                activeDataLayer={activeDataLayer}
                onSelect={() => {
                  setSelectedRackId(rack.id)
                  onRackClick?.(rack.id)
                }}
                onRightClick={(p) => onRackRightClick?.(rack.id, p)}
                onCellClick={onCellClick}
                onCellRightClick={onCellRightClick}
                onMove={(pos) => onRackMove?.(rack.id, pos)}
              />
            )
          })}
        </Layer>

        {/* Highlighted bin pulse */}
        {highlightedMapping ? (
          <Layer listening={false}>
            <HighlightedCellPulse
              mapping={highlightedMapping}
              rack={visibleRacks.find(
                (r) => r.id === highlightedMapping.rack_id
              )}
              pulseRef={pulseRef}
            />
          </Layer>
        ) : null}

        {/* Route polyline */}
        {routePolyline && routePolyline.length >= 2 ? (
          <Layer listening={false}>
            <RouteLayer points={routePolyline} />
          </Layer>
        ) : null}

        {/* Aisle graph */}
        {showAisleGraph || editMode === 'edit-aisles' ? (
          <Layer>
            <AisleGraphLayer
              nodes={visibleAisleNodes}
              edges={visibleAisleEdges}
              editable={editMode === 'edit-aisles'}
              onNodeClick={onAisleNodeClick}
              onNodeMove={onAisleNodeMove}
            />
          </Layer>
        ) : null}

        {/* Asset positions */}
        {showAssetPositions && assetPositions.length > 0 ? (
          <Layer listening={false}>
            <AssetPositionsLayer
              positions={assetPositions.filter(
                (p) => p.floor_level === currentFloor
              )}
            />
          </Layer>
        ) : null}

        {/* Polygon drawing for zones / building outline */}
        <PolygonDrawLayer
          active={editMode === 'edit-zones' && !!onZoneCommit}
          stageRef={stageRef}
          color='#3b82f6'
          gridSnap={gridSnap}
          onCommit={(pts) => onZoneCommit?.(pts)}
          onCancel={() => useWarehouseMapStore.getState().setEditMode('view')}
        />
        <PolygonDrawLayer
          active={editMode === 'edit-building' && !!onBuildingCommit}
          stageRef={stageRef}
          color='#f59e0b'
          gridSnap={gridSnap}
          onCommit={(pts) => onBuildingCommit?.(pts)}
          onCancel={() => useWarehouseMapStore.getState().setEditMode('view')}
        />
      </Stage>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function flatten(points: Point2D[]): number[] {
  const out: number[] = []
  for (const p of points) {
    out.push(p.x, p.y)
  }
  return out
}

function ZoneShape({
  zone,
  editMode,
}: {
  zone: WarehouseZone
  editMode: EditMode
}) {
  if (!zone.polygon || zone.polygon.length < 3) return null
  const isEditable = editMode === 'edit-zones'
  const xs = zone.polygon.map((p) => p.x)
  const ys = zone.polygon.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2

  return (
    <Group listening={isEditable}>
      <Line
        points={flatten(zone.polygon)}
        closed
        fill={hexWithAlpha(zone.color, zone.opacity ?? 0.3)}
        stroke={zone.color}
        strokeWidth={isEditable ? 2 : 1}
        dash={isEditable ? [4, 4] : undefined}
      />
      <Text
        x={cx - 50}
        y={cy - 6}
        width={100}
        align='center'
        text={zone.name}
        fontSize={12}
        fontStyle='bold'
        fill={zone.color}
        listening={false}
      />
    </Group>
  )
}

interface RackShapeProps {
  rack: WarehouseRack
  mappings: WarehouseLocationMapping[]
  isSelected: boolean
  editMode: EditMode
  readOnly: boolean
  activeDataLayer: 'status' | 'stock' | 'utilization' | 'activity'
  onSelect: () => void
  onRightClick: (p: { x: number; y: number }) => void
  onCellClick?: (mappingId: string) => void
  onCellRightClick?: (
    mappingId: string,
    pointer: { x: number; y: number }
  ) => void
  onMove: (pos: Point2D) => void
}

function RackShape({
  rack,
  mappings,
  isSelected,
  editMode,
  readOnly,
  activeDataLayer,
  onSelect,
  onRightClick,
  onCellClick,
  onCellRightClick,
  onMove,
}: RackShapeProps) {
  const draggable = !readOnly && editMode === 'edit-racks'
  const cellW = rack.width / Math.max(rack.columns, 1)
  const cellH = rack.height / Math.max(rack.rows, 1)

  const cellMap = useMemo(() => {
    const m = new Map<string, WarehouseLocationMapping>()
    for (const mapping of mappings) {
      m.set(`${mapping.rack_row}-${mapping.rack_column}`, mapping)
    }
    return m
  }, [mappings])

  return (
    <Group
      x={rack.position_x}
      y={rack.position_y}
      rotation={rack.rotation ?? 0}
      draggable={draggable}
      onClick={(e) => {
        e.cancelBubble = true
        if (e.target === e.currentTarget) onSelect()
      }}
      onTap={(e) => {
        e.cancelBubble = true
        if (e.target === e.currentTarget) onSelect()
      }}
      onContextMenu={(e) => {
        e.evt.preventDefault()
        e.cancelBubble = true
        const pointer = e.target.getStage()?.getPointerPosition()
        if (pointer) onRightClick(pointer)
      }}
      onDragEnd={(e) => {
        const node = e.target
        onMove({ x: node.x(), y: node.y() })
      }}
    >
      <Rect
        width={rack.width}
        height={rack.height}
        cornerRadius={2}
        fill={isSelected ? 'rgba(30,58,95,0.5)' : 'rgba(30,41,59,0.5)'}
        stroke={isSelected ? '#3b82f6' : '#475569'}
        strokeWidth={isSelected ? 2 : 1}
      />
      <Text
        x={0}
        y={-14}
        text={rack.label}
        fontSize={10}
        fontStyle='bold'
        fill={isSelected ? '#60a5fa' : '#94a3b8'}
      />

      {/* Cells */}
      {Array.from({ length: rack.rows }).map((_, row) =>
        Array.from({ length: rack.columns }).map((_, col) => {
          const mapping = cellMap.get(`${row + 1}-${col + 1}`)
          const color = colorForCell(mapping, activeDataLayer)
          const x = col * cellW + 1
          const y = row * cellH + 1
          const w = cellW - 2
          const h = cellH - 2
          return (
            <Rect
              key={`${row}-${col}`}
              x={x}
              y={y}
              width={w}
              height={h}
              cornerRadius={1}
              fill={color}
              opacity={mapping ? 0.85 : 0.25}
              listening={!!mapping && !!onCellClick}
              onClick={(e) => {
                e.cancelBubble = true
                if (mapping && onCellClick) onCellClick(mapping.id)
              }}
              onTap={(e) => {
                e.cancelBubble = true
                if (mapping && onCellClick) onCellClick(mapping.id)
              }}
              onContextMenu={(e) => {
                e.evt.preventDefault()
                e.cancelBubble = true
                if (!mapping || !onCellRightClick) return
                const pointer = e.target.getStage()?.getPointerPosition()
                if (pointer) onCellRightClick(mapping.id, pointer)
              }}
            />
          )
        })
      )}
    </Group>
  )
}

function HighlightedCellPulse({
  mapping,
  rack,
  pulseRef,
}: {
  mapping: WarehouseLocationMapping
  rack: WarehouseRack | undefined
  pulseRef: React.RefObject<Konva.Circle | null>
}) {
  if (!rack) return null
  const cellW = rack.width / Math.max(rack.columns, 1)
  const cellH = rack.height / Math.max(rack.rows, 1)
  // Center of cell in world coordinates (compensating for rack rotation roughly).
  const localX = (mapping.rack_column - 0.5) * cellW
  const localY = (mapping.rack_row - 0.5) * cellH
  const cx = rack.position_x + localX
  const cy = rack.position_y + localY
  return (
    <Group>
      <Circle
        x={cx}
        y={cy}
        radius={Math.max(cellW, cellH) * 1.2}
        stroke='#22d3ee'
        strokeWidth={3}
        ref={pulseRef as React.RefObject<Konva.Circle>}
      />
    </Group>
  )
}

function RouteLayer({ points }: { points: RoutePoint[] }) {
  const lineRef = useRef<Konva.Line>(null)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (t: number) => {
      const phase = ((t - start) % 600) / 600
      lineRef.current?.dashOffset(phase * 18)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  const flat = flatten(points)
  return (
    <Group>
      <Line
        points={flat}
        stroke='#22d3ee'
        strokeWidth={12}
        opacity={0.25}
        lineCap='round'
        lineJoin='round'
      />
      <Line
        ref={lineRef}
        points={flat}
        stroke='#22d3ee'
        strokeWidth={4}
        dash={[10, 8]}
        lineCap='round'
        lineJoin='round'
      />
      <Circle
        x={points[0].x}
        y={points[0].y}
        radius={8}
        fill='#0891b2'
        stroke='#fff'
        strokeWidth={2}
      />
      <Circle
        x={points[points.length - 1].x}
        y={points[points.length - 1].y}
        radius={10}
        fill='#22d3ee'
        stroke='#fff'
        strokeWidth={2}
      />
    </Group>
  )
}

function AisleGraphLayer({
  nodes,
  edges,
  editable,
  onNodeClick,
  onNodeMove,
}: {
  nodes: AisleNode[]
  edges: AisleEdge[]
  editable: boolean
  onNodeClick?: (id: string) => void
  onNodeMove?: (id: string, pos: Point2D) => void
}) {
  const nodeMap = useMemo(() => {
    const m = new Map<string, AisleNode>()
    for (const n of nodes) m.set(n.id, n)
    return m
  }, [nodes])
  return (
    <Group>
      {edges.map((e) => {
        const a = nodeMap.get(e.from_node_id)
        const b = nodeMap.get(e.to_node_id)
        if (!a || !b) return null
        return (
          <Line
            key={e.id}
            points={[a.x, a.y, b.x, b.y]}
            stroke={e.one_way ? '#a855f7' : '#10b981'}
            strokeWidth={1.5}
            opacity={0.7}
          />
        )
      })}
      {nodes.map((n) => (
        <Group
          key={n.id}
          x={n.x}
          y={n.y}
          draggable={editable}
          onClick={(e) => {
            e.cancelBubble = true
            onNodeClick?.(n.id)
          }}
          onTap={(e) => {
            e.cancelBubble = true
            onNodeClick?.(n.id)
          }}
          onDragEnd={(e) => {
            const node = e.target
            onNodeMove?.(n.id, { x: node.x(), y: node.y() })
          }}
        >
          <Circle
            radius={6}
            fill={kindColor(n.kind)}
            stroke='#fff'
            strokeWidth={1.5}
          />
        </Group>
      ))}
    </Group>
  )
}

function AssetPositionsLayer({
  positions,
}: {
  positions: AssetPositionLatest[]
}) {
  return (
    <Group>
      {positions.map((p) => (
        <Group key={p.asset_id} x={p.x} y={p.y} rotation={p.heading_deg ?? 0}>
          <Circle radius={10} stroke='#f59e0b' strokeWidth={2} opacity={0.6} />
          <Circle radius={7} fill='#f59e0b' stroke='#fff' strokeWidth={1} />
          <Line points={[0, 0, 14, 0]} stroke='#fff' strokeWidth={2} />
        </Group>
      ))}
    </Group>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexWithAlpha(hex: string, alpha: number): string {
  if (!hex) return `rgba(59,130,246,${alpha})`
  const trimmed = hex.replace('#', '')
  if (trimmed.length === 3) {
    const r = parseInt(trimmed[0] + trimmed[0], 16)
    const g = parseInt(trimmed[1] + trimmed[1], 16)
    const b = parseInt(trimmed[2] + trimmed[2], 16)
    return `rgba(${r},${g},${b},${alpha})`
  }
  if (trimmed.length === 6) {
    const r = parseInt(trimmed.slice(0, 2), 16)
    const g = parseInt(trimmed.slice(2, 4), 16)
    const b = parseInt(trimmed.slice(4, 6), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }
  return hex
}

function colorForCell(
  mapping: WarehouseLocationMapping | undefined,
  layer: 'status' | 'stock' | 'utilization' | 'activity'
): string {
  if (!mapping) return '#1e293b'
  const status = mapping.operational_status as OperationalStatus
  switch (layer) {
    case 'stock':
    case 'utilization':
    case 'activity':
      return STATUS_COLORS[status] ?? '#334155'
    case 'status':
    default:
      return STATUS_COLORS[status] ?? '#334155'
  }
}

const KIND_COLOR: Record<string, string> = {
  aisle: '#10b981',
  doorway: '#facc15',
  pickup: '#3b82f6',
  dock: '#a855f7',
  stair: '#f97316',
  elevator: '#06b6d4',
  manual: '#94a3b8',
}

function kindColor(kind: string): string {
  return KIND_COLOR[kind] ?? '#94a3b8'
}

// Created and developed by Jai Singh
