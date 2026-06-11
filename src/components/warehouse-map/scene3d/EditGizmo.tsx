// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// EditGizmo — drei TransformControls bound to the selected object/rack.
// ---------------------------------------------------------------------------
// Translate is constrained to the floor plane (X/Z); rotate is Y-only. drei's
// TransformControls suspends the active drei camera controls while dragging —
// but ONLY for controls that honour `.enabled` (OrbitControls / MapControls).
// three-stdlib FlyControls ignores `.enabled`, so the caller must not render
// this gizmo in fly mode (the editor blocks fly while editing). Commit fires on
// mouse-up; the caller reads the object's transform and persists it.
import { TransformControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { Object3D } from 'three'

interface EditGizmoProps {
  object: Object3D | null
  mode: 'translate' | 'rotate'
  /** Grid snap in scene meters (0 → no snap). */
  gridSnapMeters: number
  onCommit: () => void
}

export function EditGizmo({
  object,
  mode,
  gridSnapMeters,
  onCommit,
}: EditGizmoProps) {
  // demand frameloop: render a frame for every gizmo drag tick.
  const invalidate = useThree((s) => s.invalidate)
  if (!object) return null
  const axes =
    mode === 'translate'
      ? { showX: true, showY: false, showZ: true }
      : { showX: false, showY: true, showZ: false }

  return (
    <TransformControls
      object={object}
      mode={mode}
      translationSnap={gridSnapMeters > 0 ? gridSnapMeters : null}
      rotationSnap={Math.PI / 12}
      size={0.8}
      {...axes}
      onObjectChange={() => invalidate()}
      onMouseUp={onCommit}
    />
  )
}

// Created and developed by Jai Singh
