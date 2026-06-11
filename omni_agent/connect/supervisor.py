# Created and developed by Jai Singh
"""Watchdog supervisor: spawn one worker, probe, auto-respawn, clean shutdown."""

from __future__ import annotations

import logging
import os
import queue
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import httpx

from omni_agent.connect.child_kill import (
    assign_pid_to_job,
    audit_agent_processes,
    close_job_handle,
    create_windows_job_handle,
    creationflags_for_worker,
    kill_descendants,
)
from omni_agent.connect.probe import HealthProbeLoop
from omni_agent.connect.system_label import SystemLabelCache, fetch_system_label
from omni_agent.connect.state import (
    ConnectPillState,
    ConnectState,
    WORKER_PORT,
    record_restart,
    reset_circuit_breaker,
    should_circuit_break,
    trip_circuit_breaker,
)

LOG = logging.getLogger("omniframe.connect.supervisor")

SHUTDOWN_POST_TIMEOUT_S = 2.0
SHUTDOWN_GRACE_S = 3.0
RESPAWN_QUEUE_TOKEN = object()


@dataclass
class WatchdogSupervisor:
    """Supervise a single ``OmniFrame_Agent.exe`` on port 8765."""

    port: int = WORKER_PORT
    state: ConnectState = field(default_factory=ConnectState)
    state_queue: queue.Queue[ConnectState] = field(
        default_factory=queue.Queue, repr=False
    )
    respawn_queue: queue.Queue[object] = field(
        default_factory=queue.Queue, repr=False
    )
    _popen: Optional[subprocess.Popen[str]] = field(default=None, repr=False)
    _job_handle: Optional[object] = field(default=None, repr=False)
    _probe: Optional[HealthProbeLoop] = field(default=None, repr=False)
    _stdout_thread: Optional[threading.Thread] = field(default=None, repr=False)
    _stderr_thread: Optional[threading.Thread] = field(default=None, repr=False)
    _stop_drain: threading.Event = field(default_factory=threading.Event, repr=False)
    _paused: bool = field(default=False, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _system_label_cache: Optional[SystemLabelCache] = field(default=None, repr=False)
    _previous_pill: ConnectPillState = field(
        default=ConnectPillState.CONNECTING, repr=False
    )
    pill_intent_queue: queue.Queue[ConnectPillState] = field(
        default_factory=queue.Queue, repr=False
    )

    @property
    def system_label_cache(self) -> Optional[SystemLabelCache]:
        return self._system_label_cache

    def resolve_agent_exe(self) -> Path:
        if getattr(sys, "frozen", False):
            base = Path(sys.executable).parent
        else:
            base = Path(__file__).resolve().parents[1]
        return base / "OmniFrame_Agent.exe"

    def build_env(self) -> dict[str, str]:
        """Legacy soft-fallback worker env (no service-key requirement)."""
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8:replace"
        env["OMNIFRAME_AGENT_PORT"] = str(self.port)
        return env

    def _stream_drain(
        self,
        stream,
        label: str,
    ) -> None:
        if stream is None:
            return
        while not self._stop_drain.is_set():
            line = stream.readline()
            if not line:
                break
            LOG.debug("worker %s: %s", label, line.rstrip())

    def _start_stream_drainers(self, popen: subprocess.Popen[str]) -> None:
        self._stop_drain.clear()
        self._stdout_thread = threading.Thread(
            target=self._stream_drain,
            args=(popen.stdout, "stdout"),
            daemon=True,
            name="connect-worker-stdout",
        )
        self._stderr_thread = threading.Thread(
            target=self._stream_drain,
            args=(popen.stderr, "stderr"),
            daemon=True,
            name="connect-worker-stderr",
        )
        self._stdout_thread.start()
        self._stderr_thread.start()

    def _stop_stream_drainers(self) -> None:
        self._stop_drain.set()
        for thread in (self._stdout_thread, self._stderr_thread):
            if thread and thread.is_alive():
                thread.join(timeout=1.0)
        self._stdout_thread = None
        self._stderr_thread = None

    def spawn_worker(self) -> None:
        """Spawn worker subprocess with Job Object assignment on Windows."""
        with self._lock:
            exe = self.resolve_agent_exe()
            env = self.build_env()
            LOG.info("[OK] Spawning worker -> %s port=%s", exe, self.port)
            popen = subprocess.Popen(
                [str(exe)],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=1,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=creationflags_for_worker(),
            )
            self._popen = popen
            self._job_handle = create_windows_job_handle()
            if popen.pid and self._job_handle is not None:
                assign_pid_to_job(self._job_handle, popen.pid)
            self._start_stream_drainers(popen)
            prior_pill = self.state.pill
            self.state = ConnectState(
                pill=ConnectPillState.CONNECTING,
                worker_pid=popen.pid,
                restarts_in_window=list(self.state.restarts_in_window),
                circuit_breaker_tripped=self.state.circuit_breaker_tripped,
                paused=self._paused,
            )
            self._emit_pill_intent(ConnectPillState.CONNECTING, prior=prior_pill)
            self.state_queue.put(self.state)

    def is_process_alive(self) -> bool:
        if self._popen is None:
            return False
        return self._popen.poll() is None

    def is_paused(self) -> bool:
        return self._paused

    def _post_shutdown(self) -> None:
        url = f"http://127.0.0.1:{self.port}/shutdown"
        try:
            httpx.post(url, timeout=SHUTDOWN_POST_TIMEOUT_S)
            LOG.info("[OK] POST /shutdown sent")
        except Exception as exc:
            LOG.debug("[ERR] POST /shutdown failed -> %s", exc)

    def kill_worker(self, *, audit: bool = True) -> list[dict[str, str]]:
        """Graceful shutdown ladder then kill descendants."""
        with self._lock:
            self._post_shutdown()
            time.sleep(SHUTDOWN_GRACE_S)
            killed: list[dict[str, str]] = []
            pid = self._popen.pid if self._popen else None
            if pid:
                killed = kill_descendants(
                    pid, job_handle=self._job_handle, audit=audit
                )
            elif self._job_handle is not None:
                close_job_handle(self._job_handle)
            self._job_handle = None
            if self._popen is not None:
                try:
                    if self._popen.poll() is None:
                        self._popen.terminate()
                        self._popen.wait(timeout=2.0)
                except subprocess.TimeoutExpired:
                    self._popen.kill()
                self._popen = None
            self._stop_stream_drainers()
            if audit:
                survivors = audit_agent_processes()
                if survivors:
                    LOG.warning(
                        "[ERR] shutdown audit survivors=%s",
                        survivors,
                    )
                else:
                    LOG.info("[OK] shutdown audit no agent survivors")
            self.state = ConnectState(
                pill=self.state.pill,
                worker_pid=None,
                restarts_in_window=list(self.state.restarts_in_window),
                circuit_breaker_tripped=self.state.circuit_breaker_tripped,
                paused=self._paused,
                user_label=self.state.user_label,
                sap_system_label=self.state.sap_system_label,
            )
            return killed

    def _maybe_trip_breaker(self) -> bool:
        now_ns = time.time_ns()
        restarts = record_restart(self.state.restarts_in_window, now_ns)
        self.state.restarts_in_window = restarts
        if should_circuit_break(restarts, now_ns):
            self.state = trip_circuit_breaker(self.state)
            self.state_queue.put(self.state)
            LOG.warning("[ERR] crash-loop circuit breaker tripped")
            return True
        return False

    def respawn_worker(self) -> None:
        """Kill and respawn unless circuit breaker is active."""
        if self.state.circuit_breaker_tripped:
            LOG.info("[OK] respawn skipped -> circuit breaker active")
            return
        if self._maybe_trip_breaker():
            return
        LOG.info("[OK] respawn worker")
        self.kill_worker(audit=False)
        self.spawn_worker()
        self.respawn_queue.put(RESPAWN_QUEUE_TOKEN)

    def start(self) -> None:
        """Spawn worker and start probe loop."""
        if not self.is_process_alive():
            self.spawn_worker()
        self._probe = HealthProbeLoop(
            self.state_queue,
            port=self.port,
            is_process_alive=self.is_process_alive,
            is_paused=self.is_paused,
            is_circuit_breaker_tripped=lambda: self.state.circuit_breaker_tripped,
        )
        self._probe.start()

    def stop(self) -> None:
        """Stop probe loop and kill worker."""
        if self._probe:
            self._probe.stop()
            self._probe = None
        self.kill_worker()

    def pause(self) -> None:
        """Stop probe loop and gracefully stop worker."""
        self._paused = True
        if self._probe:
            self._probe.stop()
            self._probe = None
        self._post_shutdown()
        self.kill_worker(audit=False)
        prior_pill = self.state.pill
        self.state = ConnectState(
            pill=ConnectPillState.PAUSED,
            paused=True,
            worker_pid=None,
            user_label=self.state.user_label,
            sap_system_label=self.state.sap_system_label,
            restarts_in_window=list(self.state.restarts_in_window),
            circuit_breaker_tripped=self.state.circuit_breaker_tripped,
        )
        self._emit_pill_intent(ConnectPillState.PAUSED, prior=prior_pill)
        self.state_queue.put(self.state)
        LOG.info("[OK] paused")

    def resume(self) -> None:
        """Respawn worker and restart probe loop."""
        self._paused = False
        prior_pill = self.state.pill
        self.state = reset_circuit_breaker(self.state)
        self.spawn_worker()
        self._probe = HealthProbeLoop(
            self.state_queue,
            port=self.port,
            is_process_alive=self.is_process_alive,
            is_paused=self.is_paused,
            is_circuit_breaker_tripped=lambda: self.state.circuit_breaker_tripped,
        )
        self._emit_pill_intent(self.state.pill, prior=prior_pill)
        self._probe.start()
        LOG.info("[OK] resumed")

    def restart(self) -> None:
        """Manual restart — resets circuit breaker."""
        prior_pill = self.state.pill
        self.state = reset_circuit_breaker(self.state)
        self.state_queue.put(self.state)
        if self._probe:
            self._probe.stop()
            self._probe = None
        self.kill_worker(audit=False)
        self.spawn_worker()
        self._probe = HealthProbeLoop(
            self.state_queue,
            port=self.port,
            is_process_alive=self.is_process_alive,
            is_paused=self.is_paused,
            is_circuit_breaker_tripped=lambda: self.state.circuit_breaker_tripped,
        )
        self._emit_pill_intent(self.state.pill, prior=prior_pill)
        self._probe.start()
        LOG.info("[OK] manual restart")

    def _maybe_refresh_system_label(self, new_state: ConnectState) -> None:
        """One-shot ``/sap/sessions`` fetch on first green transition."""
        was_connected = self._previous_pill == ConnectPillState.CONNECTED
        is_connected = new_state.pill == ConnectPillState.CONNECTED
        self._previous_pill = new_state.pill
        if not is_connected or was_connected:
            return
        if (
            self._system_label_cache is not None
            and not self._system_label_cache.is_stale()
        ):
            return
        token = os.environ.get("OMNIFRAME_AGENT_ADMIN_TOKEN") or os.environ.get(
            "OMNIFRAME_AGENT_TOKEN"
        )
        label = fetch_system_label(self.port, agent_token=token)
        if label is not None:
            self._system_label_cache = label
            LOG.info(
                "[OK] system label cached user=%s system=%s tx=%s",
                label.user,
                label.system,
                label.transaction,
            )

    def _emit_pill_intent(
        self,
        new_pill: ConnectPillState,
        *,
        prior: Optional[ConnectPillState] = None,
    ) -> None:
        """Notify GUI thread when pill state changes (pulse animation hook)."""
        old = prior if prior is not None else self._previous_pill
        if new_pill != old:
            self.pill_intent_queue.put(new_pill)

    def handle_probe_state(self, new_state: ConnectState) -> None:
        """Apply probe updates; trigger respawn on failure threshold."""
        prior_pill = self._previous_pill
        self._maybe_refresh_system_label(new_state)
        self._emit_pill_intent(new_state.pill, prior=prior_pill)
        should_respawn = (
            new_state.consecutive_failures >= 3
            and not self._paused
            and not new_state.circuit_breaker_tripped
        )
        self.state = new_state
        if should_respawn:
            self.respawn_worker()
            self.state = ConnectState(
                pill=self.state.pill,
                consecutive_failures=0,
                last_health=self.state.last_health,
                last_health_at=self.state.last_health_at,
                user_label=self.state.user_label,
                sap_system_label=self.state.sap_system_label,
                restarts_in_window=list(self.state.restarts_in_window),
                circuit_breaker_tripped=self.state.circuit_breaker_tripped,
                paused=self._paused,
                worker_pid=self.state.worker_pid,
                subtitle_hint=self.state.subtitle_hint,
            )

    def shutdown_connect(self) -> None:
        """Full clean shutdown for Quit / WM_DELETE_WINDOW."""
        LOG.info("[OK] connect shutdown begin")
        if self._probe:
            self._probe.stop()
            self._probe = None
        self.kill_worker()
        LOG.info("[OK] connect shutdown complete")

# Created and developed by Jai Singh
