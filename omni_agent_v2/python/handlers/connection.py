# Created and developed by Jai Singh
"""
Connection / session-pool management handlers.

JSON-RPC methods registered:
  - sap.connect            — bind a slot to a SAP GUI (conn_idx, sess_idx)
  - sap.disconnect         — release a slot's COM ref but keep the thread
  - sap.sessions           — full snapshot of all 6 slots + available SAP fleet
  - sap.session            — manually select a (conn_idx, sess_idx) for a slot
                             (kept for parity with the upstream HTTP route
                             `POST /sap/session`; functionally same as
                             sap.connect with explicit indexes).
  - sap.selectSession      — pin a slot to a session (with optional
                             pin_by_criteria so the binding survives
                             SAP GUI restart-renumber).
  - sap.unpinSession       — clear the pin on a slot.
  - sap.health             — quick liveness probe.
  - sap.fleet              — enumerate every SAP GUI session visible
                             on the host (separate from the 6 helper
                             slots — used by the picker UI).
"""

from __future__ import annotations

from typing import Any

from com_compat import win32com_client
from rpc_protocol import RpcError
from session_manager import SessionManager

from ._common import opt_bool, opt_int, opt_str


# ---------------------------------------------------------------------------
#  Per-slot pin metadata (kept in-memory, mirrored to the Rust shell so
#  the persistence layer can write it to disk if it wants to).
# ---------------------------------------------------------------------------
_PIN_STATE: dict[int, dict[str, Any]] = {}  # slot_id -> pin descriptor


def _set_pin(slot_id: int, pin: dict[str, Any]) -> None:
    _PIN_STATE[slot_id] = pin


def _get_pin(slot_id: int) -> dict[str, Any] | None:
    return _PIN_STATE.get(slot_id)


def _clear_pin(slot_id: int) -> None:
    _PIN_STATE.pop(slot_id, None)


# ---------------------------------------------------------------------------
#  Handlers
# ---------------------------------------------------------------------------
async def handle_connect(pool: SessionManager, params: dict, notify) -> dict:
    """Bind a slot to a SAP GUI session.

    Params:
      slot_id   : int — required (0..5)
      conn_idx  : int — optional; if absent we auto-pick a usable session
      sess_idx  : int — optional; if absent we auto-pick a usable session
      label     : str — optional UI label

    Returns the slot snapshot post-connect.
    """
    slot_id = opt_int(params, "slot_id", default=None)
    if slot_id is None:
        raise RpcError.invalid_params("missing `slot_id`")
    conn_idx = opt_int(params, "conn_idx", default=None)
    sess_idx = opt_int(params, "sess_idx", default=None)
    label = opt_str(params, "label") or None

    snap = await pool.connect_slot(
        slot_id=slot_id,
        conn_idx=conn_idx,
        sess_idx=sess_idx,
        label=label,
    )
    return {"ok": True, "slot": snap}


async def handle_disconnect(pool: SessionManager, params: dict, notify) -> dict:
    slot_id = opt_int(params, "slot_id", default=None)
    if slot_id is None:
        raise RpcError.invalid_params("missing `slot_id`")
    snap = await pool.disconnect_slot(slot_id)
    _clear_pin(slot_id)
    return {"ok": True, "slot": snap}


async def handle_sessions(pool: SessionManager, params: dict, notify) -> dict:
    """Return the full pool snapshot — every slot + its current binding.

    Worker C's GUI calls this every ~1s (debounced) to render the
    six-tile session-pool dashboard. Cheap: pure in-memory read.
    """
    snap = pool.snapshot()
    snap["pins"] = {sid: pin for sid, pin in _PIN_STATE.items()}
    return snap


async def handle_session_set(pool: SessionManager, params: dict, notify) -> dict:
    """Manually set a slot's (conn_idx, sess_idx). Mirrors the upstream
    `POST /sap/session` route. Same shape as sap.connect but requires
    explicit indexes."""
    slot_id = opt_int(params, "slot_id", default=None)
    if slot_id is None:
        raise RpcError.invalid_params("missing `slot_id`")
    conn_idx = opt_int(params, "conn_idx", default=None)
    sess_idx = opt_int(params, "sess_idx", default=None)
    if conn_idx is None or sess_idx is None:
        raise RpcError.invalid_params(
            "sap.session requires both `conn_idx` and `sess_idx` "
            "(use sap.connect with no indexes for auto-pick)",
        )
    snap = await pool.connect_slot(slot_id=slot_id,
                                   conn_idx=conn_idx,
                                   sess_idx=sess_idx)
    return {"ok": True, "slot": snap}


