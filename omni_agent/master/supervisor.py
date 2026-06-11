# Created and developed by Jai Singh
"""Subprocess orchestration: spawn, graceful shutdown, orphan pid lookup."""

from __future__ import annotations

import logging
import os
import queue
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import httpx

from omni_agent.master.admin_client import load_or_create_master_admin_token
from omni_agent.master.config import (
    MasterConfig,
    WorkerConfig,
    canonical_service_key_path,
    expand_path,
)
from omni_agent.master.console_buffer import ConsoleLineEntry, ConsoleRingBuffer
from omni_agent.master.console_reader import (
    clamp_tail_queue_size,
    spawn_fanout_thread,
    spawn_stream_reader,
)
from omni_agent.master.log_rotation import spawn_rotation_thread

LOG = logging.getLogger("omniframe.master.supervisor")

SHUTDOWN_GRACE_S = 5.0
TERMINATE_GRACE_S = 2.0
THREAD_JOIN_TIMEOUT_S = 2.0


def _creationflags() -> int:
    if sys.platform == "win32" and hasattr(subprocess, "CREATE_NO_WINDOW"):
        return subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
    return 0


@dataclass
class WorkerConsoleResources:
    """Per-worker console plane: ring buffer, queues, and helper threads."""

    worker_id: str
    buffer: ConsoleRingBuffer
    tail_queue: queue.Queue[ConsoleLineEntry]
    log_queue: queue.Queue[ConsoleLineEntry]
    gui_pending: list[ConsoleLineEntry] = field(default_factory=list)
    gui_lock: threading.Lock = field(default_factory=threading.Lock)
    stop_event: threading.Event = field(default_factory=threading.Event)
    stdout_thread: Optional[threading.Thread] = None
    stderr_thread: Optional[threading.Thread] = None
    fanout_thread: Optional[threading.Thread] = None
    rotation_thread: Optional[threading.Thread] = None

    def start_for_popen(
        self,
        popen: subprocess.Popen[str],
        *,
        log_dir: Path,
        retention_days: int,
    ) -> None:
        self.stop_event.clear()
        self.stdout_thread = spawn_stream_reader(
            self.worker_id,
            popen.stdout,
            "stdout",
            self.buffer,
            self.tail_queue,
            self.stop_event,
        )
        self.stderr_thread = spawn_stream_reader(
            self.worker_id,
            popen.stderr,
            "stderr",
            self.buffer,
            self.tail_queue,
            self.stop_event,
        )
        self.fanout_thread = spawn_fanout_thread(
            self.worker_id,
            self.tail_queue,
            self.log_queue,
            self.gui_pending,
            self.gui_lock,
            self.stop_event,
        )
        self.rotation_thread = spawn_rotation_thread(
            self.worker_id,
            log_dir,
            self.log_queue,
            self.stop_event,
            retention_days=retention_days,
        )

    def shutdown(self) -> None:
        self.stop_event.set()
        for thread in (
            self.stdout_thread,
            self.stderr_thread,
            self.fanout_thread,
            self.rotation_thread,
        ):
            if thread is not None and thread.is_alive():
                thread.join(timeout=THREAD_JOIN_TIMEOUT_S)


@dataclass
class ManagedWorker:
    config: WorkerConfig
    popen: Optional[subprocess.Popen[str]] = None
    adopted_pid: Optional[int] = None

    @property
    def is_adopted(self) -> bool:
        return self.adopted_pid is not None and self.popen is None

    def effective_pid(self) -> Optional[int]:
        if self.popen is not None and self.popen.poll() is None:
            return self.popen.pid
        return self.adopted_pid

    def is_alive(self) -> bool:
        if self.popen is not None:
            return self.popen.poll() is None
        if self.adopted_pid:
            import psutil

            return psutil.pid_exists(self.adopted_pid)
        return False


