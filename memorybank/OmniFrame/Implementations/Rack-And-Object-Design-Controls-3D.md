---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-06-11
---
# Rack & Object Design Controls + Draggable Floor Plan (3D Location Tab)

## Purpose / Context
User feedback on the floor-plan builder: rack height wasn't editable, racks
and objects needed full colour/design configurability, and the floor-plan
envelope couldn't be moved on the plane. All three landed — zero migrations
(everything persists in existing JSONB `metadata` / `canvas_settings`).

## Details
### Rack full configurability
- **`scene3d/rack-appearance.ts`** (pure, 7 tests): `RackAppearance`
  { postColor, shelfColor, beamColor, levelHeightM, showBeams } read from
  `warehouse_racks.metadata.appearance` with palette defaults per rack type
  (beams default ON only for pallet; orange `#e8762d` = the old hard-code).
  `mergeRackAppearance` strips default values so untouched racks keep empty
  metadata. **`levelHeightM` (0.2–4 m) drives total rack height**
  (`rows × levelH + base`) — replaces the fixed 0.5 m `SHELF_SPACING`.
- **`RackInstanced`** consumes the appearance (posts/braces, shelf decks,
  beams, cell Y positions all level-height aware).
- **`RackConfigPanel3D.tsx`** (lazy, added to the manualChunks exclusion
  regex): label, type, levels, bays, width/depth (m), rotation, level height
  + computed total height, 3 colour pickers, beams toggle, reset-look,
  duplicate, two-step delete (blocked while bins are mapped). All edits via a
  generic undoable `handleRackConfigUpdate` (snapshot inverse of patched keys
  → `updateRack` → invalidate).
- **Selection plumbing:** `WarehouseScene` got `onSelectRack` (fired in
  selectRack, cleared on object-select/empty-click/hidden-layer) →
  `store.setSelectedRackId`; panel shows when `editing && !selectedObject &&
  selectedRack3D`; InsightsPanel yields the right slot to it too.

### Object design (every object)
- **`scene3d/object-style.ts`** (pure, 5 tests): `metadata.style` =
  { finish: standard|matte|brushed|chrome|glossy, glow: boolean } with
  absolute roughness/metalness targets per finish.
- **Applied by material traversal in `SceneObject`** — a `useLayoutEffect`
  walks the recipe group, captures each MeshStandardMaterial's recipe values
  into `userData.__recipeStyle` on first touch (so 'standard'/glow-off
  restores exactly), then applies the preset and/or emissive glow in the
  object's colour. ~45 recipes covered with zero per-recipe surgery; troika
  Text and wireframe basics skipped via `isMeshStandardMaterial`.
- ObjectConfigPanel gained a "Design" section (finish select + neon glow).

### Floor plan direct manipulation
- **floor-plan.ts** additions (pure, +9 tests): `moveFloorPlan` (snap),
  `resizeFloorPlan(corner, x, y)` (opposite-corner anchor, 5 m min,
  `FLOOR_PLAN_MIN_SIZE`), `floorPlanCorner`.
- **`objects/FloorPlanEditor.tsx`** (in edit mode, parked while placing):
  drag the **border band** to move, drag **corner handles** to resize.
  Gesture pattern: pointer-down on a handle → mount a 10 km invisible
  drag plane for onPointerMove/Up (avoids R3F pointer-capture quirks) +
  window pointerup fallback; `CameraRig controlsEnabled={!painting &&
  !fpDragging}` pauses panning. Commit on release →
  `updateMap(canvas_settings.floor_plan)` with undo (`handleFloorPlanCommit`).

## Gotchas
- A full-rect drag surface would steal interior clicks (deselect/selection) —
  the border band + corner handles avoid that entirely.
- feature-warehouse-3d now **491.3/500 KB** — the NEXT in-chunk addition must
  split the chunk (e.g. carve `scene3d/objects/` recipes out).

## Related
- [[Floor-Plan-Envelope-3D]]
- [[Rack-System-Builder-3D]]
- [[Scene3D-Catalog-Expansion-And-Perf]]



## Follow-up (same day): per-level heights + pallets-per-bay
- **`appearance.levelHeights: number[] | null`** — per-level height overrides
  (bottom first, each clamped 0.2–4 m, missing entries fall back to
  `levelHeightM`). `levelOffsets(app, rows)` returns cumulative deck Y's +
  per-level heights + total; replaces the uniform formula everywhere.
  RackInstanced keeps ONE instanced cell geometry and scales instances on Y
  per level (`scaleY = levelH/levelHeightM`) — no per-level geometry split.
- **`appearance.palletsPerBay: 1|2|3 | null`** — pallet positions per bay.
  Uprights align to bay boundaries (`bayW = cellWidth × ppb`); null keeps the
  legacy ~2.9 m heuristic so existing maps render unchanged. Panel: select
  (pallet racks only) + computed bay count; "Vary heights by level" checkbox
  expands per-level inputs (Level 1 = ground).
- **Rack-system generator**: `RackSystemConfig.palletsPerBay` —
  `columns = bays × ppb` (positions, footprint unchanged) and the generated
  rack carries `metadata.appearance.palletsPerBay`. DEFAULTS now ppb=2
  (matches the 2.8 m "standard 2-pallet bay" comment); shelving preset ppb=1.
  GeneratedRack gained required `metadata` → handlePlaceSystem dropped its
  `metadata: {}` literal (TS2783 duplicate-key otherwise).
- 91 scene3d tests; chunk 492.5/500 KB.
