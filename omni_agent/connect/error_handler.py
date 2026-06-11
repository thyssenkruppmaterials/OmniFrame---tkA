# Created and developed by Jai Singh
"""Global GUI-thread exception hook with friendly modal routing."""

from __future__ import annotations

import logging
import sys
from typing import Any, Callable, Optional

LOG = logging.getLogger("omniframe.connect.error_handler")

_prev_hook: Optional[Any] = None
_gui_root: Optional[Any] = None


def classify_exception(exc: BaseException) -> str:
    """Map an unhandled exception to a friendly ``error_kind``."""
    text = f"{type(exc).__name__}: {exc}".lower()
    if isinstance(exc, (ConnectionRefusedError, ConnectionError)):
        return "web_unreachable"
    if isinstance(exc, OSError):
        if "address already in use" in text or "10048" in text:
            return "port_blocked"
        if "10061" in text or "connection refused" in text:
            return "web_unreachable"
    if "sap" in text and ("not running" in text or "getobject" in text):
        return "sap_not_running"
    if "service key" in text or "401" in text or "unauthorized" in text:
        return "service_key_invalid"
    if "spawn" in text or "popen" in text or "subprocess" in text:
        return "worker_spawn_failed"
    if "crash" in text or "circuit" in text:
        return "crash_loop"
    return "unknown"


def install(
    root: Any,
    *,
    show_error: Optional[Callable[..., None]] = None,
) -> None:
    """Register ``sys.excepthook`` to route GUI-thread errors to friendly modals."""
    global _prev_hook, _gui_root
    _gui_root = root
    _prev_hook = sys.excepthook

    def _hook(exc_type, exc, tb) -> None:  # type: ignore[no-untyped-def]
        if exc_type is KeyboardInterrupt:
            if _prev_hook:
                _prev_hook(exc_type, exc, tb)
            return
        kind = classify_exception(exc)
        LOG.exception("[ERR] unhandled GUI error kind=%s", kind, exc_info=(exc_type, exc, tb))
        if show_error is not None:
            show_error(_gui_root, kind)
        elif _gui_root is not None:
            from omni_agent.connect.dialogs import show_friendly_error

            try:
                _gui_root.after(
                    0,
                    lambda: show_friendly_error(_gui_root, kind),
                )
            except Exception:
                LOG.exception("[ERR] failed to schedule friendly error modal")
        elif _prev_hook:
            _prev_hook(exc_type, exc, tb)

    sys.excepthook = _hook

# Created and developed by Jai Singh
