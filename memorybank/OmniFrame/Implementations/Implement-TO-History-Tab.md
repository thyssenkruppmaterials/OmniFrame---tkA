---
tags: [type/implementation, status/active, domain/frontend, domain/backend]
created: 2026-04-18
---
# Implement TO History Tab

## Purpose / Context
New "TO History" tab in SAP Testing page. Pulls LT24 data live via the Omni-Agent, renders a vertical timeline of TO lifecycle events, and displays an Obsidian-style force-directed local graph centered on the focused entity (TO, material, bin, or delivery).

## Details

### Agent Side
- **`handler_lt24`** in `omni_agent/agent.py` — supports 4 modes: `by_to`, `by_material`, `by_bin`, `by_delivery`.
  - Navigates `/nLT24`, fills warehouse (`S1_LGNUM`), then mode-specific fields:
    - `by_to`: `S1_TANUM-LOW`
    - `by_material`: `MATNR-LOW`
    - `by_bin`: `S1_LGTYP-LOW` + `S1_LGPLA-LOW`
    - `by_delivery`: `S1_VBELN-LOW`
  - Optional date range via `S1_BDATU-LOW` / `S1_BDATU-HIGH`.
  - Reuses existing `_extract_alv_grid()` fallback chain (ALV → GuiTableControl → SAP list output).
- **`_rows_to_graph(rows, focus)`** — converts flat LT24 rows into `{focus, nodes, edges}` for the frontend graph. Node types: `to`, `material`, `bin`, `user`, `delivery`. Edge relations: `moves`, `picks_from`, `puts_to`, `created_by`, `confirmed_by`, `references`.
- Registered in `QUERY_HANDLERS` as `"lt24": handler_lt24`.
- `AGENT_VERSION` bumped to `1.2.0`.

### Frontend
- **File:** `src/features/admin/sap-testing/components/to-history-tab.tsx`
- **Registered** in `src/features/admin/sap-testing/index.tsx` as tab `'to-history'` → `<TOHistoryTab />`.
- **Layout:** 3-column (3-5-4 on 12-col grid):
  1. **Focus Picker** — dropdown (TO/Material/Bin/Delivery), identifier input, warehouse, optional date range, Run Live button, recent focuses list (localStorage).
  2. **Graph Canvas** — `react-force-graph-2d` wrapped in `<LocalGraph />`. Dark canvas, node color by type, degree-based sizing, focus node 1.5x with glow, directional arrows on edges, legend, zoom-to-fit control. Click non-focus node → refocus.
  3. **Details Panel** — summary card (counts by type), vertical step timeline (Created → Movement → Confirmed/Pending), compact raw LT24 data table with CSV export.
- **Dependency:** `react-force-graph-2d@1.29.1` added to `package.json`.
- **localStorage:** `omniframe.to_history.recent_focuses.v1` — last 20 focus queries.

### Error States
- Agent missing → same red alert + instructions pattern as Inventory Management.
- SAP GUI not connected → red badge.
- Empty results → friendly empty-state with hint to widen date range.
- Query error → red error card with message.

### Design Decisions
- **Live fetch only** — no Supabase caching or materialised tables. Graph is rebuilt on every query. This keeps the feature self-contained with zero DB migrations.
- **Local graph only** — one entity at a time with 1-hop neighbors. No global warehouse graph (can add later by swapping data source).
- **`react-force-graph-2d`** chosen for its Obsidian-like physics feel (~30 KB gz).
- Graph node/edge IDs are deterministic (`to:7242363`, `material:RR30000237`) for stable React keys.

## Related
- [[Component - Omni-Agent Query Framework]]
- [[Implementation - Inventory Management Tab]]
- [[Patterns - React-Force-Graph-Local-Graphs]]
- [[LT24 - Transfer Order History]]