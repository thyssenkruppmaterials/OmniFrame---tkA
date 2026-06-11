# Created and developed by Jai Singh
"""
MM02 — Material Master change (Warehouse Mgmt 2 storage bin + Warehouse
Mgmt 1 storage-type defaults).

JSON-RPC methods:
  - sap.materialMasterBin           (set MLGT-LGPLA)
  - sap.materialMasterStorageTypes  (set MLGN-LTKZA / MLGN-LTKZE)

Near-verbatim ports of `omni_agent.agent.material_master_bin` and
`material_master_storage_types` (agent.py:8187 + 8395).
"""

from __future__ import annotations

from typing import Any, Optional

from session_manager import SessionManager

from ._common import (
    ack_save_warnings,
    classify_sbar,
    emit_audit_log,
    opt_int,
    opt_str,
    require_str,
    wait_for_session,
    walk_gui_tree,
    with_retries,
)


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


# ---------------------------------------------------------------------------
#  sap.materialMasterBin
# ---------------------------------------------------------------------------
async def handle_material_master_bin(pool: SessionManager, params: dict, notify) -> dict:
    slot_id = opt_int(params, "slot_id", default=None)
    material = require_str(params, "material")
    plant = require_str(params, "plant")
    warehouse = require_str(params, "warehouse")
    storage_type = require_str(params, "storage_type")
    storage_bin = opt_str(params, "storage_bin")  # may be empty (clear)
    clearing_bin = not storage_bin.strip()

    bin_id = (
        "wnd[0]/usr/tabsTABSPR1/tabpSP22/ssubTABFRA1:SAPLMGMM:2000/"
        "subSUB3:SAPLMGD1:2734/ctxtMLGT-LGPLA"
    )

    async with pool.acquire_slot_for_op(slot_id=slot_id,
                                        op_name="sap.materialMasterBin") as slot:

        def _initial(sess: Any) -> tuple[str, str]:
            def _open() -> None:
                sess.findById("wnd[0]/tbar[0]/okcd").text = "/nMM02"
                sess.findById("wnd[0]").sendVKey(0)
                wait_for_session(sess, 15)
            with_retries(_open, label="MM02 open")

            sess.findById("wnd[0]/usr/ctxtRMMG1-MATNR").text = material

            def _press_org_levels() -> None:
                try:
                    sess.findById("wnd[0]/tbar[1]/btn[6]").press()
                except Exception:
                    sess.findById("wnd[0]").sendVKey(0)
                wait_for_session(sess, 15)
            with_retries(_press_org_levels, label="MM02 org-levels press")
            return classify_sbar(sess)

        def _confirm_org_levels(sess: Any) -> tuple[str, str]:
            sess.findById("wnd[1]/usr/ctxtRMMG1-WERKS").text = plant
            sess.findById("wnd[1]/usr/ctxtRMMG1-LGNUM").text = warehouse
            sess.findById("wnd[1]/usr/ctxtRMMG1-LGTYP").text = storage_type
            try:
                sess.findById("wnd[1]/usr/chkUSRM1-ASCHL").setFocus()
            except Exception:
                pass
            sess.findById("wnd[1]").sendVKey(0)
            wait_for_session(sess, 20)
            return classify_sbar(sess)

        def _set_bin(sess: Any) -> bool:
            field = _find_field(sess, bin_id, "/ctxtMLGT-LGPLA")
            if field is None:
                return False
            field.text = storage_bin
            return True

        def _save(sess: Any) -> tuple[str, str]:
            sess.findById("wnd[0]/tbar[0]/btn[11]").press()
            wait_for_session(sess, 30)
            for _ in range(3):
                try:
                    sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
                    wait_for_session(sess, 5)
                except Exception:
                    try:
                        sess.findById("wnd[1]").sendVKey(0)
                        wait_for_session(sess, 5)
                    except Exception:
                        break
            return ack_save_warnings(sess)

        try:
            sbar, msg_type = await slot.run_on_com(_initial)
        except Exception as e:
            return {"ok": False, "error": str(e), "step": "initial_screen"}
        sbar_lower = sbar.lower()
        if msg_type in ("E", "A") or any(
            err in sbar_lower
            for err in ("does not exist", "not found", "no authorization", "is locked")
        ):
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="MM02",
                                 action="material_master_bin", status="error",
                                 message=f"WH:{warehouse} | initial | {sbar}",
                                 delivery_id=material)
            return {"ok": False, "error": sbar, "step": "initial_screen"}

        try:
            sbar, msg_type = await slot.run_on_com(_confirm_org_levels)
        except Exception as e:
            return {"ok": False, "error": str(e), "step": "org_levels_popup"}
        if msg_type in ("E", "A"):
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="MM02",
                                 action="material_master_bin", status="error",
                                 message=f"WH:{warehouse} | org-levels | {sbar}",
                                 delivery_id=material)
            return {"ok": False, "error": sbar, "step": "org_levels_popup"}

        try:
            ok = await slot.run_on_com(_set_bin)
        except Exception as e:
            return {"ok": False, "error": f"Could not set storage bin: {e}",
                    "step": "bin_field"}
        if not ok:
            return {
                "ok": False,
                "error": (
                    "Could not locate MLGT-LGPLA on Warehouse Mgmt 2 tab — "
                    "material may not have this view extended."
                ),
                "step": "bin_field",
            }

        try:
            sbar, msg_type = await slot.run_on_com(_save)
        except Exception as e:
            return {"ok": False, "error": str(e), "step": "save"}

        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="MM02",
                                 action="material_master_bin", status="error",
                                 message=f"WH:{warehouse} | save | {sbar}",
                                 delivery_id=material)
            return {"ok": False, "error": sbar, "step": "save"}

        if msg_type == "S" or any(
            w in sbar_lower for w in ("changed", "saved", "updated", "modified")
        ):
            bin_label = "(cleared)" if clearing_bin else storage_bin
            await emit_audit_log(
                notify, slot_id=slot.slot_id,
                transaction_code="MM02",
                action="material_master_bin", status="success",
                message=(f"WH:{warehouse} Plant:{plant} STyp:{storage_type} "
                         f"Bin:{bin_label} | {sbar}"),
                delivery_id=material,
            )
            return {
                "ok": True,
                "message": sbar or f"{material} → {bin_label}",
                "material": material,
                "storage_bin": storage_bin,
                "cleared": clearing_bin,
            }

        await emit_audit_log(notify, slot_id=slot.slot_id,
                             transaction_code="MM02",
                             action="material_master_bin", status="warning",
                             message=f"WH:{warehouse} | unrecognised: {sbar}",
                             delivery_id=material)
        return {
            "ok": False,
            "error": sbar or "MM02 returned no confirmation message",
            "warning": True,
        }


