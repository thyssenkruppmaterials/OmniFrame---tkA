---
tags: [type/debug, status/active, domain/backend, domain/sap]
created: 2026-05-09
---

# Fix-LT24-Pagination-vs-Bulk-Export

## Symptom

User reports that immediately after the [[Fix-LT24-S1-Lgnum-Control-Mismatch]] fix landed (LT24 selection screen now correctly fills `T2_LGNUM` / `T2_MATNR-LOW` and presses F8), the **TO History** query against `USINDPR-CXA106V` paginates with Ctrl+PgDn through the result list instead of triggering the menu-driven bulk export the user's own `LT24Exporting.vbs` recording uses.

The exact agent console signature mirrors what the v1.7.5 LT10 fix targeted:

```
[query]  Running handler 'lt24' with params: {...} (bulk_export=False)
[query]  SAP list paginated: N page(s), M unique row(s)
```

for a query that should have completed in <5 s via a single-shot file save.

## Root cause

This is the EXACT same shape of bug that hit `handler_lt10` in [[Fix-LT10-Bulk-Export-Pagedown-Fallback]] (v1.7.4 / v1.7.5). The result-extraction block in `handler_lt24` was:

```python
result = _extract_alv_grid(sess)
```

On the user's SAP variant LT24 renders as a **classic list output**, not an ALV grid — so `_extract_alv_grid` falls through its candidate-id probe, lands in its `_PcPreCommitError` fallback chain at line 10200 (`return _extract_sap_list_output(sess)`), and `_extract_sap_list_output` paginates with Ctrl+PgDn. The bulk-export path that `_extract_via_pc_export` already implements (with the v1.7.4 menu-driven trigger as primary) was **never even attempted** because the handler called `_extract_alv_grid` directly instead of explicitly opting in to bulk export the way LT10 / MB52 do.

The user's `LT24Exporting.vbs` recording confirms the canonical export path is available on this variant:

```vbs
session.findById("wnd[0]/mbar/menu[0]/menu[1]/menu[2]").select  ' List → Save → File...
session.findById("wnd[1]/usr/subSUBSCREEN_STEPLOOP:SAPLSPO5:0150/sub:SAPLSPO5:0150/radSPOPLI-SELFLAG[0,0]").select  ' Unconverted
session.findById("wnd[1]/tbar[0]/btn[0]").press                                                ' Enter
session.findById("wnd[1]/usr/ctxtDY_PATH").text = "C:\Users\U8206556\Documents"
session.findById("wnd[1]/usr/ctxtDY_FILENAME").text = "LT24Export.txt"
session.findById("wnd[1]/tbar[0]/btn[11]").press                                              ' Save
```

— identical menu / dialog / save flow to LT10 / MB52, which `_extract_via_pc_export` has handled correctly since v1.7.4.

## Fix

`omni_agent/agent.py` lines **10930-10975**, function `handler_lt24` — replaced the single `_extract_alv_grid(sess)` call with the canonical bulk-export-first ladder used by `handler_lt10` and `handler_mb52`.

### Before (lines 10930-10942 pre-fix)

```python
# Step 4: Extract the result (list / ALV / table control)
result = _extract_alv_grid(sess)

focus = _lt24_focus(mode, to_number, material, storage_bin, delivery)
graph = _rows_to_graph(result.get("rows", []), focus)
result["graph"] = graph
result["meta"] = {
    "transaction": "LT24", "mode": mode,
    "warehouse": warehouse,
    "to_number": to_number, "material": material,
    "storage_bin": storage_bin, "delivery": delivery,
    "date_from": date_from, "date_to": date_to,
}
return result
```

### After (lines 10930-10975)

```python
# Step 4: Extract the result.
#
# 2026-05-09 — Force menu-driven bulk export FIRST (mirrors the LT10
# / MB52 v1.7.4-v1.7.5 fix). [...]
state._use_bulk_export = True
extraction_path = "pc_bulk_export"
try:
    result = _extract_via_pc_export(sess)
except _PcPreCommitError as pre_err:
    print(
        f"[query]  LT24 %pc pre-commit failed, falling back to "
        f"lbl[x,y] pagination: {pre_err}"
    )
    result = _extract_sap_list_output(sess)
    extraction_path = "lbl_paginated_fallback"
finally:
    state._use_bulk_export = False

focus = _lt24_focus(mode, to_number, material, storage_bin, delivery)
graph = _rows_to_graph(result.get("rows", []), focus)
result["graph"] = graph
result["meta"] = {
    "transaction": "LT24", "mode": mode,
    "warehouse": warehouse,
    "to_number": to_number, "material": material,
    "storage_bin": storage_bin, "delivery": delivery,
    "date_from": date_from, "date_to": date_to,
    "extraction_path": extraction_path,
}
return result
```

Key points:

