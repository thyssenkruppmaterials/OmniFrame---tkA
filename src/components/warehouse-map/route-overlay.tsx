// Created and developed by Jai Singh
import { useEffect, useRef } from 'react'
import type Konva from 'konva'
import { Layer, Line, Circle, Text } from 'react-konva'
import type { Point2D } from '@/components/warehouse-map/types'

export interface RoutePolyline {
  points: Point2D[]
  cost?: number
  fromLabel?: string
  toLabel?: string
}

interface RouteOverlayProps {
  route: RoutePolyline | null
  visible?: boolean
  color?: string
  width?: number
  animate?: boolean
}

const DEFAULT_COLOR = '#22d3ee'
const DEFAULT_WIDTH = 4
const DASH_PATTERN: [number, number] = [10, 8]
const DASH_CYCLE_LENGTH = DASH_PATTERN[0] + DASH_PATTERN[1]
const MARCH_PIXELS_PER_SECOND = 30

function flattenPoints(points: Point2D[]): number[] {
  const flat: number[] = new Array(points.length * 2)
  for (let i = 0; i < points.length; i += 1) {
    flat[i * 2] = points[i].x
    flat[i * 2 + 1] = points[i].y
  }
  return flat
}

/**
 * Konva overlay that renders a walking-route polyline on top of the warehouse
 * map canvas. Mount as a sibling `<Layer>` inside the parent `<Stage>` from
 * `map-canvas.tsx`. The layer is non-interactive so it never steals pointer
 * events from underlying racks, zones, or background layers.
 */
export function RouteOverlay({
  route,
  visible = true,
  color = DEFAULT_COLOR,
  width = DEFAULT_WIDTH,
  animate = true,
}: RouteOverlayProps) {
  const lineRef = useRef<Konva.Line>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!animate || !route || route.points.length < 2 || !visible) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }

    const startTime = performance.now()

    const tick = (now: number) => {
      const elapsedSeconds = (now - startTime) / 1000
      const offset = -(
        (elapsedSeconds * MARCH_PIXELS_PER_SECOND) %
        DASH_CYCLE_LENGTH
      )
      const node = lineRef.current
      if (node) {
        node.dashOffset(offset)
        const layer = node.getLayer()
        if (layer) layer.batchDraw()
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [animate, route, visible])

  if (!visible || !route || route.points.length < 2) {
    return null
  }

  const flat = flattenPoints(route.points)
  const start = route.points[0]
  const end = route.points[route.points.length - 1]

  return (
    <Layer listening={false}>
      <Line
        points={flat}
        stroke={color}
        strokeWidth={width * 3}
        opacity={0.3}
        lineCap='round'
        lineJoin='round'
        tension={0}
        listening={false}
      />
      <Line
        ref={lineRef}
        points={flat}
        stroke={color}
        strokeWidth={width}
        lineCap='round'
        lineJoin='round'
        tension={0}
        dash={DASH_PATTERN}
        listening={false}
      />
      <Circle
        x={start.x}
        y={start.y}
        radius={8}
        fill={color}
        opacity={0.7}
        stroke='#ffffff'
        strokeWidth={2}
        listening={false}
      />
      {route.fromLabel ? (
        <Text
          x={start.x - 40}
          y={start.y - 24}
          width={80}
          align='center'
          text={route.fromLabel}
          fontSize={11}
          fontStyle='bold'
          fill='#ffffff'
          stroke='#0f172a'
          strokeWidth={2}
          fillAfterStrokeEnabled
          listening={false}
        />
      ) : null}
      <Circle
        x={end.x}
        y={end.y}
        radius={10}
        fill={color}
        stroke='#ffffff'
        strokeWidth={2}
        listening={false}
      />
      {route.toLabel ? (
        <Text
          x={end.x - 40}
          y={end.y - 28}
          width={80}
          align='center'
          text={route.toLabel}
          fontSize={11}
          fontStyle='bold'
          fill='#ffffff'
          stroke='#0f172a'
          strokeWidth={2}
          fillAfterStrokeEnabled
          listening={false}
        />
      ) : null}
    </Layer>
  )
}

// Created and developed by Jai Singh
