---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-06-10
---
# Build Mode — Minecraft-Style Placement in the 3D Scene Editor

## Purpose / Context
Make the Location-tab 3D editor feel like building in Minecraft while staying in
the locked isometric view: see the block before it lands, paint runs of blocks,
stack on top of existing ones, and break/copy with modifier clicks.

## Details
- **`scene3d/build-mode.ts`** — pure placement math in persisted world units
  (~cm), fully unit-tested (`__tests__/build-mode.test.ts`, 11 tests):
  - `snapToGrid` / `groundPlacement` — grid-snapped floor placement.
  - `attachPlacement(target, hit, dims, grid)` — classifies the hit against the
    target's box **in its local frame** (rotation-correct): top face (≥80%
    height) → stack (`position_z = target z + height`); side faces → adjoin
    flush along the dominant local axis.
  - `paintStride(dims, rot, grid)` — per-axis world-AABB extents rounded up to
    grid cells, so thin walls paint correctly along either axis.
- **`objects/GhostPreview.tsx`** — translucent accent box + footprint outline at
  the resolved placement; `raycast={() => null}` so it never blocks picking.
- **`WarehouseScene.tsx`** — ghost state from pointermove on the interaction
  plane and on objects (`onBuildHover`); pointer-down places; drag stamps
  copies once moved a full stride (`painting` state pauses MapControls via new
  `CameraRig controlsEnabled` prop); `placingRotation` prop renders the ghost
  pre-rotated.
- **`objects/SceneObject.tsx`** — while placing: hover/click route to build
  handlers (cursor `copy`); otherwise **⌥click = quick delete**, **middle-click
  = pick block** (start placing the hovered object's kind).
- **`WarehouseScene3D.tsx`** — `placingRotation` state (resets per kind);
  **R = +90°, Q/E = ∓15° (⇧=90°) while placing**; `handlePlaceAt(x, y, z)` now
  persists `position_z` + `rotation` (each stamp is an undoable command on the
  existing [[Kit-Grid-Derived-Stage-Status|history]] command bus — undo/redo
  works for painted runs per stamp); HUD hint teaches the build controls.
- **New structural kinds** (DB `kind` is free text — no migration):
  `wall` (200×20×300), `platform` (200×200×20, stackable deck), `stairs`
  (5-step run), `ramp` (custom wedge BufferGeometry, manually disposed).
  Added to `SceneObjectKind`, `object-catalog.ts` (category `structure`), and
  `SceneObject` recipes.

## Gotchas
- Scene-object coordinates are footprint-CENTER; racks are corner-origin.
- Ghost/object placement math stays in world units; only render converts via
  `WORLD_SCALE`.
- `feature-warehouse-3d` chunk after all of this: **467.7 KB** (gate 500).

## Related
- [[Fix-Location-3D-Black-Scene-Night-Fog-SoftShadows]]
- [[ADR-Location-Tab-Isometric-3D-Overhaul]]
