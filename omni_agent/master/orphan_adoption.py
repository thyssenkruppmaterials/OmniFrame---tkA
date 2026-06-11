# Created and developed by Jai Singh
"""Orphan worker adoption on master restart (Phase F2)."""

from __future__ import annotations

import logging
import socket
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

from omni_agent.master.config import MasterConfig, WorkerConfig

LOG = logging.getLogger("omniframe.master.orphan_adoption")

TCP_PROBE_TIMEOUT_S = 0.5
HEALTH_TIMEOUT_S = 1.0
HEALTH_HOST = "127.0.0.1"


@dataclass(frozen=True)
class AdoptedWorker:
    worker_id: str
    pid: int
    health_port: int
    agent_id: str


@dataclass(frozen=True)
class NotAdoptedReason:
    worker_id: str
    reason: str


@dataclass
class AdoptionResult:
    adopted: list[AdoptedWorker] = field(default_factory=list)
    not_adopted: list[NotAdoptedReason] = field(default_factory=list)


def _default_socket_connect(host: str, port: int, timeout: float) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex((host, port)) == 0


def _default_httpx_get(url: str, *, timeout: float) -> tuple[int, dict[str, Any]]:
    import httpx

    resp = httpx.get(url, timeout=timeout)
    try:
        body = resp.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return resp.status_code, body


def _port_is_listening(
    host: str,
    port: int,
    timeout: float,
    socket_connect: Callable[..., Any],
) -> bool:
    try:
        out = socket_connect(host, port, timeout)
        if out is None:
            return True
        return bool(out)
    except OSError:
        return False


def _fetch_health(
    port: int,
    *,
    httpx_get: Callable[..., Any],
) -> tuple[Optional[int], dict[str, Any], Optional[str]]:
    """Return (status_code, body, error_reason)."""
    url = f"http://{HEALTH_HOST}:{port}/health"
    try:
        result = httpx_get(url, timeout=HEALTH_TIMEOUT_S)
    except TypeError:
        result = httpx_get(url, timeout=HEALTH_TIMEOUT_S)
    except Exception as exc:
        return None, {}, f"health_request_failed:{exc!r}"

    if isinstance(result, tuple) and len(result) >= 2:
        status, body = result[0], result[1]
        if not isinstance(body, dict):
            body = {}
        return int(status), body, None

    status = getattr(result, "status_code", None)
    if status is None:
        return None, {}, "/health returned None"
    try:
        body = result.json() if hasattr(result, "json") else {}
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return int(status), body, None


def _resolve_agent_id(
    body: dict[str, Any], expected_worker_id: str
) -> tuple[Optional[str], Optional[str]]:
    agent_id = body.get("agent_id")
    if agent_id is not None and str(agent_id) == expected_worker_id:
        return str(agent_id), None
    self_id = body.get("self_id")
    if self_id is not None and str(self_id) == expected_worker_id:
        return str(self_id), None
    if agent_id is not None:
        return None, f"agent_id_mismatch:{agent_id}"
    if self_id is not None:
        return None, f"self_id_mismatch:{self_id}"
    return None, "missing_agent_identity"


def _process_matches_worker(
    proc_info: dict[str, Any],
    *,
    port: int,
    agent_exe_path: Path,
) -> bool:
    env = proc_info.get("environ") or {}
    if isinstance(env, dict) and str(env.get("OMNIFRAME_AGENT_PORT", "")) == str(port):
        return True
    cmdline = proc_info.get("cmdline") or []
    if isinstance(cmdline, (list, tuple)):
        joined = " ".join(str(x) for x in cmdline).lower().replace("-", "_")
        if f"omniframe_agent_port={port}" in joined or f":{port}" in joined:
            return True
        exe_lower = agent_exe_path.name.lower()
        if exe_lower and exe_lower in joined:
            return True
    name = (proc_info.get("name") or "").lower()
    exe_lower = agent_exe_path.name.lower()
    if exe_lower and exe_lower in name:
        return True
    return False


def _iter_process_infos(process_iter: Callable[..., Iterable[Any]]) -> Iterable[dict[str, Any]]:
    try:
        iterator = process_iter(["pid", "name", "cmdline", "environ"])
    except TypeError:
        iterator = process_iter()
    for proc in iterator:
        if isinstance(proc, dict):
            yield proc
            continue
        info = getattr(proc, "info", None) or {}
        if not info and hasattr(proc, "pid"):
            info = {
                "pid": proc.pid,
                "name": proc.name() if hasattr(proc, "name") else "",
                "cmdline": proc.cmdline() if hasattr(proc, "cmdline") else [],
                "environ": proc.environ() if hasattr(proc, "environ") else {},
            }
        yield info


