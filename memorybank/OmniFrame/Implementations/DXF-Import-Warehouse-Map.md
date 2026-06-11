---
tags: [type/implementation, status/active, domain/frontend, domain/database]
created: 2026-04-25
---
# DXF Import → Warehouse Map

## Purpose / Context
Let customers seed a `warehouse_maps` row from existing CAD floorplans rather than hand-drawing zones / racks / aisles. Two new files only — a minimal ASCII DXF parser and a shadcn dialog that drives the import. No other files were modified.

Follow-up to [[ADR-Floor-Mapping-Build-vs-Buy]] (build, not buy) and a step toward closing the Phase A "empty map" gap called out in [[Warehouse Map - Feature Module]].

## Files
- `src/lib/utils/dxf-parser.ts` — pure-TS DXF tokenizer + entity reader.
- `src/components/warehouse-map/dxf-import-dialog.tsx` — the user-facing dialog.

## DXF Parser (`dxf-parser.ts`)
- Tokenizer turns the file into `(group-code, value)` pairs, robust against CRLF, BOM, and stray blank lines. Lines that don't parse as integers are skipped without losing alignment of subsequent pairs.
- Walks pairs as a tiny state machine. Code `0` opens an entity; everything until the next `0` is collected into a `FieldBag` (`Record<number, string[]>`) so that repeated codes — most notably 10/20 vertex pairs on `LWPOLYLINE` — survive intact.
- Per entity:
  - `LINE`  : 10/20 → start, 11/21 → end, 8 → layer.
  - `CIRCLE`: 10/20 → center, 40 → radius, 8 → layer.
  - `LWPOLYLINE`: zips the 10 / 20 arrays into points, decodes `closed` from bit 1 of group 70.
  - `POLYLINE`  : reads header, then walks subsequent `VERTEX` entities (taking 10/20) until a `SEQEND` entity. `closed` is bit 1 of group 70.
- Unsupported entities are skipped using the same `readFields` helper so the parser doesn't fall out of phase.
- Bounds are computed from all rendered vertices (CIRCLE expands to `(cx±r, cy±r)`); empty input returns `{0,0,0,0}`.

Returns `{ entities, layers, bounds }` where `layers` is a sorted unique list of group-code-8 values seen.

## Dialog (`dxf-import-dialog.tsx`)
- Props: `{ mapId, open, onClose, onImported }`.
- Step 1: `<Input type="file" accept=".dxf">`. On change, reads text via `File.text()` and runs `parseDxf`. Toasts a success summary.
- Step 2: `Tabs` with two panes
  - **Preview** — react-konva `Stage` of all entities, fit-to-bounds (Y-flipped to map DXF Y-up onto screen Y-down). Each layer gets a deterministic palette colour (hashed name). LINE / LWPOLYLINE / POLYLINE → `<Line>`, CIRCLE → `<Circle>`.
  - **Mapping** — `Table` of `layer | entity count | role <Select>`. Roles: Building Outline / Zone / Rack / Aisle / Ignore.
- Heuristic defaults by layer name: `wall|outline|floorplan|building|perimeter` → Building, `zone|area|region` → Zone, `rack|shelf|shelving|bay` → Rack, `aisle|path|walkway|corridor` → Aisle, else Ignore.
- Import flow runs in a TanStack `useMutation`:
  - Fetches `organization_id` inline (auth.getUser → user_profiles) so it can populate `WarehouseZone` / `WarehouseRack` rows that don't auto-fill org id.
  - Building Outline → largest closed polyline by AABB area → `service.updateMap(mapId, { building_outline })`.
  - Zone → each closed polyline → `service.createZone({ zone_type: 'storage', color: '#3B82F6', opacity: 0.3, floor_level: 0, sort_order: 0 })`.
  - Rack → each closed polyline → AABB → `service.createRack({ rack_type: 'shelving', rows: 4, columns: 6, position_x/y, width, height })`.
  - Aisle → each open polyline → a `warehouse_aisle_node` per vertex (floor 0, kind `aisle`), then `warehouse_aisle_edges` connecting consecutive vertices with cost = euclidean distance.
- Success: invalidates queries with key prefix `warehouse*` and calls `onImported() + onClose()`. Per-layer progress toasts during the run, plus a final aggregate toast.

## Constraints
- Only **two** files added; no other source touched. `WarehouseMapService` does not yet expose `createAisleNode` / `createAisleEdge` (migration 238 introduces the tables) — the dialog calls them via a typed cast on the service instance with a comment, so it compiles today and "goes live" the moment those methods are added to the class.

## Related
- [[Warehouse Map - Feature Module]]
- [[ADR-Floor-Mapping-Build-vs-Buy]]
- [[ProductivityAndSettings - Supabase Service]]
