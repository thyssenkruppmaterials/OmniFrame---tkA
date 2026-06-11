# Created and developed by Jai Singh
"""Self-diagnostic helpers for OmniFrame Connect launch (warn-only)."""

from __future__ import annotations

import json
import socket
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal, Optional

import httpx

from omni_agent.connect.state import WORKER_PORT

CheckStatus = Literal["ok", "warning", "critical"]
OverallStatus = Literal["all_ok", "warnings", "critical"]

DIAGNOSTIC_STATE_FILENAME = "connect_diagnostic_state.json"
MODAL_SUPPRESS_AFTER_S = 24 * 60 * 60
SAP_LABEL_CACHE_TTL_S = 5 * 60


@dataclass(frozen=True)
class CheckResult:
    """Outcome of a single launch-time environment check."""

    check_id: str
    status: CheckStatus
    message: str


@dataclass
class SelfDiagnosticResult:
    """Aggregate self-diagnostic snapshot for Connect launch."""

    overall: OverallStatus
    checks: list[CheckResult] = field(default_factory=list)
    friendly_summary: str = ""


def _omniframe_home() -> Path:
    import os

    profile = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    return Path(profile) / ".omniframe"


def diagnostic_state_path() -> Path:
    return _omniframe_home() / DIAGNOSTIC_STATE_FILENAME


def check_port_free(
    port: int = WORKER_PORT,
    *,
    connect_fn: Callable[..., Any] = socket.create_connection,
) -> CheckResult:
    """Port should be free before the worker binds."""
    try:
        connect_fn(("127.0.0.1", port), timeout=0.5)
        return CheckResult(
            check_id="port_blocked",
            status="critical",
            message="Another OmniFrame agent appears to be running.",
        )
    except OSError:
        return CheckResult(
            check_id="port_free",
            status="ok",
            message="Worker port is available.",
        )


def check_sap_gui(
    *,
    dispatch_fn: Optional[Callable[[str], Any]] = None,
) -> CheckResult:
    """Verify SAP GUI scripting is reachable (Windows-only)."""
    if sys.platform != "win32":
        return CheckResult(
            check_id="sap_unavailable_dev_host",
            status="warning",
            message="SAP GUI check skipped on this platform.",
        )
    if dispatch_fn is None:
        try:
            import win32com.client  # type: ignore[import-untyped]

            dispatch_fn = win32com.client.Dispatch
        except ImportError:
            return CheckResult(
                check_id="sap_unavailable_dev_host",
                status="warning",
                message="SAP GUI check unavailable.",
            )

    try:
        sap_gui = dispatch_fn("SAPGUI")
        engine = sap_gui.GetScriptingEngine
        _ = engine.Children.Count
        return CheckResult(
            check_id="sap_running",
            status="ok",
            message="SAP GUI is running.",
        )
    except Exception as exc:
        msg = str(exc).lower()
        if "scripting" in msg or "disabled" in msg:
            return CheckResult(
                check_id="sap_scripting_disabled",
                status="critical",
                message="SAP scripting is disabled.",
            )
        return CheckResult(
            check_id="sap_not_running",
            status="warning",
            message="SAP GUI is not running.",
        )


def check_web_reachable(
    web_url: str,
    *,
    get_fn: Callable[..., httpx.Response] = httpx.get,
    timeout_s: float = 3.0,
) -> CheckResult:
    """Verify the OmniFrame web app responds."""
    try:
        resp = get_fn(web_url, timeout=timeout_s, follow_redirects=True)
        if 200 <= resp.status_code < 300:
            return CheckResult(
                check_id="web_ok",
                status="ok",
                message="Web app is reachable.",
            )
        return CheckResult(
            check_id="web_unreachable",
            status="warning",
            message="Web app did not respond successfully.",
        )
    except Exception:
        return CheckResult(
            check_id="web_unreachable",
            status="warning",
            message="Web app is unreachable.",
        )


def compute_overall(checks: list[CheckResult]) -> OverallStatus:
    relevant = [c for c in checks if c.check_id != "sap_unavailable_dev_host"]
    if not relevant:
        return "all_ok"
    if all(c.status == "ok" for c in relevant):
        return "all_ok"
    if any(c.status == "critical" for c in relevant):
        return "critical"
    return "warnings"


def build_friendly_summary(result: SelfDiagnosticResult) -> str:
    """Plain-English one-liner for the launch modal."""
    if result.overall == "all_ok":
        return ""
    failing = [c for c in result.checks if c.check_id in set(_failing_check_ids(result))]
    if not failing:
        return ""
    ids = {c.check_id for c in failing}
    if "port_blocked" in ids:
        return (
            "Heads up — another OmniFrame looks like it's already running. "
            "Close it first, then try again."
        )
    if "sap_not_running" in ids or "sap_scripting_disabled" in ids:
        return (
            "Heads up — we couldn't reach SAP yet. Open SAP and OmniFrame "
            "will connect automatically when it's ready."
        )
    if "web_unreachable" in ids:
        return (
            "Heads up — we couldn't reach OmniFrame online. Check your "
            "network or VPN, then try again in a moment."
        )
    return (
        "Heads up — a few things look off. OmniFrame will keep trying "
        "in the background."
    )


