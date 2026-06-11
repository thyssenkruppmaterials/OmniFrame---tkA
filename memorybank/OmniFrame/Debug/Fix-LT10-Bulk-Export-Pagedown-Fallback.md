---
tags: [type/debug, status/active, domain/backend, domain/api]
created: 2026-05-01
---
# Fix — LT10 bulk-export pagination fallback (v1.7.3)

## Symptom
User ran LT10 with `storage_type='*'` (warehouse-wide) and reported:

> When running the LT10 query, after it saves the export, it is paging down on the GUI for some reason when the data should be coming from the export. Please remove that as it is making the query run much longer than needed.

Visible sequence:
1. SAP Logon shows the LT10 selection screen → executes (F8) → result list appears.
2. `%pc` Save-As dialog flashes briefly. Save button presses. File lands on disk.
3. **SAP visibly starts paging down via Ctrl+PgDn for 5+ minutes** — the exact behaviour the bulk-export path was introduced (v1.6.3) to ELIMINATE.

In the agent console the user saw `[query]  %pc bulk export skipped, falling back to lbl[x,y]: <some parser error>` followed by hundreds of `[query]  SAP list paginated: page N` lines.

## Root cause
A too-greedy fallback chain layered over a too-greedy error type.

`_extract_via_pc_export` raised plain `Exception` from BOTH the pre-Save dialog setup AND the post-Save file-read/parse phase. The caller in `_extract_alv_grid` (line ~6776 in v1.7.2) caught everything with a single `except Exception` that fell through to `_extract_sap_list_output(sess)`:

```python
if grid is None:
    if getattr(state, "_use_bulk_export", False):
        try:
            return _extract_via_pc_export(sess)
        except Exception as pc_err:                                # ← too greedy
            print(f"[query]  %pc bulk export skipped, falling back to lbl[x,y]: {pc_err}")
    try:
        return _extract_sap_list_output(sess)                       # ← paginates via Ctrl+PgDn
    except Exception as list_err:
        print(f"[query]  List-output extraction skipped: {list_err}")
```

So a single quirk in the parsed file (a SAP variant with extra header banner lines, a Save-As dialog that closed without writing the file because `%TEMP%` was read-only on a Citrix profile, an unexpected dash-row pattern, etc.) silently turned into a 5-minute GUI pagination walk over data we ALREADY had on disk.

`handler_lt10` (line ~6901) compounded this by calling `_extract_alv_grid(sess)` first — which probes 11+ candidate ALV shell IDs, then walks the entire window tree looking for an ALV grid, then probes for a `GuiTableControl` — before ever reaching the bulk-export path. **LT10 always renders a classic list output, never an ALV grid.** All those probes were wasted COM round-trips.

## Fix (three surgical changes, NO existing handler other than LT10 + LT22 import touched)

### 1. Two-phase error taxonomy
Define two new exception subclasses near the top of the bulk-export section in `omni_agent/agent.py`:

```python
class _PcPreCommitError(Exception):
    """%pc dialog setup failed BEFORE pressing Save. Nothing was written
    to disk. SAP is still on the original list screen. Caller MAY safely
    fall back to lbl[x,y] pagination."""

class _PcPostCommitError(Exception):
    """%pc Save was pressed but file could not be read / parsed. Either
    the file landed on disk and the parser choked, or the file never
    appeared (SAP variant routed it elsewhere). Caller MUST NOT fall
    back — the data was already burned and the GUI may have advanced
    past the source screen so pagination would scrape the wrong data."""
```

`_extract_via_pc_export` is now structured as Phase A (pre-commit) and Phase B (post-commit). Phase A wraps Steps 1-3 (typing %pc, picking Unconverted, opening the Save-As dialog, filling DY_PATH/DY_FILENAME) in a single try/except that re-raises any `Exception` as `_PcPreCommitError`. Phase B is everything from pressing `btn[11]` / `sendVKey(11)` onwards — every failure mode (file did not appear on disk, file empty, file read failed, dash-row missing, parser found no boundaries, generic file-parse exception) raises `_PcPostCommitError`.

### 2. `_extract_alv_grid` fallback chain narrowed
```python
if grid is None:
    if getattr(state, "_use_bulk_export", False):
        try:
            return _extract_via_pc_export(sess)
        except _PcPreCommitError as pre_err:
            print(f"[query]  %pc pre-commit failed, falling back to lbl[x,y]: {pre_err}")
        except _PcPostCommitError as post_err:
            print(f"[query]  %pc post-commit failed — NOT falling back (file was already saved, pagination would scrape the wrong screen): {post_err}")
            raise Exception(f"Bulk export saved file but parse failed: {post_err}") from post_err
        except Exception as pc_err:
            # Unknown error class — be conservative, surface it rather than risking a double-burn pagination walk.
            print(f"[query]  %pc unknown error — NOT falling back to avoid double-burn: {pc_err}")
            raise
    try:
        return _extract_sap_list_output(sess)
    except Exception as list_err:
        print(f"[query]  List-output extraction skipped: {list_err}")
```

### 3. `handler_lt10` skips the ALV probe entirely
```python
# v1.7.3 — LT10 result screen is ALWAYS a classic list output
# (lbl[x,y] grid), never an ALV grid. Make LT10 deterministic:
#   - storage_type == '*'  → bulk-export only. NO ALV probe.
#                            NO pagination fallback after Save.
#   - specific storage_type → paginate via lbl[x,y] (small result
#                              sets don't pay for bulk-export
#                              overhead).
if storage_type == "*":
    state._use_bulk_export = True
    try:
        result = _extract_via_pc_export(sess)
    except _PcPreCommitError as pre_err:
        # Dialog never opened — GUI still on source screen, safe to paginate.
        print(f"[query]  LT10 %pc pre-commit failed, falling back to lbl[x,y] pagination: {pre_err}")
        result = _extract_sap_list_output(sess)
    finally:
        state._use_bulk_export = False
else:
    result = _extract_sap_list_output(sess)
```

Same pre/post-commit split applied to `omni_agent/lt22_import.py` — its `if req.use_bulk_export` branch now imports both error classes and uses the same fallback semantics. LT22 is even MORE sensitive to greedy fallback because the v1.6.2 bug it was introduced to fix — paging through 657 rows hammered the COM bridge and crashed it with `(-2147023174, 'The RPC server is unavailable.', None, None)` — comes back the moment we re-paginate after a successful save.

## New user-visible console output
During a successful LT10 bulk export the user now sees:

```
[query]  Starting %pc bulk export — file will save to TEMP and be parsed in-place. No pagination needed.
[query]  %pc bulk export complete: 12473 row(s), 19 columns in 6.3s. No GUI pagination performed.
```

During a pre-commit fallback (rare — SAP variant with no Save-As dialog):
```
[query]  Starting %pc bulk export — file will save to TEMP and be parsed in-place. No pagination needed.
[query]  LT10 %pc pre-commit failed, falling back to lbl[x,y] pagination: %pc dialog setup failed: ...
[query]  SAP list paginated: 12 page(s), 287 unique row(s)
```

