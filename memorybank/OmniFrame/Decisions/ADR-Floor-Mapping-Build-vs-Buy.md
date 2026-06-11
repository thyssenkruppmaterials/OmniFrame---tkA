---
tags: [type/decision, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-04-25
---
# ADR — Floor Mapping: Build In-House vs Buy (Mappedin)

## Context
User asked whether to use a third-party indoor-mapping platform like [Mappedin](https://www.mappedin.com/industries/warehouses/) or finish the in-house warehouse map. Goal: "completely designed floor mapping that I can make locations to down to the bay, interactive, path mapping etc."

A three-pronged read-only review (frontend / backend / pathfinding) was performed.

## Current State (evidence-based)

### Frontend (`src/components/warehouse-map/*`)
- **15 files exist**, but **the main `WarehouseLocationMap` shell uses inline placeholders** for mini-map, legend, and the location-detail panel; the polished components (`MiniMap`, `MapLegend`, full `LocationDetailPanel`, `Rack3DViewer`, `MapContextMenu`, `WarehouseMapAccessibleList`, `PublishLayoutDialog`) are **not mounted** in the live screen.
- **Canvas is HTML `div` + CSS `transform: translate scale`**, not Canvas2D / SVG / WebGL. Per-cell `div`s scale poorly past ~10k cells.
- **Zones rendered as bounding boxes** (axis-aligned rect) instead of true polygons (`map-canvas.tsx` 118–151).
- **Cells are not clickable** — only racks are (`map-canvas.tsx` 215–244).
- **No background floor-plan image is rendered** even though the service uploads it (`warehouse-map.service.ts` 374–438).
- **`activeDataLayer`, `searchQuery`, `highlightedBin`, `isListMode`** are toggleable in the toolbar/store but **not consumed** by the canvas.
- **3D viewer has a row/column off-by-one bug** (1-based DB vs 0-based loops in `rack-3d-viewer.tsx` 42–47 vs 89–91).
- **Realtime subscription** invalidates only the layout query, not the mappings query → cell colors stay stale (`warehouse-location-map.tsx` 89–95).
- **`readOnly`** prop is passed to `MapCanvas` but never destructured — toggle is dead.

### Backend (`supabase/migrations/202_create_warehouse_map_tables.sql`)
- **Schema is solid**: `warehouse_maps`, `_revisions`, `_background_assets`, `warehouse_zones`, `warehouse_racks`, `warehouse_location_mappings` (with `rack_row`, `rack_column` for bay granularity), `warehouse_location_status_log`, `warehouse_auto_map_runs`. Org-scoped RLS, indexes, and triggers in place.
- **RPCs implemented**: `get_warehouse_map_layout`, `get_warehouse_map_statistics`, `get_unassigned_bins`, `bulk_assign_locations`, `update_location_operational_status`.
- **`get_windowed_location_details`** is **called from the frontend but NOT in any migration** — likely runtime error or hand-applied DB function not in source control.
- **Realtime publication** is **not** added in migrations (`ALTER PUBLICATION supabase_realtime ADD TABLE warehouse_location_mappings` is missing) — Realtime may not fire.
- **`update_location_operational_status` signature mismatch**: DB requires `p_changed_by`; service does not pass it.
- **`createAutoMapRun` insert is incomplete** — missing required `organization_id` / `warehouse_code`.
- **Auto-map worker does not exist** — no Edge function, no Rust route, no SQL job; only a queue table.
- **Publish/revision workflow is stubbed** — `PublishLayoutDialog` calls `updateMap` with a new `updated_at`, never inserts a revision snapshot.
- **No PostGIS / spatial index** in migrations.
- **No multi-floor topology** (only `floor_level` column on zones).

### Pathfinding
- **Zero geometric pathfinding exists.** No A*, no Dijkstra, no aisle graph, no navmesh, no waypoints.
- The existing "Path Engine" (`src/components/path-engine-panel.tsx`, `src/lib/supabase/path-rules.service.ts`, `supabase/migrations/204_create_cycle_count_path_rules_engine.sql`) is **symbolic/regex-based ordering** for cycle count work — not floor-walking routes.
- **No 3rd-party path libs** are installed (`pathfinding`, `ngraph.path`, `mappedin`, etc. — none in `package.json`). `dijkstrajs` exists transitively only via the `qrcode` package.
- The `highlightedBin` setter exists in the store but is referenced **nowhere in the UI** — search-to-highlight is unimplemented.

## Mappedin Feature Matrix (vs current state)

| Capability                                | Mappedin | OmniFrame today |
|-------------------------------------------|----------|-----------------|
| 2D floor visualization                    | Yes      | Partial (AABB, divs) |
| Bay-level (row/col) granularity in DB     | n/a      | **Have** |
| Bay-level click/select on canvas          | Yes      | **Missing** |
| Floor-plan image overlay                  | Yes      | **Partial** (uploaded, not rendered) |
| Multi-floor                                | Yes      | **Missing** |
| True polygon zones                        | Yes      | **Missing** |
| 3D view                                   | Yes      | **Partial** (built, not mounted, has bug) |
| Wayfinding (A→B path) on map              | Yes      | **Missing** |
| Search-to-route                           | Yes      | **Missing** |
| Mobile / touch gestures                   | Yes      | **Missing** |
| Indoor positioning (BLE/UWB/RFID)         | Yes (integrations) | **Missing** |
| CAD/DXF/IFC import                        | Yes      | **Missing** |
| Tile server for huge plans                | Yes      | **Missing** |
| SDK / embeddable widget                   | Yes      | **Missing** |
| SAP LX03 / MLGT integration               | No (custom) | **Have** |
| Operational status workflow + audit       | No (generic) | **Have** |
| Auto-map bins → cells from SAP            | No       | **Partial** (queue only, no worker) |
| Cycle-count integration / zone exclusivity| No       | **Have** |
| Org-scoped RLS / multi-tenant             | n/a (SaaS) | **Have** |

## Decision
**Build in-house. Do NOT adopt Mappedin.**

### Rationale
1. **The hardest, most differentiated work is already built — and it's not what Mappedin sells.** SAP LX03 / MLGT bin reconciliation, operational status workflows, cycle-count zone exclusivity, org-scoped RLS, putaway/cycle-count integration. Replacing these with Mappedin would be a regression.
2. **What's missing is the *visual / interaction* layer**, which is well-scoped, finite engineering work — not a 12-month indoor-positioning platform play.
3. **Mappedin's value props (consumer wayfinding, BLE positioning, SDKs for mall apps) are not the user's actual need.** User wants warehouse ops, not visitor navigation.
4. **Vendor lock-in + per-venue licensing** for a feature that ships behind enterprise auth and integrates 5+ internal services is a poor fit.
5. **The data model already supports bay-level granularity** (`rack_row`, `rack_column` on `warehouse_location_mappings`); we just need the canvas to read it back.

### Where Mappedin would still be the right call (not us)
- A consumer / visitor mobile app for a public-facing campus.
- Multi-tenant 3D mall directories with kiosk wayfinding.
- Active BLE/UWB indoor positioning at scale with a vendor-managed beacon network.

## Roadmap (in priority order, so the in-house map matches the request)

### Phase A — Wire the existing pieces (1–2 sprints)
1. Replace inline placeholders in `warehouse-location-map.tsx` with the real `MiniMap`, `MapLegend`, `LocationDetailPanel`, optional `Rack3DViewer`, `MapContextMenu`.
2. Add per-cell click → open `LocationDetailPanel` for that `mapping_id`.
3. Plumb `activeDataLayer` (status / stock / utilization / activity) into `MapCanvas` rendering.
4. Render the uploaded background floor-plan image behind zones/racks; add scale-calibration UI.
5. Render zones as **true polygons** (SVG layer on top of the transformed canvas).
6. Wire `searchQuery` → `highlightedBin` → cell pulse animation.
7. Fix the `update_location_operational_status` signature mismatch and the 3D viewer 0/1-based indexing bug.
8. Add `ALTER PUBLICATION supabase_realtime ADD TABLE warehouse_location_mappings` migration; invalidate the mappings query on Realtime events.
9. Migrate `get_windowed_location_details` (currently called but missing in source) into a real migration file.

### Phase B — Performance and polish (1–2 sprints)
10. Replace the per-cell `div` rendering with a single Canvas2D layer (or `react-konva` — already in `package.json`!) so the map handles 50k+ cells smoothly.
11. Add touch / pinch-zoom gestures for mobile / tablet (warehouse floor use case).
12. Implement the real revision/publish flow (insert into `warehouse_map_revisions` with snapshot JSON; restore on rollback).
13. Build the auto-map worker (Postgres function or Edge function) that fills `proposed_assignments` and `conflicts`.
14. Add diagnostics RPC to back the `MapDiagnostics` types (orphans, stale, ambiguous MLGT, duplicate labels).

### Phase C — Pathfinding / wayfinding (the "path mapping" ask) (2–3 sprints)
15. **New table `warehouse_aisle_nodes`** — waypoints at aisle intersections, doorways, P&D ends, with `(map_id, x, y, floor_level)`.
16. **New table `warehouse_aisle_edges`** — graph edges with cost (Manhattan distance + penalty for narrow / one-way aisles).
17. **Each `warehouse_location_mapping`** gets a `nearest_node_id` (face-of-aisle anchor) — backfilled by a function that snaps each cell to the closest aisle node.
18. **New RPC `get_route(p_from_bin, p_to_bin)`** — A* on the aisle graph, returns a polyline of `Point2D[]`.
19. **New canvas layer `RouteOverlay`** — renders the polyline as an SVG path with arrows; supports an animated marching-ants effect.
20. **"Pick path" / TSP variant** for multi-bin tours (cycle count, picks, putaway): nearest-neighbor heuristic inside an aisle traversal pattern (serpentine — already documented in the symbolic Path Engine; now make it geometric).
21. **Multi-floor**: extend nodes/edges with `floor_level`, add stair/elevator edges.

### Phase D — Optional advanced (later, only if needed)
22. CAD import (DXF/IFC) — likely a one-time per warehouse, scriptable.
23. Indoor positioning ingest (BLE/UWB) — only if user buys hardware; the position table + WebSocket layer is straightforward.
24. Embeddable SDK so Cycle Count, Putaway, Picking screens can render mini-maps inline.

## Effort Estimate
- **Phase A**: ~2 weeks (1 dev, mostly wiring existing components).
- **Phase B**: ~2 weeks.
- **Phase C**: ~3–4 weeks (new tables, A* RPC, overlay).
- **Phase D**: per-feature.

Total to reach Mappedin parity for warehouse ops: **~8–10 weeks of focused work**, considerably less than a Mappedin integration + the parallel custom work needed to keep SAP/operational features.

## References
- Frontend review notes: `src/components/warehouse-map/*`
- Backend review notes: `supabase/migrations/202_create_warehouse_map_tables.sql`, `204_create_cycle_count_path_rules_engine.sql`
- Pathfinding audit: `src/components/path-engine-panel.tsx`, `src/lib/supabase/path-rules.service.ts`
- Mappedin: https://www.mappedin.com/industries/warehouses/

## Related
- [[Warehouse Map - Feature Module]]
- [[Path-Engine-Configuration]]
- [[Architecture]]
