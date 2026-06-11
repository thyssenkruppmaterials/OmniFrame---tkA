# Created and developed by Jai Singh
"""
LL01 Warehouse Activity Monitor — cross-plant stuck/critical conditions (2026-05-22).

Backs the "Warehouse Activity Monitor" entry in SAP Testing → Inventory
Management → Query Library → WAREHOUSE category. Runs LL01 per plant,
exports each of the 7 category lists via PC export, parses tab-delimited
output, persists count snapshots to Supabase, and returns the full row
payload in the HTTP response.

Reference recordings (MacWindowsBridge/LL01_Worker_Full/):
    - LL01_Worker_Full.vbs — single-plant navigator + per-category export loop
    - LL01_Master_Full.vbs — 5-session parallel fan-out (NOT replicated in MVP)

Capability id: `ll01-warehouse-activity-monitor`
"""

from __future__ import annotations

import os
import re
import time
import uuid
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Optional

import requests
from fastapi import APIRouter
from pydantic import BaseModel


# ---------------------------------------------------------------------------
#  Constants
# ---------------------------------------------------------------------------
LL01_PLANTS: list[str] = ["JSF", "JSM", "PDC", "WH5", "WH8"]

LL01_CATEGORIES: list[dict[str, Any]] = [
    {
        "key": "open_to",
        "label": "Open Transfer Orders",
        "row": 3,
        "thresholds": {"green": 100, "amber": 500},
        # `created_on` + `created_by` were added 2026-05-27 to drive the
        # frontend Aging tab — the manual `LL01 Stack.xlsx` confirmed SAP's
        # LL01 export carries these columns. Smart-header parser drops
        # them silently if a future SAP skin omits either, so this stays
        # safe for older builds.
        "columns": [
            ("TO Number", "to_number"),
            ("Item", "item"),
            ("Co", "company"),
            ("WhN", "warehouse"),
            ("MTy", "movement_type"),
            ("Material", "material"),
            ("SrceTgtQty", "source_target_qty"),
            ("Sourc", "source_storage_type"),
            ("Source Bin", "source_bin"),
            ("Dest.st.t", "dest_storage_type"),
            ("Dest. Bin", "dest_bin"),
            ("Plnt", "plant"),
            ("Created On", "created_on"),
            ("Created by", "created_by"),
        ],
    },
    {
        "key": "open_tr",
        "label": "Open Transfer Requirements",
        "row": 4,
        "thresholds": {"green": 500, "amber": 2000},
        "columns": [
            ("TR Number", "tr_number"),
            ("Item", "item"),
            ("WhN", "warehouse"),
            ("MTy", "movement_type"),
            ("Material", "material"),
            ("TR Quantity", "tr_quantity"),
            ("Tpe", "source_type"),
            ("Plnt", "plant"),
            ("SLoc", "storage_location"),
            ("Created On", "created_on"),
        ],
    },
    {
        "key": "open_posting",
        "label": "Open Posting Changes",
        "row": 5,
        "thresholds": {"green": 50, "amber": 200},
        "columns": [
            ("Post.Ch.No", "posting_change_no"),
            ("WhN", "warehouse"),
            ("MvT", "movement_type"),
            ("Material", "material"),
            ("Plnt", "plant"),
            ("SLoc", "storage_location"),
            ("User", "user"),
            ("Post.change qty", "posting_change_qty"),
            ("Created On", "created_on"),
        ],
    },
    {
        "key": "critical_delivery",
        "label": "Critical Deliveries",
        "row": 6,
        "thresholds": {"green": 25, "amber": 100},
        "columns": [
            ("Warehouse", "warehouse"),
            ("Delivery", "delivery"),
            ("ShPt", "shipping_point"),
            ("DlvTy", "delivery_type"),
            ("Ship-to", "ship_to"),
            ("No.Pk", "number_of_packages"),
            ("Loadg Date", "loading_date"),
            ("Created On", "created_on"),
            ("Created By", "created_by"),
            ("DPrio", "delivery_priority"),
            ("Deliv.Date", "delivery_date"),
            ("External Delivery ID", "external_delivery_id"),
        ],
    },
    {
        "key": "negative_stock",
        "label": "Negative Stock",
        "row": 7,
        "thresholds": {"green": 25, "amber": 100},
        "columns": [
            ("Material", "material"),
            ("TR Number", "tr_number"),
            ("Plnt", "plant"),
            ("WhN", "warehouse"),
            ("Typ", "storage_type"),
            ("StorageBin", "storage_bin"),
            ("Total Stock", "total_stock"),
            ("BUn", "base_unit"),
            ("Last mvmnt", "last_movement_date"),
            ("Time", "last_movement_time"),
        ],
    },
    {
        "key": "interim_stock",
        "label": "Interim Stock w/o Movement",
        "row": 8,
        "thresholds": {"green": 100, "amber": 500},
        "columns": [
            ("Warehouse", "warehouse"),
            ("Material", "material"),
            ("Plnt", "plant"),
            ("Typ", "storage_type"),
            ("StorageBin", "storage_bin"),
            ("Total Stock", "total_stock"),
            ("BUn", "base_unit"),
            ("Last mvmnt", "last_movement_date"),
            ("Time", "last_movement_time"),
            ("Aging Days", "aging_days"),
        ],
    },
    {
        "key": "critical_stock_production",
        "label": "Critical Stock in Production",
        "row": 9,
        "thresholds": {"green": 25, "amber": 100},
        "columns": [
            ("Material", "material"),
            ("Plnt", "plant"),
            ("Typ", "storage_type"),
            ("StorageBin", "storage_bin"),
            ("Total Stock", "total_stock"),
            ("BUn", "base_unit"),
            ("Last mvmnt", "last_movement_date"),
            ("Time", "last_movement_time"),
            ("Available stock", "available_stock"),
            ("GR Date", "goods_receipt_date"),
        ],
    },
]