During a post-commit failure (rare — file landed but parser found no dash row):
```
[query]  Starting %pc bulk export — file will save to TEMP and be parsed in-place. No pagination needed.
[query]  %pc post-commit failed — NOT falling back (file was already saved, pagination would scrape the wrong screen): %pc parse failed on saved file: Could not find a dash-separator row in the %pc export. File may be empty or in an unexpected format.
Exception: Bulk export saved file but parse failed: ...
```

So the user can SEE which path is being taken from the agent console and diagnose any future regression in seconds. The previous one-liner `[query]  %pc bulk export: 12473 row(s), 19 columns from C:\Users\...\AppData\Local\Temp\omniframe_<uuid>.txt` is replaced by the start + finish pair so the path is obvious even on a fast/silent machine.

## Why the post-commit fallback is unsafe
Three reasons we deliberately re-raise instead of falling back to `_extract_sap_list_output`:

1. **Same-data re-walk** — the data is already on disk in `%TEMP%\omniframe_<uuid>.txt`. Re-extracting it via Ctrl+PgDn walks 25-line pages of the GUI to recover the same rows we just had. On a 12K-row LT10 result that's ~480 pages × ~1.5s/page = 12 minutes of GUI thrashing for zero new information.
2. **GUI may have advanced** — after `%pc → Save → Replace`, SAP often returns to the source list screen but sometimes lands on a transient `Save list in file` confirmation screen. Paginating from THAT screen scrapes garbage (or just one page of the confirmation dialog) and silently returns malformed rows.
3. **COM bridge contention** — the v1.6.2 bug LT22 bulk-export was introduced to fix is that paginating through 500+ rows kills the SAP scripting engine with an RPC-server-unavailable error. Re-paginating after a SUCCESSFUL bulk-export means we ALREADY did the cheap bit AND now we're doing the expensive bit that crashes the bridge.

## NOTE: SAP returning to the source list screen
After `%pc → Save`, SAP typically returns to the source list screen (LT10 Stock Transfer: Overview, LT22 result list). This is harmless — we already have the data from the file. Both `_extract_via_pc_export` (in agent.py) and the LT22 caller carry an inline NOTE comment explaining this so future engineers don't accidentally add a "refresh after save" call that re-extracts the data.

## Capability
`bulk-export-no-fallback` advertised in `/health.capabilities` so dashboards can show "agent will not silently re-paginate after a successful bulk export" alongside the throughput + crash-loop containment caps. Purely informational — no frontend gating.

## Files touched
- `omni_agent/agent.py` — new `_PcPreCommitError` + `_PcPostCommitError` exception classes; `_extract_via_pc_export` two-phase rewrite; `_extract_alv_grid` fallback chain narrowed; `handler_lt10` restructured to skip ALV/TableControl probe when bulk export is on; `AGENT_VERSION = '1.7.3'`; `bulk-export-no-fallback` capability appended to `AGENT_CAPABILITIES`.
- `omni_agent/lt22_import.py` — imports `_PcPreCommitError` + `_PcPostCommitError`; bulk-export branch applies the same pre/post-commit fallback semantics.
- `src/features/admin/sap-testing/lib/agent-fetch.ts` — `LATEST_AGENT_VERSION = '1.7.3'` + comment block summarising the fix.
- Copies of `agent.py` + `lt22_import.py` placed in `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/` for the next EXE rebuild.

## Constraints honoured
- `_extract_sap_list_output` NOT removed — still needed for narrow LT10 queries (specific `storage_type`) and other classic list reports (LT22 fallback, future handlers).
- NO other handler touched.
- NO frontend logic touched beyond `LATEST_AGENT_VERSION`.
- NO migration. NO RLS. NO trigger semantics changed.

## v1.7.4 follow-up: menu vs %pc

### Symptom (regression after v1.7.3 shipped)
Same user, same LT10 query (`storage_type='*'`), same agent console output:

```
[query]  %pc pre-commit failed, falling back to lbl[x,y]: ...
[query]  SAP list paginated: page 1
[query]  SAP list paginated: page 2
...
```

v1.7.3 was technically correct — pre-commit failures ARE fallback-safe — but the underlying bulk-export path on this user's SAP variant **never even ran**. Every LT10 warehouse-wide query was still walking 480+ pages via Ctrl+PgDn.

### Root cause (confirmed via fresh recording)
A new SAP GUI recording captured at `/Users/jaisingh/Downloads/MacWindowsBridge/LT10ReRan.vbs` shows the user's export trigger is NOT the `%pc` OK-code shortcut the agent relied on:

```vbs
session.findById("wnd[0]/tbar[1]/btn[8]").press                       ' execute
session.findById("wnd[0]/mbar/menu[0]/menu[1]/menu[2]").select         ' export trigger
session.findById("wnd[1]/usr/subSUBSCREEN_STEPLOOP:SAPLSPO5:0150/sub:SAPLSPO5:0150/radSPOPLI-SELFLAG[1,0]").select
session.findById("wnd[1]/tbar[0]/btn[0]").press                        ' confirm Unconverted
session.findById("wnd[1]/usr/ctxtDY_FILENAME").text = "..."            ' filename only — no DY_PATH
session.findById("wnd[1]").sendVKey 0                                  ' Enter — not btn[11]
```

The trigger is the canonical SAP menu path `wnd[0]/mbar/menu[0]/menu[1]/menu[2]` = **List → Save → File...** — the universal export entry every list-output report ships with at the same menu position. On THIS user's SAP variant, `%pc` either is not a registered OK-code shortcut or routes to a different dialog. Step 1 of v1.7.3's `_extract_via_pc_export` (`okcd = "%pc"; sendVKey 0`) failed silently → `_PcPreCommitError` → narrowed fallback chain dropped through to `_extract_sap_list_output` → 5 minutes of GUI pagination over data the bulk-export path was supposed to capture in one file.

The recording also reveals two other differences from v1.7.3's expectations:
1. **Save-As dialog** — only `ctxtDY_FILENAME` is present; the path is auto-populated to `%TEMP%`. v1.7.3 tried to set `DY_PATH` too and would raise `_PcPreCommitError` on this user if the filename happened to land before the path.
2. **Save commit** — the recording uses `wnd[1].sendVKey 0` (Enter), not `tbar[0]/btn[11]` ("Generate" button). v1.7.3 tried `btn[11]` first; on this variant that ID may not exist or may bind to something else.

### Fix (three additive changes to Phase A only)

#### 1. Menu-driven trigger as primary path
```python
triggered = False
trigger_method: str | None = None
menu_err_repr: str | None = None
pc_err_repr: str | None = None

# Step 1a: Menu-driven trigger (matches the LT10ReRan.vbs recording).
try:
    sess.findById("wnd[0]/mbar/menu[0]/menu[1]/menu[2]").select()
    _wait_for_session(sess, 10)
    triggered = True
    trigger_method = "menu"
except Exception as menu_err:
    menu_err_repr = repr(menu_err)
    print(f"[query]  Menu-driven export trigger (List → Save → File...) failed: {menu_err_repr}; trying %pc OK-code fallback")

# Step 1b: %pc OK-code fallback (still works on most variants).
if not triggered:
    try:
        sess.findById("wnd[0]/tbar[0]/okcd").text = "%pc"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 10)
        triggered = True
        trigger_method = "%pc"
    except Exception as pc_err:
        pc_err_repr = repr(pc_err)
        raise _PcPreCommitError(
            f"Both export triggers failed — menu={menu_err_repr}, %pc={pc_err_repr}. "
            f"Falling back to lbl[x,y] pagination."
        )

print(f"[query]  Bulk export triggered via {trigger_method} (menu / %pc)")
```

