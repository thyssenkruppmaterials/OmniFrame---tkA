# Created and developed by Jai Singh
"""
LX25 Inventory Completion — cross-warehouse cycle-count summary (2026-05-10).

Backs the new "Inventory Completion" entry in the SAP Testing → Inventory
Management → Query Library → WAREHOUSE category. Runs LX25 ("Inventory
Status — List with Totals") with a different SAP variant per warehouse
and aggregates the 5 storage-type-level metrics that LX25 emits per row:

    - Total number of bins
    - Inv. executed during selection peri[od]
    - Inventory active
    - Inventory planned
    - No inventory executed

Returns both a per-warehouse breakdown AND a cross-warehouse roll-up so
the FE can render an aggregate stat card on top + 5 per-warehouse cards
+ a detail table.

Reference recordings (under `MacWindowsBridge/`):
    - WH5LX25x  — small (462-byte) verbatim text export from LX25 for
                  warehouse WH5, storage type 110. Tab-delimited
                  unconverted format with `\\r\\n` line endings.
    - LX25data.vbs — extended SAP GUI scripting recording showing the
                  variant-driven flow used here.

Recorded SAP GUI flow (verbatim from the .vbs):
    1. /nLX25                                   → Inventory Status selection screen
    2. tbar[1]/btn[17].press()                  → opens Get Variant dialog (wnd[1])
    3. wnd[1]/usr/txtV-LOW   = "<variant>"      → variant name (e.g. "TKAWH5")
       wnd[1]/usr/txtENAME-LOW = ""             → clear user-name filter so any
                                                  user's variant (not just the
                                                  recording author's) is found.
    4. wnd[1]/tbar[0]/btn[8].press()            → Execute → criteria loaded
    5. tbar[1]/btn[8].press()                   → F8 → run report → list output
    6. mbar/menu[0]/menu[1]/menu[2].select()    → List → Save → File...
    7. radSPOPLI-SELFLAG[1,0].select()          → "Unconverted" radio
       wnd[1]/tbar[0]/btn[0].press()            → OK
    8. ctxtDY_FILENAME = "<file>"               → filename
       wnd[1]/tbar[0]/btn[0].press() OR Enter   → Save → file lands on disk
    9. tbar[0]/btn[3].press()                   → Back (so the next warehouse
                                                  starts from the menu, NOT
                                                  the current report screen)

NOTE: the .vbs recording also writes `ctxtP_VARI = "JSINGH"` after the
variant load (lines 24-26, 42-44, 66-68). That was a recording artifact
— "JSINGH" is the recording author's personal variant, left over in the
P_VARI control from a previous run. We deliberately DO NOT replicate it
here: the Get Variant dialog already populates P_VARI with the warehouse
variant (TKAWH5/TKAWH8/etc.) when btn[8] in the dialog is pressed.

# Why a custom parser instead of `_extract_via_pc_export()`

LX25's "Inventory Status - List with Totals" output is a *summary by
storage type per warehouse*, NOT a row-per-record list like LT10 / LT22
/ LT24. The byte-level shape is:

    \\t05/10/2026\\t\\t\\tInventory Status - List with Totals\\r\\n
    \\r\\n
    Warehouse number\\t\\t\\tWH5\\tIndianapolis Plt 5 Stores\\r\\n
    \\r\\n
    \\tTyp\\tStorage type name\\r\\n
    \\tSummary\\t\\t\\t\\tAbsolute\\tProportio\\tWhN\\tTyp\\r\\n
    \\r\\n
    \\t110\\tTKA LGE ENG FIXED BIN\\r\\n
    \\tTotal number of bins\\t\\t\\t\\t  6,133\\t 100.00%\\tWH5\\t110\\r\\n
    \\tInv. executed during selection peri\\t\\t\\t\\t  4,302\\t  70.15%\\tWH5\\t110\\r\\n
    \\tInventory active\\t\\t\\t\\t    458\\t   7.47%\\tWH5\\t110\\r\\n
    \\tInventory planned\\t\\t\\t\\t      0\\t   0.00%\\tWH5\\t110\\r\\n
    \\tNo inventory executed\\t\\t\\t\\t  1,831\\t  29.85%\\tWH5\\t110\\r\\n
    \\t<next storage type>...

The agent's generic multi-format parser (`_extract_via_pc_export`'s
v1.7.6+ ladder) might pick the "Summary | Absolute | Proportio | WhN
| Typ" line as the column header and parse the metric rows as data,
but it would also incorrectly emit the "<storage type>  <name>" rows
as malformed data rows and lose the warehouse context entirely. We
write a small purpose-built parser instead: walk lines, track current
warehouse + current storage type, match by metric label.

Mirrors the `material_master_read.py` / `zmm60_lookup.py` pattern:
    - Lazy `_resolve_agent_globals()` so PyInstaller's --onefile
      bootloader doesn't trip on a circular import.
    - `_track_metric` proxy (decorator) so the agent's per-action
      metrics counter stays accurate.
    - Returns ok/error shape consistent with the rest of the agent so
      the FE can branch on `data.ok` uniformly.

Capability id: `lx25-inventory-completion` — added to AGENT_CAPABILITIES
in `agent.py`. The FE's Query Library entry gates the Run button on
this capability id so older agents render the entry disabled with a
"needs update" hint instead of failing the network call.
"""

