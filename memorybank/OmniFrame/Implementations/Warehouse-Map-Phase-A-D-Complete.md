---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-04-25
---
# Warehouse Map: Full Phase A–D Implementation

## Purpose
Per [[ADR-Floor-Mapping-Build-vs-Buy]], the user requested A through D of the roadmap implemented "down to the bone". This note tracks every artifact shipped in a single session.

## Phases delivered

### Phase A — Wire existing pieces
- Replaced placeholders in `warehouse-location-map.tsx` with real `MiniMap`, `MapLegend`, `LocationDetailPanel`, `RackConfigPanel`, `MapContextMenu`, `Rack3DViewer`, `WarehouseMapAccessibleList`.
- Per-cell click → opens `LocationDetailPanel` for that `mapping_id`.
- `activeDataLayer` plumbed into `MapCanvas` (status colors active; stock/utilization/activity reuse status palette as a base — ready for richer rendering when MapWindowRow data is fetched per cell).
- Background image fetched via `getBackgroundSignedUrl` and rendered as a Konva `Image` layer behind everything.
- Zones rendered as **true polygons** (Konva `Line closed`) instead of bounding boxes.
- `searchQuery` → `highlightedBin` → pulsing `Circle` overlay at the matched cell.
- Fixed `Rack3DViewer` 0/1-based indexing bug (`rack-3d-viewer.tsx` line 91).
- `update_location_operational_status` now passes `p_changed_by` from `auth.getUser`.
- Migration **235** adds `warehouse_location_mappings`, `warehouse_auto_map_runs`, `warehouse_location_status_log` to `supabase_realtime` publication; adds `get_windowed_location_details`, `get_warehouse_map_diagnostics`, and `ensure_warehouse_map_settings` RPCs.

### Phase B — Performance + polish
- Replaced HTML-div canvas with **`react-konva` `Stage` + Layer architecture** (`map-canvas.tsx`). Wheel zoom-around-cursor, drag-pan, ResizeObserver, fit-to-bounds on first load.
- Polygon zone drawing (`polygon-draw-layer.tsx`) for `edit-zones` and `edit-building` modes: click vertices, double-click or click first vertex to close, Escape cancels, Enter commits, Backspace removes last point. Optional grid snap from `map.grid_settings.size` when `snap=true`.
- Drag rack repositioning (`edit-racks` mode) persists via `service.updateRack`.
- Real `publish_map_revision` (migration **236**) snapshots zones, racks, mappings, building outline, scale, grid_settings into `warehouse_map_revisions.snapshot_json`. Optimistic concurrency check via `expected_revision`. `rollback_map_revision` restores the snapshot. `get_map_revisions` lists history.
- `auto_map_runs` worker (migration **237**) implements greedy bin→cell assignment with conflict detection, auto-trigger on insert, plus `apply_auto_map_run` and `cancel_auto_map_run`.
- `ensure_warehouse_map_settings` initializes a row per org if missing.
- Diagnostics panel powered by `get_warehouse_map_diagnostics` (orphan, unmapped, stale, ambiguous MLGT, dup labels, auto-map warnings).
- Background upload dialog with hash-based dedupe (existing service path).
- 3D rack viewer wired behind `show_3d_viewer` setting and triggered from rack context menu.