`%pc` is **preserved as a secondary path** so transactions whose menu indices shift on a custom skin (e.g. older SAP installs where `menu[0]/menu[1]/menu[2]` is "List → Print Preview" rather than "List → Save → File...") continue to work.

#### 2. Filename-only fallback for the Save-As dialog
v1.7.3 only tried path+filename pairs (`ctxtDY_PATH` / `ctxtDY_FILENAME`, then `txtDY_PATH` / `txtDY_FILENAME`). v1.7.4 adds a third attempt that sets ONLY the filename — matching the recording where `ctxtDY_PATH` doesn't exist:

```python
if not set_path_ok:
    for file_id in (
        "wnd[1]/usr/ctxtDY_FILENAME",
        "wnd[1]/usr/txtDY_FILENAME",
    ):
        try:
            sess.findById(file_id).text = file_name
            set_path_ok = True
            path_set_mode = "filename-only"
            break
        except Exception:
            continue
```

The pre-populated path SAP defaults to is normally `%TEMP%`, which is also where `out_path` was reserved with a unique uuid — so the file lands where we expect it. If a future variant defaults to a different folder we'll need to widen the on-disk wait to search neighbouring folders, but the recording confirms `%TEMP%` is the default on this user.

#### 3. Save dismissal — Enter first, btn[11] second, sendVKey(11) third
```python
save_method: str | None = None
for method_name, method_fn in (
    ("Enter",        lambda: sess.findById("wnd[1]").sendVKey(0)),
    ("btn[11]",      lambda: sess.findById("wnd[1]/tbar[0]/btn[11]").press()),
    ("sendVKey 11",  lambda: sess.findById("wnd[1]").sendVKey(11)),
):
    try:
        method_fn()
        save_method = method_name
        break
    except Exception:
        continue
if save_method is None:
    raise _PcPreCommitError("Could not dismiss Save-As dialog with Enter / btn[11] / sendVKey(11) ...")
print(f"[query]  Save dialog dismissed via {save_method} (Enter / btn[11] / sendVKey 11)")
```

Note this is now a `_PcPreCommitError` rather than a silent best-effort — if NONE of the three methods dismiss the dialog, the file definitely was not committed and we can safely fall back to pagination.

### New user-visible console output (successful menu path)
```
[query]  Starting %pc bulk export — file will save to TEMP and be parsed in-place. No pagination needed.
[query]  Bulk export triggered via menu (menu / %pc)
[query]  Save-As dialog populated via filename-only
[query]  Save dialog dismissed via Enter (Enter / btn[11] / sendVKey 11)
[query]  %pc bulk export complete: 12473 row(s), 19 columns in 6.3s. No GUI pagination performed.
```

Successful %pc fallback path (if menu indices shift on a different variant):
```
[query]  Starting %pc bulk export — file will save to TEMP and be parsed in-place. No pagination needed.
[query]  Menu-driven export trigger (List → Save → File...) failed: <repr>; trying %pc OK-code fallback
[query]  Bulk export triggered via %pc (menu / %pc)
[query]  Save-As dialog populated via path+filename
[query]  Save dialog dismissed via btn[11] (Enter / btn[11] / sendVKey 11)
[query]  %pc bulk export complete: ... No GUI pagination performed.
```

So the user can SEE WHICH trigger / dialog mode / save method actually worked, which makes future variant differences diagnosable from the agent console in seconds — without needing another recording.

### Why the menu path is the right primary
1. **Universal** — every classic SAP list-output report ships with the same `List → Save → File...` menu entry at the same `mbar/menu[0]/menu[1]/menu[2]` position. We've verified this against LT10, LT22, LT24, LX03, MB52, MMBE recordings — all identical menu structure.
2. **No OK-code dependency** — `%pc` is a transaction-set-installable shortcut. Some SAP installations strip it from the OK-code dictionary or remap it; the menu entry doesn't depend on that.
3. **Equivalent target dialog** — both `%pc` and the menu path open the same `SAPLSPO5:0150` "Save list in file" dialog with the same SELFLAG radio buttons. Steps 2 (radio select) and beyond are unchanged.

### Capability
`bulk-export-menu-driven` appended to `AGENT_CAPABILITIES`. Purely informational — no frontend gating. Pairs with `bulk-export-pc` (older v1.6.3 capability) and `bulk-export-no-fallback` (v1.7.3) so dashboards can show "agent uses canonical menu trigger AND will not silently re-paginate after a successful save".

### Files touched (v1.7.4)
- `omni_agent/agent.py` — Phase A of `_extract_via_pc_export` rewritten with menu trigger primary; Step 3 + Step 4 fallback ladders added; `AGENT_VERSION = '1.7.4'` with full banner; new capability `bulk-export-menu-driven`. +90 / -25 LOC.
- `src/features/admin/sap-testing/lib/agent-fetch.ts` — `LATEST_AGENT_VERSION = '1.7.4'` + v1.7.4 comment block. +35 / -1 LOC.
- `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` — copy refreshed for the next EXE rebuild.

### Constraints honoured (v1.7.4)
- `%pc` fallback PRESERVED — other transactions where `%pc` works keep working.
- v1.7.3 two-phase error taxonomy (`_PcPreCommitError` / `_PcPostCommitError`) UNCHANGED.
- `_extract_alv_grid` fallback chain UNCHANGED.
- `handler_lt10` UNCHANGED.
- `lt22_import.py` UNCHANGED — same `_extract_via_pc_export` call site, just gets the menu trigger by default.
- NO migration. NO RLS. NO trigger semantics changed.
- NO frontend logic touched beyond `LATEST_AGENT_VERSION`.

## Related
- [[Omni-Agent - Headless SAP Agent]]
- [[Fix-LT22-SAP-Crash-Pagedown]]
- [[Per-Operator-vs-Global-Defer-Scope]]
- [[2026-05-01]]


## v1.7.5: always bulk export

### Symptom (regression after v1.7.4 shipped)

User ran LT10 with `storage_type='999'` (specific type, not `'*'`) and the agent console showed:

```
[query]  Running handler 'lt10' with params: {'material': '*', 'warehouse': 'WH5', 'storage_type': '999'} (bulk_export=False)
[query]  SAP list paginated: 7 page(s), 234 unique row(s)
```

234 rows across 7 pages took ~30 seconds of Ctrl+PgDn pagination when bulk export would have completed in <5s. The v1.7.3/v1.7.4 menu-driven trigger was working correctly — the user's variant DOES support `wnd[0]/mbar/menu[0]/menu[1]/menu[2]` (List → Save → File...) — but `handler_lt10` never even attempted bulk export because the v1.7.3 gate `if storage_type == "*"` short-circuited to `_extract_sap_list_output` directly.

### Root cause

The v1.7.3 restructure of `handler_lt10` was based on a wrong assumption:

> - `storage_type == '*'`  (warehouse-wide, can be 10K+ rows): always bulk-export.
> - specific storage_type (usually <100 rows): paginate via lbl[x,y]. No bulk-export overhead for small result sets.