from __future__ import annotations

import os
import re
import time
import uuid
from functools import wraps
from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel


# ---------------------------------------------------------------------------
#  Hardcoded warehouse + variant mapping
# ---------------------------------------------------------------------------
# Single source of truth for the 5-warehouse fan-out. The FE imports an
# equivalent constant in `inventory-management-tab.tsx` so both sides
# render the same default list when the user hits Run Query without
# overrides. The shape is `list[dict]` (not a dict) so order is
# deterministic — the per-warehouse cards in the FE render in the same
# order they're posted, which matches the user's mental model
# (WH5 → WH8 → JSM → JSF → PDC).
#
# Adding/removing a warehouse: append (or remove) one tuple here AND in
# the FE's `LX25_WAREHOUSES` constant. No other code changes needed.
LX25_WAREHOUSES: list[dict[str, str]] = [
    {"warehouse": "WH5", "variant": "TKAWH5"},
    {"warehouse": "WH8", "variant": "TKAWH8"},
    {"warehouse": "JSM", "variant": "TKAJSM"},
    {"warehouse": "JSF", "variant": "TKAJSF"},
    {"warehouse": "PDC", "variant": "TKAPDC"},
]


# ---------------------------------------------------------------------------
#  Lazy bridge into the parent `agent` module — see material_master_read.py
#  / zmm60_lookup.py for the full rationale (PyInstaller bootloader window).
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
        "_get_sap_session",
        "_log_sap_txn",
        "_wait_for_session",
        "_with_retries",
        "_PcPreCommitError",
        "_PcPostCommitError",
        "state",
    ):
        g[name] = getattr(a, name)
    _AGENT_GLOBALS_RESOLVED = True


router = APIRouter()


# ---------------------------------------------------------------------------
#  Request / Response Models
# ---------------------------------------------------------------------------
class Lx25WarehouseSpec(BaseModel):
    """One warehouse + its SAP variant. The variant is the SAP-side
    Saved Variant on the LX25 selection screen — it carries the
    warehouse number, storage-type filter, owner filter, and date-range
    filter so the FE doesn't have to know any of those details."""
    warehouse: str
    variant: str


class Lx25InventoryCompletionRequest(BaseModel):
    """Inventory Completion fan-out request. When `warehouses` is empty
    or unset the agent uses the hardcoded `LX25_WAREHOUSES` list so the
    FE can fire-and-forget the standard 5-warehouse query without
    serializing the variant mapping on every call. Pass an explicit
    list to override (e.g. a future "subset" UI affordance)."""
    warehouses: Optional[list[Lx25WarehouseSpec]] = None


# ---------------------------------------------------------------------------
#  LX25 text-export parser
# ---------------------------------------------------------------------------
# The five metric labels SAP renders under each storage-type heading.
# We match by PREFIX (case-insensitive, leading whitespace stripped) so
# minor wording drift between SAP variants doesn't break parsing —
# e.g. "Inv. executed during selection peri" (truncated to fit the
# fixed-width label column) and "Inventory executed during selection
# period" (untruncated variant) both resolve to the same metric.
_METRIC_LABELS: list[tuple[str, str]] = [
    ("total_bins",   "total number of bins"),
    ("executed",     "inv. executed"),  # "Inv. executed during selection peri"
    ("active",       "inventory active"),
    ("planned",      "inventory planned"),
    ("not_executed", "no inventory executed"),
]

