# Created and developed by Jai Singh
"""Background ``/health`` probe loop for a single worker."""

from __future__ import annotations

import logging
import queue
import threading
from typing import Any, Callable, Optional

import httpx

from omni_agent.connect.state import (
    FAILURES_FOR_RESPAWN,
    HEALTH_TIMEOUT_S,
    PROBE_INTERVAL_S,
    WORKER_PORT,
    ConnectState,
    apply_health_failure,
    apply_health_success,
)

LOG = logging.getLogger("omniframe.connect.probe")


def probe_health_once(
    port: int = WORKER_PORT,
    *,
    client: Optional[httpx.Client] = None,
    timeout_s: float = HEALTH_TIMEOUT_S,
) -> tuple[bool, Optional[dict[str, Any]]]:
    """Single synchronous health probe. Returns (ok, body)."""
    url = f"http://127.0.0.1:{port}/health"
    own_client = client is None
    if own_client:
        client = httpx.Client(timeout=timeout_s)
    try:
        assert client is not None
        resp = client.get(url, timeout=timeout_s)
        if resp.status_code != 200:
            return False, None
        return True, resp.json()
    except Exception as exc:
        LOG.debug("probe failed -> %s", exc)
        return False, None
    finally:
        if own_client and client is not None:
            client.close()


class HealthProbeLoop:
    """Daemon thread probing ``/health`` every ``PROBE_INTERVAL_S``."""

    def __init__(
        self,
        result_queue: queue.Queue[ConnectState],
        *,
        port: int = WORKER_PORT,
        is_process_alive: Callable[[], bool],
        is_paused: Callable[[], bool],
        is_circuit_breaker_tripped: Callable[[], bool],
        client_factory: Optional[Callable[[], httpx.Client]] = None,
        interval_s: float = PROBE_INTERVAL_S,
    ) -> None:
        self._queue = result_queue
        self._port = port
        self._is_process_alive = is_process_alive
        self._is_paused = is_paused
        self._is_circuit_breaker_tripped = is_circuit_breaker_tripped
        self._client_factory = client_factory or (
            lambda: httpx.Client(timeout=HEALTH_TIMEOUT_S)
        )
        self._interval_s = interval_s
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._failures = 0
        self._state = ConnectState()
        self._client: Optional[httpx.Client] = None

    @property
    def consecutive_failures(self) -> int:
        return self._failures

    @property
    def state(self) -> ConnectState:
        return self._state

    def reset_failures(self) -> None:
        self._failures = 0

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._client = self._client_factory()
        self._thread = threading.Thread(
            target=self._run,
            name="connect-health-probe",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=self._interval_s + 2.0)
        self._thread = None
        if self._client:
            self._client.close()
            self._client = None

    def _run(self) -> None:
        while not self._stop.is_set():
            if self._is_paused() or self._is_circuit_breaker_tripped():
                self._stop.wait(self._interval_s)
                continue

            alive = self._is_process_alive()
            ok, body = probe_health_once(
                self._port, client=self._client, timeout_s=HEALTH_TIMEOUT_S
            )
            if ok and body is not None:
                self._failures = 0
                self._state = apply_health_success(self._state, body)
                self._queue.put(self._state)
                LOG.debug("[OK] health probe success")
            else:
                self._failures += 1
                self._state = apply_health_failure(
                    self._state,
                    failures=self._failures,
                    process_alive=alive,
                )
                self._queue.put(self._state)
                LOG.debug(
                    "[ERR] health probe fail count=%s alive=%s",
                    self._failures,
                    alive,
                )
                if self._failures >= FAILURES_FOR_RESPAWN:
                    self._failures = 0

            self._stop.wait(self._interval_s)

# Created and developed by Jai Singh