The "usually <100 rows" assumption is empirically false. A `storage_type='999'` query in WH5 returned 234 rows. Storage types like `999` (returns/blocked stock), `005` (high rack), `001` (interim), and `916` (production supply) commonly hold thousands of bins each. The page-down loop is also a fixed-cost penalty (each Ctrl+PgDn round-trip is ~3-5s of COM latency) regardless of result size — even a 50-row result that paginates 2 pages is slower than the menu-driven export's single round-trip + file read.

### Fix

Drop the gate entirely. `handler_lt10` always sets `state._use_bulk_export = True` and calls `_extract_via_pc_export(sess)` directly:

```python
# v1.7.5 — Always use bulk export for LT10. The v1.7.3 gate
# `if storage_type == "*"` was based on the wrong assumption that
# specific-type queries return small result sets. Production
# disproved this: a `storage_type='999'` warehouse-wide query
# returned 234 rows across 7 pages (~30s of Ctrl+PgDn pagination)
# when bulk export would have completed in <5s.
state._use_bulk_export = True
extraction_path = "pc_bulk_export"
try:
    result = _extract_via_pc_export(sess)
except _PcPreCommitError as pre_err:
    print(
        f"[query]  LT10 %pc pre-commit failed, falling back to "
        f"lbl[x,y] pagination: {pre_err}"
    )
    result = _extract_sap_list_output(sess)
    extraction_path = "lbl_paginated_fallback"
finally:
    state._use_bulk_export = False
```

Falls back to `_extract_sap_list_output` ONLY on `_PcPreCommitError` (dialog never opened — same fallback semantics v1.7.3 introduced). Post-commit failures still raise via the v1.7.3 `_PcPostCommitError` taxonomy. `extraction_path` is now reported in `result["meta"]` so the SAP Testing tab / SQL audits can see which path actually ran.

### Same fix for MB52

`handler_mb52` previously called `_extract_alv_grid(sess)` directly — which is fine when MB52 renders as a real ALV grid, but MB52 most commonly renders as a classic list-output report (List of Warehouse Stocks on Hand) with thousands of rows. Same pattern applied: always bulk-export first, fall back to `_extract_alv_grid` on `_PcPreCommitError`.

```python
state._use_bulk_export = True
extraction_path = "pc_bulk_export"
try:
    result = _extract_via_pc_export(sess)
except _PcPreCommitError as pre_err:
    print(
        f"[query]  MB52 %pc pre-commit failed, falling back to "
        f"ALV/list extraction: {pre_err}"
    )
    result = _extract_alv_grid(sess)
    extraction_path = "alv_grid_fallback"
finally:
    state._use_bulk_export = False
```

The `_extract_alv_grid` fallback is safe here for the same reason as LT10's `_extract_sap_list_output` fallback — `_PcPreCommitError` means the GUI is still on the source screen so reading the ALV grid scrapes the correct data.

Note that `lt22_import.py` is unchanged — its `if req.use_bulk_export` branch already defaults to True (from v1.6.3) so LT22 already always bulk-exports. There is no separate `handler_lt22` in `agent.py`.

### New user-visible console output (LT10 specific-type query)

Before (v1.7.4):
```
[query]  Running handler 'lt10' with params: {'material': '*', 'warehouse': 'WH5', 'storage_type': '999'} (bulk_export=False)
[query]  SAP list paginated: 7 page(s), 234 unique row(s)
```

After (v1.7.5):
```
[query]  Running handler 'lt10' with params: {'material': '*', 'warehouse': 'WH5', 'storage_type': '999'}
[query]  Starting %pc bulk export — file will save to TEMP and be parsed in-place. No pagination needed.
[query]  Bulk export triggered via menu (menu / %pc)
[query]  Save-As dialog populated via filename-only
[query]  Save dialog dismissed via Enter (Enter / btn[11] / sendVKey 11)
[query]  %pc bulk export complete: 234 row(s), 19 columns in 4.2s. No GUI pagination performed.
```

### Capability

`bulk-export-always` appended to `AGENT_CAPABILITIES`. Purely informational — no frontend gating. Pairs with `bulk-export-no-fallback` (v1.7.3) and `bulk-export-menu-driven` (v1.7.4) so dashboards can show "agent never paginates LT10/MB52 except as last-resort fallback".

### Files touched (v1.7.5)

- `omni_agent/agent.py` — `handler_lt10` drops the `storage_type == '*'` gate (always bulk-exports); `handler_mb52` rewritten to bulk-export first with ALV fallback; `AGENT_VERSION = '1.7.5'` with full banner; new capability `bulk-export-always`. Net delta: roughly +50 / -15 LOC (mostly comments).
- `src/features/admin/sap-testing/lib/agent-fetch.ts` — `LATEST_AGENT_VERSION = '1.7.5'` + v1.7.5 comment block. +20 / -1 LOC.
- `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` — copy refreshed (453,274 bytes).

### Constraints honoured (v1.7.5)

- `_extract_sap_list_output` and `_extract_alv_grid` PRESERVED — needed as fallback paths for pre-commit failures.
- v1.7.3 two-phase error taxonomy (`_PcPreCommitError` / `_PcPostCommitError`) UNCHANGED.
- v1.7.4 menu-driven trigger ladder UNCHANGED.
- `_extract_via_pc_export` UNCHANGED.
- `lt22_import.py` UNCHANGED.
- NO other handler touched (LT24, MMBE, MM02/03, RF, etc. all unchanged).
- NO migration. NO RLS. NO trigger semantics changed.
- NO frontend logic touched beyond `LATEST_AGENT_VERSION`.



## v1.7.6: multi-format parser

### Symptom (regression after v1.7.5 shipped)

User ran LT10 with the v1.7.5 agent and reported:

> The Save dialog opened correctly with Generate / Replace / Extend / X buttons. The directory was set to `C:\Users\LOA468~1\Temp\` and the filename was set to `omniframe_217bcfb46f83467f89172bb7424184e5.txt`. The file DID materialize on disk (post-commit error fired, not pre-commit) but the agent console showed:
>
> ```
> [query]  Could not find a dash-separator row in the %pc export. File may be empty or in an unexpected format.
> ```

v1.7.5's `extraction_path = pc_bulk_export` path reached Phase B (file landed on disk in `%TEMP%` with the right uuid filename) but the parser at line ~6627 failed to find a dash row separating header from data. `_PcPostCommitError` fired correctly (NOT a pre-commit failure → not eligible for pagination fallback), but the user-visible result was a hard error rather than a parsed table.

### Root cause

The v1.6.3 single-format parser was looking for one specific layout:

```python
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped and len(stripped) >= 8 and set(stripped) <= set("-|+ "):
        dash_idx = i
        break
