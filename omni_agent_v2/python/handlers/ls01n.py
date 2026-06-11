# Created and developed by Jai Singh
"""
LS01N — Create Storage Bin.

JSON-RPC method: `sap.createStorageBin`.

Near-verbatim port of `omni_agent.agent.create_storage_bin` (agent.py:8642).
"""

from __future__ import annotations

from typing import Any, Optional

from session_manager import SessionManager

from ._common import (
    ack_save_warnings,
    classify_sbar,
    emit_audit_log,
    opt_int,
    require_str,
    wait_for_session,
    walk_gui_tree,
    with_retries,
)


# Constants from the recorded LS01N.vbs flow — never change for this user.
LGBER = "001"
LGEWI = "9,999,999.000"
LKAPV = "9,999,999.000"


def _find_field(sess: Any, primary_id: str, suffix: str) -> Optional[Any]:
    try:
        return sess.findById(primary_id)
    except Exception:
        pass
    nodes: list = []
    try:
        walk_gui_tree(sess.findById("wnd[0]/usr"), nodes)
    except Exception:
        return None
    for nid, ntype, node in nodes:
        if ntype in ("GuiCTextField", "GuiTextField") and nid.endswith(suffix):
            return node
    return None


async def handle_create_storage_bin(pool: SessionManager, params: dict, notify) -> dict:
    slot_id = opt_int(params, "slot_id", default=None)
    warehouse = require_str(params, "warehouse")
    storage_type = require_str(params, "storage_type")
    storage_bin = require_str(params, "storage_bin")

    section_id = (
        "wnd[0]/usr/tabsFUNC_TABSTRIP/tabpALLG/"
        "ssubD0400_S:SAPML01S:4001/ctxtLAGP-LGBER"
    )
    total_cap_id = (
        "wnd[0]/usr/tabsFUNC_TABSTRIP/tabpALLG/"
        "ssubD0400_S:SAPML01S:4001/txtLAGP-LGEWI"
    )
    allowed_cap_id = (
        "wnd[0]/usr/tabsFUNC_TABSTRIP/tabpALLG/"
        "ssubD0400_S:SAPML01S:4001/txtLAGP-LKAPV"
    )

    async with pool.acquire_slot_for_op(slot_id=slot_id,
                                        op_name="sap.createStorageBin") as slot:

        def _initial(sess: Any) -> tuple[str, str]:
            def _open() -> None:
                sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLS01N"
                sess.findById("wnd[0]").sendVKey(0)
                wait_for_session(sess, 15)
            with_retries(_open, label="LS01N open")

            sess.findById("wnd[0]/usr/ctxtLAGP-LGNUM").text = warehouse
            sess.findById("wnd[0]/usr/ctxtLAGP-LGTYP").text = storage_type
            sess.findById("wnd[0]/usr/ctxtLAGP-LGPLA").text = storage_bin
            sess.findById("wnd[0]").sendVKey(0)
            wait_for_session(sess, 15)
            return classify_sbar(sess)

        def _detail_screen(sess: Any) -> bool:
            section = _find_field(sess, section_id, "/ctxtLAGP-LGBER")
            total = _find_field(sess, total_cap_id, "/txtLAGP-LGEWI")
            allowed = _find_field(sess, allowed_cap_id, "/txtLAGP-LKAPV")
            if section is None or total is None or allowed is None:
                return False
            section.text = LGBER
            total.text = LGEWI
            allowed.text = LKAPV
            return True

        def _save_and_exit(sess: Any) -> tuple[str, str]:
            sess.findById("wnd[0]/tbar[0]/btn[11]").press()
            wait_for_session(sess, 15)
            sbar, msg_type = ack_save_warnings(sess)
            for _ in range(2):
                try:
                    sess.findById("wnd[0]/tbar[0]/btn[3]").press()
                    wait_for_session(sess, 5)
                except Exception:
                    break
            try:
                sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
            except Exception:
                pass
            return sbar, msg_type

        try:
            sbar, msg_type = await slot.run_on_com(_initial)
        except Exception as e:
            return {"ok": False, "error": str(e), "step": "initial_screen"}

        sbar_lower = sbar.lower()
        for already in ("already exists", "already created", "already defined"):
            if already in sbar_lower:
                await emit_audit_log(notify, slot_id=slot.slot_id,
                                     transaction_code="LS01N",
                                     action="create_storage_bin",
                                     status="error",
                                     message=f"WH:{warehouse} | already-exists | {sbar}",
                                     delivery_id=storage_bin)
                return {
                    "ok": False, "error": sbar,
                    "step": "initial_screen", "already_exists": True,
                }
        if msg_type in ("E", "A") or any(
            err in sbar_lower
            for err in ("does not exist", "not found", "no authorization", "is locked")
        ):
            return {"ok": False, "error": sbar, "step": "initial_screen"}

        try:
            ok = await slot.run_on_com(_detail_screen)
        except Exception as e:
            return {"ok": False, "error": str(e), "step": "detail_screen"}
        if not ok:
            return {
                "ok": False,
                "error": (
                    "Could not locate LS01N detail-screen fields "
                    "(LGBER / LGEWI / LKAPV). Re-record LS01N to confirm."
                ),
                "step": "detail_screen",
            }

        try:
            sbar, msg_type = await slot.run_on_com(_save_and_exit)
        except Exception as e:
            return {"ok": False, "error": str(e), "step": "save"}

        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="LS01N",
                                 action="create_storage_bin", status="error",
                                 message=f"WH:{warehouse} | save | {sbar}",
                                 delivery_id=storage_bin)
            return {"ok": False, "error": sbar, "step": "save"}

        success = msg_type == "S" or any(
            w in sbar_lower for w in ("created", "saved", "added")
        )
        if success:
            await emit_audit_log(
                notify, slot_id=slot.slot_id,
                transaction_code="LS01N",
                action="create_storage_bin", status="success",
                message=(f"WH:{warehouse} STyp:{storage_type} "
                         f"Bin:{storage_bin} | {sbar}"),
                delivery_id=storage_bin,
            )
            return {
                "ok": True,
                "message": sbar or f"Bin {storage_bin} created in {warehouse}/{storage_type}",
                "warehouse": warehouse,
                "storage_type": storage_type,
                "storage_bin": storage_bin,
            }

        return {
            "ok": False,
            "error": sbar or "LS01N returned no confirmation message",
            "warning": True,
        }


def register(dispatcher) -> None:
    dispatcher.register("sap.createStorageBin", handle_create_storage_bin)

# Created and developed by Jai Singh
