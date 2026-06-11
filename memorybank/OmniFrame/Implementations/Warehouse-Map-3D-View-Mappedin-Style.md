---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-04-25
---
# Warehouse Map — Full 3D View (Mappedin-style)

## Trigger
After the Edit Toolbar polish, the user noted: "I also do not see the 3d mapping like Mappedin shows the actual racking etc." The existing `Rack3DViewer` was a single-rack modal; what was needed was a **whole-warehouse 3D scene** with extruded walls, zones as floor patches, every rack as a 3D box-grid, and the same overlays we have in 2D (route, asset positions, aisle graph) projected into 3D.

## Implemented

### `src/components/warehouse-map/warehouse-3d-view.tsx`
- `react-three-fiber` `Canvas` with shadows, fog, ambient + directional + drei `Environment` (warehouse preset).
- World scale: `1 / 100` so a 1000-unit-wide map becomes a 10 m floor. 2D x → 3D x, 2D y → 3D z, floor at y=0.
- **`BuildingShell`**: extrudes `building_outline` polygon edges into ~4.5 m semi-transparent walls (opacity 0.18) with a wireframe overlay; fills the floor inside the outline with a darker plate to highlight the building footprint.
- **`ZoneShape`**: draws each zone polygon as a translucent floor patch at y=0.02 with the zone's color; floats the zone label as billboarded text above its centroid.
- **`Rack3D`**: renders each rack as 4 metal posts + (rows+1) shelf decks + a grid of cargo `boxGeometry` cells colored by `STATUS_COLORS[operational_status]`. Highlighted bin glows cyan with `<Edges>`. Cells are clickable (→ `onCellClick(mappingId)` opens `LocationDetailPanel`) and the rack body is clickable (→ `onRackClick(rackId)` opens `RackConfigPanel`). Rack rotation honored.
- **`AisleGraph3D`**: nodes as small emissive spheres color-coded by kind (aisle/doorway/dock/stair/elevator/manual), edges as thin lines (purple if one-way, emerald if bidi).
- **`Route3D`**: the active A* polyline as a thick cyan line + a wider 25% opacity glow underneath, plus a darker start sphere + a brighter destination sphere.
- **`AssetMarker3D`**: cone + small bar showing forklift/operator/etc. position with heading.
- **`OrbitControls`** with damping, polar clamp at π/2.05 (cannot tilt below floor), distance clamps based on world bounds.
- HTML overlay shows orbit / pan / zoom hint in the bottom-right.

### Store (`stores/warehouse-map-store.ts`)
- New state: `is3DMode: boolean`.
- New actions: `toggle3DMode()`, `set3DMode(on)`.
- `setEditMode` auto-switches **out of 3D** when entering an edit mode (editing is Konva-based 2D; UX would be confusing if the edit toolbar were active without an editable canvas).

### Toolbar (`map-toolbar.tsx`)
- New segmented "3D / 2D" button between the layer-toggles and list/map toggle. Uses Box / Layers icons. Pressed (`secondary`) when 3D is on.

### Shell (`warehouse-location-map.tsx`)
- Conditionally renders `<Warehouse3DView>` instead of `<MapCanvas>` when `is3DMode` is true.
- MiniMap (which reads from the 2D viewport store) is hidden in 3D mode.
- `?`-style keyboard cheatsheet adds a "3D view" group (orbit / right-drag / scroll / cell click).
- New global keys: `3` toggles 3D, `2` forces 2D.

## Coordinate convention
- 2D world units: arbitrary (~cm).
- 3D world units: meters (scale 1/100).
- Y is up. Floor plane at y=0. Racks extrude upward.
- Camera: positioned isometrically above and behind the world centroid; orbit target at (centroid.x, 1, centroid.z).

## Performance notes
- ~18 racks × 24 cells = ~432 boxes; well within Three.js comfort zone with non-instanced meshes. If we ever push past ~5k cells we should swap to `InstancedMesh` keyed by status.
- Shadow map is 2048² with directional light only — acceptable on modern GPUs.
- Three.js was newly optimized by Vite (HMR log line at 10:24:36 AM); first 3D toggle takes ~1–2 s as the bundle resolves.

## What we still don't have vs full Mappedin
- **Texture-mapped racks** (we use solid colors; Mappedin uses photographic textures for some venues).
- **Built-in pathfinding overlays at floor level animated like a flight path** (we have a static line; Mappedin uses animated arrows with auto-camera-follow).
- **Mobile gesture support** in 3D (drei `OrbitControls` does support touch, but we haven't tuned for it).
- **Texture from background floor plan** — we render the building outline + zones, but the uploaded floor-plan image isn't projected onto the 3D floor yet. Easy follow-up: convert `bgImage` to a `THREE.Texture` and apply it to the floor plane mesh.

## Files
- new: `warehouse-3d-view.tsx`
- modified: `warehouse-location-map.tsx`, `map-toolbar.tsx`, `keyboard-shortcuts-dialog.tsx`, `stores/warehouse-map-store.ts`
- ReadLints clean across all changed files.

## Related
- [[Warehouse-Map-Phase-A-D-Complete]]
- [[Warehouse-Map-Edit-Toolbar-And-Polish]]
- [[ADR-Floor-Mapping-Build-vs-Buy]]