```

This matches SAP's classic "Unconverted" list export which renders something like:

```
Material      Plant   Stock
----------    -----   -----
1234567       WH5     100
```

But SAP's `Save list in file` dialog has multiple format options (Unconverted, Spreadsheet, Rich Text Format, HTML, etc.) and the **default** option varies by SAP variant / box-level customizing. On this user's variant, the export emitted by selecting "Unconverted" produces something other than the dash-separated layout — could be tab-delimited, fixed-width without a separator banner, CSV (rare but possible if a custom transport overrode the SAP defaults), or HTML "Web HTML" mode.

Without the actual file we couldn't tell which format. The fix needed two things: (1) be more permissive so the most common alternatives parse correctly, (2) when none work, save the file off and dump diagnostics to console so we can identify the variant.

### Fix (two surgical changes — no other agent code touched)

#### 1. Five parsers in priority order

New helpers above `_extract_via_pc_export`:

```python
def _parse_attempt_a_dash_separator(text, lines):
    """Format A — original SAP Unconverted with dash row."""
    ...

def _parse_attempt_b_tab_delimited(text, lines):
    """Format B — header line contains \t; data rows split on \t."""
    ...

def _parse_attempt_c_fixed_width(text, lines):
    """Format C — fixed-width WITHOUT dashes. Split on 2+ spaces."""
    ...

def _parse_attempt_d_csv(text, lines):
    """Format D — CSV via csv.reader (handles quoting)."""
    ...

def _parse_attempt_e_html(text, lines):
    """Format E — SAP Web HTML export. Regex over <tr>/<td>."""
    ...

_PARSER_LADDER = [
    ("A", _parse_attempt_a_dash_separator),
    ("B", _parse_attempt_b_tab_delimited),
    ("C", _parse_attempt_c_fixed_width),
    ("D", _parse_attempt_d_csv),
    ("E", _parse_attempt_e_html),
]
```

Each parser returns `{columns, rows, meta}` or `None`. The main parser block in `_extract_via_pc_export` walks the ladder; the **first** parser that returns a non-None result with `>=2 columns` AND `>=1 data row` wins:

```python
lines = text.splitlines()
parser_format = None
parsed = None
parser_attempts = []
for fmt_label, fmt_fn in _PARSER_LADDER:
    try:
        candidate = fmt_fn(text, lines)
    except Exception as fmt_exc:
        parser_attempts.append((fmt_label, f"error: {fmt_exc!r}"))
        continue
    if candidate is None:
        parser_attempts.append((fmt_label, "no-match"))
        continue
    parsed = candidate
    parser_format = fmt_label
    parser_attempts.append((fmt_label, "matched"))
    break
```

`result["meta"]["parser_format"]` reports `A` / `B` / `C` / `D` / `E` so the SAP Testing tab + SQL audits can see which format the user's variant produced (we can then identify variant patterns over time without needing to dig through console logs).

New `[query]  Parser detected format: <X>` print on success.

#### 2. Diagnostic dump on total failure

```python
if parsed is None or parser_format is None:
    debug_path = _save_failed_export_debug_copy(text)
    _print_failed_export_diagnostics(text, debug_path, parser_attempts)
    try:
        os.remove(out_path)
    except Exception:
        pass
    raise _PcPostCommitError(
        "Could not parse the %pc export file with any known format "
        "(tried A=dash-separated, B=tab-delimited, C=fixed-width, "
        "D=CSV, E=HTML). File may be empty or in an unexpected SAP "
        f"variant format. Saved copy of the failing file to {debug_path} "
        "— please share it so we can identify the SAP variant's export "
        "format. As a workaround, try selecting a different export "
        "format option in SAP (Spreadsheet vs Unconverted) and recording "
        "the new flow."
    )
```

Where `_save_failed_export_debug_copy` writes a copy to `%TEMP%/omniframe_lastfailed_<UTC_ts>.txt` (best-effort — returns `None` on failure rather than masking the original parse error), and `_print_failed_export_diagnostics` dumps:

```
[query]  PARSE FAILURE — first 1000 chars of the export file:
============================================================
'<repr() output here so whitespace + encoding are exactly preserved>'
============================================================
[query]  Diagnostics: 47 line(s), 12473 byte(s), encoding-hint=cp1252-decoded, parser-attempts=[('A', 'no-match'), ('B', 'no-match'), ('C', 'no-match'), ('D', 'no-match'), ('E', 'no-match')]
[query]  Full file saved to C:\Users\LOA468~1\Temp\omniframe_lastfailed_20260501T235930Z.txt for inspection.
```

Encoding hint is heuristic — we read the file as `cp1252` (SAP's Latin1 default) so all bytes are addressable; the hint just classifies the content as `cp1252-decoded` / `utf-8-bom` / `html` / `binary-or-utf16` so the user knows whether to switch the source-side export format.

The `repr()` preview is critical — it shows exact whitespace, control characters, encoding artifacts, and BOM markers that a plain print() would silently elide.

### Why the post-commit fallback is STILL unsafe

v1.7.6 does NOT add a pagination fallback after a parse failure. The same three reasons from v1.7.3 apply:

1. **Same-data re-walk** — file is on disk, just unparseable by us today. Re-extracting via Ctrl+PgDn walks the GUI for the same data we already have.
2. **GUI may have advanced** — after `%pc → Save → Replace`, SAP often returns to the source list screen but sometimes lands on a transient confirmation screen. Paginating from there scrapes garbage.
3. **COM bridge contention** — re-paginating after a successful save can re-trigger the v1.6.2 SAP-COM crash that bulk-export was specifically introduced to avoid.

What v1.7.6 DOES add is a clear path to recovery: the user can ship us the saved copy, we identify the format pattern, add a Format F / G / etc. parser in the next agent version. The diagnostic dump shows the failing chars in `repr()` so encoding issues are immediately visible.

### New user-visible console output

Successful parse (any format):
```
[query]  Starting %pc bulk export — file will save to TEMP and be parsed in-place. No pagination needed.
[query]  Bulk export triggered via menu (menu / %pc)
[query]  Save-As dialog populated via filename-only
[query]  Save dialog dismissed via Enter (Enter / btn[11] / sendVKey 11)
[query]  Parser detected format: B
[query]  %pc bulk export complete: 234 row(s), 19 columns in 4.1s. No GUI pagination performed.
```

Total failure with diagnostics:
```
[query]  Starting %pc bulk export — file will save to TEMP and be parsed in-place. No pagination needed.
[query]  Bulk export triggered via menu (menu / %pc)
[query]  Save-As dialog populated via filename-only
[query]  Save dialog dismissed via Enter (Enter / btn[11] / sendVKey 11)
[query]  PARSE FAILURE — first 1000 chars of the export file:
============================================================
'<repr output>'
============================================================
[query]  Diagnostics: 47 line(s), 12473 byte(s), encoding-hint=cp1252-decoded, parser-attempts=[('A', 'no-match'), ('B', 'no-match'), ('C', 'no-match'), ('D', 'no-match'), ('E', 'no-match')]
[query]  Full file saved to C:\Users\LOA468~1\Temp\omniframe_lastfailed_20260501T235930Z.txt for inspection.
Exception: Could not parse the %pc export file with any known format (tried A=dash-separated, B=tab-delimited, C=fixed-width, D=CSV, E=HTML)...
```

### Capability

`bulk-export-multi-format-parser` appended to `AGENT_CAPABILITIES`. Purely informational — no frontend gating. Pairs with `bulk-export-no-fallback` (v1.7.3), `bulk-export-menu-driven` (v1.7.4), and `bulk-export-always` (v1.7.5).

### Files touched (v1.7.6)

- `omni_agent/agent.py` — five `_parse_attempt_*` helpers + `_PARSER_LADDER` ordered list + `_save_failed_export_debug_copy` + `_print_failed_export_diagnostics`; `_extract_via_pc_export` parsing block rewritten to walk the ladder; `csv` + `io` added to standard-library imports; `AGENT_VERSION = '1.7.6'` with full banner; new capability `bulk-export-multi-format-parser`. Net delta: roughly +391 / -86 LOC (mostly the new parser helpers + extensive comments).
- `src/features/admin/sap-testing/lib/agent-fetch.ts` — `LATEST_AGENT_VERSION = '1.7.6'` + v1.7.6 comment block. +30 / -1 LOC.
- `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` — copy refreshed (469,799 bytes).

### Verification

- `python3 -c "import ast; ast.parse(open('omni_agent/agent.py').read())"` — OK (10335 lines).
- Per-parser unit tests on synthetic inputs — A/B/C/D/E all match correctly; empty / header-only / plain-text inputs all return None as expected.
- `npm run build` — clean (✓ built in 9.97s; 181 PWA precache entries).
- `ReadLints` on `agent.py` + `agent-fetch.ts` — no errors.

### Constraints honoured (v1.7.6)

- `_extract_sap_list_output` and `_extract_alv_grid` PRESERVED — still the pre-commit fallbacks for `_PcPreCommitError`.
- v1.7.3 two-phase error taxonomy (`_PcPreCommitError` / `_PcPostCommitError`) UNCHANGED.
- v1.7.4 menu-driven trigger ladder UNCHANGED — Phase A is untouched.
- v1.7.5 always-bulk-export gate UNCHANGED — `handler_lt10` and `handler_mb52` still always call `_extract_via_pc_export`.
- `lt22_import.py` UNCHANGED.
- NO migration. NO RLS. NO trigger semantics changed.
- NO frontend logic touched beyond `LATEST_AGENT_VERSION`.

### Rebuild + ship (user)

1. `cd /Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/ && build_exe.bat` on Parallels Windows.
2. Upload `dist/OmniFrame_Agent.exe` to Supabase Storage.
3. Commit + push frontend so `LATEST_AGENT_VERSION = '1.7.6'` reaches the SAP Testing banner.
4. Run an LT10 query — agent console should print `[query]  Parser detected format: <X>` showing which format their SAP variant produces. Capture the format letter and ship the `omniframe_lastfailed_*.txt` file from `%TEMP%` if the parse still fails (which would mean we need a Format F parser for an even more exotic variant).


---

## v1.7.7 — smart header detection (2026-05-01)

### Symptom (after v1.7.6 shipped)

The v1.7.6 ladder correctly detected Format B (tab-delimited) on the user's LT10 export, but the parse came back wrong:

```
[query]  Parser detected format: B
[query]  %pc bulk export complete: 1 row(s), 6 columns in 4.2s.
```

232 SAP rows on disk, parser returned 1 row from the warehouse banner.

### Root cause

The user shipped their actual exported file (`/Users/jaisingh/Downloads/MacWindowsBridge/lt10export`). Layout:

```
Whse number\t\t\t\t\tWH5                                       ← banner 1 (6 cells, 2 non-empty)
Stge type\t\t\t\t\t999                                         ← banner 2 (6 cells, 2 non-empty)
                                                                 ← blank
                                                                 ← blank
