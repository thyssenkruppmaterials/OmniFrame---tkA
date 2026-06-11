---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-06-10
---
# Rack System Builder — Full Racking Layouts in the 3D Editor

## Purpose / Context
User ask: "improve the racking — add racks and aisles to replicate a full
racking system." Racks previously could only be added one-at-a-time from the
2D edit-racks toolbar; the 3D editor could only move them.

## Details
- **`scene3d/rack-system.ts`** (pure, 8 tests in `__tests__/rack-system.test.ts`):
  `generateRackSystem(config, centerX, centerY, rotationDeg)` produces one
  `warehouse_racks` row per RUN — `columns` = bays, `rows` = levels, runs
  lettered A, B, C… (`runLetter`), `aisle` = letter. Supports single rows or
  **back-to-back pairs with a flue gap**, separated by a configurable working
  **aisle width**. Corner-origin + rotate-about-own-center convention matched
  exactly (run centers rotate around the system center). `systemFootprint` for
  the ghost. `RACK_RUN_PRESETS` (Pallet Run, Shelving Run) +
  `RACK_SYSTEM_DEFAULTS` (2.8 m bays, 1.1 m depth, 0.3 m flue, 3.2 m aisle).
- **UI:** "Racking" section at the top of the library panel (presets +
  "Build rack system…"). `RackSystemDialog` (meters in, world units out; live
  footprint/aisles/locations summary). Armed config → cyan system ghost on the
  floor (same R/Q/E rotate + grid snap as objects), one click places ALL runs:
  `Promise.all(createRack…)`, layout invalidated, **single undo command**
  (undo deletes the created ids; redo re-inserts the captured rows WITH their
  original ids so deeper undo chains stay valid). Esc disarms; rack-arming and
  object-arming are mutually exclusive.
- **Rack visuals** (`RackInstanced`): orange load beams (`#e8762d`) front+back
  per level for `rack_type='pallet'`, and **intermediate upright frames every
  ~2.9 m** (with a faint cross-brace) so a full-row run reads as real bays
  instead of one unsupported 20 m span.
- **Bundle:** the chunk hit 500.16 KB → fixed by letting the editor's DOM
  panels (RackSystemDialog, FurnitureLibraryPanel, InsightsPanel, LayersPanel,
  MultiSelectToolbar, ShortcutsDialog, ObjectConfigPanel) React.lazy into their
  own chunks. **Gotcha:** `vite.config.ts` manualChunks force-matched ALL of
  `scene3d/` into `feature-warehouse-3d`, silently defeating dynamic imports —
  the panels are now excluded from that match. Chunk: **479.4 KB** (~21 KB
  headroom).
- Lint gotcha: exporting a non-component from a recipe/component file trips
  `react-refresh/only-export-components` on EVERY component in the file (28
  warnings) — `buildExtraKind()` became the `<ExtraObject>` component.

## Related
- [[Build-Mode-Minecraft-Style-Placement]]
- [[Scene3D-Catalog-Expansion-And-Perf]]
- [[ADR-Location-Tab-Isometric-3D-Overhaul]]
