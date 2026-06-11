---
tags: [type/implementation, status/active, domain/agent, domain/frontend]
created: 2026-05-10
---
# Implement LX25 Inventory Completion

## Purpose
New end-to-end feature shipped 2026-05-10 on the SAP Testing → Inventory Management tab. Adds an **Inventory Completion** entry to the Query Library WAREHOUSE category that runs LX25 ("Inventory Status — List with Totals") with a different SAP variant per warehouse and aggregates the per-storage-type cycle-count metrics into a single cross-warehouse completion %. One click → 5 warehouses → aggregate stat card + per-warehouse cards + sortable detail table. See [[Inventory-Management - SAP Query Framework]] for the surrounding tab.

## User flow
1. User opens SAP Testing → Inventory Management tab, picks **Inventory Completion** from the Query Library WAREHOUSE section.
2. Detail Card renders with zero `inputs` and a read-only **Variants Summary** panel listing all 5 warehouses + their dedicated SAP variants. Run Query button is enabled when the agent advertises `lx25-inventory-completion`.
3. User clicks **Run Query**. Browser POSTs `{}` to `/sap/lx25/inventory-completion` (no body needed — the agent defaults to the hardcoded `LX25_WAREHOUSES` list).
4. Agent loops through the 5 warehouses *sequentially* in a single SAP COM session. For each warehouse:
   - `/nLX25` → selection screen
   - Open Get Variant dialog (`tbar[1]/btn[17]`) → type variant name in `txtV-LOW` → clear `txtENAME-LOW` → Execute
   - F8 (`tbar[1]/btn[8]`) → run report
   - Menu → List → Save → File... → Unconverted radio → type filename → Save
   - Read the text file from disk, parse, accumulate.
5. Agent returns one envelope: `{ ok, warehouses: [...], totals: {...}, meta: {...} }`. Per-warehouse failures are captured inline (e.g. missing variant, SAP timeout) and DO NOT abort the rest of the fan-out.
6. FE renders the result in `<InventoryCompletionView />` (custom renderer, NOT the standard flat-table `<ResultsCard>`):
   - Aggregate stat card on top (cross-warehouse completion %, bins counted / total, status pill emerald/amber/red, per-status breakdown).
   - 5 per-warehouse cards in a `grid-cols-1 sm:grid-cols-2 lg:grid-cols-5` grid (warehouse code in mono, variant chip, completion %, bins counted / total, status pill).
   - Detail table at the bottom: searchable + sortable rows, one per (warehouse × storage type), with a warehouse chip filter row and CSV export.

## Variant mapping (single source of truth)

Hardcoded in BOTH `omni_agent/lx25_inventory_completion.py` (`LX25_WAREHOUSES`) and `inventory-completion-types.ts` (`LX25_WAREHOUSES`). Adding/removing a warehouse needs both updated.

| Warehouse | Variant |
|---|---|
| WH5 | TKAWH5 |
| WH8 | TKAWH8 |
| JSM | TKAJSM |
| JSF | TKAJSF |
| PDC | TKAPDC |

Each variant carries the warehouse number, storage-type filter, owner filter, and date-range filter on the SAP side, so the FE / agent doesn't have to know any of those details — the variant IS the parameter set.

## Recorded SAP GUI flow

Verbatim from `MacWindowsBridge/LX25data.vbs`:

```
1. /nLX25                                   → selection screen
2. tbar[1]/btn[17].press()                  → Get Variant dialog (wnd[1])
3. wnd[1]/usr/txtV-LOW   = "<variant>"      → variant name (e.g. "TKAWH5")
   wnd[1]/usr/txtENAME-LOW = ""             → clear user filter
4. wnd[1]/tbar[0]/btn[8].press()            → Execute → criteria loaded
5. tbar[1]/btn[8].press()                   → F8 → run report
6. mbar/menu[0]/menu[1]/menu[2].select()    → List → Save → File...
7. radSPOPLI-SELFLAG[1,0].select()          → Unconverted radio
   wnd[1]/tbar[0]/btn[0].press()            → OK
8. ctxtDY_FILENAME = "<file>"               → filename
   Enter / btn[11] / sendVKey 11            → Save
9. tbar[0]/btn[3].press()                   → Back (loop next warehouse)
```

**Recording artifact note**: lines 24-26 / 42-44 / 66-68 of the recording write `ctxtP_VARI = "JSINGH"` after the variant load. That was a recording artifact — "JSINGH" was the recording author's personal variant left over from a previous run; the Get Variant dialog already populates P_VARI with the warehouse variant when btn[8] in the dialog is pressed. We deliberately do NOT replicate it.

## Output format + parser

LX25's "Inventory Status - List with Totals" output is a *summary by storage type per warehouse*, NOT a row-per-record list like LT10 / LT22 / LT24. The unconverted text export is **tab-delimited** with `\r\n` line endings (verified via `od -c WH5LX25x`). Each storage type spans 6 lines: 1 marker line + 5 metric rows.

