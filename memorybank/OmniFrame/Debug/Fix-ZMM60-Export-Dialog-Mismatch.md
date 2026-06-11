---
tags: [type/debug, status/active, domain/agent, domain/backend]
created: 2026-05-07
---
# Fix — ZMM60 Export Dialog Mismatch

## Symptom

First cut of `omni_agent/zmm60_lookup.py` (the new endpoint backing the [[Implement-Inventory-Adjustment-Workflow]] feature) failed end-to-end on the user's SAP variant with:

> ZMM60 lookup failed
> ZMM60 bulk export dialog never opened: Could not locate the Save-As path/filename fields after %pc trigger — this SAP variant may render a different export dialog. Falling back to lbl[x,y] pagination.

The pagination fallback failed too. Net effect: every `+ Add to Inv. Adjust` click on an LT10 row toasted an error and never staged the row.

## Root cause

The initial implementation called `_extract_via_pc_export(sess)` to reuse the LT10 / LT22 bulk-export pipeline. That helper expects the screen to be a **classic list-output report** — it triggers via:

1. The menu path `wnd[0]/mbar/menu[0]/menu[1]/menu[2]` (List → Save → File…), then
2. The `%pc` OK-code as a fallback.

Neither matches what ZMM60 actually does on this user's SAP variant. The recorded `MacWindowsBridge/Zmm60xx.vbs` (lines 25-26) shows:

```vbs
session.findById("wnd[0]/usr/shell").pressToolbarContextButton "&MB_EXPORT"
session.findById("wnd[0]/usr/shell").selectContextMenuItem "&PC"
```

Key observations the first cut missed:

1. The result of ZMM60 lives in **`wnd[0]/usr/shell`** — an **ALV grid**, NOT a classic list-output. That means the menu path `mbar/menu[0]/menu[1]/menu[2]` doesn't exist on this screen (different menu layout).
2. The `&PC` here is the **ALV grid toolbar's** "Local file…" context menu item. **It is NOT the same as the `%pc` OK-code.** Same character sequence, completely different SAP control surface. The OK-code `%pc` isn't registered on ALV-grid screens on this variant; SAP silently no-ops the keystroke.
3. The Save-As dialog ZMM60 renders only has **`DY_FILENAME`** (no `DY_PATH`). The `_extract_via_pc_export` setup loop tries to set BOTH first, then falls back to filename-only, but the failure mode here was reached before that fallback (the dialog wasn't even open by the time the helper looked for it).

The symptom message ("Falling back to lbl[x,y] pagination") was actively misleading because the fallback couldn't possibly succeed either — there is no `lbl[x,y]` grid; the result is an ALV grid that pagination doesn't know how to read.

## Fix

Rewrote `omni_agent/zmm60_lookup.py` to use **Option 1**: read the ALV grid directly via SAP COM. The agent already had `_extract_alv_grid(sess, candidate_ids=...)` (handler_mb52 uses it as a fallback path); ZMM60 just needs the recorded ID at the head of the candidate list:

```python
extract = _extract_alv_grid(sess, candidate_ids=[
    "wnd[0]/usr/shell",                              # recorded path
    "wnd[0]/usr/cntlGRID1/shellcont/shell",          # variant fallback
    "wnd[0]/usr/cntlCONTAINER1_CONT/shellcont/shell",
    "wnd[0]/usr/shellcont/shell",
])
```

The helper walks the candidate list, then falls back to a tree-walk for any control that exposes `.ColumnOrder`. Returns `{columns: [{id, title}], rows: [{col_id: value, ...}], total}` — exactly the same shape as `_extract_via_pc_export` so the column-lookup logic (`Price` / `Currency` / `Material` / `Plant` by case-insensitive title) is unchanged.

No file I/O, no Save-As dialog, no `%pc` keystroke. Faster too — a single `grid.GetCellValue(row, col_id)` per cell vs the export-then-parse round trip.

## Why we picked Option 1 (read ALV via COM) over Option 2 (replay the recorded `&MB_EXPORT` + `&PC` flow)

Option 2 — replaying the ALV grid's own toolbar context button + Save dialog — would also work, but:

- It still routes through %TEMP% with all the file I/O and parser ambiguity that brings.
- The Save-As shape (`DY_FILENAME` only) differs from LT10/LT22's `DY_PATH + DY_FILENAME`, so we'd need a separate, smaller dialog handler.
- We'd inherit the multi-format parser's edge cases for a single-row result that's already trivially readable via COM.

Option 1 sidesteps all of that. The recording's export path is what a human user does to peek at the data; the agent has a faster shortcut.

## Removed

Per the user's directive ("DO NOT re-add %pc as a fallback — it actively misled the diagnostic message and burned time"):

- Dropped the `_extract_via_pc_export` import.
- Dropped the `_PcPreCommitError` / `_PcPostCommitError` exception handlers.
- Dropped the `state._use_bulk_export = True` toggle.
- New error path on extraction failure points the user at MM03 (Costing/Accounting view) as the manual fallback instead.

The old behaviour is preserved in commit history for the next agent reading [[Implement-Inventory-Adjustment-Workflow]] so they understand the full arc.

## Lessons (for the next agent)

1. **`wnd[0]/usr/shell` directly = ALV grid; `wnd[0]/usr/cnt...` containers = nested ALV; `wnd[0]/usr/lbl[x,y]` = classic list output.** Different extraction strategies for each.
2. **`shell.pressToolbarContextButton("&XYZ") + shell.selectContextMenuItem("&XYZ")` is the ALV grid's OWN toolbar API.** The `&XYZ` constants are NOT the same namespace as OK-codes typed into `tbar[0]/okcd`. Same characters, different SAP control surface.
3. **`_extract_via_pc_export()` is for classic list-output reports only** (LT10, LT22, MB52-old). For ALV grids prefer `_extract_alv_grid(sess, candidate_ids=[...])`. Pass the recorded shell ID at the head of the candidate list.
4. **When a recording shows an export, ask what the recording is FOR.** A human user exporting to %TEMP% for a peek is a UI affordance, not the only data path. The agent can usually read the same data faster via COM directly.
5. **Diagnostic messages must not mislead about fallback paths.** `Falling back to lbl[x,y] pagination` was wrong because pagination can't read an ALV grid either. New error path is honest: "Could not read ZMM60 ALV grid: … Verify in MM03 (Costing/Accounting view) …".

## Verification

- Manual: material `23067754` plant `8303` returns `unit_value=287.63`, `currency="USD"` (matches the `MacWindowsBridge/ValueExport` reference).
- AGENT_VERSION stays at `2.0.0` (the spec gated against a bump for additive fixes).
- AST clean for source (`omni_agent/zmm60_lookup.py`) + mirror (`MacWindowsBridge/Omni-Agent/zmm60_lookup.py`).
- No FE change required — the endpoint URL, request body, and response shape are unchanged. Only the internal extraction strategy changed.

## Related

- [[Implement-Inventory-Adjustment-Workflow]] — the surrounding feature.
- [[Inventory-Management - SAP Query Framework]] — query-handler conventions on the SAP Testing tab.
- [[Omni-Agent - Headless SAP Agent]] — the agent that hosts the endpoint.
- [[Bulk-Export-via-pc]] — when the `%pc` path IS the right answer (LT10/LT22/MB52).
- [[Sessions/2026-05-07]] — the day the workflow shipped + the same-day extraction-strategy fix.