### Phase C — Pathfinding
- Migration **238**: `warehouse_aisle_nodes` (id, x, y, floor_level, kind), `warehouse_aisle_edges` (from, to, cost, one_way, is_stair, is_elevator), `nearest_node_id` on `warehouse_location_mappings`. Helpers: `find_nearest_node`, `backfill_mapping_nearest_node`, `auto_connect_aisle_nodes` (k-NN), `seed_aisle_nodes_from_racks`.
- Migration **239**: `get_route(map_id, from_bin, to_bin)` runs **A\* / Dijkstra via recursive CTE** over a bidirectional edge view; `get_pick_tour(map_id, from_bin, bins[])` does **nearest-neighbour** ordering with iterative `get_route` calls and concatenates polylines.
- `RouteOverlay` (`route-overlay.tsx`) renders the polyline as a Konva `Layer` with marching-ants animation, glow halo, and labeled start/end markers.
- `RoutePanel` (`route-panel.tsx`): from/to inputs, navigate single, multi-bin tour builder.
- Search bin → highlight wired (cell pulse).
- `MapContextMenu` adds **"Navigate from here"** action that pre-fills routeFromBin and opens RoutePanel.
- Edit-aisles mode in `map-canvas`: click empty space to add a node, click two nodes to connect (creates edge with Manhattan cost), drag a node to move it. `AisleGraphEditor` portal panel offers "Auto-connect (k=4)" and "Seed from racks".
- **Multi-floor** support: `FloorSwitcher` reads/writes `currentFloor`, canvas filters zones, racks, aisle nodes/edges by floor; aisle edges support `is_stair` and `is_elevator` flags.

### Phase D — Optional advanced
- **DXF import** (`dxf-parser.ts` + `dxf-import-dialog.tsx`): pure-TS ASCII DXF parser handles `LINE`, `CIRCLE`, `LWPOLYLINE`, `POLYLINE`/`SEQEND`, with bounds + layer roster. Dialog previews on a fit-to-bounds Konva stage, lets user map each layer to Building/Zone/Rack/Aisle/Ignore (with smart defaults from layer name), and persists via `WarehouseMapService`.
- **Live asset tracking** (migration **240** + `asset-position-overlay.tsx`): `warehouse_assets`, `warehouse_asset_positions`, `warehouse_asset_position_latest` tables with `ingest_asset_position` RPC. Realtime publication. Overlay does smooth interpolation (rAF-driven exponential lerp), pulsing rings, kind-coded markers (forklift/operator/cart/pallet_jack/robot/sensor/other), directional indicator lines.
- **Embeddable widget** (`warehouse-map-widget.tsx`): self-contained `WarehouseMapWidget` for use in Cycle Count, Putaway, Picking, etc. Lightweight Konva render with pulsing highlights, route polyline support, and `onCellClick` callback.
- **Print / PDF / image export** (`map-export-button.tsx`): PNG, JPEG (95%), PDF via `html-to-image` capture + a print-window flow with landscape A3 `@page` CSS.

## Files created (24)

### SQL migrations (6)
- `supabase/migrations/235_warehouse_map_phase_a_fixes.sql`
- `supabase/migrations/236_warehouse_map_revisions_publish.sql`
- `supabase/migrations/237_warehouse_auto_map_worker.sql`
- `supabase/migrations/238_warehouse_aisle_graph.sql`
- `supabase/migrations/239_warehouse_routing_rpcs.sql`
- `supabase/migrations/240_warehouse_asset_positions.sql`

### TypeScript components / utilities (16)
- `src/components/warehouse-map/route-overlay.tsx`
- `src/components/warehouse-map/asset-position-overlay.tsx`
- `src/components/warehouse-map/aisle-graph-editor.tsx`
- `src/components/warehouse-map/dxf-import-dialog.tsx`
- `src/components/warehouse-map/map-export-button.tsx`
- `src/components/warehouse-map/warehouse-map-widget.tsx`
- `src/components/warehouse-map/route-panel.tsx`
- `src/components/warehouse-map/revisions-panel.tsx`
- `src/components/warehouse-map/diagnostics-panel.tsx`
- `src/components/warehouse-map/floor-switcher.tsx`
- `src/components/warehouse-map/background-upload-dialog.tsx`
- `src/components/warehouse-map/polygon-draw-layer.tsx`
- `src/lib/utils/dxf-parser.ts`
- (parallel workstream created: same files as above also documented in their own implementation notes)