# Storage-type marker line. SAP renders 3-character codes followed by
# the storage-type description. Codes can be PURELY NUMERIC (`110`,
# `826`, `010` — used by warehouses WH5/WH8/PDC) or PURELY ALPHA
# (`DDN`, `DDS`, `DDU`, `DUR`, `SCD` — used by JSM) or mixed alnum.
# Originally `\d{1,4}` (digits-only) — that broke JSM's TKAJSM variant
# because none of its storage type marker lines matched, causing every
# metric row to fall through to the `(unspecified)` placeholder branch
# and overwrite each other (so the warehouse total = LAST storage
# type's count instead of the sum). See `Fix-LX25-JSM-Undercount.md`.
# Uppercase + digits, 1-4 chars, matches the SAP storage-type field
# convention. The metric-row guard below (and the explicit `typ` /
# `summary` skip earlier) keeps banner / header lines from sneaking
# past as false-positive storage type markers.
_STORAGE_TYPE_RE = re.compile(r"^([A-Z0-9]{1,4})\s+(.+?)\s*$")

# Warehouse header line. The recording emits:
#   "Warehouse number\t\t\tWH5\tIndianapolis Plt 5 Stores"
# After tab-collapse this reads like a 5-cell row — code + name in
# the last two cells. The regex stays permissive (variable whitespace)
# so a localised SAP variant whose label is "Whse number" still hits.
_WAREHOUSE_HEADER_RE = re.compile(
    r"(?:warehouse|whse)\s+(?:number|no\.?|#)?\s*(\S+)\s+(.+?)\s*$",
    re.IGNORECASE,
)


def _parse_sap_int(s: str) -> Optional[int]:
    """Permissive integer parser. SAP renders counts with locale-aware
    thousand separators (`6,133` US, `6.133` DE) and trailing-minus
    convention for negatives. We strip both separators before parsing.
    Returns None when the cell is blank or unparseable."""
    if s is None:
        return None
    t = str(s).strip()
    if not t:
        return None
    neg = t.endswith("-")
    if neg:
        t = t[:-1].strip()
    # Drop any character that isn't a digit. This is intentionally
    # aggressive — `1,234`, `1.234`, `1 234`, `1\u00A0234` all collapse
    # to `1234`. Decimal handling is irrelevant: LX25 metric counts
    # are always integers (number of bins).
    digits = re.sub(r"[^\d]", "", t)
    if not digits:
        return None
    try:
        v = int(digits)
        return -v if neg else v
    except ValueError:
        return None