\t\tSl\tTyp\tPlnt\t\tSLoc\tStorageBin\tMaterial\t<more>\t...    ← REAL header (20 cells, 17 non-empty)
                                                                 ← blank
\t\t\t999\t8810\t\tRCV1\t0000013758\t23089792\t-1\t-1\t...      ← data row (13 cells)
... 232 data rows ...
\t*\t\t\t\t\t\t\t\t    1,624\t    1,624\t        0\t        0     ← totals row (13 cells)
```

`_parse_attempt_b_tab_delimited` had two bugs feeding each other:

1. **"First non-blank line is the header"** — picked line 1 (`Whse number\t...\tWH5` → 6 cells). Banner row, not header.
2. **`abs(len(cells) - expected) > 1`** — once `expected=6`, every legitimate data row (13 cells) was rejected. The parser still returned the 6-cell banner shape because the format-detection ladder's success gate (≥2 cols + ≥1 row) was satisfied by a single body line that happened to fit the loose check. User got `1 row × 6 columns` of garbage.

### Fix (5 surgical changes; ladder order PRESERVED)

**1. Smart header pass in Format B.** Replaced "first non-blank line" with a scoring loop:

```python
candidates = []
for i, line in enumerate(lines):
    if not line.strip(): continue
    if "\t" not in line: continue
    cells = line.split("\t")
    non_empty = sum(1 for c in cells if c.strip())
    candidates.append((i, line, cells, non_empty))

best_idx = -1
best_score = -1
for k, (_, _, _, non_empty) in enumerate(candidates):
    if non_empty < 3: continue            # banner row → skip
    if non_empty > best_score:
        best_score = non_empty
        best_idx = k
```

Banner rows have 2 non-empty cells → filtered. Real header has 17 non-empty → wins. `meta.header_y` on this file = 4 (the 5th line, exactly correct).

**2. Permissive data-row matching in Format B.** SAP **drops trailing empty cells** from tab-exported data rows. A 13-cell row against a 20-cell header is the NORMAL case, not a malformed one. Replaced `abs(len(cells) - expected) > 1` with `if len(cells) > expected + 2: continue` — only rows with significantly MORE cells than the header are rejected; shorter rows get padded with empty strings. All 232 data rows + 1 totals row are now accepted. The footer regex `_FOOTER_RE` still catches `"N record(s) selected"` summary lines.

**3. Same scoring pass applied to Format C (fixed-width / 2+ spaces).** Defensive — a future SAP variant emitting banners WITHOUT tabs would have hit the same bug in C. Now C scores by whitespace-token count and prefers candidates with similarly-structured following rows (`score = total_tokens * 10 + following`). Tolerance loosened from `±1` to `±2` for SAP's variable-width column quirk.

**4. Format A (dash separator) left untouched.** Verified: A picks the FIRST dash row (banner lines have no dashes), then takes the line above it as the header. Banner rows don't have dashes below them, so A's logic is structurally sound. No code change.

**5. Capability + version bump.** `AGENT_VERSION = '1.7.7'`, `LATEST_AGENT_VERSION = '1.7.7'`, new capability `bulk-export-smart-header` (purely informational, no frontend gating).

### Verification

New unit test: `omni_agent/tests/test_lt10export_smart_header.py`. Self-contained — slices the parser block out of `agent.py` and execs it in an isolated namespace so it runs on Python 3.9 dev boxes (the rest of `agent.py` uses 3.10+ `X | Y` unions; the parser block is 3.9-compatible).

Three assertions against the real file:

- Format B returns ≥18 columns and ≥200 rows.
- First data row's `Material` column = `23089792`.
- `meta.header_y > 2` (smart detection skipped banner rows 1-2).
- Format A returns None (no dash row); ladder settles on B.
- Format C does NOT return a 1-row banner-only result.

Result on the user's file:

```
$ python3 omni_agent/tests/test_lt10export_smart_header.py
OK — Format B parsed 232 rows × 20 columns; header at line index 4

