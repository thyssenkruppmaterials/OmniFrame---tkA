# Created and developed by Jai Singh
"""
LT01 — Create Transfer Order (bin-to-bin).

JSON-RPC method: `sap.transferInventory`.

Near-verbatim port of `omni_agent.agent.transfer_inventory`
(agent.py:7816). Mirrors the recorded flow in
omni_bridge/sap_scripts/LT01Steps.vbs:

  1. /nLT01                       → Create TO: Initial Screen
  2. Fill: LGNUM, BWLVS (movement type), MATNR, ANFME (qty),
     plant, storage location, batch, plus optional stock-attribute
     fields (BESTQ, SOBKZ + LSONR, LDEST). Set focus on SOBKZ
     then Enter.
  3. Source bin (VLTYP, VLPLA) + destination (NLTYP, NLPLA).
  4. Enter to validate. Enter again to commit.

Request shape (matches Worker A's TransferInventoryParams):
  {
    "slot_id": <int>,                    # required
    "warehouse": <str>,                  # required
    "material": <str>,                   # required
    "quantity": <str>,                   # required
    "plant": <str>,                      # optional
    "storage_location": <str>,           # optional
    "batch": <str>,                      # optional
    "source_storage_type": <str>,        # required
    "source_storage_bin":  <str>,        # required
    "dest_storage_type":   <str>,        # required
    "dest_storage_bin":    <str>,        # required
    "movement_type": <str>,              # default "999"
    "stock_category": <str>,             # optional
    "special_stock_indicator": <str>,    # optional
    "special_stock_number":    <str>,    # optional
    "print_destination": <str>,          # optional
  }

Response shape (success):
  {
    "ok": true,
    "message": "<sap status>",
    "to_number": "<extracted from sbar>"
  }
"""

from __future__ import annotations

import re as _re
from typing import Any

from rpc_protocol import RpcError
from session_manager import SessionManager

from ._common import (
    classify_sbar,
    emit_audit_log,
    opt_int,
    opt_str,
    require_str,
    wait_for_session,
    with_retries,
)


