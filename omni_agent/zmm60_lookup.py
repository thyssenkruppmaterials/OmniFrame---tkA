# Created and developed by Jai Singh
"""
ZMM60 unit-price lookup — Inventory Adjustment workflow (2026-05-07).

Backs the new `+ Add to Inv. Adjust` action on LT10 row results in the
SAP Testing → Inventory Management tab. Given a single material number
(and optional plant), runs the recorded ZMM60 selection screen and
reads the resulting ALV grid via SAP COM directly. Returns the SAP
`Price` field along with `Currency`.

Reference recording: `MacWindowsBridge/Zmm60xx.vbs`

Recorded flow (verbatim from the .vbs):
    1. /nzmm60                              → MM Selection Screen
    2. ctxtMS_MATNR-LOW = <material>
    3. ctxtMS_WERKS-LOW = <plant>           (optional)
    4. tbar[1]/btn[8].press()               → execute (F8) → ALV grid
                                              at `wnd[0]/usr/shell`
    5. shell.pressToolbarContextButton "&MB_EXPORT"
       shell.selectContextMenuItem        "&PC"
                                            → "Save list in file" dialog
       (We DO NOT replay this — instead we read the ALV grid directly
       via COM. The recording's export path is what a human user does
       to peek at the data; the agent has a faster shortcut. See the
       implementation note below.)

# Why we DON'T reuse `_extract_via_pc_export()`

# 2026-05-07 — Two-attempt history (`Debug/Fix-ZMM60-Export-Dialog-Mismatch`):
# the first cut of this module called `_extract_via_pc_export(sess)` to
# reuse the LT10 / LT22 bulk-export pipeline. That FAILED on the user's
# SAP variant with `Could not locate the Save-As path/filename fields
# after %pc trigger`, then failed the lbl[x,y] pagination fallback too.
#
# Root cause: ZMM60's result is an ALV grid (`wnd[0]/usr/shell`), NOT
# a classic list-output report. The two paths the helper uses are
# wrong-target on this transaction:
#
#   1. `wnd[0]/mbar/menu[0]/menu[1]/menu[2]` (List → Save → File) →
#      menu doesn't exist on ALV-grid screens (different menu layout).
#   2. `%pc` OK-code → not registered on this SAP variant for ALV-grid
#      list reports; SAP silently does nothing.
#
# The recording's `&MB_EXPORT` + `&PC` IS the ALV grid's own toolbar
# Export → Local file… dropdown. That's NOT the same `&PC` constant as
# the OK-code; same character sequence, completely different SAP
# control surface. We could replay it (Option 2 in the user's spec)
# but reading the ALV grid via COM (Option 1) is faster, simpler, and
# avoids file I/O entirely. The grid has all the columns we need
# (`Price`, `Currency`, `Material`, `Plant`) directly readable via
# `grid.GetCellValue(row, col_id)`.

Output columns (verified against the 2026-05-07 ValueExport reference,
test material `23067754` / plant `8303`, expected price `287.63 USD`):

    Material  Plant  Created  Mat. Type  Matl Group  Unit
    Purch. Grp  ABC  MRP Type  Val. Class  Price Ctrl  Val. Type
    Price  Currency  Price Unit  Material Description  ...

The agent locates `Price` / `Currency` / `Price Unit` by case-insensitive
column TITLE on the live grid (`grid.GetColumnTitles(col_id)[0]`). Falls
back to a small alias list (`Std Price`, `Standard Price`,
`Moving Avg`, `Moving Average`) for SAP variants whose layout renames
the canonical column.

Mirrors the `material_master_read.py` pattern:
  - Lazy `_resolve_agent_globals()` so PyInstaller's --onefile bootloader
    doesn't trip on a circular import.
  - `_track_metric` proxy (decorator) so the agent's per-action metrics
    counter stays accurate.
  - Returns ok/error shape consistent with the rest of the agent so the
    FE can branch on `data.ok` uniformly.

Capability id: `zmm60-price-lookup` — added to AGENT_CAPABILITIES in
`agent.py`. The FE gates the new row action on this capability id so
older agents render the dropdown item disabled with a "needs update"
hint instead of silently failing the network call.
"""