def _parse_lx25_text(text: str) -> dict:
    """Parse the LX25 unconverted text export.

    Tracks the active warehouse + active storage type as we walk lines
    top-down, and emits one record per (warehouse, storage_type)
    combination.

    Returns:
        {
            "warehouse_code": "WH5",          # last-seen warehouse header
            "warehouse_name": "Indianapolis Plt 5 Stores",
            "storage_types": [
                {
                    "storage_type": "110",
                    "storage_type_name": "TKA LGE ENG FIXED BIN",
                    "total_bins": 6133,
                    "executed": 4302,
                    "active": 458,
                    "planned": 0,
                    "not_executed": 1831,
                },
                ...
            ]
        }

    A single LX25 export covers ONE warehouse, so `warehouse_code` is a
    scalar (not a list). Multiple storage types per warehouse is
    typical — the user's WH5 export shipped only storage type 110 in
    the 462-byte sample because their variant filtered to that one
    type, but variants without a storage-type filter return many.
    """
    warehouse_code: Optional[str] = None
    warehouse_name: Optional[str] = None
    storage_types: list[dict[str, Any]] = []
    current_st: Optional[dict[str, Any]] = None

    for raw_line in text.splitlines():
        # Collapse runs of whitespace (including tabs) to single spaces
        # before matching. The unconverted export uses tab-delimited
        # cells, but downstream we want a single normalised string we
        # can prefix-match on. Keep a copy of the original tab-split
        # cells for the metric-row absolute count which lives in cell
        # position 5 ("Absolute") in the tab-cell array.
        if not raw_line.strip():
            continue
        cells = [c for c in raw_line.split("\t")]
        compact = re.sub(r"\s+", " ", raw_line).strip()
        compact_lower = compact.lower()

        # ── Warehouse header. Looks like "Warehouse number   WH5
        # Indianapolis Plt 5 Stores".
        if compact_lower.startswith(("warehouse number", "whse number")):
            m = _WAREHOUSE_HEADER_RE.match(compact)
            if m:
                warehouse_code = m.group(1).strip().upper()
                warehouse_name = m.group(2).strip()
            continue

        # ── Section break: skip the header rows ("Typ Storage type
        # name", "Summary  Absolute  Proportio  WhN  Typ"). They carry
        # no data and would falsely match the storage-type-marker
        # regex below.
        if compact_lower.startswith(("typ ", "summary ", "summary\t")):
            continue
        if compact_lower in ("typ", "summary"):
            continue

        # ── Metric row. The first non-empty cell carries the label
        # (e.g. "Total number of bins"). Match against our 5 known
        # prefixes — any line whose first cell starts with one of them
        # is a metric row for the current storage type.
        first_cell = ""
        for c in cells:
            if c.strip():
                first_cell = c.strip()
                break
        first_cell_lower = first_cell.lower()
        matched_metric: Optional[str] = None
        for key, prefix in _METRIC_LABELS:
            if first_cell_lower.startswith(prefix):
                matched_metric = key
                break
        if matched_metric:
            if current_st is None:
                # Defensive — a metric line before we saw a storage
                # type header. Possible if the SAP layout suppresses
                # the per-type header (rare). Synthesise a placeholder
                # storage type so the count isn't lost; the FE will
                # render it under "(unspecified)".
                current_st = {
                    "storage_type": "",
                    "storage_type_name": "(unspecified)",
                    "total_bins": None,
                    "executed": None,
                    "active": None,
                    "planned": None,
                    "not_executed": None,
                }
                storage_types.append(current_st)

            # The "Absolute" column is the 4th-or-later non-empty cell
            # in the metric row. We skim cells right-to-left looking
            # for the first integer-looking cell — the absolute count
            # is to the left of the proportion ("70.15%") and the WhN
            # / Typ trailing identifiers, so the int-only pattern is
            # unambiguous.
            absolute_value: Optional[int] = None
            for c in cells:
                cell = c.strip()
                if not cell:
                    continue
                # Skip the label cell (first non-empty cell we already
                # matched).
                if cell.lower().startswith(_METRIC_LABELS[
                    [k for k, _ in _METRIC_LABELS].index(matched_metric)
                ][1]):
                    continue
                # Skip percentage cells.
                if cell.endswith("%"):
                    continue
                # Skip warehouse + type identifier cells (alpha).
                if not any(ch.isdigit() for ch in cell):
                    continue
                # First integer-looking cell wins.
                v = _parse_sap_int(cell)
                if v is not None:
                    absolute_value = v
                    break

            current_st[matched_metric] = absolute_value
            continue

        # ── Storage type marker line. Looks like "110 TKA LGE ENG
        # FIXED BIN" once whitespace is collapsed. We match AFTER the
        # metric-row branch above so a metric row whose label happens
        # to start with digits doesn't get misclassified.
        m = _STORAGE_TYPE_RE.match(compact)
        if m and not first_cell_lower.startswith(
            tuple(p for _, p in _METRIC_LABELS)
        ):
            current_st = {
                "storage_type": m.group(1).strip(),
                "storage_type_name": m.group(2).strip(),
                "total_bins": None,
                "executed": None,
                "active": None,
                "planned": None,
                "not_executed": None,
            }
            storage_types.append(current_st)
            continue

        # Anything else — date headers, blank lines, banner labels —
        # is silently skipped. The 5 metric prefixes are the only
        # signal-bearing lines we care about.

    return {
        "warehouse_code": warehouse_code or "",
        "warehouse_name": warehouse_name or "",
        "storage_types": storage_types,
    }


# ---------------------------------------------------------------------------
#  Per-warehouse SAP GUI flow
# ---------------------------------------------------------------------------
def _exit_to_main(sess) -> None:
    """Send `/n` to leave whatever screen we're on. Idempotent and
    forgiving — failures swallowed because the next `/nLX25` will reset
    us anyway."""
    try:
        sess.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 5)
    except Exception:
        pass


def _press_back(sess) -> None:
    """Press F3 / Back. Used between warehouses so the next /nLX25
    starts from the menu rather than overlaying the previous report."""
    try:
        sess.findById("wnd[0]/tbar[0]/btn[3]").press()
        _wait_for_session(sess, 5)
    except Exception:
        # Try /n as a hard reset.
        _exit_to_main(sess)


