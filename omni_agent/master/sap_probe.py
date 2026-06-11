# Created and developed by Jai Singh
"""Standalone SAP GUI session probe (Plan Section 3, Phase E).

Lazy-imports ``win32com.client`` so ``omni_agent.master`` imports cleanly on macOS/Linux dev hosts.
"""

from __future__ import annotations

import logging
from typing import Any, TypedDict

LOG = logging.getLogger("omniframe.master.sap_probe")

SapProbeError = str  # sapgui_not_running | scripting_disabled | permission_denied | unknown


class SapSessionInfo(TypedDict, total=False):
    conn_idx: int
    sess_idx: int
    system_name: str
    client: str
    user: str
    transaction: str


class SapProbeResult(TypedDict, total=False):
    sessions: list[SapSessionInfo]
    error: SapProbeError
    error_detail: str


def _info_field(info: Any, name: str) -> str:
    val = getattr(info, name, "") or ""
    return val if isinstance(val, str) else str(val)


def _classify_com_error(exc: BaseException) -> tuple[SapProbeError, str]:
    msg = str(exc).lower()
    if "sapgui" in msg or "getobject" in msg or "invalid class string" in msg:
        return "sapgui_not_running", str(exc)
    if "scripting" in msg or "disabled" in msg:
        return "scripting_disabled", str(exc)
    if "access" in msg or "permission" in msg or "denied" in msg:
        return "permission_denied", str(exc)
    return "unknown", str(exc)


def enumerate_scripting_sessions(application: Any) -> list[SapSessionInfo]:
    """Walk ``GetScriptingEngine.Children(c).Children(s).Info`` (unit-testable)."""
    sessions: list[SapSessionInfo] = []
    conn_count = int(application.Children.Count)
    for conn_idx in range(conn_count):
        connection = application.Children(conn_idx)
        sess_count = int(connection.Children.Count)
        for sess_idx in range(sess_count):
            session = connection.Children(sess_idx)
            info = session.Info
            sessions.append(
                {
                    "conn_idx": conn_idx,
                    "sess_idx": sess_idx,
                    "system_name": _info_field(info, "SystemName"),
                    "client": _info_field(info, "Client"),
                    "user": _info_field(info, "User"),
                    "transaction": _info_field(info, "Transaction"),
                }
            )
    return sessions


def probe_sap_sessions() -> SapProbeResult:
    """Enumerate ``SAPGUI.GetScriptingEngine.Children(c).Children(s).Info``.

    Returns ``{"sessions": [...]}`` on success, or ``{"sessions": [], "error": ...}`` on failure.
    """
    try:
        import pythoncom  # type: ignore[import-untyped]

        pythoncom.CoInitialize()
    except Exception:
        pass

    try:
        import win32com.client  # type: ignore[import-untyped]
    except ImportError as exc:
        LOG.debug("win32com unavailable: %s", exc)
        return {
            "sessions": [],
            "error": "sapgui_not_running",
            "error_detail": "win32com not installed (dev host?)",
        }

    try:
        sap_gui = win32com.client.GetObject("SAPGUI")
        application = sap_gui.GetScriptingEngine
        return {"sessions": enumerate_scripting_sessions(application)}
    except Exception as exc:
        code, detail = _classify_com_error(exc)
        LOG.warning("SAP probe failed (%s): %s", code, detail)
        return {"sessions": [], "error": code, "error_detail": detail}


def session_label(sess: SapSessionInfo) -> str:
    """Human-readable dropdown label for a detected session."""
    parts = [
        f"c{sess.get('conn_idx', 0)}",
        f"s{sess.get('sess_idx', 0)}",
    ]
    if sess.get("system_name"):
        parts.append(str(sess["system_name"]))
    if sess.get("user"):
        parts.append(str(sess["user"]))
    if sess.get("transaction"):
        parts.append(str(sess["transaction"]))
    return " — ".join(parts)

# Created and developed by Jai Singh