@dataclass
class WorkerSupervisor:
    cfg: MasterConfig
    managed: dict[str, ManagedWorker] = field(default_factory=dict)
    console: dict[str, WorkerConsoleResources] = field(default_factory=dict)
    _admin_token: Optional[str] = field(default=None, repr=False, compare=False)

    def __post_init__(self) -> None:
        n = self.cfg.master.workers
        ring_size = self.cfg.master.console_ring_size
        tail_size = clamp_tail_queue_size(self.cfg.master.console_tail_queue_size)
        for w in self.cfg.workers[:n]:
            self.managed[w.id] = ManagedWorker(config=w)
            self.console[w.id] = WorkerConsoleResources(
                worker_id=w.id,
                buffer=ConsoleRingBuffer(maxlen=ring_size),
                tail_queue=queue.Queue(maxsize=tail_size),
                log_queue=queue.Queue(maxsize=tail_size),
            )
        if self._admin_token is None:
            self._admin_token = load_or_create_master_admin_token()

    @property
    def admin_token(self) -> str:
        return self._admin_token or ""

    def get_console_buffer(self, worker_id: str) -> Optional[ConsoleRingBuffer]:
        res = self.console.get(worker_id)
        return res.buffer if res else None

    def get_gui_pending(self, worker_id: str) -> tuple[list[ConsoleLineEntry], threading.Lock]:
        res = self.console[worker_id]
        return res.gui_pending, res.gui_lock

    def resolve_agent_exe(self) -> Path:
        raw = self.cfg.master.agent_exe_path.strip()
        if raw:
            return Path(expand_path(raw))
        if getattr(sys, "frozen", False):
            base = Path(sys.executable).parent
        else:
            base = Path(__file__).resolve().parents[1]
        return base / "OmniFrame_Agent.exe"

    def build_env(self, worker: WorkerConfig) -> dict[str, str]:
        env = os.environ.copy()
        key_path = canonical_service_key_path(worker.id)
        env["OMNIFRAME_AGENT_SELF_ID_OVERRIDE"] = worker.id
        env["OMNIFRAME_AGENT_PORT"] = str(worker.health_port)
        env["OMNIFRAME_SAP_CONN_IDX"] = str(worker.sap_conn_idx)
        env["OMNIFRAME_SAP_SESS_IDX"] = str(worker.sap_session_index)
        env["OMNIFRAME_AGENT_SERVICE_KEY_PATH"] = str(key_path)
        if self.cfg.master.require_service_keys:
            env["OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY"] = "1"
        # Force UTF-8 for the worker's stdin/stdout/stderr regardless of the
        # Windows console code page (cp1252 in en-US locales). Without this,
        # boot prints that contain non-ASCII characters such as the U+2192
        # arrow ("→") in agent.py crash with ``UnicodeEncodeError`` because
        # Python sets ``sys.stdout.encoding`` to the host code page at
        # interpreter startup. ``:replace`` is a belt-and-suspenders error
        # handler — utf-8 itself never produces an unencodable codepoint, so
        # the suffix is a no-op for legitimate text but prevents a future
        # binary-byte regression from killing the worker.
        env["PYTHONIOENCODING"] = "utf-8:replace"
        if self._admin_token:
            env["OMNIFRAME_AGENT_ADMIN_TOKEN"] = self._admin_token
        env.update(worker.extra_env)
        return env

    def _teardown_console(self, worker_id: str) -> None:
        res = self.console.get(worker_id)
        if not res:
            return
        res.shutdown()
        ring_size = self.cfg.master.console_ring_size
        tail_size = clamp_tail_queue_size(self.cfg.master.console_tail_queue_size)
        self.console[worker_id] = WorkerConsoleResources(
            worker_id=worker_id,
            buffer=ConsoleRingBuffer(maxlen=ring_size),
            tail_queue=queue.Queue(maxsize=tail_size),
            log_queue=queue.Queue(maxsize=tail_size),
        )

    def spawn_worker(self, worker: WorkerConfig) -> ManagedWorker:
        mw = self.managed[worker.id]
        if mw.is_adopted and mw.is_alive():
            LOG.debug(
                "Worker %s adopted pid=%s; skip spawn/console",
                worker.id,
                mw.adopted_pid,
            )
            return mw
        if mw.is_adopted:
            mw.adopted_pid = None
        self._teardown_console(worker.id)
        exe = self.resolve_agent_exe()
        env = self.build_env(worker)
        LOG.info("Spawning %s on port %s", worker.id, worker.health_port)
        popen = subprocess.Popen(
            [str(exe)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=1,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=_creationflags(),
        )
        mw = self.managed[worker.id]
        mw.popen = popen
        mw.adopted_pid = None
        res = self.console[worker.id]
        res.start_for_popen(
            popen,
            log_dir=self.cfg.master.resolved_log_dir(),
            retention_days=self.cfg.master.log_retention_days,
        )
        return mw

    def start_workers(
        self,
        *,
        only_auto_start: bool = True,
        progress: Optional[Callable[[str], None]] = None,
    ) -> list[str]:
        """Spawn workers with ``auto_start`` (or all), capped by concurrency."""
        cap = max(1, self.cfg.master.parallel_spawn_concurrency)
        targets = [
            w
            for w in self.cfg.workers[: self.cfg.master.workers]
            if (w.auto_start or not only_auto_start)
            and not self.managed[w.id].is_alive()
        ]
        started: list[str] = []

        def _spawn(w: WorkerConfig) -> str:
            self.spawn_worker(w)
            return w.id

        with ThreadPoolExecutor(max_workers=cap) as pool:
            futures = {pool.submit(_spawn, w): w for w in targets}
            for fut in as_completed(futures):
                wid = fut.result()
                started.append(wid)
                if progress:
                    progress(wid)
        return started

    def start_worker(self, worker_id: str) -> bool:
        """Spawn a single worker if it is not already running."""
        mw = self.managed.get(worker_id)
        if not mw or mw.is_alive():
            return False
        self.spawn_worker(mw.config)
        return True

    def stop_worker(self, worker_id: str) -> None:
        mw = self.managed.get(worker_id)
        if not mw:
            return
        port = mw.config.health_port
        self._post_shutdown(port)
        if mw.popen is not None:
            self._terminate_popen(mw.popen)
            mw.popen = None
        elif mw.adopted_pid:
            self._kill_pid(mw.adopted_pid)
            mw.adopted_pid = None
        self._teardown_console(worker_id)

    def stop_all(self) -> None:
        for wid in list(self.managed):
            self.stop_worker(wid)

    def _post_shutdown(self, port: int) -> None:
        url = f"http://127.0.0.1:{port}/shutdown"
        try:
            httpx.post(url, timeout=SHUTDOWN_GRACE_S)
        except Exception as exc:
            LOG.debug("POST /shutdown on :%s failed: %s", port, exc)

    def _terminate_popen(self, popen: subprocess.Popen[str]) -> None:
        try:
            popen.wait(timeout=SHUTDOWN_GRACE_S)
            return
        except subprocess.TimeoutExpired:
            pass
        popen.terminate()
        try:
            popen.wait(timeout=TERMINATE_GRACE_S)
            return
        except subprocess.TimeoutExpired:
            popen.kill()
            popen.wait(timeout=TERMINATE_GRACE_S)

    def _kill_pid(self, pid: int) -> None:
        import psutil

        try:
            proc = psutil.Process(pid)
            proc.terminate()
            proc.wait(timeout=int(SHUTDOWN_GRACE_S))
        except (psutil.NoSuchProcess, psutil.TimeoutExpired):
            try:
                proc = psutil.Process(pid)
                proc.kill()
            except psutil.NoSuchProcess:
                pass

    def is_process_alive(self, worker_id: str) -> bool:
        mw = self.managed.get(worker_id)
        return bool(mw and mw.is_alive())

    def respawn(self, worker_id: str) -> None:
        """Spawn worker if process is not alive."""
        mw = self.managed.get(worker_id)
        if not mw or mw.is_alive():
            return
        self.spawn_worker(mw.config)

    def kill_and_respawn(self, worker_id: str) -> None:
        """Graceful stop then spawn fresh worker."""
        mw = self.managed.get(worker_id)
        if not mw:
            return
        if mw.is_adopted:
            self.restart_adopted(worker_id)
            return
        self.stop_worker(worker_id)
        self.spawn_worker(mw.config)

    def kill_adopted(self, worker_id: str) -> None:
        """Terminate adopted worker via psutil (no Popen handle)."""
        mw = self.managed.get(worker_id)
        if not mw or not mw.adopted_pid:
            return
        port = mw.config.health_port
        self._post_shutdown(port)
        self._kill_pid(mw.adopted_pid)
        mw.adopted_pid = None

    def restart_adopted(self, worker_id: str) -> None:
        """Kill adopted orphan then spawn with full console pipes."""
        mw = self.managed.get(worker_id)
        if not mw:
            return
        if mw.is_adopted:
            self.kill_adopted(worker_id)
        elif mw.is_alive():
            self.stop_worker(worker_id)
        self.spawn_worker(mw.config)

    def register_adopted(self, worker_id: str, pid: int) -> None:
        """Bind an existing Agent.exe PID without Popen/console pipes."""
        mw = self.managed.get(worker_id)
        if mw is None:
            return
        mw.adopted_pid = pid
        mw.popen = None
        LOG.info("Registered adopted worker %s pid=%s", worker_id, pid)

    def adopt_orphan(self, worker_id: str, pid: int) -> None:
        """Backward-compatible alias for ``register_adopted``."""
        self.register_adopted(worker_id, pid)

    def is_worker_adopted(self, worker_id: str) -> bool:
        mw = self.managed.get(worker_id)
        return bool(mw and mw.is_adopted)

    def find_orphan_pid(
        self,
        worker: WorkerConfig,
        *,
        expected_agent_id: Optional[str] = None,
    ) -> Optional[int]:
        """Phase F wires adoption — scan for Agent.exe on ``health_port``."""
        import psutil

        exe_name = self.resolve_agent_exe().name.lower()
        for proc in psutil.process_iter(["pid", "name", "cmdline"]):
            try:
                name = (proc.info.get("name") or "").lower()
                if exe_name not in name and "agent" not in name:
                    continue
                cmdline = proc.info.get("cmdline") or []
                joined = " ".join(cmdline).lower()
                if (
                    f"omniframe_agent_port={worker.health_port}".lower()
                    in joined.replace("-", "_")
                    or f":{worker.health_port}" in joined
                ):
                    return int(proc.pid)
                if expected_agent_id and expected_agent_id.lower() in joined:
                    return int(proc.pid)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return None

# Created and developed by Jai Singh