def _apply_lx25_variant(sess, variant: str) -> None:
    """Open the Get Variant dialog, type the variant name, clear the
    user-name filter, and press Execute. After this returns SAP is
    back on the LX25 selection screen with the variant's criteria
    already loaded into the on-screen fields.

    Raises Exception (with a step-tagged message) on any control
    miss — the caller wraps it into a per-warehouse failure entry.
    """
    # Step 1 — open the variant lookup dialog.
    try:
        sess.findById("wnd[0]/tbar[1]/btn[17]").press()
    except Exception as e:
        raise Exception(f"Could not open Get Variant dialog (btn[17]): {e}")
    _wait_for_session(sess, 10)

    # Step 2 — fill the variant name + clear the user filter. Wrap each
    # field write so a missing control doesn't kill the whole flow with
    # a generic "object not found" — we want a clear "could not set
    # variant name" / "could not clear user filter" message.
    try:
        sess.findById("wnd[1]/usr/txtV-LOW").text = variant
    except Exception as e:
        raise Exception(f"Could not set variant name V-LOW={variant!r}: {e}")
    try:
        sess.findById("wnd[1]/usr/txtENAME-LOW").text = ""
    except Exception:
        # Some SAP variants don't expose the user filter (e.g. when
        # only personal variants exist). Best-effort — silently skip.
        pass

    # Step 3 — press Execute on the dialog (btn[8]). This loads the
    # variant's criteria into the LX25 selection screen.
    try:
        sess.findById("wnd[1]/tbar[0]/btn[8]").press()
    except Exception as e:
        raise Exception(f"Could not execute variant lookup (dialog btn[8]): {e}")
    _wait_for_session(sess, 10)


def _execute_lx25(sess) -> None:
    """Press F8 to run the LX25 report. After this returns SAP is on
    the report's list output screen, ready for the menu-driven
    export."""
    try:
        sess.findById("wnd[0]/tbar[1]/btn[8]").press()
    except Exception:
        try:
            sess.findById("wnd[0]").sendVKey(8)
        except Exception as e:
            raise Exception(f"Could not execute LX25 (F8 / tbar[1]/btn[8]): {e}")
    _wait_for_session(sess, 30)


def _export_lx25_to_text_file(sess) -> str:
    """Drive the menu-driven export dialog (List → Save → File →
    Unconverted) and return the absolute path of the text file SAP
    wrote to disk.

    This is a stripped-down version of the agent's
    `_extract_via_pc_export()` pipeline — we keep the canonical menu
    trigger + Unconverted radio selection + Save-As filename write +
    Save dismiss, but we DO NOT parse the file with the multi-format
    parser; we hand the path back to the caller so a custom parser can
    consume it. The caller is responsible for deleting the temp file
    after parse.
    """
    out_path = os.path.join(
        os.getenv("TEMP", os.path.expanduser("~")),
        f"omniframe_lx25_{uuid.uuid4().hex}.txt",
    )
    try:
        if os.path.exists(out_path):
            os.remove(out_path)
    except Exception:
        pass

    # Step 1 — trigger the export dialog. Menu entry first (universal),
    # `%pc` OK-code as fallback.
    triggered = False
    trigger_method: Optional[str] = None
    menu_err: Optional[str] = None
    try:
        sess.findById("wnd[0]/mbar/menu[0]/menu[1]/menu[2]").select()
        _wait_for_session(sess, 10)
        triggered = True
        trigger_method = "menu"
    except Exception as e:
        menu_err = repr(e)

    if not triggered:
        try:
            sess.findById("wnd[0]/tbar[0]/okcd").text = "%pc"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 10)
            triggered = True
            trigger_method = "%pc"
        except Exception as pc_err:
            raise Exception(
                f"Both export triggers failed — menu={menu_err}, "
                f"%pc={pc_err!r}"
            )

    # Step 2 — pick "Unconverted" radio. Try the canonical id from the
    # recording first, with three documented skin-variant fallbacks.
    chose_unconverted = False
    for rb_id in (
        "wnd[1]/usr/subSUBSCREEN_STEPLOOP:SAPLSPO5:0150/sub:SAPLSPO5:0150/radSPOPLI-SELFLAG[1,0]",
        "wnd[1]/usr/subSUBSCREEN_STEPLOOP:SAPLSPO5:0150/sub:SAPLSPO5:0150/radSPOPLI-SELFLAG[0,0]",
        "wnd[1]/usr/sub:SAPLSPO5:0150/radSPOPLI-SELFLAG[0,0]",
        "wnd[1]/usr/radSPOPLI-SELFLAG[0,0]",
    ):
        try:
            sess.findById(rb_id).select()
            chose_unconverted = True
            break
        except Exception:
            continue

    # Step 3 — confirm the radio choice (OK button on dialog tbar).
    try:
        sess.findById("wnd[1]/tbar[0]/btn[0]").press()
    except Exception:
        try:
            sess.findById("wnd[1]").sendVKey(0)
        except Exception:
            pass
    _wait_for_session(sess, 10)

    # Step 4 — set the Save-As path/filename. Try (path + filename)
    # first; fall back to filename-only when the dialog only renders
    # DY_FILENAME (matches the LX25 recording on the user's variant —
    # only ctxtDY_FILENAME is set; the dialog accepts the
    # pre-populated path).
    file_dir = os.path.dirname(out_path) + os.sep
    file_name = os.path.basename(out_path)
    set_path_ok = False
    for path_id, file_id in (
        ("wnd[1]/usr/ctxtDY_PATH",     "wnd[1]/usr/ctxtDY_FILENAME"),
        ("wnd[1]/usr/txtDY_PATH",      "wnd[1]/usr/txtDY_FILENAME"),
    ):
        try:
            sess.findById(path_id).text = file_dir
            sess.findById(file_id).text = file_name
            set_path_ok = True
            break
        except Exception:
            continue
    if not set_path_ok:
        for file_id in (
            "wnd[1]/usr/ctxtDY_FILENAME",
            "wnd[1]/usr/txtDY_FILENAME",
        ):
            try:
                sess.findById(file_id).text = file_name
                set_path_ok = True
                break
            except Exception:
                continue
    if not set_path_ok:
        raise Exception(
            f"Could not locate Save-As path/filename fields after "
            f"{trigger_method} trigger (unconverted_radio_selected="
            f"{chose_unconverted})"
        )

    # Step 5 — dismiss the Save-As dialog. Recording uses Enter; we try
    # Enter / btn[11] / sendVKey(11) for cross-variant compatibility.
    save_method: Optional[str] = None
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
        raise Exception("Could not dismiss Save-As dialog")
    _wait_for_session(sess, 15)

    # Step 6 — handle the optional "file already exists, replace?"
    # confirmation popup. Best-effort.
    try:
        sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
        _wait_for_session(sess, 5)
    except Exception:
        pass

    # Step 7 — wait for the file to materialise on disk.
    deadline = time.time() + 10
    while time.time() < deadline:
        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            break
        time.sleep(0.5)
    if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        raise Exception(
            f"Save-As dialog closed (trigger={trigger_method}, "
            f"save={save_method}) but no file at {out_path}"
        )

    return out_path


