# Created and developed by Jai Singh
"""
MM03 — Read-only material master navigators (Phase D #11 — diff preview).

JSON-RPC methods:
  - sap.materialMasterReadBin           (read MLGT-LGPLA on WM2)
  - sap.materialMasterReadStorageTypes  (read MLGN-LTKZA / MLGN-LTKZE on WM1)

Near-verbatim port of `omni_agent/material_master_read.py`. The upstream
module already has clean helpers (`_open_mm03_for_material`,
`_press_org_levels`, `_confirm_org_levels`, `_find_field_text`,
`_exit_to_main`); we copy them with minimal adaptation for the new
session-handle plumbing.

These two methods are READ-ONLY: they navigate via /nMM03 (display, not
change) and never press btn[11]. Used by the frontend's diff modal so
users can see what an upcoming MM02 mutation would overwrite.
"""

from __future__ import annotations

from typing import Any, Optional

from session_manager import SessionManager

from ._common import (
    classify_sbar,
    emit_audit_log,
    opt_int,
    require_str,
    wait_for_session,
    walk_gui_tree,
    with_retries,
)


# ---------------------------------------------------------------------------
#  Internal helpers (verbatim port from material_master_read.py)
# ---------------------------------------------------------------------------
def _exit_to_main(sess: Any) -> None:
    try:
        sess.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        sess.findById("wnd[0]").sendVKey(0)
        wait_for_session(sess, 5)
    except Exception:
        pass


def _find_field_text(sess: Any, primary_id: str, suffix: str) -> Optional[str]:
    try:
        node = sess.findById(primary_id)
        return str(node.text or "")
    except Exception:
        pass
    nodes: list = []
    try:
        walk_gui_tree(sess.findById("wnd[0]/usr"), nodes)
    except Exception:
        return None
    for nid, ntype, node in nodes:
        if ntype in ("GuiCTextField", "GuiTextField") and nid.endswith(suffix):
            try:
                return str(node.text or "")
            except Exception:
                return None
    return None


def _open_mm03(sess: Any, material: str) -> tuple[bool, Optional[str], Optional[str]]:
    def _open() -> None:
        sess.findById("wnd[0]/tbar[0]/okcd").text = "/nMM03"
        sess.findById("wnd[0]").sendVKey(0)
        wait_for_session(sess, 15)
    try:
        with_retries(_open, label="MM03 open")
    except Exception as e:
        return False, f"Could not open MM03: {e}", "open_mm03"
    try:
        sess.findById("wnd[0]/usr/ctxtRMMG1-MATNR").text = material
    except Exception as e:
        return False, f"Could not set material RMMG1-MATNR: {e}", "initial_screen"
    return True, None, None


def _press_org_levels(sess: Any) -> tuple[bool, Optional[str], Optional[str]]:
    def _press() -> None:
        try:
            sess.findById("wnd[0]/tbar[1]/btn[6]").press()
        except Exception:
            sess.findById("wnd[0]").sendVKey(0)
        wait_for_session(sess, 15)
    try:
        with_retries(_press, label="MM03 org-levels press")
    except Exception as e:
        return False, f"Could not open Org Levels popup: {e}", "org_levels_popup"

    sbar, msg_type = classify_sbar(sess)
    sbar_lower = sbar.lower()
    if msg_type in ("E", "A"):
        return False, sbar or "Material initial screen rejected", "initial_screen"
    for err in ("does not exist", "not found", "no authorization", "is locked"):
        if err in sbar_lower:
            return False, sbar, "initial_screen"
    return True, None, None


def _confirm_org_levels(sess: Any, *, plant: str, warehouse: str,
                        storage_type: str) -> tuple[bool, Optional[str], Optional[str]]:
    try:
        sess.findById("wnd[1]/usr/ctxtRMMG1-WERKS").text = plant
        sess.findById("wnd[1]/usr/ctxtRMMG1-LGNUM").text = warehouse
        sess.findById("wnd[1]/usr/ctxtRMMG1-LGTYP").text = storage_type
    except Exception as e:
        return False, f"Could not fill org-levels popup: {e}", "org_levels_popup"
    try:
        sess.findById("wnd[1]/usr/chkUSRM1-ASCHL").setFocus()
    except Exception:
        pass
    try:
        sess.findById("wnd[1]").sendVKey(0)
        wait_for_session(sess, 20)
    except Exception as e:
        return False, f"Could not confirm Org Levels popup: {e}", "org_levels_popup"
    sbar, msg_type = classify_sbar(sess)
    if msg_type in ("E", "A"):
        return False, sbar or "Org Levels rejected", "org_levels_popup"
    return True, None, None


