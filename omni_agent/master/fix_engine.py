# Created and developed by Jai Singh
"""Pure fix-action decision tree (Plan Section 5, Phase D1).

No I/O — snapshots in, ``FixAction`` out. Master GUI/supervisor execute actions.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Mapping, Optional, Protocol, Sequence

_HTTP_FAILS_FOR_KILL = 3
_WS_DOWN_KILL_SECONDS = 60.0
_STALE_JOB_AGE_SECONDS = 300
_STALE_JOB_PROGRESS_SECONDS = 60
SAP_BANNER_WINDOW_S = 5.0
SAP_BANNER_SUPPRESS_SECONDS = 60.0


class FixAction(str, Enum):
    """One-click Fix outcomes (modes A–H + healthy toast)."""

    RESPAWN = "respawn"
    KILL_AND_RESPAWN = "kill_and_respawn"
    WS_RECONNECT = "ws_reconnect"
    SAP_REATTACH = "sap_reattach"
    REASSIGN_SESSION = "reassign_session"
    REREGISTER_KEY = "reregister_key"
    ABORT_STALE_JOB = "abort_stale_job"
    SHOW_NETWORK_DIAGNOSTIC = "show_network_diagnostic"
    SHOW_HEALTHY_TOAST = "show_healthy_toast"


@dataclass(frozen=True)
class HealthSnapshot:
    """Immutable probe view for the Section 5 decision tree."""

    process_alive: bool
    http_fails: int
    ws_connected: bool
    ws_down_seconds: float
    sap_attached: bool
    identity_status: str
    worker_id: str = ""
    last_sap_error: Optional[str] = None
    job_age_seconds: Optional[int] = None
    job_progress_unchanged_seconds: Optional[int] = None
    last_reconnect_reason: Optional[str] = None
    in_flight_job: str = "idle"


@dataclass
class MasterFixContext:
    """Master-wide flags that affect per-tile fix routing."""

    all_workers_ws_down: bool = False
    sap_restart_banner_active: bool = False


class WorkerBannerView(Protocol):
    process_alive: bool
    sap_attached: bool


_ADMIN_CONFIRM_ACTIONS = frozenset(
    {
        FixAction.RESPAWN,
        FixAction.KILL_AND_RESPAWN,
        FixAction.SAP_REATTACH,
        FixAction.REASSIGN_SESSION,
    }
)


def pick_fix_action(
    snapshot: HealthSnapshot,
    ctx: MasterFixContext,
) -> FixAction:
    """Section 5 decision tree — first matching branch wins."""

    if not snapshot.process_alive:
        return FixAction.RESPAWN
    if snapshot.http_fails >= _HTTP_FAILS_FOR_KILL:
        return FixAction.KILL_AND_RESPAWN
    if ctx.all_workers_ws_down:
        return FixAction.SHOW_NETWORK_DIAGNOSTIC
    if snapshot.identity_status == "rejected":
        return FixAction.REREGISTER_KEY
    if not snapshot.sap_attached:
        if snapshot.last_sap_error == "session_index_invalid":
            return FixAction.REASSIGN_SESSION
        return FixAction.SAP_REATTACH
    if not snapshot.ws_connected:
        if snapshot.ws_down_seconds < _WS_DOWN_KILL_SECONDS:
            return FixAction.WS_RECONNECT
        return FixAction.KILL_AND_RESPAWN
    if _is_stale_job(snapshot):
        return FixAction.ABORT_STALE_JOB
    return FixAction.SHOW_HEALTHY_TOAST


def requires_admin_confirm(
    action: FixAction,
    snapshot: HealthSnapshot,
    fix_admin_confirm_required: bool,
) -> bool:
    """Admin gating (Section 5): destructive fixes while a job is in flight."""

    if not fix_admin_confirm_required:
        return False
    if snapshot.job_age_seconds is None:
        return False
    if action in (FixAction.WS_RECONNECT, FixAction.ABORT_STALE_JOB):
        return False
    return action in _ADMIN_CONFIRM_ACTIONS


def is_sap_recovery_action(action: FixAction) -> bool:
    return action in (FixAction.SAP_REATTACH, FixAction.REASSIGN_SESSION)


def should_suppress_sap_fix_toast(now: float, suppress_until: float) -> bool:
    """True for 60s after SAP-restart banner triggers (modes D/E soft toast)."""
    return suppress_until > 0 and now < suppress_until


def all_workers_ws_down(workers: Mapping[str, object]) -> bool:
    """Mode H — every alive worker reports ``ws_connected=false``."""
    running = [
        w for w in workers.values() if bool(getattr(w, "process_alive", False))
    ]
    if not running:
        return False
    return all(not bool(getattr(w, "ws_connected", False)) for w in running)


def detect_sap_restart_banner(
    workers: Mapping[str, WorkerBannerView],
    transitions: Sequence[tuple[float, str]],
    now: float,
    *,
    window_s: float = SAP_BANNER_WINDOW_S,
) -> bool:
    """True when all running workers lost SAP and >=2 detached within window."""
    running = [w for w in workers.values() if w.process_alive]
    if len(running) < 2:
        return False
    if any(w.sap_attached for w in running):
        return False
    recent = sum(1 for ts, _wid in transitions if now - ts <= window_s)
    return recent >= 2


def snapshot_from_runtime(state: object, *, now: float = 0.0) -> HealthSnapshot:
    """Build a fix snapshot from ``WorkerRuntimeState``."""
    return HealthSnapshot(
        process_alive=bool(getattr(state, "process_alive", False)),
        http_fails=int(getattr(state, "consecutive_failures", 0) or 0),
        ws_connected=bool(getattr(state, "ws_connected", False)),
        ws_down_seconds=float(getattr(state, "ws_down_seconds", 0.0) or 0.0),
        sap_attached=bool(getattr(state, "sap_attached", False)),
        identity_status=str(getattr(state, "identity_status", "unknown") or "unknown"),
        worker_id=str(getattr(state, "worker_id", "") or ""),
        last_sap_error=getattr(state, "last_sap_error", None),
        job_age_seconds=getattr(state, "job_age_seconds", None),
        job_progress_unchanged_seconds=getattr(
            state, "job_progress_unchanged_seconds", None
        ),
        last_reconnect_reason=getattr(state, "last_reconnect_reason", None),
        in_flight_job=str(getattr(state, "in_flight_job", "idle") or "idle"),
    )


def _is_stale_job(snapshot: HealthSnapshot) -> bool:
    age = snapshot.job_age_seconds
    progress = snapshot.job_progress_unchanged_seconds
    if age is None or progress is None:
        return False
    return (
        age > _STALE_JOB_AGE_SECONDS
        and progress > _STALE_JOB_PROGRESS_SECONDS
    )

# Created and developed by Jai Singh
