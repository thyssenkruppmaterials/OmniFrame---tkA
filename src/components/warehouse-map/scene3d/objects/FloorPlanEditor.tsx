// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// FloorPlanEditor — direct manipulation of the envelope in the 3D editor.
// ---------------------------------------------------------------------------
// Drag the border band to MOVE the whole envelope across the plane; drag a
// corner handle to RESIZE (opposite corner anchored). Grid-snapped via the
// pure helpers in floor-plan.ts; the new envelope is committed on release
// (one undoable command). While a drag is live, a full-coverage invisible
// plane receives the pointer so the gesture never drops out of the band.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Line as DreiLine } from '@react-three/drei'
import { type ThreeEvent } from '@react-three/fiber'
import {
  floorPlanCorner,
  moveFloorPlan,
  resizeFloorPlan,
  type FloorPlanConfig,
  type FloorPlanCorner,
} from '../floor-plan'
import { WORLD_SCALE } from '../scene-config'

const HANDLE_COLOR = '#2563eb'
const BAND_W = 0.55 // border band width, meters
const CORNERS: FloorPlanCorner[] = ['nw', 'ne', 'se', 'sw']

interface FloorPlanEditorProps {
  fp: FloorPlanConfig
  /** Map grid size in world units (0 = no snapping). */
  gridWorld: number
  onCommit: (next: FloorPlanConfig) => void
  /** Camera pan must pause while a band/handle drag is live. */
  onDraggingChange: (dragging: boolean) => void
}

type DragState = {
  mode: 'move' | FloorPlanCorner
  start: FloorPlanConfig
  grabX: number
  grabY: number
}

export function FloorPlanEditor({
  fp,
  gridWorld,
  onCommit,
  onDraggingChange,
}: FloorPlanEditorProps) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [draft, setDraft] = useState<FloorPlanConfig | null>(null)
  const active = draft ?? fp

  const begin = useCallback(
    (mode: DragState['mode']) => (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return
      e.stopPropagation()
      setDrag({
        mode,
        start: fp,
        grabX: e.point.x / WORLD_SCALE,
        grabY: e.point.z / WORLD_SCALE,
      })
      setDraft(fp)
      onDraggingChange(true)
    },
    [fp, onDraggingChange]
  )

  const handleMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!drag) return
      e.stopPropagation()
      const wx = e.point.x / WORLD_SCALE
      const wy = e.point.z / WORLD_SCALE
      setDraft(
        drag.mode === 'move'
          ? moveFloorPlan(
              drag.start,
              wx - drag.grabX,
              wy - drag.grabY,
              gridWorld
            )
          : resizeFloorPlan(drag.start, drag.mode, wx, wy, gridWorld)
      )
    },
    [drag, gridWorld]
  )

  const end = useCallback(
    (e?: ThreeEvent<PointerEvent>) => {
      e?.stopPropagation()
      if (
        drag &&
        draft &&
        (draft.origin_x !== drag.start.origin_x ||
          draft.origin_y !== drag.start.origin_y ||
          draft.width !== drag.start.width ||
          draft.depth !== drag.start.depth)
      )
        onCommit(draft)
      setDrag(null)
      setDraft(null)
      onDraggingChange(false)
    },
    [drag, draft, onCommit, onDraggingChange]
  )

  // Releasing outside the canvas must still finish the gesture (double-fire is
  // harmless: the second end() sees drag === null and no-ops).
  useEffect(() => {
    if (!drag) return
    const up = () => end()
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [drag, end])

  const x0 = active.origin_x * WORLD_SCALE
  const z0 = active.origin_y * WORLD_SCALE
  const w = active.width * WORLD_SCALE
  const d = active.depth * WORLD_SCALE

  // Four border-band boxes (move grip) around the active rect.
  const bands = useMemo(
    () =>
      [
        { pos: [x0 + w / 2, z0] as const, size: [w + BAND_W, BAND_W] as const },
        {
          pos: [x0 + w / 2, z0 + d] as const,
          size: [w + BAND_W, BAND_W] as const,
        },
        { pos: [x0, z0 + d / 2] as const, size: [BAND_W, d + BAND_W] as const },
        {
          pos: [x0 + w, z0 + d / 2] as const,
          size: [BAND_W, d + BAND_W] as const,
        },
      ] as const,
    [x0, z0, w, d]
  )

  const previewOutline = useMemo(
    () =>
      [
        [x0, 0.03, z0],
        [x0 + w, 0.03, z0],
        [x0 + w, 0.03, z0 + d],
        [x0, 0.03, z0 + d],
        [x0, 0.03, z0],
      ] as [number, number, number][],
    [x0, z0, w, d]
  )

  const setCursor = (c: string) => {
    document.body.style.cursor = c
  }

  return (
    <group>
      {/* Move grip: the border band */}
      {bands.map((b, i) => (
        <mesh
          key={i}
          position={[b.pos[0], 0.026, b.pos[1]]}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerDown={begin('move')}
          onPointerOver={(e) => {
            e.stopPropagation()
            setCursor('move')
          }}
          onPointerOut={() => setCursor('default')}
        >
          <planeGeometry args={[b.size[0], b.size[1]]} />
          <meshBasicMaterial
            color={HANDLE_COLOR}
            transparent
            opacity={drag ? 0.3 : 0.12}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* Corner resize handles */}
      {CORNERS.map((corner) => {
        const c = floorPlanCorner(active, corner)
        return (
          <mesh
            key={corner}
            position={[c.x * WORLD_SCALE, 0.12, c.y * WORLD_SCALE]}
            onPointerDown={begin(corner)}
            onPointerOver={(e) => {
              e.stopPropagation()
              setCursor('nwse-resize')
            }}
            onPointerOut={() => setCursor('default')}
          >
            <boxGeometry args={[0.34, 0.24, 0.34]} />
            <meshStandardMaterial
              color={HANDLE_COLOR}
              emissive={HANDLE_COLOR}
              emissiveIntensity={0.3}
            />
          </mesh>
        )
      })}

      {/* Live drag: preview outline + the full-coverage pointer plane */}
      {drag && (
        <>
          <DreiLine
            points={previewOutline}
            color={HANDLE_COLOR}
            lineWidth={2.5}
          />
          <mesh
            position={[x0 + w / 2, 0.02, z0 + d / 2]}
            rotation={[-Math.PI / 2, 0, 0]}
            onPointerMove={handleMove}
            onPointerUp={end}
          >
            <planeGeometry args={[10000, 10000]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </>
      )}
    </group>
  )
}

// Created and developed by Jai Singh
