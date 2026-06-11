# Created and developed by Jai Singh
"""
Shared helpers for handler modules — extracted verbatim (with minimal
adaptation) from `omni_agent/agent.py` so the COM logic stays identical.

Notable changes from the upstream agent.py code:

  - These helpers now run on a slot's COM thread (via
    `slot.run_on_com(...)`), so they receive `sess` explicitly rather
    than reading a module-level singleton.
  - `_log_sap_txn` no longer makes outbound HTTP — Worker A's Rust
    shell handles audit-log persistence via a structured `log`
    notification. We accept the same signature and emit a notification
    via the helper's notify callback (passed in by the handler).
  - `_with_retries`, `_classify_sbar`, `_wait_for_session`, and
    `_walk_gui_tree` are byte-for-byte ports of the upstream behaviour.
"""

from __future__ import annotations

import time
import traceback
from typing import Any, Callable, Iterable, Optional

# ---------------------------------------------------------------------------
#  SAP soft-warning catalog (verbatim port from agent.py:7459)
# ---------------------------------------------------------------------------
SAP_SOFT_WARNINGS: dict[str, dict[str, str]] = {
    "quant still exists":               {"action": "enter",   "log": "info"},
    "quant exists":                     {"action": "enter",   "log": "info"},
    "still exists":                     {"action": "enter",   "log": "info"},
    "last data record":                 {"action": "enter",   "log": "info"},
    "first data record":                {"action": "enter",   "log": "info"},
    "address has been simplified":      {"action": "enter",   "log": "info"},
    "data has been changed":            {"action": "option1", "log": "info"},
    "consignment information":          {"action": "enter",   "log": "info"},
    "no data records found":            {"action": "skip",    "log": "info"},
    "stock category":                   {"action": "enter",   "log": "info"},
    "warehouse activities not allowed": {"action": "skip",    "log": "warning"},
    "values are accepted":              {"action": "enter",   "log": "info"},
}

# Status-bar phrases for two-step LT12 transfers.
TWO_STEP_KEYWORDS = (
    "must be confirmed separately",
    "must be confirmed in two steps",
    "consist of two",
    "withdrawal and material shipment",
    "withdrawal and material putaway",
)

SUCCESS_KEYWORDS = ("confirmed", "saved", "updated", "posted")


# ---------------------------------------------------------------------------
#  Status-bar / wait helpers
# ---------------------------------------------------------------------------
def classify_sbar(sess: Any) -> tuple[str, str]:
    """Return (sbar_text, message_type). message_type is 'S'/'E'/'A'/'W'
    or '' if not exposed."""
    try:
        sbar_text = sess.findById("wnd[0]/sbar").Text or ""
    except Exception:
        sbar_text = ""
    try:
        msg_type = sess.findById("wnd[0]/sbar").MessageType or ""
    except Exception:
        msg_type = ""
    return sbar_text, msg_type


def wait_for_session(sess: Any, timeout_sec: int = 15) -> None:
    """Poll the SAP session for "Busy" until it goes idle (verbatim port
    of agent._wait_for_session). Returns when ready or after timeout."""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            if not sess.Busy:
                return
        except Exception:
            return
        time.sleep(0.05)


def with_retries(
    fn: Callable[[], Any],
    *,
    max_attempts: int = 3,
    backoff: tuple[float, ...] = (0.5, 1.5, 3.0),
    exceptions: tuple[type, ...] = (Exception,),
    label: str = "step",
) -> Any:
    """Verbatim port of agent._with_retries. Retry navigation/read steps
    only — never wrap the actual Save (btn[11])."""
    last_exc: Optional[BaseException] = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except exceptions as e:
            last_exc = e
            if attempt >= max_attempts - 1:
                break
            delay = backoff[attempt] if attempt < len(backoff) else backoff[-1]
            time.sleep(delay)
    assert last_exc is not None
    raise last_exc


def safe_get(obj: Any, attr: str, default: Any = None) -> Any:
    try:
        return getattr(obj, attr)
    except Exception:
        return default


def walk_gui_tree(node: Any, out: list, depth: int = 0,
                  max_depth: int = 12) -> None:
    """Verbatim port of agent._walk_gui_tree.

    Appends `(id, type_name, node)` tuples to `out` for every descendant
    of `node` up to `max_depth`. Used by handlers that need to find a
    control by suffix when the literal long-id path has shifted.
    """
    if depth > max_depth:
        return
    try:
        nid = safe_get(node, "Id", "") or ""
        ntype = safe_get(node, "Type", "") or ""
        if nid:
            out.append((nid, ntype, node))
    except Exception:
        return
    try:
        children = safe_get(node, "Children", None)
        if children is None:
            return
        try:
            count = int(getattr(children, "Count", 0) or 0)
        except Exception:
            return
        for i in range(count):
            try:
                child = children(i)
                walk_gui_tree(child, out, depth + 1, max_depth)
            except Exception:
                continue
    except Exception:
        return


