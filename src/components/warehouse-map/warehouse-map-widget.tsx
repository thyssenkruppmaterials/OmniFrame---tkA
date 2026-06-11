// Created and developed by Jai Singh
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck - New warehouse map tables (warehouse_location_mappings) not yet in generated database.types.ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type Konva from 'konva'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import { Stage, Layer, Line, Rect, Group, Circle, Text } from 'react-konva'
import { supabase } from '@/lib/supabase/client'
import { WarehouseMapService } from '@/lib/supabase/warehouse-map.service'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  STATUS_COLORS,
  type WarehouseLocationMapping,
} from '@/components/warehouse-map/types'

export interface WarehouseMapWidgetProps {
  /** Required map id. */
  mapId: string
  /** Highlighted storage bins; rendered with a pulsing ring overlay. */
  highlightedBins?: string[]
  /** Optional route polyline (world-coord points) to render across the map. */
  routePolyline?: { x: number; y: number }[]
  /** Floor level filter; default 0. */
  floorLevel?: number
  /** Container CSS height (e.g. 320). Default 320. */
  height?: number
  /** Optional click handler — called with mapping_id when a cell is clicked. */
  onCellClick?: (mappingId: string) => void
  /** Pass-through className. */
  className?: string
}

interface Size {
  w: number
  h: number
}
interface Viewport {
  x: number
  y: number
  scale: number
}
interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const MIN_SCALE = 0.2
const MAX_SCALE = 5
const FIT_PAD = 24
const DASH: [number, number] = [10, 8]
const DASH_CYCLE = DASH[0] + DASH[1]
const MARCH_PX_PER_S = 30

const LEGEND: { key: 'active' | 'maintenance' | 'shutdown'; label: string }[] =
  [
    { key: 'active', label: 'Active' },
    { key: 'maintenance', label: 'Maintenance' },
    { key: 'shutdown', label: 'Shutdown' },
  ]

function flatten(pts: { x: number; y: number }[]): number[] {
  const out: number[] = new Array(pts.length * 2)
  for (let i = 0; i < pts.length; i += 1) {
    out[i * 2] = pts[i].x
    out[i * 2 + 1] = pts[i].y
  }
  return out
}

function computeBounds(
  zones: { polygon: { x: number; y: number }[] }[],
  racks: {
    position_x: number
    position_y: number
    width: number
    height: number
  }[]
): Bounds | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const z of zones)
    for (const p of z.polygon) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  for (const r of racks) {
    if (r.position_x < minX) minX = r.position_x
    if (r.position_y < minY) minY = r.position_y
    if (r.position_x + r.width > maxX) maxX = r.position_x + r.width
    if (r.position_y + r.height > maxY) maxY = r.position_y + r.height
  }
  if (!isFinite(minX) || !isFinite(minY)) return null
  return { minX, minY, maxX, maxY }
}

function fitViewport(b: Bounds, s: Size): Viewport {
  const wW = Math.max(b.maxX - b.minX, 1)
  const wH = Math.max(b.maxY - b.minY, 1)
  const aW = Math.max(s.w - FIT_PAD * 2, 1)
  const aH = Math.max(s.h - FIT_PAD * 2, 1)
  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.min(aW / wW, aH / wH))
  )
  const x = FIT_PAD - b.minX * scale + (aW - wW * scale) / 2
  const y = FIT_PAD - b.minY * scale + (aH - wH * scale) / 2
  return { x, y, scale }
}

/**
 * Lightweight, embeddable mini warehouse-map widget for surfacing the current
 * floor layout next to lists in features like Cycle Count, Putaway, and
 * Picking. Renders zones, racks, and bin cells via `react-konva` with
 * mouse-wheel zoom and drag-to-pan, plus optional highlighted bins (pulsing
 * rings) and a marching-ants route polyline. Loads layout via
 * `WarehouseMapService` and bin mappings via Supabase, so callers only need to
 * supply the map id.
 */
