# Created and developed by Jai Singh
"""Connect runtime state and pure UI/supervisor decision helpers."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from omni_agent.connect.system_label import SystemLabelCache

from omni_agent.connect.theme import (
    PILL_CONNECTED,
    PILL_CONNECTING,
    PILL_DEGRADED,
    PILL_DISCONNECTED,
)

PAUSED_PILL_COLOR = PILL_CONNECTING  # amber-500
PAUSED_SUBTITLE_PREFIX = "[Paused]"

CIRCUIT_BREAKER_MAX_RESPAWNS = 5
CIRCUIT_BREAKER_WINDOW_NS = 60 * 1_000_000_000
FAILURES_FOR_RESPAWN = 3
PROBE_INTERVAL_S = 5.0
HEALTH_TIMEOUT_S = 2.0
WORKER_PORT = 8765


class ConnectPillState(str, Enum):
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    RESET_NEEDED = "reset_needed"
    PAUSED = "paused"


@dataclass
class ConnectState:
    """Mutable Connect widget + supervisor snapshot."""

    pill: ConnectPillState = ConnectPillState.CONNECTING
    consecutive_failures: int = 0
    last_health: Optional[dict[str, Any]] = None
    last_health_at: Optional[float] = None
    user_label: str = "—"
    sap_system_label: str = "—"
    restarts_in_window: list[int] = field(default_factory=list)
    circuit_breaker_tripped: bool = False
    paused: bool = False
    worker_pid: Optional[int] = None
    subtitle_hint: str = ""


def should_circuit_break(timestamps_ns: list[int], now_ns: int) -> bool:
    """True when ``CIRCUIT_BREAKER_MAX_RESPAWNS`` restarts fall within 60 s."""
    cutoff = now_ns - CIRCUIT_BREAKER_WINDOW_NS
    recent = [ts for ts in timestamps_ns if ts >= cutoff]
    return len(recent) >= CIRCUIT_BREAKER_MAX_RESPAWNS


def record_restart(timestamps_ns: list[int], now_ns: int) -> list[int]:
    """Append a restart timestamp and prune entries outside the 60 s window."""
    cutoff = now_ns - CIRCUIT_BREAKER_WINDOW_NS
    pruned = [ts for ts in timestamps_ns if ts >= cutoff]
    pruned.append(now_ns)
    return pruned


def format_state_label(pill: ConnectPillState) -> str:
    """Human-readable top-row state label."""
    mapping = {
        ConnectPillState.CONNECTING: "Connecting…",
        ConnectPillState.CONNECTED: "Connected",
        ConnectPillState.RECONNECTING: "Reconnecting…",
        ConnectPillState.RESET_NEEDED: "Reset needed",
        ConnectPillState.PAUSED: "Paused",
    }
    return mapping[pill]


def is_paused_state(state: ConnectState) -> bool:
    """True when supervisor has paused the worker."""
    return state.paused or state.pill == ConnectPillState.PAUSED


def compute_pill_color(pill: ConnectPillState) -> str:
    """Map pill state to hex colour token."""
    mapping = {
        ConnectPillState.CONNECTED: PILL_CONNECTED,
        ConnectPillState.CONNECTING: PILL_CONNECTING,
        ConnectPillState.RECONNECTING: PILL_DEGRADED,
        ConnectPillState.RESET_NEEDED: PILL_DISCONNECTED,
        ConnectPillState.PAUSED: PAUSED_PILL_COLOR,
    }
    return mapping[pill]


def resolve_subtitle_hint(
    state: ConnectState,
    *,
    diagnostic_hint: str = "",
    probe_hint: str = "",
) -> str:
    """Single priority resolver for the widget hint row.

    Priority (top wins):
    1. Paused
    2. Crash-loop / circuit breaker
    3. Diagnostic persistent hint
    4. Probe-driven hint (explicit subtitle_hint or probe_hint)
    """
    if is_paused_state(state):
        return "Tap Resume to start."
    if state.circuit_breaker_tripped or state.pill == ConnectPillState.RESET_NEEDED:
        return state.subtitle_hint or "Tap Restart to try again."
    if diagnostic_hint:
        return diagnostic_hint
    if state.subtitle_hint:
        return state.subtitle_hint
    if probe_hint:
        return probe_hint
    return ""


def format_subtitle(user: str, sap_system: str, transaction: str = "—") -> str:
    """Middle-row muted text: ``<user> · <system> · <transaction>``."""
    user = user or "—"
    sap_system = sap_system or "—"
    transaction = transaction or "—"
    if transaction != "—":
        return f"{user} · {sap_system} · {transaction}"
    return f"{user} · {sap_system}"


def parse_health_subtitle(
    body: dict[str, Any],
    system_label_cache: Optional["SystemLabelCache"] = None,
) -> tuple[str, str, str]:
    """Extract subtitle parts from ``/health`` plus optional session cache."""
    citrix = body.get("citrix") or {}
    user = str(citrix.get("user_name") or "").strip() or "—"
    system = "—"
    transaction = "—"
    if system_label_cache is not None:
        user, system, transaction = system_label_cache.as_subtitle_parts()
        if user == "—":
            user = str(citrix.get("user_name") or "").strip() or "—"
    elif bool(body.get("sap_attached", body.get("sap_connected"))):
        system = "SAP"
    return user, system, transaction


def format_health_subtitle(
    state: ConnectState,
    system_label_cache: Optional["SystemLabelCache"] = None,
) -> str:
    """Render the widget middle row from state + optional SAP session cache."""
    if system_label_cache is not None:
        user, system, transaction = system_label_cache.as_subtitle_parts()
        if user == "—":
            user = state.user_label
        return format_subtitle(user, system, transaction)
    return format_subtitle(state.user_label, state.sap_system_label)


def apply_health_success(state: ConnectState, body: dict[str, Any]) -> ConnectState:
    """Return updated state after a successful health probe."""
    user, sap_system, _tx = parse_health_subtitle(body)
    pill = ConnectPillState.PAUSED if state.paused else ConnectPillState.CONNECTED
    return ConnectState(
        pill=pill,
        consecutive_failures=0,
        last_health=body,
        last_health_at=time.time(),
        user_label=user,
        sap_system_label=sap_system,
        restarts_in_window=list(state.restarts_in_window),
        circuit_breaker_tripped=state.circuit_breaker_tripped,
        paused=state.paused,
        worker_pid=state.worker_pid,
        subtitle_hint=state.subtitle_hint,
    )


def apply_health_failure(
    state: ConnectState,
    *,
    failures: int,
    process_alive: bool,
) -> ConnectState:
    """Return updated state after a failed health probe."""
    if state.paused:
        return state
    if state.circuit_breaker_tripped:
        return ConnectState(
            pill=ConnectPillState.RESET_NEEDED,
            consecutive_failures=failures,
            last_health=state.last_health,
            last_health_at=state.last_health_at,
            user_label=state.user_label,
            sap_system_label=state.sap_system_label,
            restarts_in_window=list(state.restarts_in_window),
            circuit_breaker_tripped=True,
            paused=False,
            worker_pid=state.worker_pid,
            subtitle_hint="Tap Restart to try again",
        )
    if failures >= FAILURES_FOR_RESPAWN:
        pill = ConnectPillState.RECONNECTING
    elif failures > 0:
        pill = ConnectPillState.CONNECTING
    else:
        pill = state.pill
    if not process_alive and failures >= FAILURES_FOR_RESPAWN:
        pill = ConnectPillState.RECONNECTING
    return ConnectState(
        pill=pill,
        consecutive_failures=failures,
        last_health=state.last_health,
        last_health_at=state.last_health_at,
        user_label=state.user_label,
        sap_system_label=state.sap_system_label,
        restarts_in_window=list(state.restarts_in_window),
        circuit_breaker_tripped=state.circuit_breaker_tripped,
        paused=state.paused,
        worker_pid=state.worker_pid,
        subtitle_hint=state.subtitle_hint,
    )


def trip_circuit_breaker(state: ConnectState) -> ConnectState:
    """Flip to reset-needed after crash-loop detection."""
    return ConnectState(
        pill=ConnectPillState.RESET_NEEDED,
        consecutive_failures=state.consecutive_failures,
        last_health=state.last_health,
        last_health_at=state.last_health_at,
        user_label=state.user_label,
        sap_system_label=state.sap_system_label,
        restarts_in_window=list(state.restarts_in_window),
        circuit_breaker_tripped=True,
        paused=False,
        worker_pid=state.worker_pid,
        subtitle_hint="Tap Restart to try again",
    )


def reset_circuit_breaker(state: ConnectState) -> ConnectState:
    """Clear crash-loop breaker (Restart menu action)."""
    return ConnectState(
        pill=ConnectPillState.CONNECTING,
        consecutive_failures=0,
        last_health=state.last_health,
        last_health_at=state.last_health_at,
        user_label=state.user_label,
        sap_system_label=state.sap_system_label,
        restarts_in_window=[],
        circuit_breaker_tripped=False,
        paused=False,
        worker_pid=state.worker_pid,
        subtitle_hint="",
    )

# Created and developed by Jai Singh
