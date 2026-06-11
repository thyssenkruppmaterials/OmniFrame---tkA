---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# Warehouse Map

## Purpose
Interactive 2D/3D warehouse floor plan visualization and management system. Maps physical warehouse layouts with zones, racks, and storage bin locations. Provides real-time occupancy, stock levels, and operational status tracking. Supports layout editing with revision control, auto-mapping of SAP storage bins to visual rack cells, and diagnostic health checks.

## Key Components
- **WarehouseLocationMap** (`warehouse-location-map.tsx`) — Main map component orchestrating canvas, toolbar, and panels.
- **MapCanvas** (`map-canvas.tsx`) — HTML5 Canvas-based rendering of warehouse layout with zoom, pan, and grid support.
- **MapToolbar** (`map-toolbar.tsx`) — Toolbar with edit mode switching (view, edit-building, edit-zones, edit-racks) and data layer selection (status, stock, utilization, activity).
- **WarehouseMapGate** (`warehouse-map-gate.tsx`) — Feature gate component that checks organization settings before rendering the map.
- **MiniMap** (`mini-map.tsx`) — Miniature overview of the full warehouse layout for navigation.
- **MapContextMenu** (`map-context-menu.tsx`) — Right-click context menu for map operations.
- **MapLegend** (`map-legend.tsx`) — Legend showing status colors and occupancy icons.
- **MapEmptyState** (`map-empty-state.tsx`) — Empty state when no map data exists.
- **LocationDetailPanel** (`location-detail-panel.tsx`) — Side panel showing storage bin details, stock levels, and status management.
- **RackConfigPanel** (`rack-config-panel.tsx`) — Rack configuration editor for dimensions, type, rows, columns, and aisle assignment.
- **Rack3DViewer** (`rack-3d-viewer.tsx`) — 3D visualization of individual rack structures.
- **PublishLayoutDialog** (`publish-layout-dialog.tsx`) — Dialog for publishing layout revisions with change summaries.
- **WarehouseMapSkeleton** (`warehouse-map-skeleton.tsx`) — Loading skeleton placeholder.
- **WarehouseMapAccessibleList** (`warehouse-map-accessible-list.tsx`) — Accessible list fallback for screen readers.

## Hooks
- Map data hooks backed by Supabase RPCs for `get_map_layout`, windowed location queries, and diagnostics.

## State Management
- `CanvasViewport` — x, y, scale for zoom/pan state
- `EditMode` — view, edit-building, edit-zones, edit-racks
- `DataLayer` — status, stock, utilization, activity visualization overlays
- `SidebarPanel` — none, location-detail, rack-config, zone-config, diagnostics
- Revision control with `WarehouseMapRevision` (draft → published → archived → rolled_back)
- `DraftLayoutPayload` for persisting local edits (zones, racks, location_mappings)
- `UndoAction` stack for edit history

## Types
Extensive type system in `types.ts`:
- **Canvas**: `Point2D`, `Polygon`, `CanvasViewport`, `ViewportBounds`
- **Map**: `WarehouseMap` with organization, warehouse code, scale factor, grid settings, building outline, active revision
- **Revisions**: `WarehouseMapRevision` with version numbers, status, snapshot JSON
- **Background**: `WarehouseMapBackgroundAsset` for floor plan images with content hashing and versioning
- **Zones**: `WarehouseZone` with polygon boundaries, type (receiving, shipping, storage, staging, quality, maintenance, office), color/opacity
- **Racks**: `WarehouseRack` with position, rotation, dimensions, rows/columns, type (pallet, shelving, cantilever, flow, mezzanine)
- **Location Mappings**: `WarehouseLocationMapping` binding SAP storage bins to rack cells with operational status
- **Status**: `OperationalStatus` (active, maintenance, shutdown, reserved, blocked) with audit log via `LocationStatusLogEntry`
- **Auto-Map**: `AutoMapRun` for automated bin-to-rack assignment with conflict detection
- **RPC Responses**: `MapLayoutResponse`, `MapWindowRow` (windowed location detail with occupancy, freshness, MLGT data), `MapStatistics`, `MapDiagnostics`
- **Diagnostics**: Unmapped bins, orphaned mappings, stale bins, ambiguous MLGT matches, duplicate rack labels

## Routes
- Rendered within the main application warehouse management section
- Feature-gated per organization via `WarehouseMapSettings`

## Related
- [[Architecture]]
- [[CubiScan Integration - Feature Module]]


---

## 2026-04-25 — Audit Update (corrects optimistic claims above)

A full read-only review (frontend + backend + pathfinding) found the documented surface here was **aspirational** rather than wired. Concretely:

