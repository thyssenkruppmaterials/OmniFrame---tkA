# Created and developed by Jai Singh
"""
Generic SAP query dispatcher (LT10 / LT24 / MB52 / MMBE).

JSON-RPC method: `sap.query`.

STATUS: Currently a STUB. The upstream agent.py (lines 8852–11141)
contains ~2,300 LOC of ALV-grid + table-control + list-output
extraction (`_extract_alv_grid`, `_extract_via_pc_export`, the five
`_parse_attempt_*` parsers, plus the four registered handlers
LT10 / LT24 / MB52 / MMBE). Porting all of this cleanly is a separate
multi-session effort; this module exposes the dispatcher contract
plus a `extract_alv_grid` adapter that handlers/zmm60.py imports
lazily, so once `_extract_alv_grid` is ported the rest of the
pipeline lights up without further refactoring.

Request shape (matches Worker A's QueryParams):
  {
    "slot_id":         <int>,
    "handler":         "lt10" | "lt24" | "mb52" | "mmbe",
    "params":          { ... handler-specific },
    "use_bulk_export": <bool>     # opt-in to %pc fast path
  }

Response shape (success):
  {
    "ok": true,
    "columns": [{"id": "...", "title": "..."}, ...],
    "rows":    [{...}, ...],
    "total":   <int>,
    "meta":    { ... handler-specific }
  }
"""

from __future__ import annotations

from typing import Any, Optional

from session_manager import SessionManager

from ._common import (
    classify_sbar,
    opt_bool,
    opt_int,
    require_str,
    stub_response,
    wait_for_session,
    walk_gui_tree,
)


# ---------------------------------------------------------------------------
#  Public API used by other handler modules
# ---------------------------------------------------------------------------
def extract_alv_grid(sess: Any,
                     candidate_ids: Optional[list[str]] = None) -> dict:
    """ALV-grid extractor stub. Returns empty rows + a `columns: []` so
    callers can short-circuit cleanly until the full extractor is ported.

    The real impl walks `sess.findById(...)` for each candidate id, falls
    through to a tree-walk for any control exposing `.ColumnOrder`, then
    pulls cell values via `grid.GetCellValue(row, col_id)` and column
    titles via `grid.GetColumnTitles(col_id)[0]`. See
    `omni_agent.agent._extract_alv_grid` (agent.py:10133) for the
    canonical implementation.
    """
    return {"columns": [], "rows": [], "total": 0, "stub": True}


def extract_table_control(sess: Any, table_id: str,
                          field_ids: list[str]) -> dict:
    """Table-control extractor stub. Real impl at agent.py:10302."""
    return {"columns": [], "rows": [], "total": 0, "stub": True}


def extract_via_pc_export(sess: Any) -> dict:
    """%pc bulk-export stub. Real impl at agent.py:9523. The %pc OK-code
    triggers SAP's "Save list in file" dialog; the real impl drives the
    save-as path in %TEMP%, reads the unconverted text file, and runs
    a 5-stage parse cascade (`_parse_attempt_a..._e`) to reconstruct
    columns + rows."""
    return {"columns": [], "rows": [], "total": 0, "stub": True}


# ---------------------------------------------------------------------------
#  Per-handler stubs
# ---------------------------------------------------------------------------
QUERY_HANDLERS: dict[str, str] = {
    "lt10": "Warehouse Activity Monitor — open transfer orders",
    "lt24": "Display Transfer Orders for Material",
    "mb52": "Display Warehouse Stocks",
    "mmbe": "Stock Overview",
}


async def handle_query(pool: SessionManager, params: dict, notify) -> dict:
    handler = require_str(params, "handler").lower()
    handler_params = params.get("params") or {}
    use_bulk_export = opt_bool(params, "use_bulk_export", False)
    slot_id = opt_int(params, "slot_id", default=None)

    if handler not in QUERY_HANDLERS:
        return {
            "ok": False,
            "error": (f"Unknown handler '{handler}'. "
                      f"Available: {list(QUERY_HANDLERS.keys())}"),
        }

    # Until each handler is fully ported, we still acquire the slot and
    # ensure the COM thread is reachable so the dispatch path is exercised
    # end-to-end. The actual SAP call is replaced by a stub response.
    async with pool.acquire_slot_for_op(slot_id=slot_id,
                                        op_name=f"sap.query/{handler}") as slot:
        return {
            **stub_response(f"sap.query/{handler}", handler_params),
            "handler": handler,
            "use_bulk_export": use_bulk_export,
            "slot_id": slot.slot_id,
        }


async def handle_query_handlers_list(pool: SessionManager, params: dict, notify) -> dict:
    """Return the registered handlers — used by the frontend's query
    picker so it doesn't have to hardcode the list."""
    return {
        "ok": True,
        "handlers": [
            {"id": h, "name": h.upper(), "description": desc}
            for h, desc in QUERY_HANDLERS.items()
        ],
    }


def register(dispatcher) -> None:
    dispatcher.register("sap.query",         handle_query)
    dispatcher.register("sap.queryHandlers", handle_query_handlers_list)

# Created and developed by Jai Singh