_DATE_KEYS = frozenset(
    {
        "loading_date",
        "created_on",
        "delivery_date",
        "last_movement_date",
        "goods_receipt_date",
    }
)

_STATUS_HEADER_RE = re.compile(r"^S(_\d+)?$", re.IGNORECASE)
_PLNT_DUP_RE = re.compile(r"^Plnt(_\d+)?$", re.IGNORECASE)

_progress: dict[str, Any] = {
    "running": False,
    "plant_index": 0,
    "plant_total": 0,
    "category_index": 0,
    "category_total": len(LL01_CATEGORIES),
    "label": "",
    "elapsed_sec": 0.0,
    "started_at": None,
}


def _agent():
    import agent  # type: ignore[import-not-found]
    return agent


def _track_metric(action: str):
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
    global _AGENT_GLOBALS_RESOLVED
    if _AGENT_GLOBALS_RESOLVED:
        return
    a = _agent()
    g = globals()
    for name in (
        "_classify_sbar",
        "_extract_via_pc_export",
        "_get_sap_session",
        "_log_sap_txn",
        "_wait_for_session",
        "_with_retries",
        "_agent_self_id",
        "_PcPreCommitError",
        "_PcPostCommitError",
        "state",
    ):
        g[name] = getattr(a, name)
    _AGENT_GLOBALS_RESOLVED = True


router = APIRouter()


class LL01WarehouseActivityRequest(BaseModel):
    plants: Optional[list[str]] = None
    categories: Optional[list[str]] = None
    organization_id: str
    snapshot_run_id: Optional[str] = None


# ---------------------------------------------------------------------------
#  Parser
# ---------------------------------------------------------------------------
def _normalize_header(raw: str) -> str:
    h = (raw or "").strip()
    if _STATUS_HEADER_RE.match(h):
        return "status"
    return h


def _header_score(headers: list[str], expected: list[str]) -> int:
    norm = [_normalize_header(h).lower() for h in headers if h.strip()]
    score = 0
    for exp in expected:
        el = exp.lower()
        if any(n == el or n.startswith(el) or el.startswith(n) for n in norm):
            score += 1
    return score


