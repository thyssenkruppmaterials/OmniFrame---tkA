# Created and developed by Jai Singh
"""
LT12 — Confirm Transfer Order.

JSON-RPC method: `sap.confirmTo`.

This is the single most-trafficked SAP transaction in production
(>99.9% of agent traffic per the 2026-05-07 analytics report). The
COM logic below is a near-verbatim port of
`omni_agent.agent.confirm_transfer_order` (agent.py:7651). The
contract changes from the upstream version are limited to the
session-handle plumbing (slot.run_on_com instead of a thread-local
SAP session) and the audit-log path (notify(...) instead of HTTP
POST to Supabase).

Handles three flavours, decided based on the SAP status bar after
the first Enter following TO/WH entry:

  1. Already-confirmed TO         → idempotent success.
  2. Two-step (withdrawal+shipment)
     TO that requires an extra
     Enter before Save             → send second Enter, then Save.
  3. Normal single-step TO         → just Save.

Request shape (matches Worker A's agent-types::ConfirmToParams):
  {
    "slot_id":   <int>,            # required — which slot to use
    "to_number": <string>,         # required
    "warehouse": <string>,         # required
    "row_id":    <uuid|null>       # optional — trigger meta passthrough
  }

Response shape (success):
  {
    "ok": true,
    "message": "<sap status bar>",
    "to_number": "<echo>",
    "warehouse": "<echo>",
    "already_confirmed": <bool>,
    "two_step": <bool>,
    "ts": "<iso8601>"
  }

Response shape (error):
  {
    "ok": false,
    "error": "<sap error or python exception>",
    "warning": <bool — true when the message was unrecognised>
  }
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from rpc_protocol import RpcError
from session_manager import SessionManager

from ._common import (
    SUCCESS_KEYWORDS,
    TWO_STEP_KEYWORDS,
    classify_sbar,
    emit_audit_log,
    emit_log,
    opt_int,
    opt_str,
    require_str,
    wait_for_session,
    with_retries,
)


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
#  Handler
# ---------------------------------------------------------------------------
async def handle_confirm_to(pool: SessionManager, params: dict, notify) -> dict:
    to_number = require_str(params, "to_number")
    warehouse = require_str(params, "warehouse")
    slot_id = opt_int(params, "slot_id", default=None)
    row_id = opt_str(params, "row_id") or None

    op_name = "sap.confirmTo"

    async with pool.acquire_slot_for_op(slot_id=slot_id,
                                        op_name=op_name) as slot:
        await emit_log(notify, slot.slot_id, "info",
                       f"LT12 confirm TO {to_number} WH {warehouse} starting")

        # ------------------------------------------------------------------
        # All COM steps below run on slot.run_on_com so they execute on
        # the slot's STA thread. We prefer ONE big closure per logical
        # step rather than many round-trips so the SAP screen state
        # doesn't drift between calls.
        # ------------------------------------------------------------------
        def _step1_open_lt12_and_fill(sess: Any) -> tuple[str, str]:
            def _open_lt12() -> None:
                sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLT12"
                sess.findById("wnd[0]").sendVKey(0)
                wait_for_session(sess, 15)
            with_retries(_open_lt12, label="LT12 open")

            def _fill_initial() -> None:
                sess.findById("wnd[0]/usr/txtLTAK-TANUM").text = str(to_number)
                sess.findById("wnd[0]/usr/ctxtLTAK-LGNUM").text = str(warehouse)
                try:
                    sess.findById("wnd[0]/usr/chkRL03T-OFPOS").setFocus()
                except Exception:
                    pass
                sess.findById("wnd[0]").sendVKey(0)
                wait_for_session(sess, 15)
            with_retries(_fill_initial, label="LT12 initial screen")

            return classify_sbar(sess)

        def _step2_two_step_enter(sess: Any) -> tuple[str, str]:
            sess.findById("wnd[0]").sendVKey(0)
            wait_for_session(sess, 15)
            return classify_sbar(sess)

        def _step3_save(sess: Any) -> tuple[str, str]:
            sess.findById("wnd[0]/tbar[0]/btn[11]").press()
            wait_for_session(sess, 15)
            try:
                sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
                wait_for_session(sess, 10)
            except Exception:
                pass
            return classify_sbar(sess)

        try:
            sbar, msg_type = await slot.run_on_com(_step1_open_lt12_and_fill)
        except Exception as e:
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="LT12",
                                 action="confirm_transfer_order",
                                 status="error",
                                 message=f"WH:{warehouse} | step1 | {e}",
                                 delivery_id=to_number)
            return {"ok": False, "error": str(e),
                    "to_number": to_number, "warehouse": warehouse}

        sbar_lower = sbar.lower()

        # Idempotent success — already confirmed.
        for already in ("already confirmed", "already been confirmed",
                        "completely confirmed"):
            if already in sbar_lower:
                await emit_audit_log(
                    notify, slot_id=slot.slot_id,
                    transaction_code="LT12",
                    action="confirm_transfer_order",
                    status="success",
                    message=f"WH:{warehouse} | already-confirmed | {sbar}",
                    delivery_id=to_number,
                )
                return {
                    "ok": True,
                    "message": sbar,
                    "to_number": to_number,
                    "warehouse": warehouse,
                    "already_confirmed": True,
                    "two_step": False,
                    "row_id": row_id,
                    "ts": _utc_iso(),
                }

        # Hard errors → fail fast.
        for err in ("does not exist", "not found", "no authorization",
                    "does not belong", "is locked"):
            if err in sbar_lower:
                await emit_audit_log(
                    notify, slot_id=slot.slot_id,
                    transaction_code="LT12",
                    action="confirm_transfer_order",
                    status="error",
                    message=f"WH:{warehouse} | {sbar}",
                    delivery_id=to_number,
                )
                return {"ok": False, "error": sbar,
                        "to_number": to_number, "warehouse": warehouse}

        # Two-step path: extra Enter before Save.
        two_step = any(k in sbar_lower for k in TWO_STEP_KEYWORDS)
        if two_step:
            try:
                sbar2, msg_type2 = await slot.run_on_com(_step2_two_step_enter)
            except Exception as e:
                await emit_audit_log(
                    notify, slot_id=slot.slot_id,
                    transaction_code="LT12",
                    action="confirm_transfer_order",
                    status="error",
                    message=f"WH:{warehouse} | 2-step second-Enter | {e}",
                    delivery_id=to_number,
                )
                return {"ok": False, "error": str(e),
                        "to_number": to_number, "warehouse": warehouse}

            sbar2_lower = sbar2.lower()
            if msg_type2 in ("E", "A"):
                await emit_audit_log(
                    notify, slot_id=slot.slot_id,
                    transaction_code="LT12",
                    action="confirm_transfer_order",
                    status="error",
                    message=f"WH:{warehouse} | 2-step second-Enter failed | {sbar2}",
                    delivery_id=to_number,
                )
                return {"ok": False, "error": sbar2,
                        "to_number": to_number, "warehouse": warehouse}
            for err in ("does not exist", "not found", "no authorization",
                        "does not belong", "is locked"):
                if err in sbar2_lower:
                    await emit_audit_log(
                        notify, slot_id=slot.slot_id,
                        transaction_code="LT12",
                        action="confirm_transfer_order",
                        status="error",
                        message=f"WH:{warehouse} | {sbar2}",
                        delivery_id=to_number,
                    )
                    return {"ok": False, "error": sbar2,
                            "to_number": to_number, "warehouse": warehouse}

        # Save (commits the confirmation, both steps if applicable).
        try:
            sbar, msg_type = await slot.run_on_com(_step3_save)
        except Exception as e:
            await emit_audit_log(
                notify, slot_id=slot.slot_id,
                transaction_code="LT12",
                action="confirm_transfer_order",
                status="error",
                message=f"WH:{warehouse} | save | {e}",
                delivery_id=to_number,
            )
            return {"ok": False, "error": str(e),
                    "to_number": to_number, "warehouse": warehouse}

        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            await emit_audit_log(
                notify, slot_id=slot.slot_id,
                transaction_code="LT12",
                action="confirm_transfer_order",
                status="error",
                message=f"WH:{warehouse} | {sbar}",
                delivery_id=to_number,
            )
            return {"ok": False, "error": sbar,
                    "to_number": to_number, "warehouse": warehouse}

        if msg_type == "S" or any(w in sbar_lower for w in SUCCESS_KEYWORDS):
            await emit_audit_log(
                notify, slot_id=slot.slot_id,
                transaction_code="LT12",
                action="confirm_transfer_order",
                status="success",
                message=f"WH:{warehouse} | {'2-step | ' if two_step else ''}{sbar}",
                delivery_id=to_number,
            )
            return {
                "ok": True,
                "message": sbar,
                "to_number": to_number,
                "warehouse": warehouse,
                "already_confirmed": False,
                "two_step": two_step,
                "row_id": row_id,
                "ts": _utc_iso(),
            }

        # Unrecognised — surface as warning so the caller doesn't
        # falsely PATCH a not-confirmed TO row.
        await emit_audit_log(
            notify, slot_id=slot.slot_id,
            transaction_code="LT12",
            action="confirm_transfer_order",
            status="warning",
            message=f"WH:{warehouse} | unrecognised: {sbar}",
            delivery_id=to_number,
        )
        return {
            "ok": False,
            "error": sbar or "LT12 returned no confirmation message — TO state unknown",
            "warning": True,
            "to_number": to_number,
            "warehouse": warehouse,
        }


def register(dispatcher) -> None:
    dispatcher.register("sap.confirmTo", handle_confirm_to)

# Created and developed by Jai Singh