- **Canvas is HTML `div`s with CSS transform**, NOT HTML5 Canvas as previously stated (`map-canvas.tsx`).
- **Zones render as axis-aligned bounding boxes**, not real polygons.
- **Mini-map, full LocationDetailPanel, Rack3DViewer, MapContextMenu, WarehouseMapAccessibleList, PublishLayoutDialog are NOT mounted** in `warehouse-location-map.tsx` — placeholders are used instead.
- **Per-cell click is missing**; only racks are clickable.
- **Background image upload exists but is not rendered** on the canvas.
- **`activeDataLayer`, `searchQuery`, `highlightedBin`, `isListMode`** toggle but the canvas ignores them.
- **3D rack viewer has a 0-based vs 1-based indexing bug** (`rack-3d-viewer.tsx` 42–47 vs 89–91).
- **Realtime subscription only invalidates the layout query**, not mappings — cell colors stale until refetch.
- **`get_windowed_location_details` RPC is called from `location-detail-panel.tsx` but is NOT in any migration** under `supabase/migrations/`.
- **`update_location_operational_status` signature mismatch** — DB requires `p_changed_by`, service does not pass it.
- **Realtime publication for `warehouse_location_mappings` is missing** from migrations.
- **Auto-map worker does not exist** (only the queue table + an incomplete `createAutoMapRun` insert).
- **Revision/publish is stubbed** — `PublishLayoutDialog` updates a timestamp instead of inserting a revision.
- **Pathfinding / wayfinding is entirely absent.** The existing "Path Engine" is symbolic regex/ordering for cycle counts, not geometric routes.

See [[ADR-Floor-Mapping-Build-vs-Buy]] for the full audit, build-vs-buy decision (build), and phased roadmap.


## 2026-04-25 — Phase A–D Implementation Shipped

Full rewrite of the warehouse map module per [[ADR-Floor-Mapping-Build-vs-Buy]]. See [[Warehouse-Map-Phase-A-D-Complete]] for the complete artifact list.

**Headline changes:**
- `map-canvas.tsx` rewritten on **react-konva** (Stage + Layer architecture, true polygon zones, per-cell click, drag/move racks, rack rotation, Konva-based pan/zoom around cursor, ResizeObserver, fit-to-bounds).
- `warehouse-location-map.tsx` rewritten as a real shell that mounts every subcomponent: `MiniMap`, `MapLegend`, `LocationDetailPanel`, `RackConfigPanel`, `Rack3DViewer` (3D viewer indexing bug fixed), `MapContextMenu`, `WarehouseMapAccessibleList`, `RoutePanel`, `RevisionsPanel`, `DiagnosticsPanel`, `MapExportButton`, `FloorSwitcher`, `BackgroundUploadDialog`, `DxfImportDialog`, `PublishLayoutDialog`.
- `MapToolbar` extended with a full edit-mode select (`view | edit-building | edit-zones | edit-racks | edit-aisles`), publish, upload, DXF import, navigate, revisions, diagnostics, layer toggles (aisle graph + asset positions), bulk status select, and a More dropdown.
- New: `route-overlay.tsx`, `asset-position-overlay.tsx`, `aisle-graph-editor.tsx`, `polygon-draw-layer.tsx`, `dxf-import-dialog.tsx`, `map-export-button.tsx`, `warehouse-map-widget.tsx`, `route-panel.tsx`, `revisions-panel.tsx`, `diagnostics-panel.tsx`, `floor-switcher.tsx`, `background-upload-dialog.tsx`, `dxf-parser.ts`.
- New SQL migrations 235–240: realtime publication, windowed location details RPC, diagnostics RPC, publish/rollback/list revisions, auto-map worker, aisle nodes/edges, A\* / pick-tour RPCs, asset positions tables + ingest.
- Service layer extended with 25+ methods covering revisions, diagnostics, aisle graph CRUD + auto-connect + seeding, routing, asset positions + Realtime channels, settings ensure.
- Store extended with floor, route, aisle/asset toggles; real `popUndo` / `popRedo`; fit-to-view with proper math.

**Bug fixes:**
- `Rack3DViewer` 0/1-based row/column indexing.
- `update_location_operational_status` now passes `p_changed_by` from `auth.getUser`.
- Realtime subscription invalidates the mappings query (was only invalidating layout).
- Realtime publication added for `warehouse_location_mappings` (was missing).
- `get_windowed_location_details` is now in migrations (was called from frontend without a backing function).
- `auto_map_runs` now has a worker function and a trigger; `createAutoMapRun` now passes the required `organization_id` and `warehouse_code`.
- `PublishLayoutDialog` now snapshots a real revision (was just bumping `updated_at`).

**Quality gates:** ReadLints clean across all 24 new + 8 rewritten files. Vite HMR reloading without compile errors.
