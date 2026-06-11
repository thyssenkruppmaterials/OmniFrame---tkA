---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-06-10
---
# Floor-Plan Envelope — Max Facility Footprint in the 3D Location Tab

## Purpose / Context
First slice of the "most advanced floor plan builder" roadmap: plot the
facility's **maximum buildable footprint** (width × depth + origin + ceiling),
draw it in the isometric scene, and stop build-mode placements escaping it.

## Details
- **Storage: NO migration.** `FloorPlanConfig` lives in
  `warehouse_maps.canvas_settings.floor_plan` (free-form JSONB already on the
  table). Ceiling height reuses the existing `canvas_settings.wall_height`
  (meters) that `BuildingShell` already reads.
- **`scene3d/floor-plan.ts`** — pure module (17 tests): m/ft ↔ world-unit
  conversion (`WORLD_PER_METER = 100`), `readFloorPlan` (validating reader),
  `floorPlanOutline` (rect → `Point2D[]`), `floorPlanContains` /
  `clampToFloorPlan` (rotated-footprint AABB, same math as `paintStride`),
  `isPlacementBlocked` (only blocks when `enabled && lock_placements`).
- **`coords.computeBounds`** now grows by the envelope rect → camera framing,
  ground size, and fog cover an empty-but-plotted facility.
- **`objects/FloorPlanBoundary.tsx`** — dashed survey line + corner stakes +
  drei-Text dimension labels (formatted in the chosen units).
- **Placement guard** in `WarehouseScene`: `placeAt` (objects + drag-paint) and
  the rack-system pointer-down both no-op outside a locked envelope;
  `GhostPreview` gained `invalid` (red tint) so the rejection is visible
  before the click.
- **`FloorPlanDialog.tsx`** — lazy (added to the vite manualChunks panel
  exclusion regex!). Units m/ft with live re-expression on switch, origin,
  ceiling, lock toggle, floor area (m² + sq ft), count of racks stranded
  outside the draft envelope, and **Save + draw outline** which replaces
  `building_outline` with the envelope rectangle.
- HUD: `Frame` icon button in the top-left cluster (gated by `canEdit`).

## Gotchas
- `atan2(-0, x)` returns `-0` — normalised with `+ 0` (test `toEqual` catches it).
- Boundary-exact float comparisons in phase-transition tests are brittle —
  test mid-phase timestamps, not boundaries.

## Related
- [[Build-Mode-Minecraft-Style-Placement]]
- [[Rack-System-Builder-3D]]
- [[ADR-Location-Tab-Isometric-3D-Overhaul]]
- [[Pick-Scenario-Simulation-3D]]
