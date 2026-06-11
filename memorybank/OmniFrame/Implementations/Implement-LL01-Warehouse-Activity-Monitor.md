---
tags: [type/implementation, status/active, domain/agent, domain/frontend, domain/database]
created: 2026-05-22
---
# Implement LL01 Warehouse Activity Monitor

## Purpose
End-to-end feature for SAP Testing → Inventory Management → Query Library → **WAREHOUSE** category. Replaces the manual VBS + OneDrive + Power Query Excel workflow with an OmniFrame agent run, Supabase snapshot persistence, and a two-tab dashboard (Heatmap + Trend).

## User flow
1. User selects **Warehouse Activity Monitor** (LL01) from the Query Library WAREHOUSE group.
2. Clicks **Run Query** — Local Agent POSTs `/sap/ll01/warehouse-activity`; Fleet Agent queues the same endpoint via `sap_agent_jobs`.
3. Agent loops **5 plants × 7 categories** sequentially in one SAP session, PC-exports each list, parses rows, inserts count snapshots.
4. FE renders `<WarehouseActivityMonitorView />` with Heatmap (default) and Trend tabs.

## SAP flow (per plant, from `LL01_Worker_Full.vbs`)
1. `/nLL01` → `WaitUntilIdle(30)`
2. Maximize + setFocus + 300ms sleep
3. `ctxtPLGNUM` = plant (`JSF` → lowercase `jsf`; others uppercase)
4. `sendVKey 8` twice (F8 execute)
5. For category rows 3–9:
   - `ReturnToMainList` via `lbl[18,3]` anchor + Back button
   - `SetFocus` on `lbl[18,<row>]`, `caretPosition=13`, `sendVKey 2` (double-click)
   - `WaitForExportReady` — menu `mbar/menu[0]/menu[2]/menu[2]`
   - `_extract_via_pc_export(sess)` → parse with per-category column map
6. Per plant×category failure → `errors[]` entry; run continues.

## Parser column maps
Seven categories with SAP header → JSON key maps (see `LL01_CATEGORIES` in `omni_agent/ll01_warehouse_activity_monitor.py`). Smart-header detection mirrors `lt22_import.py` — skips banner rows, scores known headers.

## Severity thresholds (heatmap traffic lights)

| key | label | green ≤ | amber ≤ |
|---|---|---:|---:|
| open_to | Open Transfer Orders | 100 | 500 |
| open_tr | Open Transfer Requirements | 500 | 2000 |
| open_posting | Open Posting Changes | 50 | 200 |
| critical_delivery | Critical Deliveries | 25 | 100 |
| negative_stock | Negative Stock | 25 | 100 |
| interim_stock | Interim Stock w/o Movement | 100 | 500 |
| critical_stock_production | Critical Stock in Production | 25 | 100 |

Baked into agent response `categories[].thresholds` for FE classification.

## Snapshot table
Migration `326_create_ll01_activity_snapshots.sql` → `public.ll01_activity_snapshots`:
- One row per (organization_id, snapshot_run_id, plant, category)
- Stores `count` only — full `rows` returned in HTTP response, not persisted
- RLS: org-scoped SELECT + INSERT via `user_profiles`
- Indexes: `(organization_id, ran_at DESC)`, `(organization_id, category, plant, ran_at DESC)`

**Note:** `database.types.ts` regen deferred — FE uses ad-hoc types in `warehouse-activity-monitor-types.ts`.

## Frontend tabs
### Heatmap (default)
- 5×7 grid: plants columns, category rows
- Traffic-light cells via `classifyLL01Severity`
- Trend column: ↗ / → / ↘ vs prior snapshot run (>10% delta)
- Total row + column; click cell → Sheet drilldown with TanStack table + CSV export
- Re-run + plant filter chips; progress bar polls `GET /sap/ll01/warehouse-activity/progress` (local agent)

### Trend
- Date range: 7 / 30 / 90 days (default 30)
- 7 Recharts `LineChart` cards (2-column grid), 5 plant lines + dashed Total
- Spike alerts card: >50% growth vs previous run
- CSV export of filtered snapshot rows
- Trend line click → drilldown placeholder (rows not in snapshots; re-fetch follow-up)

## Recharts
Uses existing `recharts` dependency — NOT added to `manualChunks` (React top-level dep rule).

## Tests
- `omni_agent/tests/test_ll01_warehouse_activity_parser.py` — synthetic tab-delimited per category
- `src/features/admin/sap-testing/components/__tests__/warehouse-activity-monitor.test.tsx` — heatmap grid, severity, trend arrows, spike copy, CSV blobs

## Follow-ups
- **Master fan-out:** `LL01_Master_Full.vbs` parallel 5-session loop (MVP is single-session sequential)
- **Threshold admin panel:** tunable green/amber per category
- **Trend drilldown re-fetch:** live single plant×category agent call for historical row detail
- **database.types.ts** regen when convenient

## Related
- [[Implement-LX25-Inventory-Completion]]
- [[Implement-Inventory-Adjustment-Workflow]]
- [[Omni-Agent-System-Topology]]
