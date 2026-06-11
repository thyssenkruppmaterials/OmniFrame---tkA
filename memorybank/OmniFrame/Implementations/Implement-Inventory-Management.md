---
tags: [type/implementation, status/active, domain/infra, domain/frontend]
created: 2026-04-16
---
# Implement Inventory Management — SAP Query Framework

## Context
After building One Click Ship (manual fire) and Agent Triggers (event-driven fire), the next logical piece was **reading data FROM SAP** without navigating through GUI screens manually. User framed it as: "look up a part in LX03 and return all info in the layout I've set up" — generalizable to any SAP transaction.

Built as a new tab (9th in SAP Testing, after Agent Triggers) with an extensible handler registry in the agent.

## Design Decisions

### Record + Hand-Write Hybrid
User asked: *"Can you design the script or do I need to record?"*

**Answer: Both, each covers what the other can't.**
- **Recordings** capture authoritative SAP element IDs for the user's specific corporate SAP configuration (custom menus, Z-transactions, layout variants)
- **Hand-written code** adds what recordings can't capture: iterating result tables, extracting structured data, parametrizing inputs, handling empty results

Workflow:
1. User records navigation in VBS (like `FullTestAAAA2.vbs`)
2. Engineer translates to Python handler, adds extraction + validation, registers
3. User adds query config to frontend (no Python needed on their side)

For today's v1 I wrote all 3 starter handlers (LX03, MB52, MMBE) based on **standard SAP layouts**. If they don't match the user's instance, record-and-iterate.

### Generic Query Endpoint vs Per-Transaction Endpoints
Chose generic `POST /sap/query {handler, params}` over per-transaction endpoints (`POST /sap/lx03`, `POST /sap/mb52`, ...).

Reasons:
- Single endpoint for frontend to target
- Adding a new transaction = one entry in `QUERY_HANDLERS` dict, no new FastAPI route
- Can add generic cross-cutting concerns (logging, rate limit, auth) in one place
- Frontend discovery via `GET /sap/query-handlers`

### Extraction Helpers as First-Class
Built `_extract_alv_grid()` and `_extract_table_control()` as reusable helpers instead of inline in each handler. Handles:
- Multiple candidate shell IDs (SAP puts grids in different paths per transaction)
- Empty results
- Column titles via `GetColumnTitles` / `GetColumnTooltip` (not just IDs)
- Scrolling for older table controls

New handlers just call `_extract_alv_grid(sess)` at the end and get structured JSON.

### Handler Signature
```python
def handler_xxx(sess, params: dict) -> dict:
    """Returns {columns, rows, total, meta?} or raises Exception."""
```
Uniform signature means the dispatcher is trivial. Handlers self-document via docstrings.

### Query Library as Frontend Constant
`QUERY_LIBRARY` is a hardcoded array in `inventory-management-tab.tsx`. Each entry specifies: `id`, `name`, `description`, `transaction`, `handler` (matches agent registry), `category`, `icon`, `inputs[]`.

Reasons over a DB-driven library:
- Zero latency to load
- Versioned with the code
- Typed (TypeScript catches mistakes)
- Easy to review in PRs

Future: allow user-created custom queries stored in Supabase.

### Results Table
Built on shadcn `<Table>` primitives. Features:
- Sticky header with scroll
- Click column to toggle sort (asc / desc)
- Numeric-aware sort: detects columns that parse as numbers, sorts numerically
- In-memory search across all columns
- CSV export (with proper quoting)
- Meta badges show query context (transaction, material, etc.)

Didn't use TanStack Table because the result shape is fully dynamic and we don't need heavy features (selection, pagination, server sort).

### Persistence
`localStorage['omniframe.inventory_query_inputs.v1']` stores last-used input values per query. Loaded when user switches to a query they've run before. Quick win UX.

## Handler Implementations

