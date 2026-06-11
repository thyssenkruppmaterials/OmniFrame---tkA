# Created and developed by Jai Singh
"""
LT22 — Display Transfer Orders for Storage Type / Bulk Import.

JSON-RPC method: `sap.importLt22`.

STATUS: STUB. The upstream `omni_agent/lt22_import.py` (956 LOC) is a
full %pc bulk-export pipeline with custom parsers — it depends on
`_extract_via_pc_export` from agent.py which itself depends on the
five-stage parse cascade `_parse_attempt_a..._e` (agent.py:8945–9469).
None of that is ported yet, so this handler returns a stub response
that lets the dispatch path be exercised.

Porting strategy:
  1. Port the parse cascade + `_extract_via_pc_export` into
     `handlers.query` (which already has an extract_via_pc_export stub).
  2. Then drop in the LT22 selection-screen navigation from
     `lt22_import.py` — the rest is just calling the now-shared
     bulk-export pipeline.

Request shape (mirrors lt22_import.py:Lt22ImportRequest):
  {
    "slot_id":         <int>,
    "warehouse":       <str>,           # required (LGNUM)
    "storage_type":    <str>,           # optional (LGTYP filter)
    "movement_type":   <str>,           # optional (BWLVS filter)
    "open_only":       <bool>,          # default true
    "use_bulk_export": <bool>           # default true (faster path)
  }
"""

from __future__ import annotations

from session_manager import SessionManager

from ._common import opt_bool, opt_int, opt_str, require_str, stub_response


async def handle_import_lt22(pool: SessionManager, params: dict, notify) -> dict:
    warehouse = require_str(params, "warehouse")
    storage_type = opt_str(params, "storage_type")
    movement_type = opt_str(params, "movement_type")
    open_only = opt_bool(params, "open_only", True)
    use_bulk_export = opt_bool(params, "use_bulk_export", True)
    slot_id = opt_int(params, "slot_id", default=None)

    async with pool.acquire_slot_for_op(slot_id=slot_id,
                                        op_name="sap.importLt22") as slot:
        return {
            **stub_response("sap.importLt22", params),
            "warehouse": warehouse,
            "storage_type": storage_type,
            "movement_type": movement_type,
            "open_only": open_only,
            "use_bulk_export": use_bulk_export,
            "slot_id": slot.slot_id,
            "rows": [],
            "columns": [],
            "total": 0,
        }


def register(dispatcher) -> None:
    dispatcher.register("sap.importLt22", handle_import_lt22)

# Created and developed by Jai Singh
