# Created and developed by Jai Singh
"""
Process Shipment — composite ZV26 + VL02N + LT12 + VT01N + PGI flow.

JSON-RPC method: `sap.processShipment`.

STATUS: STUB. The upstream `agent.process_shipment`
(omni_agent/agent.py:11148, ~430 LOC) is one of the most complex
orchestrations in the agent: it sequences shipment-cost ZV26, delivery
VL02N, transfer-order LT12 confirmation, shipment creation VT01N, and
post-goods-issue across multiple windows + popup dispatches with
fine-grained per-step progress reporting.

Porting strategy when this module is fleshed out:
  1. Replicate `_reset_progress` / `_set_step` / `_append_step_result`
     / `_finalize_progress` as helper-local state held on the slot
     (so a slot tracks the in-flight shipment progress and the Rust
     shell can poll via a separate `sap.shipmentProgress` method).
  2. Each step becomes its own closure dispatched on `slot.run_on_com`,
     followed by an emit_audit_log + a "step.X" notification so the
     frontend shipment timeline tile can render live progress.
  3. Preserve the failed_step error contract — frontend retry buttons
     branch on it.

Until then this stub returns ok=false with `stub: true` so the Rust
shell can still exercise the dispatch path and unblock GUI work.

Request shape (matches ShipmentRequest from agent.py:1529):
  {
    "slot_id":   <int>,
    "delivery":  <str>,            # required
    "item":      <str>,            # default "0010"
    "serials":   [<str>, ...],     # optional
    "to_number": <str>,            # required
    "warehouse": <str>,            # required
    "tracking":  <str>             # default "Tracking"
  }

Response shape (success):
  {
    "ok": true,
    "delivery":        "<echo>",
    "to_number":       "<echo>",
    "warehouse":       "<echo>",
    "shipment_number": "<from VT01N>",
    "results":         [{"step": <int>, "name": "<str>", "status": "<str>", "msg": "<str>"}, ...]
  }
"""

from __future__ import annotations

from session_manager import SessionManager

from ._common import opt_int, opt_str, require_str, stub_response


async def handle_process_shipment(pool: SessionManager, params: dict, notify) -> dict:
    delivery = require_str(params, "delivery")
    to_number = require_str(params, "to_number")
    warehouse = require_str(params, "warehouse")
    item = opt_str(params, "item", "0010")
    tracking = opt_str(params, "tracking", "Tracking")
    slot_id = opt_int(params, "slot_id", default=None)

    async with pool.acquire_slot_for_op(slot_id=slot_id,
                                        op_name="sap.processShipment") as slot:
        return {
            **stub_response("sap.processShipment", params),
            "delivery": delivery,
            "to_number": to_number,
            "warehouse": warehouse,
            "item": item,
            "tracking": tracking,
            "slot_id": slot.slot_id,
            "failed_step": 0,
        }


async def handle_shipment_progress(pool: SessionManager, params: dict, notify) -> dict:
    """Currently no live shipment is tracked (process_shipment is a stub).
    Returns idle progress."""
    return {
        "ok": True,
        "delivery": None,
        "step": 0,
        "step_name": "idle",
        "status": "idle",
        "results": [],
    }


def register(dispatcher) -> None:
    dispatcher.register("sap.processShipment", handle_process_shipment)
    dispatcher.register("sap.shipmentProgress", handle_shipment_progress)

# Created and developed by Jai Singh