# ---------------------------------------------------------------------------
#  Soft-warning dispatch (port of agent._ack_save_warnings)
# ---------------------------------------------------------------------------
def ack_save_warnings(
    sess: Any,
    *,
    extra_keywords: Iterable[str] = (),
    max_iters: int = 6,
    wait_secs: int = 8,
) -> tuple[str, str]:
    """After pressing Save, dispatch on the soft-warning catalog."""
    extra_rules = {k.lower(): {"action": "enter", "log": "info"}
                   for k in extra_keywords}
    catalog = {**SAP_SOFT_WARNINGS, **extra_rules}

    sbar, msg_type = classify_sbar(sess)
    for _ in range(max_iters):
        if msg_type in ("E", "A", "S"):
            break
        sbar_lower = sbar.lower()
        match_rule = None
        for key, rule in catalog.items():
            if key in sbar_lower:
                match_rule = rule
                break
        if match_rule is None:
            break
        action = match_rule.get("action", "enter")
        if action == "skip":
            break
        try:
            if action == "option1":
                try:
                    sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
                except Exception:
                    sess.findById("wnd[0]").sendVKey(0)
            else:
                sess.findById("wnd[0]").sendVKey(0)
            wait_for_session(sess, wait_secs)
        except Exception:
            break
        sbar, msg_type = classify_sbar(sess)
    return sbar, msg_type


# ---------------------------------------------------------------------------
#  Param validation helpers
# ---------------------------------------------------------------------------
def require_str(params: dict, field: str, *, allow_empty: bool = False) -> str:
    """Pull a string field from params, raising RpcError(INVALID_PARAMS)
    if it's missing / wrong type / empty (when allow_empty=False)."""
    from rpc_protocol import RpcError

    if field not in params:
        raise RpcError.invalid_params(f"missing field `{field}`",
                                      field=field)
    val = params[field]
    if val is None:
        if allow_empty:
            return ""
        raise RpcError.invalid_params(f"`{field}` cannot be null",
                                      field=field)
    if not isinstance(val, (str, int, float)):
        raise RpcError.invalid_params(
            f"`{field}` must be string", field=field,
            received_type=type(val).__name__,
        )
    s = str(val).strip()
    if not s and not allow_empty:
        raise RpcError.invalid_params(f"`{field}` cannot be empty",
                                      field=field)
    return s


def opt_str(params: dict, field: str, default: str = "") -> str:
    val = params.get(field)
    if val is None:
        return default
    return str(val).strip()


def opt_int(params: dict, field: str, default: Optional[int] = None) -> Optional[int]:
    val = params.get(field)
    if val is None:
        return default
    try:
        return int(val)
    except (TypeError, ValueError):
        from rpc_protocol import RpcError
        raise RpcError.invalid_params(f"`{field}` must be integer",
                                      field=field, value=val)


def opt_bool(params: dict, field: str, default: bool = False) -> bool:
    val = params.get(field)
    if val is None:
        return default
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return bool(val)
    if isinstance(val, str):
        return val.strip().lower() in ("true", "1", "yes", "y", "on", "x")
    return bool(val)


# ---------------------------------------------------------------------------
#  Audit / metric notification (replaces agent._log_sap_txn)
# ---------------------------------------------------------------------------
async def emit_audit_log(
    notify: Callable,
    *,
    slot_id: Optional[int],
    transaction_code: str,
    action: str,
    status: str,
    message: str,
    delivery_id: str = "",
) -> None:
    """Emit a structured audit-log notification. Worker A's Rust shell
    persists this to Supabase `sap_audit_log` (or any future audit
    sink). Helpers don't make outbound HTTP themselves."""
    from datetime import datetime, timezone
    try:
        await notify("sap.audit", {
            "slot_id": slot_id,
            "transaction_code": transaction_code,
            "action": action,
            "status": status,
            "message": message[:500],
            "delivery_id": delivery_id or None,
            "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        })
    except Exception:
        pass


async def emit_log(notify: Callable, slot_id: Optional[int],
                   level: str, message: str) -> None:
    """Emit a free-form `log` notification for live console relay."""
    from datetime import datetime, timezone
    try:
        await notify("log", {
            "slot_id": slot_id,
            "level": level,
            "message": message,
            "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        })
    except Exception:
        pass


# ---------------------------------------------------------------------------
#  Boilerplate stub helper (used by intentionally-deferred handlers)
# ---------------------------------------------------------------------------
def stub_response(method: str, params: dict, *,
                  reason: str = "not_yet_extracted") -> dict:
    """Standard payload for a handler that's been wired but not fully
    ported yet. Lets the Rust shell + frontend exercise the dispatch
    path without any COM side-effects."""
    return {
        "ok": False,
        "error": reason,
        "method": method,
        "stub": True,
        "params_received": list(params.keys()),
    }


__all__ = [
    "SAP_SOFT_WARNINGS",
    "TWO_STEP_KEYWORDS",
    "SUCCESS_KEYWORDS",
    "classify_sbar",
    "wait_for_session",
    "with_retries",
    "safe_get",
    "walk_gui_tree",
    "ack_save_warnings",
    "require_str",
    "opt_str",
    "opt_int",
    "opt_bool",
    "emit_audit_log",
    "emit_log",
    "stub_response",
]

# Created and developed by Jai Singh
