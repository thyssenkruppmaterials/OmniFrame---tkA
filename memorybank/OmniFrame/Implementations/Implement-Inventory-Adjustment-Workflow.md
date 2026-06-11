---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database, domain/agent]
created: 2026-05-07
---
# Implement Inventory Adjustment Workflow

## Purpose
New end-to-end workflow shipped 2026-05-07 on the SAP Testing → Inventory Management tab. Lets a warehouse user pick rows from an LT10 query result, automatically value each one through ZMM60, and accumulate them in a per-org staging table for offline inventory adjustment review (Excel export). See [[Inventory-Management - SAP Query Framework]] for the surrounding tab.

## User flow
1. User runs the existing **Bin Stock by Material** (LT10) query.
2. From any row's Actions dropdown, picks the new **`+ Add to Inv. Adjust`** entry.
3. Browser POSTs `/sap/zmm60/lookup` to the local OmniFrame agent (capability `zmm60-price-lookup`). Agent runs ZMM60 (`/nZMM60` + material/plant + F8 + canonical menu/%pc bulk export), parses the `Price` column, returns `{ unit_value, currency, raw }`.
4. Browser INSERTs one row into `public.inventory_adjustment_staging` (migration 288) carrying the LT10 row attributes + the agent's price + the raw ZMM60 dict.
5. The new **Inventory Adjustment** entry in the Query Library renders the staging table with three stat cards (Net Value / Gross Gains / Gross Losses), a per-row Remove action (with confirm dialog), and an **Export to Excel** button (`inventory_adjustment_YYYYMMDD_HHmm.xlsx`).

## ZMM60 column mapping
Verified against `MacWindowsBridge/ValueExport` (test material 23067754, plant 8303 → price 287.63 USD). The PC-export is tab-separated with a leading empty column; columns in order are:
```
Material · Plant · Created · Mat. Type · Matl Group · Unit · Purch. Grp · ABC · MRP Type · Val. Class · Price Ctrl · Val. Type · **Price** · **Currency** · Price Unit · Material Description · ...
```
The agent locates `Price` + `Currency` + `Price Unit` by case-insensitive header title rather than positional index, so a localised SAP variant that shifts the column order keeps working. There are also fallback aliases (`Std Price`, `Standard Price`, `Moving Avg`) for variants that rename the canonical column.

The `Price` field is the per-Price-Unit unit value (NOT moving avg or std). Multiplying by `total_stock` from LT10 gives the row's contribution to the adjustment. SAP can emit negative `total_stock` (shortfall); we render it red and bucket it under Gross Losses.

## Persistence model — `inventory_adjustment_staging`
Migration `supabase/migrations/288_create_inventory_adjustment_staging.sql`. Applied via Supabase MCP and verified via `information_schema.columns`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `organization_id` | UUID FK | RLS scope |
| `created_by` | UUID FK | nullable, from auth.uid() |
| `storage_type` / `plant` / `storage_location` / `storage_bin` | TEXT | nullable, copied from the LT10 row |
| `material` | TEXT NOT NULL | from the LT10 row |
| `total_stock` | NUMERIC NOT NULL | sign-aware |
| `unit_value` | NUMERIC NOT NULL | from ZMM60 `Price` |
| `currency` | TEXT | from ZMM60 `Currency`, nullable |
| `extended_value` | NUMERIC GENERATED STORED | `total_stock * unit_value` |
| `zmm60_raw` | JSONB | full key→value parsed ZMM60 row, informational |
| `created_at` | TIMESTAMPTZ NOT NULL | `now()` |

Indexes: `(organization_id, created_at DESC)` for the list-by-org-newest-first access path; `(organization_id, material)` for the per-material lookup. RLS scoped to org members (SELECT/INSERT/DELETE).

Duplicates allowed by design — adding the same material at the same bin twice creates two rows. Re-counts later in the day shouldn't silently update the prior row.

Not added to the supabase_realtime publication. See [[realtime-policy]] / `realtime-policy workspace rule` — adds happen one-at-a-time via the agent at human pace, table is org-scoped, and the user driving inserts is the user reading the table. TanStack Query `invalidateQueries` after each mutation keeps the UI in sync without a Realtime channel.