def _find_process_pid(
    worker: WorkerConfig,
    *,
    agent_exe_path: Path,
    master_pid: Optional[int],
    process_iter: Callable[..., Iterable[Any]],
) -> tuple[Optional[int], Optional[str]]:
    matches: list[int] = []
    for info in _iter_process_infos(process_iter):
        try:
            pid = int(info.get("pid") or 0)
            if not pid:
                continue
            if _process_matches_worker(
                info, port=worker.health_port, agent_exe_path=agent_exe_path
            ):
                matches.append(pid)
        except Exception:
            continue

    non_master = [p for p in matches if master_pid is None or p != master_pid]
    pool = non_master or matches
    if not pool:
        return None, "no_matching_process"
    if len(matches) > 1:
        LOG.warning(
            "Multiple processes match worker %s on port %s — using pid %s",
            worker.id,
            worker.health_port,
            pool[0],
        )
    return pool[0], None


def adopt_running_workers(
    config: MasterConfig,
    *,
    agent_exe_path: str | Path = "",
    master_pid: Optional[int] = None,
    socket_connect: Callable[..., Any] = _default_socket_connect,
    httpx_get: Optional[Callable[..., Any]] = None,
    process_iter: Optional[Callable[..., Iterable[Any]]] = None,
) -> AdoptionResult:
    """Probe each configured worker; return adoption candidates with PIDs."""
    import os

    if master_pid is None:
        master_pid = os.getpid()
    exe_path = Path(agent_exe_path) if agent_exe_path else Path("OmniFrame_Agent.exe")
    get_health = httpx_get or _default_httpx_get
    if process_iter is None:
        import psutil

        iter_fn: Callable[..., Iterable[Any]] = psutil.process_iter
    else:
        iter_fn = process_iter

    result = AdoptionResult()
    workers = config.workers[: config.master.workers]

    for worker in workers:
        port = worker.health_port
        if not _port_is_listening(
            HEALTH_HOST, port, TCP_PROBE_TIMEOUT_S, socket_connect
        ):
            result.not_adopted.append(
                NotAdoptedReason(worker.id, "port_not_listening")
            )
            continue

        status, body, health_err = _fetch_health(port, httpx_get=get_health)
        if health_err:
            result.not_adopted.append(NotAdoptedReason(worker.id, health_err))
            continue
        if status != 200:
            result.not_adopted.append(
                NotAdoptedReason(worker.id, f"health_http_{status}")
            )
            continue

        agent_id, mismatch = _resolve_agent_id(body, worker.id)
        if agent_id is None:
            result.not_adopted.append(
                NotAdoptedReason(worker.id, mismatch or "agent_id_mismatch")
            )
            continue

        pid, proc_reason = _find_process_pid(
            worker,
            agent_exe_path=exe_path,
            master_pid=master_pid,
            process_iter=iter_fn,
        )
        if pid is None:
            result.not_adopted.append(
                NotAdoptedReason(worker.id, proc_reason or "no_matching_process")
            )
            continue

        result.adopted.append(
            AdoptedWorker(
                worker_id=worker.id,
                pid=pid,
                health_port=port,
                agent_id=agent_id,
            )
        )

    return result


def apply_adoptions_to_supervisor(
    supervisor: Any,
    runtime: Any,
    adoption: AdoptionResult,
    *,
    toast: Optional[Callable[[str], None]] = None,
) -> list[str]:
    """Register adopted workers in supervisor + runtime state."""
    adopted_ids: list[str] = []
    for item in adoption.adopted:
        supervisor.register_adopted(item.worker_id, item.pid)
        with runtime.lock:
            snap = runtime.workers.get(item.worker_id)
            if snap is None:
                continue
            snap.is_adopted = True
            snap.adopted_pid = item.pid
            snap.console_available = False
            snap.process_alive = True
            snap.pid = item.pid
        adopted_ids.append(item.worker_id)
        msg = (
            f"Adopted {item.worker_id} (pid {item.pid}) — "
            "console unavailable until restart"
        )
        LOG.info(msg)
        if toast:
            toast(msg)
    return adopted_ids

# Created and developed by Jai Singh
