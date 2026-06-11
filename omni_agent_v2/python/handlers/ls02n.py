# Created and developed by Jai Singh
"""
LS02N — Set Putaway / Stock-Removal block flags on a storage bin.

JSON-RPC method: `sap.binBlocks`.

Near-verbatim port of `omni_agent.agent.set_bin_blocks` (agent.py:8023),
mirroring `omni_bridge/sap_scripts/ls02ntesting.vbs`.

Request shape:
  {
    "slot_id":            <int>,
    "warehouse":          <str>,
    "storage_type":       <str>,
    "storage_bin":        <str>,
    "putaway_block":      <bool>,
    "stock_removal_block":<bool>
  }
"""

from __future__ import annotations

from typing import Any

from session_manager import SessionManager

from ._common import (
    classify_sbar,
    emit_audit_log,
    opt_bool,
    opt_int,
    require_str,
    wait_for_session,
    walk_gui_tree,
    with_retries,
)


CHK_PUTAWAY_ID = (
    "wnd[0]/usr/tabsFUNC_TABSTRIP/tabpALLG/"
    "ssubD0400_S:SAPML01S:4001/chkLAGP-SKZUE"
)
CHK_REMOVAL_ID = (
    "wnd[0]/usr/tabsFUNC_TABSTRIP/tabpALLG/"
    "ssubD0400_S:SAPML01S:4001/chkLAGP-SKZUA"
)


def _set_checkbox(sess: Any, primary_id: str, suffix: str, value: bool) -> None:
    try:
        sess.findById(primary_id).selected = value
        return
    except Exception:
        pass
    nodes: list = []
    try:
        walk_gui_tree(sess.findById("wnd[0]/usr"), nodes)
    except Exception as e:
        raise RuntimeError(
            f"Could not locate checkbox '{suffix}': tree walk failed: {e}"
        ) from e
    for node_id, node_type, node in nodes:
        if node_type == "GuiCheckBox" and node_id.endswith(suffix):
            try:
                node.selected = value
                return
            except Exception as e:
                raise RuntimeError(
                    f"Found '{node_id}' but could not set: {e}"
                ) from e
    raise RuntimeError(
        f"Could not find checkbox ending with '{suffix}' on the LS02N "
        f"detail screen. The General tab layout may have shifted."
    )


async def handle_bin_blocks(pool: SessionManager, params: dict, notify) -> dict:
    slot_id = opt_int(params, "slot_id", default=None)
    warehouse = require_str(params, "warehouse")
    storage_type = require_str(params, "storage_type")
    storage_bin = require_str(params, "storage_bin")
    putaway_block = opt_bool(params, "putaway_block")
    stock_removal_block = opt_bool(params, "stock_removal_block")

    async with pool.acquire_slot_for_op(slot_id=slot_id,
                                        op_name="sap.binBlocks") as slot:

        def _open_and_lookup(sess: Any) -> tuple[str, str]:
            def _open_ls02n() -> None:
                sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLS02N"
                sess.findById("wnd[0]").sendVKey(0)
                wait_for_session(sess, 15)
            with_retries(_open_ls02n, label="LS02N open")

            sess.findById("wnd[0]/usr/ctxtLAGP-LGNUM").text = warehouse
            sess.findById("wnd[0]/usr/ctxtLAGP-LGTYP").text = storage_type
            sess.findById("wnd[0]/usr/ctxtLAGP-LGPLA").text = storage_bin
            sess.findById("wnd[0]").sendVKey(0)
            wait_for_session(sess, 15)
            return classify_sbar(sess)

        def _set_blocks(sess: Any) -> None:
            _set_checkbox(sess, CHK_PUTAWAY_ID, "/chkLAGP-SKZUE", putaway_block)
            _set_checkbox(sess, CHK_REMOVAL_ID, "/chkLAGP-SKZUA", stock_removal_block)

        def _save_and_exit(sess: Any) -> tuple[str, str]:
            sess.findById("wnd[0]/tbar[0]/btn[11]").press()
            wait_for_session(sess, 15)
            sbar, msg_type = classify_sbar(sess)
            try:
                sess.findById("wnd[0]/tbar[0]/btn[12]").press()
                wait_for_session(sess, 5)
            except Exception:
                pass
            return sbar, msg_type

        try:
            sbar, msg_type = await slot.run_on_com(_open_and_lookup)
        except Exception as e:
            return {"ok": False, "error": f"Could not open LS02N: {e}",
                    "step": "lookup"}

        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="LS02N",
                                 action="set_bin_blocks", status="error",
                                 message=f"WH:{warehouse} | lookup | {sbar}",
                                 delivery_id=storage_bin)
            return {"ok": False, "error": sbar, "step": "lookup"}
        for err in ("does not exist", "not found", "no authorization", "is locked"):
            if err in sbar_lower:
                await emit_audit_log(notify, slot_id=slot.slot_id,
                                     transaction_code="LS02N",
                                     action="set_bin_blocks", status="error",
                                     message=f"WH:{warehouse} | {sbar}",
                                     delivery_id=storage_bin)
                return {"ok": False, "error": sbar, "step": "lookup"}

        try:
            await slot.run_on_com(_set_blocks)
        except Exception as e:
            return {"ok": False, "error": str(e), "step": "checkbox"}

        try:
            sbar, msg_type = await slot.run_on_com(_save_and_exit)
        except Exception as e:
            return {"ok": False, "error": str(e), "step": "save"}

        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="LS02N",
                                 action="set_bin_blocks", status="error",
                                 message=f"WH:{warehouse} | save | {sbar}",
                                 delivery_id=storage_bin)
            return {"ok": False, "error": sbar, "step": "save"}

        if msg_type == "S" or any(
            w in sbar_lower for w in ("changed", "saved", "updated", "modified")
        ):
            await emit_audit_log(
                notify, slot_id=slot.slot_id,
                transaction_code="LS02N",
                action="set_bin_blocks", status="success",
                message=(f"WH:{warehouse} | bin:{storage_type}/{storage_bin} | "
                         f"PutBlk={putaway_block} StkRemBlk={stock_removal_block} | {sbar}"),
                delivery_id=storage_bin,
            )
            return {
                "ok": True,
                "message": sbar,
                "putaway_block": putaway_block,
                "stock_removal_block": stock_removal_block,
            }

        await emit_audit_log(notify, slot_id=slot.slot_id,
                             transaction_code="LS02N",
                             action="set_bin_blocks", status="warning",
                             message=f"WH:{warehouse} | unrecognised: {sbar}",
                             delivery_id=storage_bin)
        return {
            "ok": False,
            "error": sbar or "LS02N returned no confirmation message — bin state unknown",
            "warning": True,
        }


def register(dispatcher) -> None:
    dispatcher.register("sap.binBlocks", handle_bin_blocks)

# Created and developed by Jai Singh