Five metric labels per storage type:
- `Total number of bins`
- `Inv. executed during selection peri[od]`
- `Inventory active`
- `Inventory planned`
- `No inventory executed`

Reference file (`MacWindowsBridge/WH5LX25x`):
```
\t05/10/2026\t\t\tInventory Status - List with Totals\r\n
\r\n
Warehouse number\t\t\tWH5\tIndianapolis Plt 5 Stores\r\n
\r\n
\tTyp\tStorage type name\r\n
\tSummary\t\t\t\tAbsolute\tProportio\tWhN\tTyp\r\n
\r\n
\t110\tTKA LGE ENG FIXED BIN\r\n
\tTotal number of bins\t\t\t\t  6,133\t 100.00%\tWH5\t110\r\n
\tInv. executed during selection peri\t\t\t\t  4,302\t  70.15%\tWH5\t110\r\n
\tInventory active\t\t\t\t    458\t   7.47%\tWH5\t110\r\n
\tInventory planned\t\t\t\t      0\t   0.00%\tWH5\t110\r\n
\tNo inventory executed\t\t\t\t  1,831\t  29.85%\tWH5\t110\r\n
```

The agent's generic multi-format parser (`_extract_via_pc_export`'s v1.7.6+ ladder) would pick the "Summary | Absolute | Proportio | WhN | Typ" line as the column header and parse the metric rows as data, but it would also incorrectly emit the storage-type-marker rows as malformed data rows and lose the warehouse context entirely. So `lx25_inventory_completion.py` ships its own `_parse_lx25_text()` that walks lines tracking active warehouse + active storage type and matches metric rows by **prefix** (case-insensitive, leading whitespace stripped) so minor wording drift between SAP variants doesn't break parsing.

**Smoke test**: parsing `MacWindowsBridge/WH5LX25x` returns:
```
warehouse_code: WH5
warehouse_name: Indianapolis Plt 5 Stores
storage_types count: 1
  {'storage_type': '110', 'storage_type_name': 'TKA LGE ENG FIXED BIN',
   'total_bins': 6133, 'executed': 4302, 'active': 458,
   'planned': 0, 'not_executed': 1831}
```

Completion % = `executed / total_bins` (4,302 / 6,133 = 70.15% — matches the SAP `Proportio` column).

### Storage type code regex — alpha + numeric (post-2026-05-10 fix)

Storage type marker lines look like `\t<CODE>\t<NAME>` after the section blank line — `\t110\tTKA LGE ENG FIXED BIN` (WH5/WH8/PDC) or `\tDDN\tDOD NEW` (JSM). The regex on these lines is `^([A-Z0-9]{1,4})\s+(.+?)\s*$` — uppercase alphanumeric, 1-4 chars. **It was originally digits-only (`\d{1,4}`)** which silently failed on JSM's alpha codes (`DDN`, `DDS`, `DDU`, `DUR`, `SCD`); every metric row fell through to the `(unspecified)` placeholder branch and overwrote each other, leaving the warehouse total = the LAST storage type's count (SCD = 17) instead of the actual sum (1,546). See [[Debug/Fix-LX25-JSM-Undercount]] for the full root-cause + fix narrative.

The metric-row branch matches FIRST by label prefix and short-circuits with `continue`, so the regex can't accidentally re-classify a metric row even if its first non-empty cell starts with 1-4 alphanumeric chars; the explicit `typ` / `summary` skip earlier in the loop handles the column-headline rows.

### Regression coverage

`omni_agent/tests/test_lx25_parser.py` — 4 test cases (WH5 numeric path, JSM alpha-code path, JSM warehouse-total roll-up, `_parse_sap_int` locale handling). Fixtures: `omni_agent/tests/fixtures/lx25_{jsm,wh5}.txt`. Loader uses the same "slice parser block + exec in controlled namespace" pattern as `test_lt22_smart_header.py` / `test_lt10export_smart_header.py` so it runs without pulling in `fastapi` / `pydantic`. Run with `python3 -m pytest omni_agent/tests/test_lx25_parser.py -v` (or `python3 omni_agent/tests/test_lx25_parser.py` for the bare run).

## Aggregation math (FE-visible, source of truth)