export function WarehouseMapWidget({
  mapId,
  highlightedBins,
  routePolyline,
  floorLevel = 0,
  height = 320,
  onCellClick,
  className,
}: WarehouseMapWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const routeLineRef = useRef<Konva.Line>(null)
  const pulseGroupRef = useRef<Konva.Group>(null)

  const [size, setSize] = useState<Size>({ w: 0, h: height })
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
  const [hasFitted, setHasFitted] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  const layoutQuery = useQuery({
    queryKey: ['warehouse-map-widget', 'layout', mapId],
    queryFn: () => WarehouseMapService.getInstance().getMapLayout(mapId),
    enabled: !!mapId,
    staleTime: 60_000,
  })

  const mappingsQuery = useQuery({
    queryKey: ['warehouse-map-widget', 'mappings', mapId],
    queryFn: async (): Promise<WarehouseLocationMapping[]> => {
      const { data, error } = await supabase
        .from('warehouse_location_mappings')
        .select('*')
        .eq('map_id', mapId)
      if (error) throw error
      return (data ?? []) as unknown as WarehouseLocationMapping[]
    },
    enabled: !!mapId,
    staleTime: 60_000,
  })

  const layout = layoutQuery.data ?? null
  const mappings = mappingsQuery.data ?? []
  const isLoading = layoutQuery.isLoading || mappingsQuery.isLoading

  const visibleZones = useMemo(
    () => (layout?.zones ?? []).filter((z) => z.floor_level === floorLevel),
    [layout, floorLevel]
  )
  const visibleRacks = useMemo(() => layout?.racks ?? [], [layout])

  const mappingsByRack = useMemo(() => {
    const m = new Map<string, WarehouseLocationMapping[]>()
    for (const x of mappings) {
      const list = m.get(x.rack_id) ?? []
      list.push(x)
      m.set(x.rack_id, list)
    }
    return m
  }, [mappings])

  const highlightSet = useMemo(
    () => new Set(highlightedBins ?? []),
    [highlightedBins]
  )

  const highlightCenters = useMemo(() => {
    if (!visibleRacks.length || highlightSet.size === 0) return []
    const out: { x: number; y: number; key: string }[] = []
    for (const r of visibleRacks) {
      const cw = r.width / Math.max(r.columns, 1)
      const ch = r.height / Math.max(r.rows, 1)
      for (const m of mappingsByRack.get(r.id) ?? []) {
        if (!highlightSet.has(m.storage_bin)) continue
        out.push({
          x: r.position_x + (m.rack_column - 0.5) * cw,
          y: r.position_y + (m.rack_row - 0.5) * ch,
          key: m.id,
        })
      }
    }
    return out
  }, [visibleRacks, mappingsByRack, highlightSet])

  const worldBounds = useMemo(
    () => computeBounds(visibleZones, visibleRacks),
    [visibleZones, visibleRacks]
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.max(1, Math.floor(r.width)), h: height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [height])

  useEffect(() => {
    if (hasFitted || !worldBounds || size.w <= 0) return
    setViewport(fitViewport(worldBounds, size))
    setHasFitted(true)
  }, [hasFitted, worldBounds, size])

  useEffect(() => {
    if (!routePolyline || routePolyline.length < 2) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const offset = -((((now - start) / 1000) * MARCH_PX_PER_S) % DASH_CYCLE)
      const node = routeLineRef.current
      if (node) {
        node.dashOffset(offset)
        node.getLayer()?.batchDraw()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [routePolyline])

  useEffect(() => {
    if (highlightCenters.length === 0) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = (now - start) / 1000
      const opacity = 0.45 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3))
      const offset = -((t * MARCH_PX_PER_S) % DASH_CYCLE)
      const g = pulseGroupRef.current
      if (g) {
        for (const child of g.getChildren()) {
          if (child.getClassName() === 'Circle') {
            ;(child as Konva.Circle).opacity(opacity)
            ;(child as Konva.Circle).dashOffset(offset)
          }
        }
        g.getLayer()?.batchDraw()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [highlightCenters])

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const pointer = stageRef.current?.getPointerPosition()
    if (!pointer) return
    const dir = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1
    const newScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, viewport.scale * dir)
    )
    const wx = (pointer.x - viewport.x) / viewport.scale
    const wy = (pointer.y - viewport.y) / viewport.scale
    setViewport({
      scale: newScale,
      x: pointer.x - wx * newScale,
      y: pointer.y - wy * newScale,
    })
  }

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return
    setIsDragging(true)
    dragStart.current = {
      x: e.evt.clientX - viewport.x,
      y: e.evt.clientY - viewport.y,
    }
  }

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!isDragging || !dragStart.current) return
    setViewport((p) => ({
      ...p,
      x: e.evt.clientX - dragStart.current!.x,
      y: e.evt.clientY - dragStart.current!.y,
    }))
  }

  const endDrag = () => {
    setIsDragging(false)
    dragStart.current = null
  }

  const zoomBy = (factor: number) =>
    setViewport((p) => {
      const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, p.scale * factor))
      const cx = size.w / 2,
        cy = size.h / 2
      const wx = (cx - p.x) / p.scale,
        wy = (cy - p.y) / p.scale
      return { scale: ns, x: cx - wx * ns, y: cy - wy * ns }
    })

  const fitToBounds = () => {
    if (worldBounds) setViewport(fitViewport(worldBounds, size))
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative overflow-hidden rounded-lg border bg-slate-950 select-none',
        className
      )}
      style={{ height }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <Layer>
          {visibleZones.map((z) =>
            z.polygon.length < 3 ? null : (
              <Line
                key={z.id}
                points={flatten(z.polygon)}
                closed
                fill={z.color}
                opacity={Math.max(0.15, Math.min(0.5, z.opacity || 0.25))}
                stroke={z.color}
                strokeWidth={1}
                listening={false}
              />
            )
          )}
          {visibleRacks.map((rack) => {
            const cw = rack.width / Math.max(rack.columns, 1)
            const ch = rack.height / Math.max(rack.rows, 1)
            const byCell = new Map<string, WarehouseLocationMapping>()
            for (const m of mappingsByRack.get(rack.id) ?? [])
              byCell.set(`${m.rack_row}-${m.rack_column}`, m)
            const cells: React.ReactNode[] = []
            for (let row = 0; row < rack.rows; row += 1) {
              for (let col = 0; col < rack.columns; col += 1) {
                const m = byCell.get(`${row + 1}-${col + 1}`)
                const fill = m
                  ? (STATUS_COLORS[m.operational_status] ?? '#334155')
                  : '#0f172a'
                const click =
                  m && onCellClick ? () => onCellClick(m.id) : undefined
                cells.push(
                  <Rect
                    key={`${rack.id}-${row}-${col}`}
                    x={col * cw + 1}
                    y={row * ch + 1}
                    width={Math.max(0, cw - 2)}
                    height={Math.max(0, ch - 2)}
                    cornerRadius={1}
                    fill={fill}
                    opacity={m ? 0.85 : 0.35}
                    onClick={click}
                    onTap={click}
                  />
                )
              }
            }
            return (
              <Group
                key={rack.id}
                x={rack.position_x}
                y={rack.position_y}
                rotation={rack.rotation || 0}
              >
                <Rect
                  width={rack.width}
                  height={rack.height}
                  cornerRadius={3}
                  fill='#1e293b'
                  stroke='#475569'
                  strokeWidth={1}
                  opacity={0.85}
                  listening={false}
                />
                <Text
                  x={2}
                  y={-12}
                  text={rack.label}
                  fontSize={9}
                  fontStyle='bold'
                  fill='#94a3b8'
                  listening={false}
                />
                {cells}
              </Group>
            )
          })}
        </Layer>

        {routePolyline && routePolyline.length >= 2 ? (
          <Layer listening={false}>
            <Line
              points={flatten(routePolyline)}
              stroke='#22d3ee'
              strokeWidth={12}
              opacity={0.25}
              lineCap='round'
              lineJoin='round'
            />
            <Line
              ref={routeLineRef}
              points={flatten(routePolyline)}
              stroke='#22d3ee'
              strokeWidth={4}
              dash={DASH}
              lineCap='round'
              lineJoin='round'
            />
          </Layer>
        ) : null}

        {highlightCenters.length > 0 ? (
          <Layer listening={false}>
            <Group ref={pulseGroupRef}>
              {highlightCenters.map((c) => (
                <Circle
                  key={c.key}
                  x={c.x}
                  y={c.y}
                  radius={12}
                  stroke='#38bdf8'
                  strokeWidth={2}
                  dash={DASH}
                  opacity={0.7}
                />
              ))}
            </Group>
          </Layer>
        ) : null}
      </Stage>

      <div className='absolute top-2 right-2 flex flex-col items-end gap-2'>
        <div className='bg-background/85 text-foreground flex flex-col gap-1 rounded-md border px-2 py-1.5 text-[10px] shadow-sm backdrop-blur-sm'>
          {LEGEND.map((l) => (
            <div key={l.key} className='flex items-center gap-1.5'>
              <span
                className='inline-block h-2 w-2 rounded-full'
                style={{ backgroundColor: STATUS_COLORS[l.key] }}
              />
              <span>{l.label}</span>
            </div>
          ))}
        </div>
        <div className='bg-background/85 flex gap-1 rounded-md border p-1 shadow-sm backdrop-blur-sm'>
          <Button
            size='icon'
            variant='ghost'
            className='h-6 w-6'
            onClick={() => zoomBy(1.2)}
            aria-label='Zoom in'
          >
            <ZoomIn className='h-3.5 w-3.5' />
          </Button>
          <Button
            size='icon'
            variant='ghost'
            className='h-6 w-6'
            onClick={() => zoomBy(1 / 1.2)}
            aria-label='Zoom out'
          >
            <ZoomOut className='h-3.5 w-3.5' />
          </Button>
          <Button
            size='icon'
            variant='ghost'
            className='h-6 w-6'
            onClick={fitToBounds}
            aria-label='Fit to bounds'
          >
            <Maximize className='h-3.5 w-3.5' />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className='text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center text-xs'>
          Loading map…
        </div>
      ) : null}
    </div>
  )
}

// Created and developed by Jai Singh