### `handler_lx03(sess, params)`
Starter based on standard ECC layout. Robust via multi-ID fallback:
```python
_try_set(
    ["wnd[0]/usr/ctxtS_LGNUM-LOW",
     "wnd[0]/usr/ctxtLGNUM-LOW",
     "wnd[0]/usr/ctxtLTAP-LGNUM"],
    warehouse,
)
```
Tries each field ID; first one that exists wins.

Checks `wnd[0]/sbar` after execute for "no data" messages — returns empty result gracefully instead of failing on the extraction step.

### `handler_mb52(sess, params)`
All inputs optional; omitting = SAP returns wider result set. Same multi-ID fallback pattern.

### `handler_mmbe(sess, params)`
MMBE uses a tree widget, not ALV. Handler:
1. Tries tree-specific shell IDs
2. Walks `GetAllNodeKeys()` → `GetNodeTextByKey()` + tree column values
3. Falls back to `_extract_alv_grid()` if no tree found

## Frontend Implementation Notes

### 2-column layout
`grid-cols-[320px_1fr]` on `lg` breakpoint. Mobile: stacked.

### Enter key runs query
Attached to input `onKeyDown`. Skipped when query is running.

### Sort icon three-state
- Not sorted — muted `ArrowUpDown`
- Ascending — primary `ArrowUpAZ`
- Descending — primary `ArrowDownAZ`

### Clear search button
`X` button inside the search input, visible only when query is non-empty.

### Filtered count badge
Shown only when filter is applied (`filteredCount !== totalRows`).

## Files Changed

### Agent
- `omni_agent/agent.py`:
  - Added `QueryRequest` pydantic model
  - Added `_safe_get`, `_extract_alv_grid`, `_extract_table_control` helpers
  - Added `handler_lx03`, `handler_mb52`, `handler_mmbe`
  - Added `QUERY_HANDLERS` registry
  - Added `POST /sap/query` and `GET /sap/query-handlers` endpoints

### Frontend
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — NEW (800 lines)
- `src/features/admin/sap-testing/index.tsx` — Registered new tab

## Testing

### Build verification
```bash
cd /Users/jaisingh/Documents/Projects/OneBoxFullStack
npm run build  # ✓ passes, no lint errors
```

### Smoke test path
1. Deploy web app, rebuild agent, re-upload ZIP
2. Open Inventory Management tab in Chrome on Citrix
3. Agent status bar green
4. Pick "Bin Stock by Material"
5. Enter material + warehouse
6. Click **Run Query**
7. Results table populates with rows from SAP
8. Sort / search / export CSV

### What to expect if layout doesn't match
- **"Could not find ALV grid"** — shell ID in recording differs; update `candidate_ids` list in `_extract_alv_grid()` OR record the transaction and note the correct ID
- **"Control not found by id"** on input field — input field ID differs between SAP versions; add another candidate to `_try_set()`
- **Empty result with `"meta.empty": true`** — SAP returned "no data"; check inputs
- **SAP timeout** — large result sets can take >30s; increase `_wait_for_session` timeout or break query into smaller scopes

## Future Enhancements
1. Move `QUERY_LIBRARY` to Supabase for team-shared custom queries
2. Add "record-driven handler generator" — upload a .vbs recording, tool auto-scaffolds a Python handler
3. Layout selection: handler accepts `layout` param and navigates "Choose Layout"
4. Scheduled auto-refresh with diff highlighting
5. Cross-query chaining (LX03 results feed into MB52)
6. Compare mode (side-by-side results)
7. Visualizations for numeric columns
8. Move agent handlers to a separate `agent_handlers.py` module as the list grows

## Related
- [[Inventory-Management - SAP Query Framework]] — component documentation
- [[Omni-Agent - Headless SAP Agent]] — service this feature extends
- [[Implement-Omni-Agent]] — agent implementation
- [[Implement-Agent-Triggers]] — the automation sibling
- [[Sessions/2026-04-16]]