# ---------------------------------------------------------------------------
#  sap.materialMasterReadBin
# ---------------------------------------------------------------------------
async def handle_read_bin(pool: SessionManager, params: dict, notify) -> dict:
    slot_id = opt_int(params, "slot_id", default=None)
    material = require_str(params, "material")
    plant = require_str(params, "plant")
    warehouse = require_str(params, "warehouse")
    storage_type = require_str(params, "storage_type")

    bin_id = (
        "wnd[0]/usr/tabsTABSPR1/tabpSP22/ssubTABFRA1:SAPLMGMM:2000/"
        "subSUB3:SAPLMGD1:2734/ctxtMLGT-LGPLA"
    )

    async with pool.acquire_slot_for_op(slot_id=slot_id,
                                        op_name="sap.materialMasterReadBin") as slot:

        def _navigate_and_read(sess: Any) -> dict:
            ok, err, step = _open_mm03(sess, material)
            if not ok:
                return {"ok": False, "error": err, "step": step}
            ok, err, step = _press_org_levels(sess)
            if not ok:
                _exit_to_main(sess)
                return {"ok": False, "error": err, "step": step}
            ok, err, step = _confirm_org_levels(
                sess, plant=plant, warehouse=warehouse, storage_type=storage_type,
            )
            if not ok:
                _exit_to_main(sess)
                return {"ok": False, "error": err, "step": step}
            try:
                sess.findById("wnd[0]/usr/tabsTABSPR1/tabpSP22").select()
                wait_for_session(sess, 10)
            except Exception:
                pass
            current_bin = _find_field_text(sess, bin_id, "/ctxtMLGT-LGPLA")
            _exit_to_main(sess)
            return {"ok": True, "current_bin": current_bin}

        try:
            res = await slot.run_on_com(_navigate_and_read)
        except Exception as e:
            return {"ok": False, "material": material, "error": str(e)}

        if not res.get("ok"):
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="MM03",
                                 action="material_master_read_bin",
                                 status="error",
                                 message=f"WH:{warehouse} | {res.get('step')} | {res.get('error')}",
                                 delivery_id=material)
            return {
                "ok": False, "material": material,
                "error": res.get("error"), "step": res.get("step"),
            }

        current_bin = res.get("current_bin")
        if current_bin is None:
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="MM03",
                                 action="material_master_read_bin",
                                 status="warning",
                                 message=f"WH:{warehouse} | WM2 view missing — bin field absent",
                                 delivery_id=material)
            return {
                "ok": True, "material": material, "current_bin": None,
                "warning": "WM2 view not extended for this plant/warehouse/storage-type",
            }

        await emit_audit_log(
            notify, slot_id=slot.slot_id,
            transaction_code="MM03", action="material_master_read_bin",
            status="success",
            message=(f"WH:{warehouse} Plant:{plant} STyp:{storage_type} "
                     f"Bin:{current_bin or '(empty)'}"),
            delivery_id=material,
        )
        return {"ok": True, "material": material, "current_bin": current_bin}


# ---------------------------------------------------------------------------
#  sap.materialMasterReadStorageTypes
# ---------------------------------------------------------------------------
async def handle_read_storage_types(pool: SessionManager, params: dict, notify) -> dict:
    slot_id = opt_int(params, "slot_id", default=None)
    material = require_str(params, "material")
    plant = require_str(params, "plant")
    warehouse = require_str(params, "warehouse")
    org_storage_type = require_str(params, "org_storage_type")

    wm1_tab_id = "wnd[0]/usr/tabsTABSPR1/tabpSP21"
    ltkza_id = (
        "wnd[0]/usr/tabsTABSPR1/tabpSP21/ssubTABFRA1:SAPLMGMM:2000/"
        "subSUB3:SAPLMGD1:2733/ctxtMLGN-LTKZA"
    )
    ltkze_id = (
        "wnd[0]/usr/tabsTABSPR1/tabpSP21/ssubTABFRA1:SAPLMGMM:2000/"
        "subSUB3:SAPLMGD1:2733/ctxtMLGN-LTKZE"
    )

    async with pool.acquire_slot_for_op(slot_id=slot_id,
                                        op_name="sap.materialMasterReadStorageTypes") as slot:

        def _navigate_and_read(sess: Any) -> dict:
            ok, err, step = _open_mm03(sess, material)
            if not ok:
                return {"ok": False, "error": err, "step": step}
            ok, err, step = _press_org_levels(sess)
            if not ok:
                _exit_to_main(sess)
                return {"ok": False, "error": err, "step": step}
            ok, err, step = _confirm_org_levels(
                sess, plant=plant, warehouse=warehouse,
                storage_type=org_storage_type,
            )
            if not ok:
                _exit_to_main(sess)
                return {"ok": False, "error": err, "step": step}

            def _select_wm1() -> None:
                sess.findById(wm1_tab_id).select()
                wait_for_session(sess, 10)
            try:
                with_retries(_select_wm1, label="MM03 WM1 tab select")
            except Exception:
                _exit_to_main(sess)
                return {
                    "ok": True,
                    "current_removal": None,
                    "current_placement": None,
                    "warning": "WM1 view not extended for this plant/warehouse/storage-type",
                }

            removal = _find_field_text(sess, ltkza_id, "/ctxtMLGN-LTKZA")
            placement = _find_field_text(sess, ltkze_id, "/ctxtMLGN-LTKZE")
            _exit_to_main(sess)
            return {
                "ok": True,
                "current_removal": removal,
                "current_placement": placement,
            }

        try:
            res = await slot.run_on_com(_navigate_and_read)
        except Exception as e:
            return {"ok": False, "material": material, "error": str(e)}

        if not res.get("ok"):
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="MM03",
                                 action="material_master_read_storage_types",
                                 status="error",
                                 message=f"WH:{warehouse} | {res.get('step')} | {res.get('error')}",
                                 delivery_id=material)
            return {
                "ok": False, "material": material,
                "error": res.get("error"), "step": res.get("step"),
            }

        await emit_audit_log(
            notify, slot_id=slot.slot_id,
            transaction_code="MM03",
            action="material_master_read_storage_types",
            status="success",
            message=(f"WH:{warehouse} Plant:{plant} "
                     f"Removal(LTKZA):{res.get('current_removal') or '(empty)'} "
                     f"Placement(LTKZE):{res.get('current_placement') or '(empty)'}"),
            delivery_id=material,
        )
        out = {
            "ok": True, "material": material,
            "current_removal": res.get("current_removal"),
            "current_placement": res.get("current_placement"),
        }
        if res.get("warning"):
            out["warning"] = res["warning"]
        return out


def register(dispatcher) -> None:
    dispatcher.register("sap.materialMasterReadBin",          handle_read_bin)
    dispatcher.register("sap.materialMasterReadStorageTypes", handle_read_storage_types)

# Created and developed by Jai Singh