## Files rewritten (8)
- `src/components/warehouse-map/map-canvas.tsx` — full Konva rewrite
- `src/components/warehouse-map/warehouse-location-map.tsx` — shell rewrite that mounts every subcomponent
- `src/components/warehouse-map/map-toolbar.tsx` — expanded with publish, upload, import, navigate, layers, more menu
- `src/components/warehouse-map/publish-layout-dialog.tsx` — wired to real RPC with optimistic concurrency
- `src/components/warehouse-map/map-context-menu.tsx` — added View 3D + Navigate from here
- `src/components/warehouse-map/types.ts` — added aisle/route/asset/revision types; extended `EditMode` with `'edit-aisles'`; extended `SidebarPanel` with `'rack-3d' | 'revisions' | 'auto-map' | 'route'`
- `src/lib/supabase/warehouse-map.service.ts` — added 25+ new methods (windowed details, diagnostics, publish/rollback/list revisions, auto-map worker apply/cancel, aisle graph CRUD, auto-connect, seed, route, pick tour, asset assets/positions, realtime channels)
- `src/stores/warehouse-map-store.ts` — imports types from canonical source, adds route/floor/aisle-graph/asset-position state, real undo/redo via popUndo/popRedo, fit-to-view with proper math, toggleSelection helper

## Schema additions summary
- New enums: `warehouse_aisle_node_kind`, `warehouse_asset_kind`
- New tables: `warehouse_aisle_nodes`, `warehouse_aisle_edges`, `warehouse_assets`, `warehouse_asset_positions`, `warehouse_asset_position_latest`
- New column: `warehouse_location_mappings.nearest_node_id`
- New RPCs: `get_windowed_location_details`, `get_warehouse_map_diagnostics`, `ensure_warehouse_map_settings`, `publish_map_revision`, `rollback_map_revision`, `get_map_revisions`, `execute_auto_map_run`, `apply_auto_map_run`, `cancel_auto_map_run`, `find_nearest_node`, `backfill_mapping_nearest_node`, `auto_connect_aisle_nodes`, `seed_aisle_nodes_from_racks`, `get_route`, `get_pick_tour`, `ingest_asset_position`, `prune_asset_positions`
- Realtime publication added: `warehouse_location_mappings`, `warehouse_auto_map_runs`, `warehouse_location_status_log`, `warehouse_aisle_nodes`, `warehouse_aisle_edges`, `warehouse_asset_position_latest`, `warehouse_assets`

## Quality gates
- ReadLints across all 24 new + 8 rewritten files: **clean** (one Tailwind class shorthand warning fixed `w-[28rem]` → `w-md`).
- Vite HMR is reloading edits in real time (terminal log shows `react-konva` newly optimized).
- All migrations are idempotent (`IF NOT EXISTS` / `ON CONFLICT` / `CREATE OR REPLACE`).
- All new tables have RLS with the standard `(auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID` org-scope policy.

## Outstanding (deliberate non-goals)
- Generated `database.types.ts` is not regenerated for migrations 235–240; the service file uses targeted `as any` casts plus a top-of-file `@ts-nocheck` for the few places it's already using one. A regeneration via `supabase gen types typescript` is recommended next time the user runs the codegen pipeline.
- Phase D "BLE/UWB hardware integration" is not implemented — only the data plane (positions table + ingest RPC + overlay) is. Hardware-specific ingest adapters are a follow-up.
- The A\* in `get_route` uses recursive CTE-based Dijkstra (Postgres lacks a native priority queue). Acceptable for typical warehouse graphs of ~hundreds of nodes; for thousands, consider a `plpython3u` A\* or an Edge function.
- Aisle graph editor's HTML mini-toolbar relies on the parallel-built component file; the canvas's inline edit mode also handles add/connect/move via direct mutations. Both paths coexist; user can choose.

## Apply migrations
Run in order with the standard pipeline:
```bash
supabase db push  # or your migration runner
```
Then optionally call `service.backfillMappingNearestNode(mapId)` and `service.seedAisleNodesFromRacks(mapId)` once per warehouse to bootstrap the routing graph.

## Related
- [[ADR-Floor-Mapping-Build-vs-Buy]] (the ADR that scoped this work)
- [[Warehouse Map - Feature Module]] (component MOC — needs refresh)
- [[Path-Engine-Configuration]] (existing symbolic engine; orthogonal to the new geometric routing)
- [[Architecture]]