async def handle_transfer_inventory(pool: SessionManager, params: dict, notify) -> dict:
    slot_id = opt_int(params, "slot_id", default=None)
    warehouse = require_str(params, "warehouse")
    material = require_str(params, "material")
    quantity = require_str(params, "quantity")
    src_type = require_str(params, "source_storage_type")
    src_bin = require_str(params, "source_storage_bin")
    dst_type = require_str(params, "dest_storage_type")
    dst_bin = require_str(params, "dest_storage_bin")

    plant = opt_str(params, "plant")
    storage_location = opt_str(params, "storage_location")
    batch = opt_str(params, "batch")
    movement_type = opt_str(params, "movement_type", "999")
    stock_category = opt_str(params, "stock_category")
    special_stock_indicator = opt_str(params, "special_stock_indicator")
    special_stock_number = opt_str(params, "special_stock_number")
    print_destination = opt_str(params, "print_destination")

    async with pool.acquire_slot_for_op(slot_id=slot_id,
                                        op_name="sap.transferInventory") as slot:

        def _initial_screen(sess: Any) -> tuple[str, str]:
            def _open() -> None:
                sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLT01"
                sess.findById("wnd[0]").sendVKey(0)
                wait_for_session(sess, 15)
            with_retries(_open, label="LT01 open")

            sess.findById("wnd[0]/usr/ctxtLTAK-LGNUM").text = warehouse
            sess.findById("wnd[0]/usr/ctxtLTAK-BWLVS").text = movement_type
            sess.findById("wnd[0]/usr/ctxtLTAP-MATNR").text = material
            sess.findById("wnd[0]/usr/txtRL03T-ANFME").text = quantity

            if plant:
                try:
                    sess.findById("wnd[0]/usr/ctxtLTAP-WERKS").text = plant
                except Exception:
                    pass
            if storage_location:
                try:
                    sess.findById("wnd[0]/usr/ctxtLTAP-LGORT").text = storage_location
                except Exception:
                    pass
            if batch:
                try:
                    sess.findById("wnd[0]/usr/ctxtLTAP-CHARG").text = batch
                except Exception:
                    pass
            if print_destination:
                try:
                    sess.findById("wnd[0]/usr/ctxtLTAP-LDEST").text = print_destination
                except Exception:
                    pass
            if stock_category:
                try:
                    sess.findById("wnd[0]/usr/ctxtLTAP-BESTQ").text = stock_category
                except Exception:
                    pass
            if special_stock_indicator:
                try:
                    sess.findById("wnd[0]/usr/ctxtLTAP-SOBKZ").text = special_stock_indicator
                except Exception:
                    pass
                if special_stock_number:
                    try:
                        sess.findById("wnd[0]/usr/txtRL03T-LSONR").text = special_stock_number
                    except Exception:
                        pass

            try:
                sess.findById("wnd[0]/usr/ctxtLTAP-SOBKZ").setFocus()
            except Exception:
                pass

            sess.findById("wnd[0]").sendVKey(0)
            wait_for_session(sess, 15)
            return classify_sbar(sess)

        def _bin_screen(sess: Any) -> tuple[str, str]:
            sess.findById("wnd[0]/usr/ctxtLTAP-VLTYP").text = src_type
            sess.findById("wnd[0]/usr/ctxtLTAP-VLPLA").text = src_bin
            sess.findById("wnd[0]/usr/ctxtLTAP-NLTYP").text = dst_type
            sess.findById("wnd[0]/usr/ctxtLTAP-NLPLA").text = dst_bin
            sess.findById("wnd[0]").sendVKey(0)
            wait_for_session(sess, 15)
            return classify_sbar(sess)

        def _commit(sess: Any) -> tuple[str, str]:
            sess.findById("wnd[0]").sendVKey(0)
            wait_for_session(sess, 25)
            return classify_sbar(sess)

        try:
            sbar, msg_type = await slot.run_on_com(_initial_screen)
        except Exception as e:
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="LT01",
                                 action="transfer_inventory", status="error",
                                 message=f"WH:{warehouse} | initial | {e}",
                                 delivery_id=material)
            return {"ok": False, "error": f"Could not fill LT01 initial screen: {e}",
                    "step": "initial_screen"}

        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="LT01",
                                 action="transfer_inventory", status="error",
                                 message=f"WH:{warehouse} | Step1 | {sbar}",
                                 delivery_id=material)
            return {"ok": False, "error": sbar, "step": "initial_screen"}
        for err in ("does not exist", "not found", "no authorization", "is locked"):
            if err in sbar_lower:
                await emit_audit_log(notify, slot_id=slot.slot_id,
                                     transaction_code="LT01",
                                     action="transfer_inventory", status="error",
                                     message=f"WH:{warehouse} | {sbar}",
                                     delivery_id=material)
                return {"ok": False, "error": sbar}

        try:
            sbar, msg_type = await slot.run_on_com(_bin_screen)
        except Exception as e:
            return {"ok": False, "error": f"Could not fill LT01 bin screen: {e}",
                    "step": "bin_screen"}

        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="LT01",
                                 action="transfer_inventory", status="error",
                                 message=f"WH:{warehouse} | Step2 | {sbar}",
                                 delivery_id=material)
            return {"ok": False, "error": sbar, "step": "bin_screen"}

        try:
            sbar, msg_type = await slot.run_on_com(_commit)
        except Exception as e:
            return {"ok": False, "error": str(e), "step": "commit"}

        sbar_lower = sbar.lower()
        to_number = None
        m = _re.search(r"transfer order\s*0*(\d+)", sbar_lower)
        if m:
            to_number = m.group(1)

        if msg_type == "S" or any(
            w in sbar_lower for w in ("created", "saved", "posted", "transfer order")
        ):
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="LT01",
                                 action="transfer_inventory", status="success",
                                 message=f"WH:{warehouse} | TO:{to_number} | {sbar}",
                                 delivery_id=material)
            return {"ok": True, "message": sbar, "to_number": to_number}

        if msg_type in ("E", "A"):
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="LT01",
                                 action="transfer_inventory", status="error",
                                 message=f"WH:{warehouse} | {sbar}",
                                 delivery_id=material)
            return {"ok": False, "error": sbar}

        await emit_audit_log(notify, slot_id=slot.slot_id,
                             transaction_code="LT01",
                             action="transfer_inventory", status="warning",
                             message=f"WH:{warehouse} | unrecognised: {sbar}",
                             delivery_id=material)
        return {
            "ok": False,
            "error": sbar or "LT01 returned no confirmation message — TO state unknown",
            "warning": True,
        }


def register(dispatcher) -> None:
    dispatcher.register("sap.transferInventory", handle_transfer_inventory)

# Created and developed by Jai Singh