def run_self_diagnostic(
    probe_url: str,
    web_url: str,
    *,
    port: int = WORKER_PORT,
    connect_fn: Callable[..., Any] = socket.create_connection,
    dispatch_fn: Optional[Callable[[str], Any]] = None,
    get_fn: Callable[..., httpx.Response] = httpx.get,
) -> SelfDiagnosticResult:
    """Run all launch checks. ``probe_url`` reserved for future worker probes."""
    _ = probe_url
    checks = [
        check_port_free(port, connect_fn=connect_fn),
        check_sap_gui(dispatch_fn=dispatch_fn),
        check_web_reachable(web_url, get_fn=get_fn),
    ]
    overall = compute_overall(checks)
    result = SelfDiagnosticResult(overall=overall, checks=checks)
    result.friendly_summary = build_friendly_summary(result)
    return result


def load_diagnostic_state(path: Optional[Path] = None) -> dict[str, Any]:
    target = path or diagnostic_state_path()
    if not target.exists():
        return {"checks": {}}
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"checks": {}}


def save_diagnostic_state(
    state: dict[str, Any],
    path: Optional[Path] = None,
) -> None:
    target = path or diagnostic_state_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _failing_check_ids(result: SelfDiagnosticResult) -> list[str]:
    ignored = {"sap_unavailable_dev_host", "port_free", "web_ok", "sap_running"}
    return [
        c.check_id
        for c in result.checks
        if c.status != "ok" and c.check_id not in ignored
    ]


def update_diagnostic_state(
    result: SelfDiagnosticResult,
    *,
    now: Optional[float] = None,
    path: Optional[Path] = None,
) -> dict[str, Any]:
    """Record failing checks and return updated persisted state."""
    ts = now if now is not None else time.time()
    state = load_diagnostic_state(path)
    checks_map: dict[str, Any] = state.setdefault("checks", {})
    failing = set(_failing_check_ids(result))
    for check_id, entry in list(checks_map.items()):
        if check_id not in failing:
            checks_map.pop(check_id, None)
    for check_id in failing:
        entry = checks_map.setdefault(check_id, {})
        if not entry.get("last_failed_at"):
            entry["last_failed_at"] = ts
    save_diagnostic_state(state, path)
    return state


def should_show_diagnostic_modal(
    result: SelfDiagnosticResult,
    state: Optional[dict[str, Any]] = None,
    *,
    now: Optional[float] = None,
) -> bool:
    """Show modal when a check failed recently and we have not nagged yet."""
    if result.overall == "all_ok":
        return False
    ts = now if now is not None else time.time()
    persisted = state if state is not None else load_diagnostic_state()
    checks_map: dict[str, Any] = persisted.get("checks") or {}
    for check_id in _failing_check_ids(result):
        entry = checks_map.get(check_id) or {}
        last_failed = float(entry.get("last_failed_at") or 0)
        modal_shown = float(entry.get("modal_shown_at") or 0)
        if ts - last_failed >= MODAL_SUPPRESS_AFTER_S:
            continue
        if modal_shown >= last_failed:
            continue
        return True
    return False


def mark_diagnostic_modal_shown(
    result: SelfDiagnosticResult,
    *,
    now: Optional[float] = None,
    path: Optional[Path] = None,
) -> None:
    ts = now if now is not None else time.time()
    state = load_diagnostic_state(path)
    checks_map: dict[str, Any] = state.setdefault("checks", {})
    for check_id in _failing_check_ids(result):
        entry = checks_map.setdefault(check_id, {})
        entry["modal_shown_at"] = ts
        entry.setdefault("last_failed_at", ts)
    save_diagnostic_state(state, path)


def compute_diagnostic_subtitle_hint(
    result: SelfDiagnosticResult,
    state: Optional[dict[str, Any]] = None,
    *,
    now: Optional[float] = None,
) -> str:
    """Widget hint when failures persist beyond the modal window."""
    if result.overall == "all_ok":
        return ""
    ts = now if now is not None else time.time()
    persisted = state if state is not None else load_diagnostic_state()
    checks_map: dict[str, Any] = persisted.get("checks") or {}
    failing_ids = set(_failing_check_ids(result))
    stale_failures = []
    for check_id in failing_ids:
        entry = checks_map.get(check_id) or {}
        last_failed = float(entry.get("last_failed_at") or 0)
        if last_failed and ts - last_failed >= MODAL_SUPPRESS_AFTER_S:
            stale_failures.append(check_id)
    if not stale_failures:
        return ""
    if any(
        cid in stale_failures
        for cid in ("sap_not_running", "sap_scripting_disabled")
    ):
        return "Open SAP to connect"
    if "web_unreachable" in stale_failures:
        return "Check network or VPN"
    if "port_blocked" in stale_failures:
        return "Close other OmniFrame copies"
    return "Check connection settings"

# Created and developed by Jai Singh
