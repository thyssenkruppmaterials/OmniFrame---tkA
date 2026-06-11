// Created and developed by Jai Singh
/**
 * PolygonDrawLayer — interactive polygon drawing for the warehouse map.
 *
 * Used in `edit-building` and `edit-zones` modes. Click empty space to add a
 * vertex, double-click (or click the first vertex) to close the polygon and
 * commit it via the supplied callback.
 */
import { useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import { Layer, Line, Circle, Group } from 'react-konva'
import type { Point2D } from './types'

interface PolygonDrawLayerProps {
  active: boolean
  /** Optional initial vertices to begin with (e.g. for editing an existing
   *  polygon). When omitted, starts blank. */
  initialPoints?: Point2D[]
  /** Called when the user closes the polygon. */
  onCommit: (points: Point2D[]) => void
  /** Called when drawing is cancelled (Escape pressed). */
  onCancel: () => void
  /** Stage ref so we can resolve world coordinates from clicks. */
  stageRef: React.RefObject<Konva.Stage | null>
  /** Optional color for the polygon stroke. Defaults to amber. */
  color?: string
  /** Snap to a grid of this size in world units (0 = no snap). */
  gridSnap?: number
}

export function PolygonDrawLayer({
  active,
  initialPoints = [],
  onCommit,
  onCancel,
  stageRef,
  color = '#f59e0b',
  gridSnap = 0,
}: PolygonDrawLayerProps) {
  const [points, setPoints] = useState<Point2D[]>(initialPoints)
  const [hover, setHover] = useState<Point2D | null>(null)

  // Capture initialPoints once so re-renders that pass a fresh `[]` reference
  // do not re-trigger the reset effect (which caused an infinite loop when
  // the parent re-rendered while drawing).
  const initialPointsRef = useRef(initialPoints)

  useEffect(() => {
    if (!active) {
      setPoints([])
      return
    }
    setPoints(initialPointsRef.current)
  }, [active])

  useEffect(() => {
    if (!active) return

    function snap(p: Point2D): Point2D {
      if (!gridSnap) return p
      return {
        x: Math.round(p.x / gridSnap) * gridSnap,
        y: Math.round(p.y / gridSnap) * gridSnap,
      }
    }

    function stageToWorld(): Point2D | null {
      const stage = stageRef.current
      if (!stage) return null
      const ptr = stage.getPointerPosition()
      if (!ptr) return null
      const scale = stage.scaleX() || 1
      return snap({
        x: (ptr.x - stage.x()) / scale,
        y: (ptr.y - stage.y()) / scale,
      })
    }

    const handleClick = (e: MouseEvent) => {
      // Only respond to clicks on the Konva canvas. The canvas is rendered as
      // a `<canvas>` element by react-konva.
      const target = e.target as HTMLElement
      if (!target.closest('.konvajs-content')) return
      // Prevent stage default click handling
      const wp = stageToWorld()
      if (!wp) return
      // If user clicked near the first vertex and we have ≥3 points, close
      if (points.length >= 3) {
        const first = points[0]
        const dx = wp.x - first.x
        const dy = wp.y - first.y
        if (dx * dx + dy * dy < 100) {
          onCommit(points)
          setPoints([])
          return
        }
      }
      setPoints((p) => [...p, wp])
    }

    const handleMouseMove = () => {
      const wp = stageToWorld()
      if (wp) setHover(wp)
    }

    const handleDoubleClick = () => {
      if (points.length >= 3) {
        onCommit(points)
        setPoints([])
      }
    }

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPoints([])
        onCancel()
      } else if (e.key === 'Enter' && points.length >= 3) {
        onCommit(points)
        setPoints([])
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        setPoints((p) => p.slice(0, -1))
      }
    }

    document.addEventListener('click', handleClick)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('dblclick', handleDoubleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('dblclick', handleDoubleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [active, points, onCommit, onCancel, stageRef, gridSnap])

  if (!active) return null

  const flat: number[] = []
  for (const p of points) flat.push(p.x, p.y)
  if (hover && points.length > 0) flat.push(hover.x, hover.y)

  return (
    <Layer listening={false}>
      {flat.length >= 4 && (
        <Line
          points={flat}
          stroke={color}
          strokeWidth={2}
          dash={[6, 4]}
          closed={false}
        />
      )}
      {points.map((p, i) => (
        <Group key={i}>
          <Circle
            x={p.x}
            y={p.y}
            radius={i === 0 ? 7 : 5}
            fill={i === 0 ? '#fff' : color}
            stroke={color}
            strokeWidth={2}
          />
        </Group>
      ))}
    </Layer>
  )
}

// Created and developed by Jai Singh