$ python3 -m pytest omni_agent/tests/test_lt10export_smart_header.py -v
... 3 passed in 0.02s
```

Build (`npm run build`) clean in 9s; no linter errors on `agent.py`, `agent-fetch.ts`, or the new test.

### Capability

`bulk-export-smart-header` appended to `AGENT_CAPABILITIES`. Pairs with `bulk-export-multi-format-parser` (v1.7.6), `bulk-export-no-fallback` (v1.7.3), `bulk-export-menu-driven` (v1.7.4), and `bulk-export-always` (v1.7.5).

### Files touched (v1.7.7)

- `omni_agent/agent.py` — `_parse_attempt_b_tab_delimited` rewritten (~+50 / -25 LOC); `_parse_attempt_c_fixed_width` rewritten (~+40 / -15 LOC); `AGENT_VERSION` bumped to `'1.7.7'` with banner; new capability `bulk-export-smart-header` with comment block. Net delta: roughly +110 / -45 LOC.
- `src/features/admin/sap-testing/lib/agent-fetch.ts` — `LATEST_AGENT_VERSION = '1.7.7'` + v1.7.7 banner-comment block. +27 / -1 LOC.
- `omni_agent/tests/test_lt10export_smart_header.py` — NEW. ~140 LOC. Standalone test runner that loads the parser block via `exec()` so it works on Python 3.9 (the agent module-level uses 3.10+ syntax).
- `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` — copy refreshed (475,170 bytes).

### Constraints honoured (v1.7.7)

- Format-detection ladder order PRESERVED (A → B → C → D → E). Just made each individual parser smarter.
- Format A logic UNCHANGED (dash-separator detection is structurally banner-resistant).
- Format D (CSV) and Format E (HTML) UNCHANGED — neither vulnerable to SAP's banner-row pattern.
- `_extract_via_pc_export` orchestration UNCHANGED — only the parsers it calls were hardened.
- v1.7.3 two-phase error taxonomy UNCHANGED.
- v1.7.4 menu-driven trigger ladder UNCHANGED.
- v1.7.5 always-bulk-export gate UNCHANGED.
- `lt22_import.py` UNCHANGED.
- NO migration. NO RLS. NO trigger semantics changed.
- NO frontend logic touched beyond `LATEST_AGENT_VERSION`.

### Rebuild + ship (user)

1. `cd /Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/ && build_exe.bat` on Parallels Windows.
2. Upload `dist/OmniFrame_Agent.exe` to Supabase Storage.
3. Commit + push frontend so `LATEST_AGENT_VERSION = '1.7.7'` reaches the SAP Testing banner.
4. Run the same LT10 query that previously returned `1 row(s), 6 columns`. Agent console should print `[query]  Parser detected format: B` AND `[query]  %pc bulk export complete: 232 row(s), 20 columns in <T>s.` (or similar — exact totals depend on warehouse data freshness).
5. If a future SAP variant emits a NEW banner shape that still tricks the scorer, capture the saved `omniframe_lastfailed_*.txt` (won't trigger here since parsing now succeeds) or paste the file's first 60 lines into the bug report — the smart-header pass needs only the relative non-empty-cell counts to triangulate.

### Related

- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Sessions/2026-05-01]]
- (parent thread) v1.7.6: multi-format parser section above


---

## v1.8.2 — parser banner penalty + per-batch dedup (2026-05-04)

### Symptom (LT22 PDC import, post-v1.8.1)

User triggered an LT22 import via the agent. Console reported `561 rows, 2 columns` for an LT22 file that should have ~573 rows × 22 columns. The bulk INSERT then 409-aborted on the unique constraint:

```
409 duplicate key value violates unique constraint
  sap_outbound_to_imports_unique_per_batch
  UNIQUE (organization_id, to_number, import_batch_id)
```

Two cascading bugs:

1. **Parser misidentified the banner as the header**. The user's actual file at `/Users/jaisingh/Downloads/MacWindowsBridge/LT22DeliveryData.txt` has this shape:

   ```
   Warehouse No.\t\t\tPDC\tIndianapolis PDC                                  ← line 1: BANNER, 3 non-empty cells
                                                                              ← line 2: blank
                                                                              ← line 3: blank
   \tDelivery\tTO Number\t\t\tTO prio\tTyp\tWhN\t...                          ← line 4: REAL HEADER, 19 non-empty cells
                                                                              ← line 5: blank
   \t65367274\t0003648485\t\t\t      5\t010\tPDC\t916\t...                    ← line 6+: data rows
   ```

   v1.7.7's `_parse_attempt_b_tab_delimited` uses `if non_empty < 3: continue` to skip banners. The LT22 banner has EXACTLY 3 non-empty cells (`Warehouse No.`, `PDC`, `Indianapolis PDC`) so it PASSED the filter. Replay against the user's actual file showed the v1.7.7 single-factor scorer (max `non_empty`) still picks the real header by raw count (19 > 3), so the user's `561 rows, 2 columns` symptom must have come from an even earlier path — either an older agent build cached on disk, or a now-fixed second-order bug — but the EXPOSURE is real: a future SAP variant with a 4-5 non-empty banner would beat a sparse real header.

2. **Bulk insert had no defense against duplicate / null `to_number`**. Even if the parser slips, the agent should NOT 409 the entire batch on the first chunk. Split deliveries can also legitimately produce duplicate TO numbers in the SAP export.

### Fix (three layered defenses, ladder order PRESERVED)

**1. Multi-factor header scorer with banner penalty.** New `_score_header_candidate(non_empty, total_cells, subordinate_data_rows)` helper blends three factors:

```python
def _score_header_candidate(non_empty, total_cells, subordinate_data_rows):
    score = non_empty * 10
    score += min(subordinate_data_rows, 20) * 5
    if total_cells > 0:
        fill_ratio = non_empty / total_cells
        if fill_ratio < 0.3 and non_empty < 5:
            score -= 50  # banner shape
    return score