async def handle_select_session(pool: SessionManager, params: dict, notify) -> dict:
    """Pin a slot to a specific (conn_idx, sess_idx). Survives helper
    restart by storing the pin in `_PIN_STATE`. The Rust shell mirrors
    this to disk via the `sap.pin.changed` notification we emit."""
    slot_id = opt_int(params, "slot_id", default=None)
    if slot_id is None:
        raise RpcError.invalid_params("missing `slot_id`")
    conn_idx = opt_int(params, "conn_idx", default=None)
    sess_idx = opt_int(params, "sess_idx", default=None)
    if conn_idx is None or sess_idx is None:
        raise RpcError.invalid_params("missing `conn_idx`/`sess_idx`")
    pin_by_criteria = opt_bool(params, "pin_by_criteria", default=True)

    snap = await pool.connect_slot(slot_id=slot_id,
                                   conn_idx=conn_idx,
                                   sess_idx=sess_idx)

    pin: dict[str, Any] = {
        "slot_id": slot_id,
        "conn_idx": conn_idx,
        "sess_idx": sess_idx,
        "pin_by_criteria": pin_by_criteria,
        "system": snap.get("system"),
        "client": snap.get("client"),
        "user": snap.get("user"),
    }
    _set_pin(slot_id, pin)
    try:
        await notify("sap.pin.changed", pin)
    except Exception:
        pass
    return {"ok": True, "slot": snap, "pin": pin}


async def handle_unpin_session(pool: SessionManager, params: dict, notify) -> dict:
    slot_id = opt_int(params, "slot_id", default=None)
    if slot_id is None:
        raise RpcError.invalid_params("missing `slot_id`")
    _clear_pin(slot_id)
    try:
        await notify("sap.pin.changed",
                     {"slot_id": slot_id, "pin": None})
    except Exception:
        pass
    return {"ok": True, "slot_id": slot_id, "pin": None}


async def handle_health(pool: SessionManager, params: dict, notify) -> dict:
    """Lightweight readiness check. Returns counts only — never touches COM."""
    snap = pool.snapshot()
    by_state: dict[str, int] = {}
    for s in snap["sessions"]:
        by_state[s["state"]] = by_state.get(s["state"], 0) + 1
    return {
        "ok": True,
        "mock_mode": snap["mock_mode"],
        "num_slots": snap["num_slots"],
        "by_state": by_state,
    }


async def handle_fleet(pool: SessionManager, params: dict, notify) -> dict:
    """Enumerate every SAP GUI connection + session visible on the host.

    Equivalent to the upstream /sap/sessions route's "connections" list,
    but separated from the slot snapshot because in v2 the slot pool
    and the SAP fleet are independent: a slot is bound to a fleet
    session, but you can have more / fewer SAP sessions than slots.

    Implementation note: this is a one-shot enumeration that has to
    happen on a COM thread. We piggy-back on slot 0's COM thread (the
    pool always boots all 6 slots' threads at startup) — even if slot
    0 isn't bound yet, the thread is alive and CoInitialised.
    """
    target_slot = pool.slots[0]
    target_slot.start()  # idempotent

    def _enumerate(_unused: Any) -> list[dict]:
        out: list[dict] = []
        try:
            sap_gui = win32com_client.GetObject("SAPGUI")
            engine = sap_gui.GetScriptingEngine
        except Exception as e:
            raise RuntimeError(f"GetScriptingEngine failed: {e}") from e

        try:
            n_conns = engine.Children.Count
        except Exception:
            return out

        for ci in range(int(n_conns)):
            try:
                conn = engine.Children(ci)
            except Exception:
                continue
            try:
                desc = conn.Description
            except Exception:
                desc = f"Connection {ci}"

            sessions: list[dict] = []
            try:
                n_sess = conn.Children.Count
            except Exception:
                n_sess = 0
            for si in range(int(n_sess)):
                try:
                    sess = conn.Children(si)
                except Exception:
                    continue
                sys_name = client = user = tx = ""
                try:
                    info = sess.Info
                    sys_name = str(info.SystemName or "")
                    client = str(info.Client or "")
                    user = str(info.User or "")
                    tx = str(info.Transaction or "")
                except Exception:
                    pass
                sessions.append({
                    "sess_idx": si,
                    "system": sys_name,
                    "client": client,
                    "user": user,
                    "transaction": tx,
                    "label": f"{sys_name} / {tx}" if sys_name else f"Session {si}",
                })
            out.append({
                "conn_idx": ci,
                "description": str(desc),
                "sessions": sessions,
            })
        return out

    try:
        connections = await target_slot.run_on_com(_enumerate, timeout=15.0)
    except Exception as e:
        return {"ok": False, "error": str(e), "connections": []}
    return {"ok": True, "connections": connections}


# ---------------------------------------------------------------------------
#  Registration
# ---------------------------------------------------------------------------
def register(dispatcher) -> None:
    dispatcher.register("sap.connect",         handle_connect)
    dispatcher.register("sap.disconnect",      handle_disconnect)
    dispatcher.register("sap.sessions",        handle_sessions)
    dispatcher.register("sap.session",         handle_session_set)
    dispatcher.register("sap.selectSession",   handle_select_session)
    dispatcher.register("sap.unpinSession",    handle_unpin_session)
    dispatcher.register("sap.health",          handle_health)
    dispatcher.register("sap.fleet",           handle_fleet)

# Created and developed by Jai Singh