from __future__ import annotations

from functools import wraps
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel


# ---------------------------------------------------------------------------
#  Lazy bridge into the parent `agent` module — see material_master_read.py
#  for the full rationale (PyInstaller bootloader / circular-import window).
# ---------------------------------------------------------------------------
def _agent():
    """Return the `agent` module. Cached in sys.modules after the first
    real import, so this is essentially free on every call."""
    import agent  # type: ignore[import-not-found]
    return agent


def _track_metric(action: str):
    """Lazy proxy for `agent._track_metric`. Resolves the real decorator
    on first invocation and caches the wrapped function so subsequent
    calls have zero overhead."""
    def decorator(fn):
        cache: list = []

        @wraps(fn)
        def wrapped(*args, **kwargs):
            if not cache:
                cache.append(_agent()._track_metric(action)(fn))
            return cache[0](*args, **kwargs)

        return wrapped

    return decorator


_AGENT_GLOBALS_RESOLVED = False


def _resolve_agent_globals() -> None:
    """Bind the agent helper symbols into THIS module's globals so the
    handler below can call them as bare names. Idempotent."""
    global _AGENT_GLOBALS_RESOLVED
    if _AGENT_GLOBALS_RESOLVED:
        return
    a = _agent()
    g = globals()
    for name in (
        "_classify_sbar",
        "_extract_alv_grid",
        "_get_sap_session",
        "_log_sap_txn",
        "_wait_for_session",
        "_with_retries",
        "state",
    ):
        g[name] = getattr(a, name)
    _AGENT_GLOBALS_RESOLVED = True


router = APIRouter()


# ---------------------------------------------------------------------------
#  Request / Response Models
# ---------------------------------------------------------------------------
class Zmm60LookupRequest(BaseModel):
    """One-shot ZMM60 price lookup. Plant is optional but strongly
    recommended — ZMM60 will execute without it, but a multi-plant
    material can return multiple rows and we'd have to guess which
    `Price` is canonical."""

    material: str
    plant: Optional[str] = None


# ---------------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------------
def _exit_to_main(sess) -> None:
    """Send `/n` to leave whatever screen we're on. Idempotent and
    forgiving — failures swallowed because the next `/nZMM60` will reset
    us anyway."""
    try:
        sess.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 5)
    except Exception:
        pass


def _try_set(sess, ids: list[str], value: str) -> bool:
    """Cross-variant field setter. Some SAP installs render the ZMM60
    selection-screen field as `ctxtMS_MATNR-LOW`; others use the
    canonical `S_MATNR-LOW` shape. Walk a small candidate list and stop
    at the first hit."""
    for fid in ids:
        try:
            sess.findById(fid).text = value
            return True
        except Exception:
            continue
    return False


def _safe_float(text: str) -> Optional[float]:
    """SAP renders prices in user-locale format. The recorded export
    shows `287.63` (US), but other variants emit `287,63` (DE) or
    thousands-separated like `1,234.56`. Be permissive."""
    if text is None:
        return None
    s = str(text).strip()
    if not s:
        return None
    # Trailing-minus convention (`23-` → -23).
    neg = s.endswith("-")
    if neg:
        s = s[:-1].strip()
    # Heuristic: if BOTH `,` and `.` appear, assume the rightmost is the
    # decimal separator and the other is a grouping separator. If only
    # one appears, assume it's the decimal (covers both EN `1.5` and
    # DE `1,5`). This matches `_parse_sap_number` in agent.py for the
    # common cases without coupling us to that helper.
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        v = float(s)
        return -v if neg else v
    except ValueError:
        return None


def _find_col_id(columns: list[dict], wanted_title: str) -> Optional[str]:
    """Case/whitespace-insensitive title→id resolver for a single column.
    Returns None when the column isn't present (older SAP layouts may
    omit `Currency` for materials with no valuation, for example)."""
    target = wanted_title.strip().lower()
    for col in columns:
        title = str(col.get("title", "")).strip().lower()
        if title == target:
            return str(col.get("id", "")) or None
    return None