def _run_lx25_for_warehouse(sess, warehouse: str, variant: str) -> dict:
    """Drive the full LX25 → variant → execute → export flow for ONE
    warehouse. Returns either:

        { "ok": True, "warehouse": ..., "variant": ..., parsed metrics... }

    or

        { "ok": False, "warehouse": ..., "variant": ..., "error": ..., "step": ... }

    Never raises — the caller's per-warehouse loop assumes failures
    are surfaced through the dict so a single bad variant doesn't
    abort the rest of the fan-out."""
    started = time.time()

    def _failure(step: str, err: str) -> dict:
        return {
            "ok": False,
            "warehouse": warehouse,
            "variant": variant,
            "error": err,
            "step": step,
            "elapsed_sec": round(time.time() - started, 2),
        }

    # Step 1 — open LX25.
    try:
        sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLX25"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 15)
    except Exception as e:
        return _failure("navigate", f"Could not open LX25: {e}")

    # Step 2 — apply the warehouse variant.
    try:
        _apply_lx25_variant(sess, variant)
    except Exception as e:
        # Read the SAP status bar — when the variant doesn't exist SAP
        # writes "Variant TKAWHX does not exist" to the sbar. Surfacing
        # it in the error makes the FE failure card more actionable.
        try:
            sbar, _ = _classify_sbar(sess)
            sbar_msg = (sbar or "").strip()
        except Exception:
            sbar_msg = ""
        msg = f"{e}"
        if sbar_msg and sbar_msg not in msg:
            msg = f"{msg} | SAP: {sbar_msg}"
        return _failure("apply_variant", msg)

    # Step 3 — execute the report.
    try:
        _execute_lx25(sess)
    except Exception as e:
        return _failure("execute", str(e))

    # Step 3b — short-circuit on a status-bar "no data" message. LX25
    # surfaces "No bin found" on a warehouse with no inventory data;
    # we don't want that to look like a parse failure.
    try:
        sbar, msg_type = _classify_sbar(sess)
        sbar_lower = (sbar or "").lower()
        if msg_type in ("E", "A") or any(
            k in sbar_lower for k in ("no data", "no records", "no bin", "no objects")
        ):
            return {
                "ok": True,
                "warehouse": warehouse,
                "variant": variant,
                "warehouse_code": warehouse,
                "warehouse_name": "",
                "storage_types": [],
                "total_bins": 0,
                "executed": 0,
                "active": 0,
                "planned": 0,
                "not_executed": 0,
                "completion_pct": None,
                "empty": True,
                "sap_message": sbar or "",
                "elapsed_sec": round(time.time() - started, 2),
            }
    except Exception:
        pass

    # Step 4 — export the list to a text file on disk.
    try:
        out_path = _export_lx25_to_text_file(sess)
    except Exception as e:
        return _failure("export", str(e))

    # Step 5 — read + parse + clean up.
    try:
        with open(out_path, "r", encoding="cp1252", errors="replace") as f:
            text = f.read()
    except Exception as e:
        try:
            os.remove(out_path)
        except Exception:
            pass
        return _failure("read_file", f"Could not read export file: {e}")
    try:
        os.remove(out_path)
    except Exception:
        pass

    parsed = _parse_lx25_text(text)

    # Aggregate the per-storage-type rows into per-warehouse totals.
    total_bins = 0
    executed = 0
    active = 0
    planned = 0
    not_executed = 0
    storage_types_clean: list[dict[str, Any]] = []
    for st in parsed.get("storage_types", []):
        # Defensive: some warehouses' variants ship a storage type with
        # zero bins (e.g. inactive types). Skip those rows so the FE
        # doesn't render an empty card with denominator=0.
        tb = st.get("total_bins") or 0
        ex = st.get("executed") or 0
        ac = st.get("active") or 0
        pl = st.get("planned") or 0
        ne = st.get("not_executed") or 0
        if tb == 0 and ex == 0 and ac == 0 and pl == 0 and ne == 0:
            # Truly empty row — skip.
            continue
        st_clean = {
            "storage_type": st.get("storage_type", ""),
            "storage_type_name": st.get("storage_type_name", ""),
            "total_bins": tb,
            "executed": ex,
            "active": ac,
            "planned": pl,
            "not_executed": ne,
            "completion_pct": (
                round((ex / tb) * 100.0, 2) if tb > 0 else None
            ),
        }
        storage_types_clean.append(st_clean)
        total_bins += tb
        executed += ex
        active += ac
        planned += pl
        not_executed += ne

    completion_pct = (
        round((executed / total_bins) * 100.0, 2) if total_bins > 0 else None
    )

    return {
        "ok": True,
        "warehouse": warehouse,
        "variant": variant,
        # Echo what we parsed; the FE prefers the request `warehouse`
        # but `warehouse_code` is useful for cross-checking when a
        # variant's warehouse filter mismatches the request (e.g. user
        # picks the wrong variant for a warehouse).
        "warehouse_code": parsed.get("warehouse_code") or warehouse,
        "warehouse_name": parsed.get("warehouse_name") or "",
        "storage_types": storage_types_clean,
        "total_bins": total_bins,
        "executed": executed,
        "active": active,
        "planned": planned,
        "not_executed": not_executed,
        "completion_pct": completion_pct,
        "empty": total_bins == 0,
        "elapsed_sec": round(time.time() - started, 2),
    }


