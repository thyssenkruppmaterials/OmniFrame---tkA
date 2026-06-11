# Created and developed by Jai Singh
"""Background ``/health`` probe loop — HTTP only on executor threads."""

from __future__ import annotations

import logging
import queue
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional

import httpx

from omni_agent.master.config import MasterConfig, WorkerConfig
from omni_agent.master.state import TilePillState, WorkerRuntimeState

LOG = logging.getLogger("omniframe.master.probe")

HEALTH_TIMEOUT_S = 2.0
FAILURES_FOR_RED = 3


def parse_health_payload(
    worker: WorkerConfig,
    body: dict[str, Any],
    *,
    process_alive: bool = True,
) -> dict[str, Any]:
    """Map Phase A ``/health`` JSON into a tile state patch."""
    ws_ok = bool(body.get("ws_connected"))
    sap_ok = bool(body.get("sap_attached", body.get("sap_connected")))
    identity = str(body.get("identity_status") or "unknown")
    last_sap = body.get("last_sap_error")
    job_age = body.get("job_age_seconds")
    job_stall = body.get("job_progress_unchanged_seconds")

    if job_age is not None:
        in_flight = f"running ({int(job_age)}s)"
    else:
        in_flight = "idle"

    if not sap_ok and last_sap:
        last_err = str(last_sap)
    elif identity == "rejected":
        last_err = "identity rejected"
    else:
        last_err = "--"

    if not process_alive:
        pill = TilePillState.STOPPED
    elif not sap_ok and ws_ok:
        pill = TilePillState.DEGRADED
    elif not ws_ok and sap_ok:
        pill = TilePillState.DEGRADED
    elif ws_ok and sap_ok:
        pill = TilePillState.CONNECTED
    elif ws_ok or sap_ok:
        pill = TilePillState.CONNECTING
    else:
        pill = TilePillState.DISCONNECTED

    session_info = (
        f"PRD/--/--/conn:{worker.sap_conn_idx} "
        f"sess:{worker.sap_session_index}"
    )

    return {
        "pill": pill,
        "process_alive": process_alive,
        "http_ok": True,
        "ws_connected": ws_ok,
        "sap_attached": sap_ok,
        "identity_status": identity,
        "last_sap_error": last_sap,
        "job_age_seconds": job_age,
        "job_progress_unchanged_seconds": job_stall,
        "in_flight_job": in_flight,
        "last_error": last_err,
        "session_info": session_info,
        "agent_version": body.get("version"),
        "last_probe_at": time.time(),
        "last_success_at": time.time(),
        "consecutive_failures": 0,
    }


def failure_patch(
    worker: WorkerConfig,
    *,
    process_alive: bool,
    consecutive_failures: int,
) -> dict[str, Any]:
    pill = (
        TilePillState.DISCONNECTED
        if consecutive_failures >= FAILURES_FOR_RED
        else TilePillState.CONNECTING
    )
    if not process_alive:
        pill = TilePillState.STOPPED
    return {
        "pill": pill,
        "process_alive": process_alive,
        "http_ok": False,
        "consecutive_failures": consecutive_failures,
        "last_probe_at": time.time(),
        "in_flight_job": "idle",
        "last_error": "probe failed",
        "session_info": (
            f"PRD/--/--/conn:{worker.sap_conn_idx} "
            f"sess:{worker.sap_session_index}"
        ),
    }


class HealthProbeLoop:
    """Runs periodic probes and enqueues patches for the Tk drainer."""

    def __init__(
        self,
        cfg: MasterConfig,
        result_queue: queue.Queue[tuple[str, dict[str, Any]]],
        *,
        is_process_alive: Callable[[str], bool],
        client_factory: Optional[Callable[[], httpx.Client]] = None,
    ) -> None:
        self._cfg = cfg
        self._queue = result_queue
        n_workers = min(cfg.master.workers, len(cfg.workers))
        self._workers = cfg.workers[:n_workers]
        pool_size = max(6, n_workers)
        self._executor = ThreadPoolExecutor(
            max_workers=pool_size,
            thread_name_prefix="master-health",
        )
        self._is_process_alive = is_process_alive
        self._client_factory = client_factory or (
            lambda: httpx.Client(timeout=HEALTH_TIMEOUT_S)
        )
        self._fail_counts: dict[str, int] = {w.id: 0 for w in self._workers}
        self._running = False
        self._client: Optional[httpx.Client] = None

    def start(self) -> None:
        self._running = True
        self._client = self._client_factory()

    def stop(self) -> None:
        self._running = False
        self._executor.shutdown(wait=False, cancel_futures=True)
        if self._client:
            self._client.close()
            self._client = None

    def probe_all_now(self) -> None:
        """Immediate round (Refresh Fleet)."""
        for w in self._workers:
            self._executor.submit(self._probe_one, w)

    def schedule_tick(self) -> None:
        if not self._running:
            return
        for w in self._workers:
            self._executor.submit(self._probe_one, w)

    def _probe_one(self, worker: WorkerConfig) -> None:
        alive = self._is_process_alive(worker.id)
        if not alive:
            fails = self._fail_counts.get(worker.id, 0) + 1
            self._fail_counts[worker.id] = fails
            patch = failure_patch(
                worker, process_alive=False, consecutive_failures=fails
            )
            self._queue.put((worker.id, patch))
            return

        url = f"http://127.0.0.1:{worker.health_port}/health"
        try:
            assert self._client is not None
            resp = self._client.get(url, timeout=HEALTH_TIMEOUT_S)
            if resp.status_code != 200:
                raise httpx.HTTPStatusError(
                    "non-200",
                    request=resp.request,
                    response=resp,
                )
            body = resp.json()
            patch = parse_health_payload(worker, body, process_alive=True)
            self._fail_counts[worker.id] = 0
            self._queue.put((worker.id, patch))
        except Exception as exc:
            fails = self._fail_counts.get(worker.id, 0) + 1
            self._fail_counts[worker.id] = fails
            LOG.debug("Health probe failed for %s: %s", worker.id, exc)
            patch = failure_patch(
                worker, process_alive=True, consecutive_failures=fails
            )
            self._queue.put((worker.id, patch))


def build_initial_runtime(worker: WorkerConfig) -> WorkerRuntimeState:
    return WorkerRuntimeState(
        worker_id=worker.id,
        label=worker.label,
        health_port=worker.health_port,
        sap_conn_idx=worker.sap_conn_idx,
        sap_session_index=worker.sap_session_index,
        session_info=(
            f"PRD/--/--/conn:{worker.sap_conn_idx} "
            f"sess:{worker.sap_session_index}"
        ),
    )

# Created and developed by Jai Singh