# ---------------------------------------------------------------------------
#  /sap/zmm60/lookup
# ---------------------------------------------------------------------------
@router.post("/sap/zmm60/lookup")
@_track_metric("zmm60_lookup")
def zmm60_lookup(req: Zmm60LookupRequest) -> dict:
    """Run ZMM60 for a single material → return the unit price.

    Response shape on success:
        {
            "ok": True,
            "material": "23067754",
            "plant":    "8303",
            "unit_value": 287.63,
            "currency":   "USD",
            "price_unit": 1,
            "raw":   { "<column title>": "<cell value>", ... },
            "warning": "<optional, e.g. price=0 hint>"
        }

    On failure (SAP not connected, material not found, parse failure):
        {
            "ok": False,
            "material": "23067754",
            "error": "<human message>",
            "step":  "<connect|navigate|execute|extract|parse>"
        }

    The handler is idempotent — same material/plant returns the same
    `unit_value` as long as the SAP master data hasn't changed.

    Implementation note (2026-05-07): reads the ALV grid at
    `wnd[0]/usr/shell` via COM (`grid.GetCellValue(row, col_id)`)
    rather than triggering the file-export dialog. The recording's
    `&MB_EXPORT` + `&PC` toolbar dance IS what a human user does to
    peek at the data, but it's purely a UI affordance — we have direct
    grid access via `_extract_alv_grid()` and don't need to round-trip
    through %TEMP%. See `Debug/Fix-ZMM60-Export-Dialog-Mismatch.md`
    for the (failed) prior attempt that reused the LT10/LT22 `%pc`
    bulk-export path.
    """
    _resolve_agent_globals()

    material = (req.material or "").strip()
    plant = (req.plant or "").strip()

    if not material:
        return {"ok": False, "material": material, "error": "Material is required", "step": "validate"}

    if not state.sap_connected:
        return {"ok": False, "material": material, "error": "SAP not connected — open SAP GUI and reconnect the agent", "step": "connect"}

    try:
        sess, _ = _get_sap_session()
    except Exception as e:
        return {"ok": False, "material": material, "error": f"Could not acquire SAP session: {e}", "step": "connect"}

    try:
        # Step 1 — open ZMM60. Wrapped in retry because a brief COM
        # hiccup mid-keystroke is the most common failure here.
        def _open():
            sess.findById("wnd[0]/tbar[0]/okcd").text = "/nZMM60"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)
        try:
            _with_retries(_open, label="ZMM60 open")
        except Exception as e:
            _exit_to_main(sess)
            _log_sap_txn(material, "ZMM60", "zmm60_lookup", "error", f"open | {e}")
            return {"ok": False, "material": material, "error": f"Could not open ZMM60: {e}", "step": "navigate"}

        # Step 2 — fill the selection screen. The recorded VBS uses
        # `MS_MATNR-LOW` / `MS_WERKS-LOW`; older variants surface the
        # canonical `S_MATNR-LOW` shape. Try both.
        if not _try_set(sess, [
            "wnd[0]/usr/ctxtMS_MATNR-LOW",
            "wnd[0]/usr/ctxtS_MATNR-LOW",
        ], material):
            _exit_to_main(sess)
            _log_sap_txn(material, "ZMM60", "zmm60_lookup", "error", "set_material_failed")
            return {
                "ok": False, "material": material,
                "error": "Could not set material field on ZMM60 selection screen — SAP variant may differ",
                "step": "navigate",
            }

        if plant:
            # Plant is optional — failure to set it is not fatal, ZMM60
            # will execute with the field blank (returning every plant).
            _try_set(sess, [
                "wnd[0]/usr/ctxtMS_WERKS-LOW",
                "wnd[0]/usr/ctxtS_WERKS-LOW",
            ], plant)

        # Step 3 — execute (F8). Equivalent to btn[8] on toolbar 1.
        try:
            sess.findById("wnd[0]/tbar[1]/btn[8]").press()
        except Exception:
            try:
                sess.findById("wnd[0]").sendVKey(8)
            except Exception as e:
                _exit_to_main(sess)
                _log_sap_txn(material, "ZMM60", "zmm60_lookup", "error", f"execute | {e}")
                return {"ok": False, "material": material, "error": f"Could not execute ZMM60: {e}", "step": "execute"}
        _wait_for_session(sess, 30)

        # Handle "no data" status bar — ZMM60 typically renders an
        # information popup ("No materials selected") rather than a list
        # screen. Check both.
        try:
            sbar, msg_type = _classify_sbar(sess)
            sbar_lower = sbar.lower()
            if msg_type in ("E", "A") or any(
                k in sbar_lower for k in ("no data", "no records", "no objects", "no materials", "not exist", "not found")
            ):
                _exit_to_main(sess)
                _log_sap_txn(material, "ZMM60", "zmm60_lookup", "warning", f"no_data | {sbar}")
                return {
                    "ok": False, "material": material,
                    "error": sbar or "No ZMM60 data for this material — verify the material exists and is valuated for the requested plant in MM03 (Costing/Accounting view)",
                    "step": "execute",
                }
        except Exception:
            pass

        # Step 4 — read the ALV grid directly via COM. The recording at
        # `Zmm60xx.vbs:25` shows the result lives at `wnd[0]/usr/shell`
        # (an ALV grid). `_extract_alv_grid()` walks a candidate list of
        # common SAP shell IDs first, then a tree-walk fallback for any
        # control that exposes `.ColumnOrder`. We pass the recorded ID
        # at the head of the candidate list so the common-case lookup
        # is O(1).
        #
        # NOTE: do NOT route through `_extract_via_pc_export()` here.
        # See the module docstring + `Debug/Fix-ZMM60-Export-Dialog-Mismatch.md`
        # for the prior attempt that wrongly reused the LT10 / LT22
        # bulk-export pipeline (different export trigger, different
        # Save-As dialog shape).
        try:
            extract = _extract_alv_grid(sess, candidate_ids=[
                # Recorded path — fastest match on the user's variant.
                "wnd[0]/usr/shell",
                # Defensive fall-throughs for skin variants.
                "wnd[0]/usr/cntlGRID1/shellcont/shell",
                "wnd[0]/usr/cntlCONTAINER1_CONT/shellcont/shell",
                "wnd[0]/usr/shellcont/shell",
            ])
        except Exception as e:
            _exit_to_main(sess)
            _log_sap_txn(material, "ZMM60", "zmm60_lookup", "error", f"alv_extract | {e}")
            return {
                "ok": False, "material": material,
                "error": (
                    f"Could not read ZMM60 ALV grid: {e}. "
                    f"Check the material exists in MM03 (Costing/Accounting view) "
                    f"and is valuated for plant {plant or '*'}."
                ),
                "step": "extract",
            }

        columns = list(extract.get("columns", []) or [])
        rows = list(extract.get("rows", []) or [])

        if not columns or not rows:
            _exit_to_main(sess)
            _log_sap_txn(material, "ZMM60", "zmm60_lookup", "warning", "empty_extract")
            return {
                "ok": False, "material": material,
                "error": (
                    f"ZMM60 returned an empty list — material {material} may not be "
                    f"valuated for plant {plant or '*'}. Verify in MM03 (Costing/"
                    f"Accounting view) that the material is extended for the plant."
                ),
                "step": "extract",
            }

        # Step 5 — locate the Price column. The recorded export labels
        # the column as exactly "Price" (verified against the 2026-05-07
        # ValueExport reference). Fall back to a small alias list in
        # case a corporate SAP variant ships a localised header. Note:
        # the alias list keeps `Std Price` / `Moving Avg` even though
        # the canonical ZMM60 layout uses `Price` because some sites
        # have customised the report to surface a different valuation
        # type at the top.
        price_col_id: Optional[str] = None
        price_alias_used: Optional[str] = None
        for alias in (
            "Price", "Std Price", "Standard Price",
            "Moving Avg", "Moving Average",
        ):
            cid = _find_col_id(columns, alias)
            if cid:
                price_col_id = cid
                price_alias_used = alias
                break
        if price_col_id is None:
            available = ", ".join(str(c.get("title", "")) for c in columns[:30])
            _exit_to_main(sess)
            _log_sap_txn(material, "ZMM60", "zmm60_lookup", "error", f"no_price_col | {available}")
            return {
                "ok": False, "material": material,
                "error": f"ZMM60 grid had no Price column. Headers seen: {available}",
                "step": "parse",
            }

        currency_col_id = _find_col_id(columns, "Currency")
        price_unit_col_id = _find_col_id(columns, "Price Unit")
        material_col_id = _find_col_id(columns, "Material")
        plant_col_id = _find_col_id(columns, "Plant")

        # Step 6 — pick the right row. ZMM60 normally returns one row
        # per (material, plant) tuple. With a plant filter we should see
        # exactly one row, but be defensive and prefer the row whose
        # Material+Plant cells match the request. Falls through to the
        # first row when no match is found (covers single-row results
        # whose Material cell happens to render with leading zeros that
        # don't string-compare equal to the request).
        chosen: Optional[dict] = None
        if material_col_id:
            for row in rows:
                m_cell = str(row.get(material_col_id, "") or "").strip()
                if m_cell != material:
                    continue
                if plant and plant_col_id:
                    p_cell = str(row.get(plant_col_id, "") or "").strip()
                    if p_cell != plant:
                        continue
                chosen = row
                break
        if chosen is None and plant and plant_col_id:
            # Fallback A: any row matching just the plant.
            for row in rows:
                p_cell = str(row.get(plant_col_id, "") or "").strip()
                if p_cell == plant:
                    chosen = row
                    break
        if chosen is None:
            chosen = rows[0]

        unit_value = _safe_float(str(chosen.get(price_col_id, "") or ""))
        if unit_value is None:
            _exit_to_main(sess)
            _log_sap_txn(
                material, "ZMM60", "zmm60_lookup", "error",
                f"price_parse_failed | raw={chosen.get(price_col_id, '')!r}",
            )
            return {
                "ok": False, "material": material,
                "error": (
                    f"Could not parse ZMM60 {price_alias_used} field "
                    f"(raw value: {chosen.get(price_col_id, '')!r})"
                ),
                "step": "parse",
            }

        currency: Optional[str] = None
        if currency_col_id:
            cell = str(chosen.get(currency_col_id, "") or "").strip()
            currency = cell or None

        price_unit: Optional[float] = None
        if price_unit_col_id:
            price_unit = _safe_float(str(chosen.get(price_unit_col_id, "") or ""))

        # Build a key→value `raw` dict on header titles so the FE / DB
        # capture is human-readable without coupling consumers to the
        # ALV grid's positional column ids (e.g. `BWPREIS`, `WAERS`).
        raw: dict[str, str] = {}
        for col in columns:
            cid = str(col.get("id", ""))
            title = str(col.get("title", ""))
            if not title:
                continue
            cell = str(chosen.get(cid, "") or "").strip()
            if cell:
                raw[title] = cell

        # Optional warning — some materials are extended in WM but not
        # yet costed. ZMM60 still renders a row, but Price is 0.
        warning: Optional[str] = None
        if unit_value == 0:
            warning = (
                f"ZMM60 returned price=0; verify in MM03 Costing/Accounting "
                f"view that material {material} has a Standard or Moving Avg "
                f"price configured for plant {plant or '*'}."
            )

        _exit_to_main(sess)
        _log_sap_txn(
            material, "ZMM60", "zmm60_lookup", "success",
            f"plant:{plant or '-'} price:{unit_value} currency:{currency or '-'} "
            f"alias:{price_alias_used}{' WARN:price=0' if unit_value == 0 else ''}",
        )
        result: dict = {
            "ok": True,
            "material": material,
            "plant": plant or None,
            "unit_value": unit_value,
            "currency": currency,
            "price_unit": price_unit,
            "raw": raw,
        }
        if warning:
            result["warning"] = warning
        return result

    except Exception as e:
        try:
            _exit_to_main(sess)
        except Exception:
            pass
        _log_sap_txn(material, "ZMM60", "zmm60_lookup", "error", f"unhandled | {e}")
        return {"ok": False, "material": material, "error": str(e), "step": "unhandled"}

# Created and developed by Jai Singh