- **Per-storage-type completion %** = `executed / total_bins` (computed in the agent for every row that ships).
- **Per-warehouse completion %** = `sum(executed) / sum(total_bins)` across all storage types in that warehouse (NOT a simple average of per-storage-type %s — that would skew toward small storage types).
- **Cross-warehouse completion %** = `sum(executed across SUCCESSFUL warehouses) / sum(total_bins across SUCCESSFUL warehouses)`. Failed warehouses are EXCLUDED from totals so a missing variant doesn't drag the cross-warehouse % to zero.
- **"Not yet counted"** is the SAP `No inventory executed` count, NOT `total_bins - executed` (the difference includes the in-progress `Inventory active` and the rare `Inventory planned` rows). Surfacing both `not_executed` and `active` separately matches the SAP semantics the warehouse user already knows.
- **Color thresholds**: emerald ≥ 90%, amber 70-89%, red < 70%. Same scale at all three levels (aggregate stat card, per-warehouse cards, per-row progress bar in the detail table).

## Agent endpoint

`POST /sap/lx25/inventory-completion` — capability `lx25-inventory-completion` advertised in `/health.capabilities`.

Request body (all fields optional; default falls back to hardcoded `LX25_WAREHOUSES`):
```json
{
  "warehouses": [
    {"warehouse": "WH5", "variant": "TKAWH5"},
    {"warehouse": "WH8", "variant": "TKAWH8"},
    {"warehouse": "JSM", "variant": "TKAJSM"},
    {"warehouse": "JSF", "variant": "TKAJSF"},
    {"warehouse": "PDC", "variant": "TKAPDC"}
  ]
}
```

Success response:
```json
{
  "ok": true,
  "warehouses": [
    {
      "ok": true,
      "warehouse": "WH5",
      "variant": "TKAWH5",
      "warehouse_code": "WH5",
      "warehouse_name": "Indianapolis Plt 5 Stores",
      "storage_types": [
        {"storage_type": "110", "storage_type_name": "TKA LGE ENG FIXED BIN",
         "total_bins": 6133, "executed": 4302, "active": 458,
         "planned": 0, "not_executed": 1831, "completion_pct": 70.15}
      ],
      "total_bins": 6133, "executed": 4302, "active": 458,
      "planned": 0, "not_executed": 1831,
      "completion_pct": 70.15,
      "empty": false,
      "elapsed_sec": 8.3
    }
  ],
  "totals": {
    "warehouses_succeeded": 5,
    "warehouses_failed": 0,
    "total_bins": 24500,
    "executed": 17600,
    "active": 1900,
    "planned": 50,
    "not_executed": 4950,
    "completion_pct": 71.84
  },
  "meta": {
    "transaction": "LX25",
    "started_at": "2026-05-10T15:21:11Z",
    "elapsed_sec": 42.6,
    "warehouse_count": 5
  }
}
```

Per-warehouse failure:
```json
{
  "ok": false,
  "warehouse": "JSF",
  "variant": "TKAJSF",
  "error": "Variant TKAJSF does not exist",
  "step": "apply_variant",
  "elapsed_sec": 2.1
}
```

Total failure (SAP not connected, etc.) returns `ok: false` at the top level with `error` + `step` — the FE renders a retry card.

## Implementation lives in

| File | Purpose |
|---|---|
| `omni_agent/lx25_inventory_completion.py` | New sibling module mounted via `app.include_router` (same pattern as `zmm60_lookup.py` / `material_master_read.py` / `lt22_import.py`). Owns the SAP GUI flow + custom text parser + 5-warehouse fan-out loop. |
| `omni_agent/agent.py` | Adds `lx25-inventory-completion` to `AGENT_CAPABILITIES`. Adds the lazy `app.include_router(_lx25_router)` block + `_JOB_ENDPOINT_MODELS["/sap/lx25/inventory-completion"]` registration so fleet-mode queue dispatch builds the Pydantic model from the JSON body. |
| `MacWindowsBridge/Omni-Agent/{agent.py, lx25_inventory_completion.py}` | Byte-equal mirror of the agent files for the next EXE rebuild. |
| `src/features/admin/sap-testing/components/inventory-completion-view.tsx` | Custom result renderer. Aggregate stat card + 5 per-warehouse cards + detail table. Uses [[Patterns/Elevated-KPI-Stat-Cards]] for the cards (multi-stop shadow stack, top accent line, radial hover glow, reduced-motion safe). |
| `src/features/admin/sap-testing/components/inventory-completion-types.ts` | Shared types + `LX25_WAREHOUSES` constant. Lives in its own `.ts` file so the sibling `.tsx` view stays a pure component file (avoids the `react-refresh/only-export-components` warning that would fire on a mixed-export `.tsx`). |
| `src/features/admin/sap-testing/components/inventory-management-tab.tsx` | New `lx25-inventory-completion` entry in `QUERY_LIBRARY` (category `warehouse`, capability `lx25-inventory-completion`, empty `inputs`). New `completionResult` + `completionProgress` state slots (separate from the shared `result` because the response shape differs). Custom dispatch branch in `runQuery` that posts to `/sap/lx25/inventory-completion` with an 8-min timeout. Read-only Variants Summary panel above the Run button. Custom rendering branch swaps in `<InventoryCompletionView />` instead of `<ResultsCard>` (mirrors the LT24 → `<TransferOrderHistoryView />` pattern). |