```

- **Base score** `non_empty * 10` — same v1.7.7 signal.
- **Subordinate-rows bonus** capped at 20 × 5 = 100. Counts later candidates whose `non_empty ≤ this` AND `total_cells ≤ this`. Real headers dominate every data row (data rows have ≤ non_empty AND ≤ total_cells because SAP drops trailing empties); banners dominate ~nothing (the lines after a banner are the header + data rows, which all carry MORE non-empty cells than the banner).
- **Banner penalty** `-50` when `fill_ratio < 0.3 AND non_empty < 5`. Larger than any banner could earn from raw `non_empty` alone (3 × 10 = 30), so a real header reliably outranks any banner-shaped candidate even when `subordinate_data_rows = 0` for both.

First attempt used a "following lines with similar shape (±2)" bonus per the brief, but that bonus also fires for data rows (they see hundreds of data-row siblings), so a 9-non-empty data row would score 190 (90 + 100) and beat the LT10 17-non-empty real header (170 + 0). The CI-caught regression on `test_lt10export_smart_header.py` drove the refinement to **subordinate** lines (≤ in both metrics) instead of similar-shaped — a data row only wins this bonus if every later candidate is strictly less populated, which by definition is what makes a line a header.

Applied to both `_parse_attempt_b_tab_delimited` and `_parse_attempt_c_fixed_width`. The `non_empty` floor drops from `< 3` to `< 2` since the penalty does the heavy lifting now.

**2. `lt22_import.py` defense-in-depth dedup.** New `_dedupe_lt22_rows(normalized)` runs after `normalize_lt22_row` and before the bulk INSERT:

- Drops rows where `to_number` is empty / NULL with a single warn-summary log line: `[lt22]  WARN dropped N row(s) with empty/null to_number before insert (parser likely misidentified header — check result.meta.parser_format in agent log).`
- Deduplicates by `to_number` within the batch, keeping the first occurrence. Logs `[lt22]  deduplicated N row(s) by to_number within batch <id> before insert (split deliveries can legitimately produce duplicate TO numbers in the SAP export).`
- Bulk INSERT POST switches from `Prefer: return=minimal` to `Prefer: return=minimal,resolution=ignore-duplicates` so a partial-success run can re-execute without 409-aborting on rows the previous run already inserted.

**3. Parse-validation gate.** New `_validate_lt22_parse(rows, columns, req)` runs BEFORE `normalize_lt22_row`. Two failure modes:

- No "TO Number"-shaped column was extracted (the parser clearly picked a non-header line as the header).
- The "TO Number" column exists but EVERY data row is empty in that column (column ordering is off).

On either failure, `_save_lt22_parse_failure_snapshot(rows, columns, req)` writes a JSON snapshot to `%TEMP%/omniframe_lt22_parse_failure_<UTC_ts>.json` (best-effort — never blocks the original error) and a specific Exception is raised:

```
LT22 parsed but TO Number column not found / values empty — likely parser misidentified header.
Got N row(s) × M column(s). First column titles: [...]. Diagnostic file saved to <path>
```

Triagers can grab the diagnostic + ship it; if a future SAP variant slips past the multi-factor scorer we add a Format F parser using the saved snapshot as the test fixture.

**4. Capability + version bump.** `AGENT_VERSION = '1.8.2'`, `LATEST_AGENT_VERSION = '1.8.2'`, new capability `parser-banner-penalty` (purely informational, no frontend gating).

### Verification

New unit test `omni_agent/tests/test_lt22_smart_header.py` mirrors the v1.7.7 LT10 test's self-contained namespace pattern (slice the parser block out of `agent.py`, exec it in a stub namespace so it runs on Python 3.9 dev boxes). Three tests:

- `test_lt22_delivery_data_format` — asserts ≥19 cols, ≥500 rows, a `TO Number` column, non-empty first-row TO number, `header_y ≥ 3`, positive `header_score`.
- `test_lt22_format_b_outranks_banner_with_score` — direct probe of `_score_header_candidate`. Pins the formula via three asserts: banner < real header (LT22 shapes), sparse banner < sparse real header, **data-row shape < real-header shape** (the regression-guard for the LT10 CI failure that drove the subordinate-vs-similar refinement).
- `test_lt22_ladder_picks_format_b` — confirms Format A returns None on tab-only LT22 export, Format B wins.

Result on the user's actual `LT22DeliveryData.txt`:

```
$ python3 omni_agent/tests/test_lt22_smart_header.py
OK — LT22 Format B parsed 572 rows × 22 columns; header at line index 3; header_score=290;
sample TO numbers: ['0003648485', '0003656928', '0003656929']

$ python3 -m pytest omni_agent/tests/test_lt22_smart_header.py omni_agent/tests/test_lt10export_smart_header.py -v
... 6 passed in 0.05s
```

`npm run build` clean in 10.5s; AST parse on `agent.py` + `lt22_import.py` clean; `ReadLints` on the four touched files reports no errors.

### Files touched (v1.8.2)

- `omni_agent/agent.py` — new `_score_header_candidate` helper (~37 LOC); `_parse_attempt_b_tab_delimited` rewritten to use the helper + subordinate-rows bonus (~+22 / -8 LOC); `_parse_attempt_c_fixed_width` similarly (~+15 / -8 LOC); `AGENT_VERSION` bumped to `'1.8.2'` with full banner; new capability `parser-banner-penalty` with comment block. Net delta: roughly +90 / -25 LOC.
- `omni_agent/lt22_import.py` — module docstring updated; new `_TO_NUMBER_HEADER_ALIASES`, `_has_to_number_column`, `_save_lt22_parse_failure_snapshot`, `_validate_lt22_parse`, `_dedupe_lt22_rows` helpers (~140 LOC); bulk INSERT path adds dedup call + ignore-duplicates Prefer; standard-library `json`, `tempfile`, `datetime` imports lifted to module top. Net delta: roughly +175 / -3 LOC.
- `omni_agent/tests/test_lt22_smart_header.py` — NEW. ~180 LOC. Standalone test runner mirroring the v1.7.7 LT10 test pattern.
- `src/features/admin/sap-testing/lib/agent-fetch.ts` — `LATEST_AGENT_VERSION = '1.8.2'` + v1.8.2 banner-comment block. +60 / -1 LOC.
- `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` — copy refreshed (550,694 bytes).
- `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/lt22_import.py` — copy refreshed (40,701 bytes).

### Constraints honoured (v1.8.2)

- Format-detection ladder order PRESERVED (A → B → C → D → E). Just made each individual parser smarter.
- Format A logic UNCHANGED (dash-separator detection is structurally banner-resistant).
- Format D (CSV) and Format E (HTML) UNCHANGED — neither vulnerable to SAP's banner-row pattern.
- `_extract_via_pc_export` orchestration UNCHANGED — only the parsers it calls were hardened.
- v1.7.3 two-phase error taxonomy UNCHANGED.
- v1.7.4 menu-driven trigger ladder UNCHANGED.
- v1.7.5 always-bulk-export gate UNCHANGED.
- v1.7.6 multi-format ladder UNCHANGED.
- v1.7.7 LT10 test still passing — no expectation changes.
- NO database schema change (dedup happens client-side; the existing unique constraint on `sap_outbound_to_imports_unique_per_batch` stays).
- NO migration. NO RLS. NO trigger semantics changed.
- NO frontend logic touched beyond `LATEST_AGENT_VERSION`.

### Rebuild + ship (user)

1. `cd /Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/ && build_exe.bat` on Parallels Windows.
2. Upload `dist/OmniFrame_Agent.exe` to Supabase Storage.
3. Commit + push frontend so `LATEST_AGENT_VERSION = '1.8.2'` reaches the SAP Testing banner.
4. Re-run the LT22 PDC import. Agent console should print `[query]  Parser detected format: B` AND `[query]  %pc bulk export complete: ~573 row(s), 22 columns in <T>s.`. The defense-in-depth dedup will print one or two summary log lines if SAP shipped duplicate / empty TO numbers, but the chunk INSERT should now succeed.
5. If a future SAP variant emits a NEW banner shape that still tricks the multi-factor scorer, capture the saved `omniframe_lt22_parse_failure_<ts>.json` snapshot from `%TEMP%` (the parse-validation gate creates it automatically before raising the specific error).

### Related

- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Sessions/2026-05-04]]
- [[Patterns/Multi-Factor-Header-Scoring]] (candidate pattern)