## Agent endpoint
`POST /sap/zmm60/lookup` — capability `zmm60-price-lookup` advertised in `/health.capabilities`.

Request body:
```json
{ "material": "23067754", "plant": "8303" }
```
Success:
```json
{
  "ok": true,
  "material": "23067754",
  "plant": "8303",
  "unit_value": 287.63,
  "currency": "USD",
  "price_unit": 1,
  "raw": { "Material": "23067754", "Plant": "8303", "Price": "287.63", ... }
}
```
Failure:
```json
{ "ok": false, "material": "23067754", "error": "<msg>", "step": "connect|navigate|execute|extract|parse|unhandled" }
```

The handler is idempotent — same material/plant returns the same `unit_value` as long as SAP master data hasn't changed.

Implementation lives in `omni_agent/zmm60_lookup.py` (sibling module mounted via the same lazy `app.include_router` pattern as `material_master_read.py` / `lt22_import.py` — survives PyInstaller's --onefile bootloader). Reads the result ALV grid (`wnd[0]/usr/shell`) directly via SAP COM through the agent's existing `_extract_alv_grid(sess, candidate_ids=[...])` helper. **Does NOT route through `_extract_via_pc_export()`** — the LT10 / LT22 menu/`%pc` bulk-export path doesn't apply to ZMM60's ALV-grid output on this user's SAP variant; see [[Debug/Fix-ZMM60-Export-Dialog-Mismatch]] for the failed first-cut attempt and the diagnostic lesson. Reading via COM is also faster (no file I/O / Save-As dialog) and removes the misleading `lbl[x,y] pagination` fallback message that the bulk-export helper emitted.

Mirrored to `MacWindowsBridge/Omni-Agent/agent.py` + `MacWindowsBridge/Omni-Agent/zmm60_lookup.py` for the next EXE rebuild. AGENT_VERSION stays at `2.0.0` per the constraint — additive capability, no version bump.

## Frontend pieces

| File | Purpose |
|---|---|
| `src/lib/supabase/inventory-adjustment-staging.service.ts` | Typed PostgREST wrapper for the new table (list/insert/delete + TanStack `queryKey` helper + `appendInventoryAdjustmentRow` one-shot for the row action). Owns the one-spot type-narrowing dance since the table isn't in the generated `database.types.ts` yet. |
| `src/features/admin/sap-testing/components/inventory-adjustment-view.tsx` | The new `InventoryAdjustmentView` component (sibling to `RecorderPanel` / `ReversalPanel`). Stat cards + table + Remove dialog + Excel export. |
| `src/features/admin/sap-testing/components/inventory-management-tab.tsx` | (1) New `+ Add to Inv. Adjust` row action in `LT10_COLUMNS.rowActions`, gated on `zmm60-price-lookup`. (2) New `inventory-adjustment` `kind: 'tool'` entry in `QUERY_LIBRARY` (category `inventory`, icon `Wallet`). (3) New render branch for the tool. (4) `handleAddToInventoryAdjustment` callback in the parent — calls the agent, INSERTs the row, invalidates the staging query. (5) `addToInventoryAdjustment` added to `QueryActionContext`. |

### Excel export
Uses the already-installed `exceljs` (the Vite manualChunks-rule explicitly exempts it as a lazy-loaded vendor chunk). Lazy-imported via `await import('exceljs')` only when the user clicks Export — no impact on the SAP testing chunk's first-paint cost. Filename pattern: `inventory_adjustment_YYYYMMDD_HHmm.xlsx`. Columns: all staging columns + a bold totals row that places the sign-aware Net into the Extended Value column. Currency formatting via `numFmt = '#,##0.00;-#,##0.00'`. No new dependency added.

### Stat-card semantics (with negative-stock data)
- **Net Value** = `SUM(extended_value)` — sign-aware. Equals Gains − Losses.
- **Gross Gains** = `SUM(extended_value WHERE total_stock > 0)`.
- **Gross Losses** = `SUM(ABS(extended_value) WHERE total_stock < 0)` — surfaced as a positive number with red accent.

When the staging set mixes currencies, the cards switch to a `Mixed currencies` hint and drop the per-currency Intl formatting fallback to USD on a per-row basis.

### Realtime / cache invalidation
No `supabase.channel(...)` callsite added — see [[realtime-policy]]. The `useMutation`/`useQuery` pair invalidates `['inventory-adjustment-staging', orgId]` on every successful insert/delete. `refetchOnWindowFocus: true` covers the rare case where another tab inserted while this one was hidden.

## Build status
- Migration applied via Supabase MCP, verified via `information_schema.columns` (14 cols, including `extended_value` as STORED generated).
- `python3 -m ast.parse` — clean for `agent.py` (source + mirror) and `zmm60_lookup.py` (source + mirror).
- `pnpm tsc -b --noEmit` — clean.
- `pnpm build` — clean. `feature-admin-sap` chunk: 446 KB / 120 KB gzip (was 427 KB / 115 KB pre-change — +19 KB for the new view). `exceljs` stays exempt.
- ESLint on the three changed/added files — 0 errors, 0 warnings.
- No Rust changes; `src/lib/work-service/types.ts` untouched.

## Manual test plan
1. Open the SAP Testing → Inventory Management tab. Confirm the **Inventory Adjustment** entry shows under the `INVENTORY` category in the Query Library sidebar (emerald accent, `ADJUST` badge, Wallet icon).
2. Switch to the entry. With an empty staging table, confirm the empty state ("No rows yet") + three stat cards all read `$0.00`.
3. Switch back to **Bin Stock by Material**, run a real LT10 query (`material=23067754`, `warehouse=WH5`). On any row, open the Actions dropdown — confirm **+ Add to Inv. Adjust** appears with the wallet icon. If the agent advertises `zmm60-price-lookup`, the item is enabled; otherwise it's disabled with a `needs update` hint.
4. Click the new action. A toast spinner reads `Looking up <material> price via ZMM60…`. On success it flips to `Added to Inventory Adjustment` showing the unit value + currency.
5. Switch back to **Inventory Adjustment**. Confirm the new row appears at the top, currency-formatted, with `Extended Value = total_stock × unit_value`. Stat cards update.
6. Click the row's Remove icon. Confirm dialog appears explaining the row is being removed from the scratch pad ("does NOT touch SAP"). Click Remove → row disappears, stat cards update, success toast.
7. Click **Export to Excel**. Confirm an `inventory_adjustment_YYYYMMDD_HHmm.xlsx` downloads. Open in Excel: 10 columns + a bold TOTAL row; currency cells render as `$1,234.56`.

## Open follow-ups (deferred)
- **Submit adjustment to SAP** button — natural next step would be to enqueue an MI04/MI07 (or LI11N for warehouse-managed) inventory document via `sap_agent_jobs` from the staging set. Not in scope for this round; the table is currently a working scratch pad.
- **Bulk-add from LT10 results** — multi-select + "Add selected to Inv. Adjust" would call ZMM60 once per selected row in sequence. Trivial to add since each insert is independent; deferred until a user asks.
- **Edit `total_stock` in the staging table** — sometimes the user wants to override the LT10 value to reflect a manual recount before exporting. Easy follow-up.
- **Cross-currency Net Value** — current FE renders `Mixed currencies` instead of FX-converting. Document elsewhere if a multi-currency org needs a single-currency net.
- **Soft-delete instead of hard-delete** — Remove is a hard `DELETE` today; if the audit trail matters later, switch to a `removed_at` timestamp + a filter in the LIST query.
- **Regenerate `database.types.ts`** to include the new table so the local type-narrowing dance in `inventory-adjustment-staging.service.ts` can be removed. Pure cleanup — current code works correctly.

## Related
- [[Inventory-Management - SAP Query Framework]] — the surrounding tab
- [[Omni-Agent - Headless SAP Agent]] — the agent that exposes `/sap/zmm60/lookup`
- [[Implement-Inventory-Mgmt-Two-Pane-Redesign]] — the round-4 layout this view inherits
- [[Sessions/2026-05-07]]
- [[realtime-policy]]