1. **`state._use_bulk_export = True`** before the try/except (matches LT10/MB52). This is what causes `_extract_via_pc_export` to actually run rather than the lazy fallback path inside `_extract_alv_grid`.
2. **`_extract_via_pc_export` does the menu-driven trigger first** — confirmed read of `agent.py` line 9577: `sess.findById("wnd[0]/mbar/menu[0]/menu[1]/menu[2]").select()` is the primary trigger; `%pc` OK-code is the fallback. v1.7.4 behaviour is intact, no further change needed inside `_extract_via_pc_export`.
3. **Pre-commit fallback** (`_PcPreCommitError`) → `_extract_sap_list_output(sess)` only. Same fallback the user's LT24 used to get unconditionally; preserved as a safety net for variants where neither menu nor `%pc` are registered. Matches LT10's pattern (LT24 like LT10 is a classic list-output report on this variant — no ALV).
4. **Post-commit failures NOT caught** — if the file saved but the parser failed, the `_PcPostCommitError` surfaces to the caller verbatim. Pagination would re-walk the same data from a GUI that may already have advanced past the source screen. Same semantics as LT10 / MB52 / LT22.
5. **`extraction_path` in `result["meta"]`** — `"pc_bulk_export"` on success, `"lbl_paginated_fallback"` if pre-commit fails. Lets the SAP Testing tab + SQL audits see which path actually ran (matches LT10 / MB52 instrumentation).

## What was deliberately NOT changed

- **`_extract_via_pc_export`** — already had the v1.7.4 menu-driven trigger as primary path (line 9577) + `%pc` as fallback (line 9593) + filename-only Save-As fallback (line 9663) + Enter / btn[11] / sendVKey(11) save-dismissal ladder (line 9707). All four paths required by the user's recording are already in place. No regression to fix.
- **`AGENT_VERSION`** — bug fix only, no API surface change. Per the user's instructions.
- **Other handlers** — LT10 / MB52 / MMBE were already on the right pattern (LT10 / MB52 since v1.7.5; MMBE uses tree extraction, doesn't apply). Untouched.
- **No new fields, env vars, or capabilities.** Per the user's instructions.
- **Frontend** — `<TransferOrderHistoryView />` and `inventory-management-tab.tsx` need no changes. The `extraction_path` meta is purely additive and ignored by the existing renderers.

## Quality gates

```bash
python3 -c "import ast; ast.parse(open('omni_agent/agent.py').read())"
# source: OK
python3 -c "import ast; ast.parse(open('/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py').read())"
# mirror: OK
cmp /Users/jaisingh/Documents/Projects/OneBoxFullStack/omni_agent/agent.py /Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py
# (no output — files identical)
```

`ReadLints` on `omni_agent/agent.py` — zero diagnostics.

## Test plan (Mac fleet mode)

1. Pick agent `USINDPR-CXA106V`.
2. Open **Inventory Management → WAREHOUSE → TO History**.
3. Material `23077931`, Warehouse `WH5`, leave TO Number blank.
4. **Run Query** — expected agent console:
   - `[query]  Running handler 'lt24' with params: {...} (bulk_export=True)`
   - `[query]  Bulk export triggered via menu (menu / %pc)`
   - `[query]  Save-As dialog populated via path+filename` (or `filename-only`)
   - `[query]  Save dialog dismissed via Enter` (or btn[11] / sendVKey 11)
   - `[query]  Parser detected format: A (dash-separated)` (or B/C/D/E)
   - `[query]  %pc bulk export complete: N row(s), C columns in <5s. No GUI pagination performed.`
5. UI Journey/Timeline view renders with rows, no Ctrl+PgDn cycling visible mid-query.
6. `result["meta"]["extraction_path"] === "pc_bulk_export"` (visible in the Query Library result inspector if expanded).

## Why this regression slipped through the v1.7.5 cleanup

The v1.7.5 audit fixed LT10 and MB52 in [[Fix-LT10-Bulk-Export-Pagedown-Fallback]] but didn't touch LT24 because at the time LT24 was hidden behind the legacy standalone TO History admin tab — only the [[Implementations/Implement-LT24-History-Trail]] migration on 2026-05-09 surfaced LT24 to the broader Inventory Management Query Library, which is what made this same-day user finally hit it on a variant where the cascading `_extract_alv_grid` falls through to pagination.

The takeaway: any query handler that returns a classic SAP list-output report (LT10 / LT22 / LT24 / MB52 / LX03) **must** opt in to `_extract_via_pc_export` explicitly — relying on `_extract_alv_grid`'s internal `_PcPreCommitError` fallback chain is not enough, because that chain only triggers AFTER the ALV probe has already failed, and the ALV probe doesn't set `state._use_bulk_export = True`. The pattern documented in [[Fix-LT10-Bulk-Export-Pagedown-Fallback]] (v1.7.5 "always bulk export" section) is the canonical one.

## Related

- [[Components/Omni-Agent - Headless SAP Agent]] — `handler_lt24` lives here.
- [[Components/LT24 - Transfer Order History]] — query semantics + frontend wiring.
- [[Fix-LT24-S1-Lgnum-Control-Mismatch]] — the immediate predecessor fix (S1_* → T2_* control IDs); this fix shipped on top of it.
- [[Fix-LT10-Bulk-Export-Pagedown-Fallback]] — canonical reference: v1.7.3 pre/post-commit error split, v1.7.4 menu-driven trigger ladder, v1.7.5 "always bulk export" pattern. LT24 now follows the same pattern.
- [[Implementations/Implement-LT24-History-Trail]] — the migration that surfaced this bug under a wider set of SAP variants.
- Source recording: `/Users/jaisingh/Downloads/MacWindowsBridge/LT24Exporting.vbs`.