## Fleet-mode

Works. The Pydantic model `Lx25InventoryCompletionRequest` is registered in `_JOB_ENDPOINT_MODELS` so `_dispatch_job` can build it from the JSON body when the FE flips to Fleet Agent mode and the call routes through `sap_agent_jobs`. The result returns via the same `WsEvent::SapJobStatusChanged` channel that other Inventory Management queries already use (Bin Stock, TO History, Stock Overview).

The FE's `executionMode.dispatch()` call at the LX25 branch in `runQuery` sets a per-call `timeoutMs: 8 * 60 * 1000` (8 min) so a slow Citrix VDA on the fleet path doesn't hit the default 5min timeout cliff.

## Build status

- `python3 -c "import ast; ast.parse(...)"` — clean for source + mirror (4 files).
- `cmp` source vs mirror — byte-equal.
- Parser smoke test against `MacWindowsBridge/WH5LX25x` — extracts the expected counts (WH5, storage type 110, 6,133 / 4,302 / 458 / 0 / 1,831).
- `pnpm tsc -b --noEmit` — clean.
- `pnpm lint:check` on the 3 changed/added FE files — 0 errors, 0 warnings.
- `pnpm build` — clean. `feature-admin-sap` chunk: **396 KB raw / 102 KB gzip** (under the 500 KB single-chunk limit). Pre-existing bundle-budget failures on `warehouse-location-map` (1487 KB) and `feature-admin` (982 KB) are not introduced by this work.

## Manual test plan

1. Open SAP Testing → Inventory Management tab. Confirm the **Inventory Completion** entry appears in the WAREHOUSE category (blue accent, LX25 transcode badge, ClipboardCheck icon).
2. Click the entry. The Detail Card shows zero inputs + a read-only **Variants Summary** panel listing WH5/WH8/JSM/JSF/PDC + their variants. Run Query is enabled when the agent advertises `lx25-inventory-completion`.
3. Click **Run Query**. Loading state shows 5 skeleton cards with the warehouse codes visible. Toast: "Inventory Completion ready" when done.
4. Confirm the aggregate stat card shows the cross-warehouse %, bins counted / total, status pill (emerald ≥ 90%, amber 70-89%, red < 70%), and a per-status breakdown (Counted / Active / Planned / Not yet counted).
5. Confirm 5 per-warehouse cards render. Click one — the detail table below filters to that warehouse. Click again to clear.
6. **Fleet mode**: flip the Inventory Management toggle to Fleet Agent, pick an online agent that advertises `lx25-inventory-completion`, click Run Query. The call routes through `sap_agent_jobs` and the result returns via the same `WsEvent::SapJobStatusChanged` channel. Confirm the same 6-step UI flow plays out.

## Open follow-ups

- **Lease budget for the long fan-out job** — the 5-warehouse loop typically takes 30-60s end-to-end (~6-12s per warehouse). The agent's `stuck-job-watchdog` default is 120s. Should be enough for the typical case but tight if SAP is slow. Could (a) raise the per-job lease for this endpoint specifically, or (b) split into 5 separate jobs the FE coordinates.
- **Per-warehouse parallelism** — SAP COM is single-threaded per session; true parallelism would need 5 SAP sessions. Not currently practical.
- **Click-through to LX02 for individual bin recount** — a row in the detail table could open LX02 prefilled to that bin so the user can re-trigger the count.
- **Real mid-flight progress** — the agent runs the loop server-side in one HTTP call. A future SSE/WS upgrade could push per-warehouse progress so the loading state shows "Fetching warehouse 2 of 5 (WH8)…" instead of the static placeholder. The `progress` prop on `<InventoryCompletionView />` is already shaped for this.
- **Variant editor UI** — the FE today hardcodes the 5 warehouses + variants. A future affordance might let an admin edit the variant per warehouse from the Detail Card (would need a new mutation that updates the Python constant remotely — likely a config table on the agent side rather than a code change).

## Related

- [[Inventory-Management - SAP Query Framework]] — the surrounding tab + Query Library framework.
- [[Omni-Agent - Headless SAP Agent]] — the agent that exposes `/sap/lx25/inventory-completion`.
- [[Implement-Inventory-Adjustment-Workflow]] — sibling end-to-end feature shipped 2026-05-07 that established the pattern of a `_JOB_ENDPOINT_MODELS`-registered POST handler called from a Query Library entry.
- [[Implement-LT24-History-Trail]] — sibling pattern of swapping the standard `<ResultsCard>` for a custom result renderer while keeping the form/dispatch infrastructure shared.
- [[Patterns/Elevated-KPI-Stat-Cards]] — visual recipe used for the aggregate + per-warehouse cards.
- [[Sessions/2026-05-10]]
