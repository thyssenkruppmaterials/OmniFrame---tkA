---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-06-08
---
# Fix — Location Tab 3D HUD Overlap & Scene Contrast

## Purpose / Context
After the [[ADR-Location-Tab-Isometric-3D-Overhaul]] made the isometric
`WarehouseScene3D` the default render path, the Location tab stacked **two**
HUD systems in the same container: the scene's own purpose-built HUD
(`scene3d/WarehouseScene3D.tsx` → `SceneHud`) **and** the shell's legacy
2D-era overlays in `warehouse-location-map.tsx` (`MapExportButton`,
`MapLegend`, `FloorSwitcher`, edit-mode hint). Both claimed the same corners,
so in 3D the chrome collided — the user's screenshot showed the **Export**
button overlapping the **Isometric** camera-mode toggle (top-left) and the
**Operational Status** legend sitting on top of the scene's compass/scale/help
cluster (bottom-left). The scene also read as light-grey-on-light-grey — the
warehouse was barely visible.

## Details

### Corner de-confliction (the scene HUD owns the corners; the shell yields)
- **Top-left** — the shell's `MapExportButton` overlay is now rendered **2D
  only** (`{!is3DMode && …}`). The 3D scene already exports via
  `canvas.toDataURL()` (correct for WebGL; the DOM `html-to-image` path the
  shell button uses can't capture a WebGL canvas), so in 3D it was both a
  duplicate action and the cause of the overlap.
- **Bottom-left** — the scene HUD's compass + scale-bar + shortcuts-help
  cluster moved from `bottom-4 left-4` to **`right-4 bottom-16`** (stacked just
  above the bottom-right nav hint). Bottom-left stays reserved for the shell's
  `MapLegend`; bottom-centre is reserved for `MultiSelectToolbar`
  (`bottom-4 left-1/2`), which is why the cluster went to the bottom-right
  stack rather than bottom-centre.
- **Top-right** — `FloorSwitcher` (shell, multi-floor only) now drops to the
  vertically-centred right edge in 3D (`top-1/2 -translate-y-1/2`) so it clears
  the scene HUD's Insights/Heatmap/Weather/Edit row. Required switching
  `floor-switcher.tsx` to `cn()` so the passed `className` actually overrides
  the base `top-4` (tailwind-merge; plain string concat does not win).
- **Bottom-centre** — the shell's amber edit-mode hint is now **2D only**
  (`{!is3DMode && editMode !== 'view' && …}`). In 3D the only non-`view` mode
  is `edit-objects`, which the scene HUD already narrates; the shell banner was
  a duplicate (and not in its `editMode` switch, so it rendered label-only).

### Scene contrast (soft-daylight look kept; definition added)
The palette was intentionally soft (see ADR) but had near-zero luminance
separation. In `scene3d/scene-config.ts` `PALETTE`:
- `ground` `#c9d3e0` → `#b3c0d4` — distinctly darker than the interior
  `floor` `#e7ecf3` so the building reads as a lit slab on a table (the "toy
  miniature" depth cue) instead of blending in.
- `wallEdge` `#9fb0c6` → `#6b7c97` and the `BuildingShell` outline opacity
  `0.25` → `0.55` — keeps the footprint crisp even with the glass walls at
  0.32 opacity.
- `rackShelf` `#cdd6e3` → `#b9c4d6` — a touch more definition on the decks.

## Wiring review (no changes needed — confirmed sound)
- Store (`warehouse-map-store.ts`) carries all 3D state (`cameraMode`,
  `sceneQuality`, `weatherOverlayEnabled`, `editMode: 'edit-objects'`,
  `placingKind`, `selectedObjectId(s)`); `SidebarPanel` includes
  `object-config`.
- Scene-object persistence (`warehouse-scene-objects.service.ts` +
  `use-scene-objects.ts`) is TanStack-Query / manual-invalidation only — **no
  `supabase.channel`**, realtime-policy compliant — and `list()` returns `[]`
  if migration **335** (`warehouse_scene_objects`, additive, org-scoped RLS for
  superadmin/admin/manager/logistics_coordinator) isn't applied, so the tab
  never breaks pre-migration.

## Known follow-up (not changed here)
`MapToolbar` zoom-in/out/fit buttons drive the 2D viewport store and are
no-ops in 3D (the scene uses scroll-zoom + the HUD "Frame" button). They live
in the toolbar (not over the scene) so they don't overlap anything; left as a
separate cleanup.

## Verification
`tsc -b` exit 0 · ESLint on touched files = 0 errors (9 warnings, all
pre-existing `useMutation` dep warnings, none new → ratchet unaffected) · all
18 `scene3d/__tests__` tests pass.

## Related
- [[ADR-Location-Tab-Isometric-3D-Overhaul]]
- [[Kit-Grid-Derived-Stage-Status]]