# ---------------------------------------------------------------------------
#  sap.materialMasterStorageTypes
# ---------------------------------------------------------------------------
async def handle_material_master_storage_types(pool: SessionManager, params: dict, notify) -> dict:
    slot_id = opt_int(params, "slot_id", default=None)
    material = require_str(params, "material")
    plant = require_str(params, "plant")
    warehouse = require_str(params, "warehouse")
    org_storage_type = require_str(params, "org_storage_type")
    removal_storage_type = opt_str(params, "removal_storage_type")
    placement_storage_type = opt_str(params, "placement_storage_type")

    clearing_removal = not removal_storage_type.strip()
    clearing_placement = not placement_storage_type.strip()
    if clearing_removal and clearing_placement:
        return {
            "ok": False,
            "error": (
                "Provide at least one of removal_storage_type or "
                "placement_storage_type."
            ),
        }

    ltkza_id = (
        "wnd[0]/usr/tabsTABSPR1/tabpSP21/ssubTABFRA1:SAPLMGMM:2000/"
        "subSUB3:SAPLMGD1:2733/ctxtMLGN-LTKZA"
    )
    ltkze_id = (
        "wnd[0]/usr/tabsTABSPR1/tabpSP21/ssubTABFRA1:SAPLMGMM:2000/"
        "subSUB3:SAPLMGD1:2733/ctxtMLGN-LTKZE"
    )
    wm1_tab_id = "wnd[0]/usr/tabsTABSPR1/tabpSP21"

    async with pool.acquire_slot_for_op(slot_id=slot_id,
                                        op_name="sap.materialMasterStorageTypes") as slot:

        def _initial(sess: Any) -> tuple[str, str]:
            def _open() -> None:
                sess.findById("wnd[0]/tbar[0]/okcd").text = "/nMM02"
                sess.findById("wnd[0]").sendVKey(0)
                wait_for_session(sess, 15)
            with_retries(_open, label="MM02 (storage types) open")

            sess.findById("wnd[0]/usr/ctxtRMMG1-MATNR").text = material

            def _press_org_levels() -> None:
                try:
                    sess.findById("wnd[0]/tbar[1]/btn[6]").press()
                except Exception:
                    sess.findById("wnd[0]").sendVKey(0)
                wait_for_session(sess, 15)
            with_retries(_press_org_levels, label="MM02 (storage types) org-levels press")
            return classify_sbar(sess)

        def _confirm_org_levels(sess: Any) -> tuple[str, str]:
            sess.findById("wnd[1]/usr/ctxtRMMG1-WERKS").text = plant
            sess.findById("wnd[1]/usr/ctxtRMMG1-LGNUM").text = warehouse
            sess.findById("wnd[1]/usr/ctxtRMMG1-LGTYP").text = org_storage_type
            try:
                sess.findById("wnd[1]/usr/chkUSRM1-ASCHL").setFocus()
            except Exception:
                pass
            sess.findById("wnd[1]").sendVKey(0)
            wait_for_session(sess, 20)
            return classify_sbar(sess)

        def _set_fields(sess: Any) -> bool:
            try:
                sess.findById(wm1_tab_id).select()
                wait_for_session(sess, 10)
            except Exception:
                return False
            ltkza = _find_field(sess, ltkza_id, "/ctxtMLGN-LTKZA")
            ltkze = _find_field(sess, ltkze_id, "/ctxtMLGN-LTKZE")
            if ltkza is None and ltkze is None:
                return False
            if ltkza is not None:
                ltkza.text = removal_storage_type
            if ltkze is not None:
                ltkze.text = placement_storage_type
            return True

        def _save(sess: Any) -> tuple[str, str]:
            sess.findById("wnd[0]/tbar[0]/btn[11]").press()
            wait_for_session(sess, 30)
            for _ in range(3):
                try:
                    sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
                    wait_for_session(sess, 5)
                except Exception:
                    try:
                        sess.findById("wnd[1]").sendVKey(0)
                        wait_for_session(sess, 5)
                    except Exception:
                        break
            return ack_save_warnings(sess)

        try:
            sbar, msg_type = await slot.run_on_com(_initial)
        except Exception as e:
            return {"ok": False, "error": str(e), "step": "initial_screen"}
        sbar_lower = sbar.lower()
        if msg_type in ("E", "A") or any(
            err in sbar_lower
            for err in ("does not exist", "not found", "no authorization", "is locked")
        ):
            return {"ok": False, "error": sbar, "step": "initial_screen"}

        try:
            sbar, msg_type = await slot.run_on_com(_confirm_org_levels)
        except Exception as e:
            return {"ok": False, "error": str(e), "step": "org_levels_popup"}
        if msg_type in ("E", "A"):
            return {"ok": False, "error": sbar, "step": "org_levels_popup"}

        try:
            ok = await slot.run_on_com(_set_fields)
        except Exception as e:
            return {"ok": False, "error": str(e), "step": "fields"}
        if not ok:
            return {
                "ok": False,
                "error": (
                    "Could not locate WM1 storage-type fields. "
                    "Material may not have this view extended."
                ),
                "step": "field_lookup",
            }

        try:
            sbar, msg_type = await slot.run_on_com(_save)
        except Exception as e:
            return {"ok": False, "error": str(e), "step": "save"}

        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="MM02",
                                 action="material_master_storage_types", status="error",
                                 message=f"WH:{warehouse} | save | {sbar}",
                                 delivery_id=material)
            return {"ok": False, "error": sbar, "step": "save"}

        if msg_type == "S" or any(
            w in sbar_lower for w in ("changed", "saved", "updated", "modified")
        ):
            removal_label = "(cleared)" if clearing_removal else removal_storage_type
            placement_label = "(cleared)" if clearing_placement else placement_storage_type
            await emit_audit_log(
                notify, slot_id=slot.slot_id,
                transaction_code="MM02",
                action="material_master_storage_types", status="success",
                message=(f"WH:{warehouse} Plant:{plant} "
                         f"Removal(LTKZA):{removal_label} Placement(LTKZE):{placement_label} | {sbar}"),
                delivery_id=material,
            )
            return {
                "ok": True,
                "message": sbar or (
                    f"{material} → removal={removal_label} placement={placement_label}"
                ),
                "material": material,
                "removal_storage_type": removal_storage_type,
                "placement_storage_type": placement_storage_type,
            }

        return {
            "ok": False,
            "error": sbar or "MM02 returned no confirmation message",
            "warning": True,
        }


def register(dispatcher) -> None:
    dispatcher.register("sap.materialMasterBin",          handle_material_master_bin)
    dispatcher.register("sap.materialMasterStorageTypes", handle_material_master_storage_types)

# Created and developed by Jai Singh
