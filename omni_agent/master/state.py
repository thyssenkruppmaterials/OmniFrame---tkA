# Created and developed by Jai Singh
"""Thread-safe master runtime state and per-worker snapshots."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional

from omni_agent.master.fix_engine import HealthSnapshot


class TilePillState(str, Enum):
    """Visual pill state derived from probe + supervisor (Plan Section 4)."""

    STOPPED = "stopped"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    DEGRADED = "degraded"
    DISCONNECTED = "disconnected"


@dataclass
class WorkerRuntimeState:
    """Latest merged view of one worker for tile rendering."""

    worker_id: str
    label: str
    health_port: int
    sap_conn_idx: int
    sap_session_index: int
    pill: TilePillState = TilePillState.STOPPED
    process_alive: bool = False
    http_ok: bool = False
    consecutive_failures: int = 0
    last_probe_at: Optional[float] = None
    last_success_at: Optional[float] = None
    session_info: str = ""
    heartbeat_age_s: Optional[float] = None
    in_flight_job: str = "idle"
    last_error: str = "--"
    # Phase A /health fields
    ws_connected: bool = False
    sap_attached: bool = False
    job_age_seconds: Optional[int] = None
    job_progress_unchanged_seconds: Optional[int] = None
    identity_status: str = "unknown"
    last_sap_error: Optional[str] = None
    agent_version: Optional[str] = None
    pid: Optional[int] = None
    ws_down_seconds: float = 0.0
    ws_down_since: Optional[float] = None
    last_reconnect_reason: Optional[str] = None
    last_action_at: Optional[float] = None
    is_adopted: bool = False
    adopted_pid: Optional[int] = None
    console_available: bool = True

    @property
    def http_fails(self) -> int:
        """Alias for Section 5 ``http_fails`` (probe consecutive miss count)."""
        return self.consecutive_failures

    def to_health_snapshot(self) -> HealthSnapshot:
        """Build a frozen snapshot for ``pick_fix_action`` (Phase D1)."""
        return HealthSnapshot(
            process_alive=self.process_alive,
            http_fails=self.http_fails,
            ws_connected=self.ws_connected,
            ws_down_seconds=self.ws_down_seconds,
            sap_attached=self.sap_attached,
            identity_status=self.identity_status,
            last_sap_error=self.last_sap_error,
            job_age_seconds=self.job_age_seconds,
            job_progress_unchanged_seconds=self.job_progress_unchanged_seconds,
            last_reconnect_reason=self.last_reconnect_reason,
        )

    def format_session_info(self) -> str:
        if self.session_info:
            return self.session_info
        return (
            f"PRD/--/--/conn:{self.sap_conn_idx} "
            f"sess:{self.sap_session_index}"
        )


def is_running(state: WorkerRuntimeState) -> bool:
    """True when the worker process is alive or an orphan was adopted (Phase F)."""
    return bool(state.process_alive or state.is_adopted)


_TILE_ACTIONS = (
    "fix",
    "start",
    "stop",
    "restart",
    "reassign",
    "console",
)


def compute_button_state(state: WorkerRuntimeState) -> dict[str, bool]:
    """Per-tile action enablement (Plan Section 4 — operator disabled-state matrix)."""

    enabled = {action: False for action in _TILE_ACTIONS}
    enabled["fix"] = True

    if not is_running(state):
        enabled["start"] = True
        return enabled

    enabled["stop"] = True
    enabled["restart"] = True
    enabled["reassign"] = True
    if not state.is_adopted and state.console_available:
        enabled["console"] = True
    return enabled


@dataclass
class MasterRuntimeState:
    """Container guarded by `lock` for cross-thread updates."""

    workers: dict[str, WorkerRuntimeState] = field(default_factory=dict)
    master_started_at: float = field(default_factory=time.time)
    using_builtin_defaults: bool = False
    healthy_count: int = 0
    lock: threading.RLock = field(default_factory=threading.RLock)

    def get(self, worker_id: str) -> Optional[WorkerRuntimeState]:
        with self.lock:
            return self.workers.get(worker_id)

    def update_worker(
        self,
        worker_id: str,
        *,
        mutator: Callable[[WorkerRuntimeState], None],
    ) -> None:
        with self.lock:
            w = self.workers.get(worker_id)
            if w is None:
                return
            mutator(w)

    def apply_snapshot(self, worker_id: str, patch: dict[str, Any]) -> None:
        """Apply a probe/supervisor patch dict onto the worker row."""

        def _apply(w: WorkerRuntimeState) -> None:
            for key, value in patch.items():
                if hasattr(w, key):
                    setattr(w, key, value)

        self.update_worker(worker_id, mutator=_apply)

    def recompute_healthy_count(self) -> int:
        with self.lock:
            count = sum(
                1
                for w in self.workers.values()
                if w.pill == TilePillState.CONNECTED
            )
            self.healthy_count = count
            return count

    def drain_snapshots_batch(
        self,
        items: list[tuple[str, dict[str, Any]]],
        handler: Callable[[str, dict[str, Any]], None],
    ) -> int:
        """Deterministic Tk-side application of queued probe updates (tests)."""
        for worker_id, patch in items:
            handler(worker_id, patch)
        return len(items)

# Created and developed by Jai Singh