# ---------------------------------------------------------------------------
#  /sap/lx25/inventory-completion — fan-out endpoint
# ---------------------------------------------------------------------------
@router.post("/sap/lx25/inventory-completion")
@_track_metric("lx25_inventory_completion")
def lx25_inventory_completion(req: Lx25InventoryCompletionRequest) -> dict:
    """Run LX25 across N warehouses (default 5) and return the
    aggregated completion summary.

    Sequential by design — SAP COM is single-threaded per session, so
    we can't fan out in parallel without multiple sessions, and the
    extra session juggling isn't worth the latency win for an
    interactive 5-warehouse query (~30-60s end-to-end).

    Per-warehouse failures are captured in the response and DO NOT
    abort the rest of the fan-out — the FE can render the failed
    warehouse card with its error message while the successful ones
    still surface their counts. The aggregate `totals` block sums only
    the successful warehouses (`status == "ok"`) so the cross-warehouse
    completion % isn't skewed by the bad ones.

    Response shape:
        {
            "ok": true,
            "warehouses": [
                {
                    "ok": true,
                    "warehouse": "WH5",
                    "variant": "TKAWH5",
                    "warehouse_code": "WH5",
                    "warehouse_name": "Indianapolis Plt 5 Stores",
                    "storage_types": [...],
                    "total_bins": 6133,
                    "executed": 4302,
                    "active": 458,
                    "planned": 0,
                    "not_executed": 1831,
                    "completion_pct": 70.15,
                    "elapsed_sec": 8.3
                },
                {  // failed warehouse
                    "ok": false,
                    "warehouse": "JSF",
                    "variant": "TKAJSF",
                    "error": "Variant TKAJSF does not exist",
                    "step": "apply_variant",
                    "elapsed_sec": 2.1
                },
                ...
            ],
            "totals": {
                "warehouses_succeeded": 4,
                "warehouses_failed": 1,
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

    On total failure (SAP not connected, all 5 warehouses failed,
    etc.) the response still returns `ok: true` with `totals.executed`
    = 0 and the per-warehouse failure cards — the FE chooses how to
    surface that. We only return `ok: false` when the agent itself
    cannot acquire a SAP session, since that's a "nothing ran"
    condition the FE handles differently (toast + error card)
    from "ran but every variant was bad".
    """
    _resolve_agent_globals()

    # Resolve the warehouse list. Empty / missing → fall back to the
    # hardcoded constant so the FE doesn't have to serialise the
    # variant mapping on every call.
    if req.warehouses:
        warehouses_in: list[dict[str, str]] = [
            {"warehouse": w.warehouse.strip(), "variant": w.variant.strip()}
            for w in req.warehouses
            if w.warehouse and w.variant
        ]
    else:
        warehouses_in = [dict(w) for w in LX25_WAREHOUSES]

    if not warehouses_in:
        return {
            "ok": False,
            "error": "No warehouses to query",
            "step": "validate",
        }

    if not state.sap_connected:
        return {
            "ok": False,
            "error": "SAP not connected — open SAP GUI and reconnect the agent",
            "step": "connect",
        }

    try:
        sess, _ = _get_sap_session()
    except Exception as e:
        return {
            "ok": False,
            "error": f"Could not acquire SAP session: {e}",
            "step": "connect",
        }

    started = time.time()
    started_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started))
    print(
        f"\n[lx25-completion] Starting {len(warehouses_in)}-warehouse fan-out "
        f"({', '.join(w['warehouse'] for w in warehouses_in)})"
    )

    results: list[dict] = []
    for idx, w in enumerate(warehouses_in):
        warehouse = w["warehouse"]
        variant = w["variant"]
        print(
            f"[lx25-completion] [{idx + 1}/{len(warehouses_in)}] "
            f"{warehouse} (variant {variant})"
        )

        # Reset to a clean state between warehouses. The first iteration
        # also benefits — if the agent was left mid-flow by a prior
        # call, /n recovers cleanly.
        try:
            _exit_to_main(sess)
        except Exception:
            pass

        result = _run_lx25_for_warehouse(sess, warehouse, variant)
        results.append(result)
        _log_sap_txn(
            warehouse,
            "LX25",
            "lx25_inventory_completion",
            "success" if result.get("ok") else "error",
            (
                f"variant:{variant} bins:{result.get('total_bins', 0)} "
                f"counted:{result.get('executed', 0)} "
                f"completion:{result.get('completion_pct')}"
                if result.get("ok")
                else f"variant:{variant} error:{result.get('error')} step:{result.get('step')}"
            ),
        )

        # Best-effort: leave LX25 cleanly so the next iteration's /nLX25
        # opens the selection screen rather than overlaying the report.
        try:
            _press_back(sess)
        except Exception:
            pass

    # Final cleanup — leave the SAP session on the home screen so the
    # next handler doesn't have to clean up.
    try:
        _exit_to_main(sess)
    except Exception:
        pass

    # Aggregate totals across the SUCCESSFUL warehouses only. Failed
    # warehouses contribute their "ok": false entry to the warehouses
    # array but are excluded from the cross-warehouse completion %.
    succeeded = [r for r in results if r.get("ok")]
    failed = [r for r in results if not r.get("ok")]
    total_bins = sum(int(r.get("total_bins") or 0) for r in succeeded)
    executed = sum(int(r.get("executed") or 0) for r in succeeded)
    active = sum(int(r.get("active") or 0) for r in succeeded)
    planned = sum(int(r.get("planned") or 0) for r in succeeded)
    not_executed = sum(int(r.get("not_executed") or 0) for r in succeeded)
    completion_pct = (
        round((executed / total_bins) * 100.0, 2) if total_bins > 0 else None
    )

    elapsed = time.time() - started
    print(
        f"[lx25-completion] Done in {elapsed:.1f}s — "
        f"{len(succeeded)}/{len(results)} warehouses ok, "
        f"{total_bins:,} total bins, {executed:,} counted "
        f"({completion_pct}% completion)"
    )

    return {
        "ok": True,
        "warehouses": results,
        "totals": {
            "warehouses_succeeded": len(succeeded),
            "warehouses_failed": len(failed),
            "total_bins": total_bins,
            "executed": executed,
            "active": active,
            "planned": planned,
            "not_executed": not_executed,
            "completion_pct": completion_pct,
        },
        "meta": {
            "transaction": "LX25",
            "started_at": started_iso,
            "elapsed_sec": round(elapsed, 2),
            "warehouse_count": len(warehouses_in),
        },
    }

# Created and developed by Jai Singh