def _find_header_index(lines: list[str], expected_headers: list[str]) -> int:
    """Smart-header detection — skip banner rows, pick the line that best
    matches the category's known SAP column titles."""
    best_idx = -1
    best_score = 0
    for idx, line in enumerate(lines[:40]):
        if not line.strip():
            continue
        cells = line.split("\t")
        if len(cells) < 2:
            continue
        score = _header_score(cells, expected_headers)
        if score > best_score:
            best_score = score
            best_idx = idx
        if score >= max(3, len(expected_headers) // 2):
            return idx
    if best_idx >= 0 and best_score >= 2:
        return best_idx
    return -1


def _parse_sap_date(value: str) -> str:
    v = (value or "").strip()
    if not v:
        return v
    for fmt in ("%m/%d/%Y", "%d.%m.%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            continue
    return v


def _build_column_map(headers: list[str], column_spec: list[tuple[str, str]]) -> list[tuple[int, str]]:
    """Map column index → json key. Drops duplicate Plnt/status columns."""
    mapping: list[tuple[int, str]] = []
    seen_keys: set[str] = set()
    for idx, raw in enumerate(headers):
        norm = _normalize_header(raw)
        if not norm:
            continue
        if norm.lower() == "status" and "status" in seen_keys:
            continue
        if _PLNT_DUP_RE.match(norm) and "plant" in seen_keys:
            continue
        matched_key: Optional[str] = None
        for sap_title, json_key in column_spec:
            if norm.lower() == sap_title.lower() or norm.lower().startswith(sap_title.lower()):
                matched_key = json_key
                break
        if matched_key is None:
            continue
        if matched_key in seen_keys:
            continue
        seen_keys.add(matched_key)
        mapping.append((idx, matched_key))
    return mapping


def parse_ll01_category_export(text: str, category_key: str) -> list[dict[str, Any]]:
    """Parse tab-delimited LL01 list export for one category."""
    spec = next((c for c in LL01_CATEGORIES if c["key"] == category_key), None)
    if spec is None:
        raise ValueError(f"Unknown category: {category_key}")

    expected = [sap for sap, _ in spec["columns"]]
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    header_idx = _find_header_index(lines, expected)
    if header_idx < 0:
        return []

    headers = lines[header_idx].split("\t")
    col_map = _build_column_map(headers, spec["columns"])
    if not col_map:
        return []

    rows: list[dict[str, Any]] = []
    for line in lines[header_idx + 1 :]:
        if not line.strip():
            continue
        cells = line.split("\t")
        if all(not c.strip() for c in cells):
            continue
        row: dict[str, Any] = {}
        for col_idx, json_key in col_map:
            val = cells[col_idx].strip() if col_idx < len(cells) else ""
            if json_key in _DATE_KEYS and val:
                val = _parse_sap_date(val)
            row[json_key] = val
        if any(str(v).strip() for v in row.values()):
            rows.append(row)
    return rows


def _rows_from_pc_export(result: dict, category_key: str) -> list[dict[str, Any]]:
    """Convert `_extract_via_pc_export` output to LL01 schema rows."""
    columns = result.get("columns") or []
    raw_rows = result.get("rows") or []
    spec = next(c for c in LL01_CATEGORIES if c["key"] == category_key)

    id_to_key: dict[str, str] = {}
    seen: set[str] = set()
    for col in columns:
        title = _normalize_header(col.get("title") or "")
        if not title:
            continue
        if title.lower() == "status" and "status" in seen:
            continue
        if _PLNT_DUP_RE.match(title) and "plant" in seen:
            continue
        for sap_title, json_key in spec["columns"]:
            if title.lower() == sap_title.lower() or title.lower().startswith(sap_title.lower()):
                if json_key not in seen:
                    id_to_key[col["id"]] = json_key
                    seen.add(json_key)
                break

    mapped: list[dict[str, Any]] = []
    for raw in raw_rows:
        row: dict[str, Any] = {}
        for col_id, json_key in id_to_key.items():
            val = str(raw.get(col_id, "") or "").strip()
            if json_key in _DATE_KEYS and val:
                val = _parse_sap_date(val)
            row[json_key] = val
        if any(str(v).strip() for v in row.values()):
            mapped.append(row)
    return mapped


# ---------------------------------------------------------------------------
#  SAP GUI helpers
# ---------------------------------------------------------------------------
def _plant_for_sap(plant: str) -> str:
    p = plant.strip()
    if p.upper() == "JSF":
        return "jsf"
    return p.upper()


def _return_to_main_list(sess, timeout_sec: float = 15.0) -> bool:
    started = time.time()
    while time.time() - started < timeout_sec:
        try:
            sess.findById("wnd[0]/usr/lbl[18,3]")
            return True
        except Exception:
            pass
        try:
            sess.findById("wnd[0]/tbar[0]/btn[3]").press()
            _wait_for_session(sess, 3)
        except Exception:
            pass
        time.sleep(0.5)
    return False


def _wait_for_export_ready(sess, timeout_sec: float = 40.0) -> bool:
    started = time.time()
    while time.time() - started < timeout_sec:
        try:
            _wait_for_session(sess, 3)
            sess.findById("wnd[0]/mbar/menu[0]/menu[2]/menu[2]")
            return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def _navigate_ll01_plant(sess, plant: str) -> None:
    sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLL01"
    sess.findById("wnd[0]").sendVKey(0)
    _wait_for_session(sess, 30)
    try:
        sess.findById("wnd[0]").maximize()
        sess.findById("wnd[0]").setFocus()
    except Exception:
        pass
    time.sleep(0.3)
    sess.findById("wnd[0]/usr/ctxtPLGNUM").text = _plant_for_sap(plant)
    sess.findById("wnd[0]").sendVKey(8)
    _wait_for_session(sess, 30)
    sess.findById("wnd[0]").sendVKey(8)
    _wait_for_session(sess, 30)


def _open_category_list(sess, row_num: int) -> None:
    """Drill into one of the 7 LL01 activity categories.

    Mirrors `LL01_Worker_Full.vbs::ProcessOne` (lines 173-198) exactly:
      ReturnToMainList → maximize/setFocus → label[18,row].SetFocus →
      caretPosition=13 → sendVKey 2 (double-click) → WaitForExportReady.
    """
    if not _return_to_main_list(sess):
        raise Exception("Could not return to LL01 main list")

    try:
        sess.findById("wnd[0]").maximize()
        sess.findById("wnd[0]").setFocus()
    except Exception:
        pass
    time.sleep(0.3)

    label_id = f"wnd[0]/usr/lbl[18,{row_num}]"
    sess.findById(label_id).setFocus()
    sess.findById(label_id).caretPosition = 13
    time.sleep(0.25)
    sess.findById("wnd[0]").sendVKey(2)

    if not _wait_for_export_ready(sess):
        raise Exception(f"Export menu not ready after double-click row {row_num}")


def _export_ll01_category_to_text_file(sess) -> str:
    """Drive the LL01-specific export dialog and return the absolute path
    of the text file SAP wrote to disk.

    Why a custom export instead of `_extract_via_pc_export`: LL01's
    menubar puts the export entry at `menu[0]/menu[2]/menu[2]` (List →
    Export → File…), whereas the shared `_extract_via_pc_export` helper
    targets `menu[0]/menu[1]/menu[2]` (List → Save → File…) which is
    LX25/LT10's path. On LL01's list screen, menu[1] is a different
    entry and the shared helper's trigger silently misses → no dialog
    → no file → no rows. Mirrors `LL01_Worker_Full.vbs::ExportCurrent`
    (lines 200-237) verbatim.

    The caller is responsible for deleting the temp file after parse.
    """
    out_path = os.path.join(
        os.getenv("TEMP", os.path.expanduser("~")),
        f"omniframe_ll01_{uuid.uuid4().hex}.txt",
    )
    try:
        if os.path.exists(out_path):
            os.remove(out_path)
    except Exception:
        pass

    # Step 0 — pre-export label focus. The VBS recording does this
    # before the menu select; without it some SAP skins drop the
    # subsequent dialog. Best-effort.
    try:
        sess.findById("wnd[0]/usr/lbl[40,14]").setFocus()
    except Exception:
        pass

    # Step 1 — trigger the export dialog via List → Export → File…
    # (LL01-specific menu path). Fall back to %pc OK-code if the menu
    # entry isn't present on a custom skin.
    triggered = False
    trigger_method: Optional[str] = None
    menu_err: Optional[str] = None
    try:
        sess.findById("wnd[0]/mbar/menu[0]/menu[2]/menu[2]").select()
        _wait_for_session(sess, 10)
        triggered = True
        trigger_method = "menu[0]/menu[2]/menu[2]"
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
                f"LL01 export triggers failed — menu={menu_err}, "
                f"%pc={pc_err!r}"
            )

    # Step 2a — explicitly select the "Unconverted" radio. The VBS recording
    # works without this because SAP REMEMBERS the user's last format choice
    # per interactive session — but when the agent attaches to a SAP session
    # that hasn't recently exported (or has had its format reset), the
    # dialog defaults to "Spreadsheet" → SAP saves a BINARY XLSX with our
    # .txt extension → parser reads bytes-as-cp1252 garbage → header
    # detection fails → every category returns [] → snapshots all
    # count=0 (observed 2026-05-23: full sweep ran clean, 35 snapshot rows
    # inserted, all counts 0). Mirrors the LX25 module's
    # `_export_lx25_to_text_file` radio-selection ladder verbatim — same
    # 4-id fallback chain to absorb skin variants.
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

    # Step 2b — confirm the format dialog (OK).
    try:
        sess.findById("wnd[1]/tbar[0]/btn[0]").press()
    except Exception:
        try:
            sess.findById("wnd[1]").sendVKey(0)
        except Exception:
            pass
    _wait_for_session(sess, 10)

    # Step 3 — set Save-As path/filename. Try (path + filename) first;
    # fall back to filename-only when the dialog only renders DY_FILENAME.
    file_dir = os.path.dirname(out_path) + os.sep
    file_name = os.path.basename(out_path)
    set_path_ok = False
    for path_id, file_id in (
        ("wnd[1]/usr/ctxtDY_PATH", "wnd[1]/usr/ctxtDY_FILENAME"),
        ("wnd[1]/usr/txtDY_PATH",  "wnd[1]/usr/txtDY_FILENAME"),
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
            f"{trigger_method} trigger"
        )

    # Step 4 — press Generate (btn[11] in the VBS — the green "Save"
    # icon, NOT btn[0] which is the dialog's OK). VBS:217.
    save_method: Optional[str] = None
    for method_name, method_fn in (
        ("btn[11]",     lambda: sess.findById("wnd[1]/tbar[0]/btn[11]").press()),
        ("sendVKey 11", lambda: sess.findById("wnd[1]").sendVKey(11)),
        ("Enter",       lambda: sess.findById("wnd[1]").sendVKey(0)),
    ):
        try:
            method_fn()
            save_method = method_name
            break
        except Exception:
            continue
    if save_method is None:
        raise Exception("Could not press Save on Save-As dialog")
    time.sleep(1.0)

    # Step 5 — multi-popup dismiss loop. The VBS handles up to two
    # follow-up popups: "file exists, replace?" → btn[11], and a
    # confirmation → btn[0]. Best-effort.
    for _ in range(2):
        if sess.Children.Count <= 1:
            break
        try:
            sess.findById("wnd[1]/tbar[0]/btn[11]").press()
            time.sleep(0.7)
            continue
        except Exception:
            pass
        try:
            sess.findById("wnd[1]/tbar[0]/btn[0]").press()
            time.sleep(0.7)
        except Exception:
            break

    _wait_for_session(sess, 15)

    # Step 6 — wait for the file to materialise on disk.
    deadline = time.time() + 10
    while time.time() < deadline:
        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            break
        time.sleep(0.5)
    if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        raise Exception(
            f"Save-As dialog closed (trigger={trigger_method}, "
            f"save={save_method}, unconverted={chose_unconverted}) "
            f"but no file at {out_path}"
        )

    return out_path


def _run_category_for_plant(
    sess,
    plant: str,
    category: dict[str, Any],
) -> tuple[list[dict[str, Any]], Optional[str]]:
    """Drill into one LL01 category, export to text, parse to row dicts.

    Returns (rows, error_message_or_None). Never raises — the caller
    aggregates errors per (plant × category) without aborting the rest
    of the run.
    """
    cat_key = category["key"]
    out_path: Optional[str] = None
    try:
        _open_category_list(sess, category["row"])
        out_path = _export_ll01_category_to_text_file(sess)
        file_size = os.path.getsize(out_path)
        with open(out_path, "r", encoding="cp1252", errors="replace") as f:
            text = f.read()
        rows = parse_ll01_category_export(text, cat_key)
        # Diagnostic: surfaces the file shape when no rows parse, so a
        # future zero-count run is debuggable without re-running. First
        # 120 chars typically include the banner + header line, enough
        # to spot binary garbage (Spreadsheet format) vs. tab-delim.
        if not rows:
            preview = text[:120].replace("\n", "\\n").replace("\t", "\\t")
            print(
                f"[ll01]   {plant} / {cat_key}: parser returned 0 rows "
                f"(file_size={file_size}B; preview={preview!r})"
            )
        return rows, None
    except Exception as e:
        return [], str(e)
    finally:
        if out_path:
            try:
                os.remove(out_path)
            except Exception:
                pass


def _update_progress(
    *,
    plant_index: int,
    plant_total: int,
    category_index: int,
    label: str,
    started: float,
) -> None:
    _progress.update(
        {
            "running": True,
            "plant_index": plant_index,
            "plant_total": plant_total,
            "category_index": category_index,
            "category_total": len(LL01_CATEGORIES),
            "label": label,
            "elapsed_sec": round(time.time() - started, 1),
            "started_at": _progress.get("started_at"),
        }
    )


def _reset_progress() -> None:
    _progress.update(
        {
            "running": False,
            "plant_index": 0,
            "plant_total": 0,
            "category_index": 0,
            "category_total": len(LL01_CATEGORIES),
            "label": "",
            "elapsed_sec": 0.0,
            "started_at": None,
        }
    )


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _supabase_post(path: str, payload: list[dict]) -> int:
    if not state.supabase_token or not state.supabase_url:
        print("[ll01] WARN no Supabase token — skipping snapshot insert")
        return 0
    resp = requests.post(
        f"{state.supabase_url}/rest/v1/{path}",
        json=payload,
        headers={
            "apikey": state.supabase_key,
            "Authorization": f"Bearer {state.supabase_token}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal,resolution=merge-duplicates",
        },
        timeout=60,
    )
    if resp.status_code not in (200, 201, 204):
        raise Exception(f"Supabase insert failed ({resp.status_code}): {resp.text[:300]}")
    return len(payload)


def _insert_snapshots(
    organization_id: str,
    snapshot_run_id: str,
    ran_at: str,
    agent_id: str,
    duration_ms: int,
    plants: list[str],
    category_results: list[dict[str, Any]],
) -> int:
    rows: list[dict[str, Any]] = []
    for cat in category_results:
        key = cat["key"]
        for plant in plants:
            count = int(cat.get("counts_by_plant", {}).get(plant, 0))
            rows.append(
                {
                    "organization_id": organization_id,
                    "snapshot_run_id": snapshot_run_id,
                    "ran_at": ran_at,
                    "agent_id": agent_id,
                    "plant": plant,
                    "category": key,
                    "count": count,
                    "duration_ms": duration_ms,
                }
            )
    if not rows:
        return 0
    inserted = 0
    chunk_size = 100
    for i in range(0, len(rows), chunk_size):
        inserted += _supabase_post("ll01_activity_snapshots", rows[i : i + chunk_size])
    return inserted


def _insert_run(
    organization_id: str,
    snapshot_run_id: str,
    ran_at: str,
    agent_id: str,
    duration_ms: int,
    payload_version: int,
    plants: list[str],
    category_results: list[dict[str, Any]],
    errors: list[dict[str, Any]],
) -> int:
    """Persist the FULL run result (one JSONB row) to `ll01_activity_runs`
    for historical re-reference. Unlike `_insert_snapshots` (counts only),
    this keeps `categories[].rows`, so the Inventory Management date picker
    can reload a past run with its drill-down rows + Aging tab intact.

    `snapshot_run_id` is a fresh uuid4 per invocation (the endpoint never
    receives one from the browser), so the (org, snapshot_run_id) unique
    constraint never collides in the normal path; the merge-duplicates
    Prefer header in `_supabase_post` makes a fleet re-run idempotent if it
    ever does."""
    row = {
        "organization_id": organization_id,
        "snapshot_run_id": snapshot_run_id,
        "ran_at": ran_at,
        "agent_id": agent_id,
        "ok": True,
        "payload_version": payload_version,
        "duration_ms": duration_ms,
        "plants": plants,
        "categories": category_results,
        "errors": errors,
    }
    return _supabase_post("ll01_activity_runs", [row])


# ---------------------------------------------------------------------------
#  Endpoints
# ---------------------------------------------------------------------------
@router.get("/sap/ll01/warehouse-activity/progress")
def ll01_warehouse_activity_progress() -> dict:
    return dict(_progress)


@router.post("/sap/ll01/warehouse-activity")
@_track_metric("ll01_warehouse_activity")
def ll01_warehouse_activity(req: LL01WarehouseActivityRequest) -> dict:
    _resolve_agent_globals()

    plants = [p.strip().upper() for p in (req.plants or LL01_PLANTS) if p.strip()]
    cat_keys = req.categories or [c["key"] for c in LL01_CATEGORIES]
    categories = [c for c in LL01_CATEGORIES if c["key"] in cat_keys]
    snapshot_run_id = req.snapshot_run_id or str(uuid.uuid4())

    if not plants:
        return {"ok": False, "error": "No plants specified", "step": "validate"}
    if not categories:
        return {"ok": False, "error": "No categories specified", "step": "validate"}
    if not state.sap_connected:
        return {
            "ok": False,
            "error": "SAP not connected — open SAP GUI and reconnect the agent",
            "step": "connect",
        }

    try:
        sess, _ = _get_sap_session()
    except Exception as e:
        return {"ok": False, "error": f"Could not acquire SAP session: {e}", "step": "connect"}

    started = time.time()
    ran_at = _utcnow_iso()
    agent_id = _agent_self_id()
    errors: list[dict[str, str]] = []

    _progress["started_at"] = ran_at
    _progress["running"] = True
    _progress["plant_total"] = len(plants)

    cat_accum: dict[str, dict[str, Any]] = {}
    for cat in categories:
        cat_accum[cat["key"]] = {
            "key": cat["key"],
            "label": cat["label"],
            "thresholds": dict(cat["thresholds"]),
            "counts_by_plant": {p: 0 for p in plants},
            "total": 0,
            "rows": [],
        }

    for p_idx, plant in enumerate(plants):
        print(f"[ll01] Plant {p_idx + 1}/{len(plants)}: {plant}")
        try:
            _navigate_ll01_plant(sess, plant)
        except Exception as e:
            for cat in categories:
                errors.append(
                    {
                        "plant": plant,
                        "category": cat["key"],
                        "step": "navigate_ll01",
                        "detail": str(e),
                    }
                )
            continue

        for c_idx, cat in enumerate(categories):
            cat_key = cat["key"]
            _update_progress(
                plant_index=p_idx + 1,
                plant_total=len(plants),
                category_index=c_idx + 1,
                label=f"Plant {p_idx + 1} of {len(plants)} · {cat['label']}",
                started=started,
            )
            rows, err = _run_category_for_plant(sess, plant, cat)
            if err:
                errors.append(
                    {
                        "plant": plant,
                        "category": cat_key,
                        "step": "export_category",
                        "detail": err,
                    }
                )
                continue

            count = len(rows)
            acc = cat_accum[cat_key]
            acc["counts_by_plant"][plant] = count
            acc["total"] += count
            for row in rows:
                tagged = dict(row)
                tagged["_plant"] = plant
                acc["rows"].append(tagged)

            _log_sap_txn(
                plant,
                "LL01",
                f"ll01_{cat_key}",
                "success",
                f"count:{count}",
            )

    duration_ms = int((time.time() - started) * 1000)
    category_results = list(cat_accum.values())
    # `payload_version` bumped 2026-05-27 alongside the additive aging fields
    # (`created_on`, `created_by`) on `open_to` / `open_tr` / `open_posting`.
    # Older agent builds that pre-date this change return 1 (or omit it); the
    # frontend treats anything < 2 as "Aging tab unavailable for this run".
    payload_version = 2

    try:
        _insert_snapshots(
            req.organization_id,
            snapshot_run_id,
            ran_at,
            agent_id,
            duration_ms,
            plants,
            category_results,
        )
    except Exception as e:
        print(f"[ll01] Snapshot insert failed: {e}")
        errors.append(
            {
                "plant": "*",
                "category": "*",
                "step": "snapshot_insert",
                "detail": str(e),
            }
        )

    # Full-fidelity run store (2026-05-31). One JSONB row per run = the exact
    # result returned below, so the Inventory Management date picker can
    # reload any past run with its drill-down rows + Aging intact. Kept in a
    # separate try from the counts insert so a failure in one never skips the
    # other.
    try:
        _insert_run(
            req.organization_id,
            snapshot_run_id,
            ran_at,
            agent_id,
            duration_ms,
            payload_version,
            plants,
            category_results,
            errors,
        )
    except Exception as e:
        print(f"[ll01] Run payload insert failed: {e}")
        errors.append(
            {
                "plant": "*",
                "category": "*",
                "step": "run_insert",
                "detail": str(e),
            }
        )

    _reset_progress()

    return {
        "ok": True,
        "payload_version": payload_version,
        "snapshot_run_id": snapshot_run_id,
        "ran_at": ran_at,
        "agent_id": agent_id,
        "duration_ms": duration_ms,
        "plants": plants,
        "categories": category_results,
        "errors": errors,
    }

# Created and developed by Jai Singh
