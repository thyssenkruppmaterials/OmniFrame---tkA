---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-06-10
---
# Scene3D — Catalog Expansion, Shell Fixes, Render-on-Demand Perf

## Purpose / Context
Follow-up to [[Build-Mode-Minecraft-Style-Placement]]: user reported the
Operational-Status legend covering the edit library, a dead "full screen"
button, and asked for many more objects + faster rendering/loading.

## Details
- **Legend overlap:** `MapLegend` is hidden while `is3DMode && editMode ===
  'edit-objects'` (the FurnitureLibraryPanel owns the left edge in the 3D
  editor) — `warehouse-location-map.tsx`.
- **Toolbar buttons now 3D-aware** (`map-toolbar.tsx`): the camera-focus store
  gained `requestZoom(factor)` + `requestFrameAll()`; zoom buttons multiply
  ortho `camera.zoom` (or dolly in perspective) via `CameraRig`, and
  fit-to-view frames the whole layout via the scene shell. A NEW true
  **fullscreen toggle** (Expand/Shrink) fullscreens the map shell root
  (`shellRef` + `fullscreenchange` listener; shell swaps `h-screen` and gets
  `bg-background`). The store import is `scene3d/camera-focus.store` directly —
  tiny, zustand-only, safe outside the lazy 3D chunk.
- **Catalog expansion (+27 kinds, ~45 total):** recipes live in
  `scene3d/objects/recipes-extra.tsx` (`buildExtraKind` fallback from
  SceneObject's switch). Furniture: chair, sofa, locker, shelf_unit, counter,
  partition, whiteboard. Equipment: pallet_jack, hand_truck, agv_robot,
  scissor_lift, ladder, floor_scale, stretch_wrapper, trash_bin, fan,
  fire_extinguisher. Storage: drum, crate_stack, gaylord, tote_stack.
  Structure: fence, gate, bollard, guard_shack, cone. Decor: tree.
  FurnitureLibraryPanel gained a **search box**. DB needs no migration (kind is
  free text).
- **Render-on-demand:** `<Canvas frameloop={cameraMode === 'fly' ? 'always' :
  'demand'}>` — idle GPU drops to ~0. Self-invalidation added where animation
  must keep the loop alive: WeatherLayer precipitation + thunder, Focuser
  tween + toolbar zoom effect, EditGizmo `onObjectChange`. drei controls and
  React state changes (ghost moves) invalidate automatically. Fly mode needs
  `always` (WASD polling isn't event-driven).
- **Loading:** `inventory-management.tsx` idle-prefetches the map gate → scene3d
  → vendor-three chunk chain (`requestIdleCallback`, 2s timeout fallback), so
  the Locations tab opens warm.
- **Showcase harness:** `/scene3d-harness?showcase` renders every catalog kind
  in a grid (no DB) — `src/routes/-scene3d-showcase.tsx` (the `-` prefix keeps
  it out of the route tree). Used to smoke-test all 27 new recipes at once.

## Gotchas
- `feature-warehouse-3d` is at **489.6 KB / 500** — the NEXT object batch must
  be split into its own chunk (e.g. lazy catalog module), not appended.
- `git stash` in this repo is dangerous while tooling regenerates
  `routeTree.gen.ts` — a pop conflict can leave the tree reverted (recovered
  via `git checkout -- src/routeTree.gen.ts && git stash pop`).
- Lint baseline: the 41 warnings in warehouse-map/** pre-exist this work.

## Related
- [[Build-Mode-Minecraft-Style-Placement]]
- [[Fix-Location-3D-Black-Scene-Night-Fog-SoftShadows]]
- [[ADR-Location-Tab-Isometric-3D-Overhaul]]
