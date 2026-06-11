# Created and developed by Jai Singh
"""Cross-platform kill subprocess + all descendant processes."""

from __future__ import annotations

import logging
import os
import signal
import sys
import time
from typing import Optional

LOG = logging.getLogger("omniframe.connect.child_kill")

TERMINATE_GRACE_S = 2.0
KILL_GRACE_S = 3.0


def _creationflags_for_worker() -> int:
    if sys.platform == "win32":
        flags = 0
        if hasattr(subprocess := __import__("subprocess"), "CREATE_NO_WINDOW"):
            flags |= subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
        if hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
            flags |= subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
        return flags
    return 0


def creationflags_for_worker() -> int:
    """Windows flags for worker spawn (no console + distinct process group)."""
    return _creationflags_for_worker()


def create_windows_job_handle() -> Optional[object]:
    """Create a Job Object with KILL_ON_JOB_CLOSE (Windows only)."""
    if sys.platform != "win32":
        return None
    try:
        import win32job  # type: ignore[import-untyped]

        job = win32job.CreateJobObject(None, "")
        info = win32job.QueryInformationJobObject(
            job, win32job.JobObjectExtendedLimitInformation
        )
        info["BasicLimitInformation"]["LimitFlags"] = (
            win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        )
        win32job.SetInformationJobObject(
            job, win32job.JobObjectExtendedLimitInformation, info
        )
        return job
    except Exception as exc:
        LOG.warning("[ERR] Job Object create failed -> psutil fallback: %s", exc)
        return None


def assign_pid_to_job(job_handle: object, pid: int) -> bool:
    """Assign ``pid`` to an existing Windows Job Object."""
    if sys.platform != "win32" or job_handle is None:
        return False
    try:
        import win32api  # type: ignore[import-untyped]
        import win32con  # type: ignore[import-untyped]
        import win32job  # type: ignore[import-untyped]

        access = win32con.PROCESS_SET_QUOTA | win32con.PROCESS_TERMINATE
        proc_handle = win32api.OpenProcess(access, False, pid)
        try:
            win32job.AssignProcessToJobObject(job_handle, proc_handle)
            LOG.info("[OK] Assigned pid=%s to Job Object", pid)
            return True
        finally:
            win32api.CloseHandle(proc_handle)
    except Exception as exc:
        LOG.warning("[ERR] Job Object assign pid=%s failed: %s", pid, exc)
        return False


def close_job_handle(job_handle: Optional[object]) -> None:
    """Close Job Object handle; Windows kills all assigned processes."""
    if job_handle is None:
        return
    try:
        import win32api  # type: ignore[import-untyped]

        win32api.CloseHandle(job_handle)
        LOG.info("[OK] Job Object closed -> descendants killed by OS")
    except Exception as exc:
        LOG.warning("[ERR] Job Object close failed: %s", exc)


def _psutil_kill_tree(pid: int, *, audit: bool = True) -> list[dict[str, str]]:
    """Terminate then kill pid + recursive children via psutil."""
    import psutil

    killed: list[dict[str, str]] = []
    try:
        root = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return killed

    targets = root.children(recursive=True) + [root]
    for proc in targets:
        try:
            proc.terminate()
        except psutil.NoSuchProcess:
            pass

    _gone, alive = psutil.wait_procs(targets, timeout=TERMINATE_GRACE_S)
    for proc in alive:
        try:
            proc.kill()
        except psutil.NoSuchProcess:
            pass
    psutil.wait_procs(alive, timeout=TERMINATE_GRACE_S)

    for proc in targets:
        try:
            if not proc.is_running():
                cmd = " ".join(proc.cmdline())
                entry = {"pid": str(proc.pid), "cmdline": cmd}
                killed.append(entry)
                if audit:
                    LOG.info("[OK] killed pid=%s cmd=%s", proc.pid, cmd)
        except psutil.NoSuchProcess:
            pass
    return killed


def _posix_kill_tree(pid: int, *, audit: bool = True) -> list[dict[str, str]]:
    killed: list[dict[str, str]] = []
    try:
        pgid = os.getpgid(pid)
        os.killpg(pgid, signal.SIGTERM)
        time.sleep(KILL_GRACE_S)
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        if audit:
            LOG.info("[OK] killpg pgid=%s (root pid=%s)", pgid, pid)
        killed.append({"pid": str(pid), "cmdline": f"pgid={pgid}"})
    except ProcessLookupError:
        pass
    except Exception as exc:
        LOG.warning("[ERR] posix killpg failed pid=%s: %s", pid, exc)
        killed.extend(_psutil_kill_tree(pid, audit=audit))
    return killed


def kill_descendants(
    pid: int,
    *,
    job_handle: Optional[object] = None,
    audit: bool = True,
) -> list[dict[str, str]]:
    """Kill ``pid`` and every descendant. Prefer Job Object close on Windows."""
    if pid <= 0:
        return []

    if job_handle is not None and sys.platform == "win32":
        close_job_handle(job_handle)
        import psutil

        try:
            proc = psutil.Process(pid)
            if not proc.is_running():
                cmd = " ".join(proc.cmdline())
                if audit:
                    LOG.info("[OK] Job Object audit pid=%s gone cmd=%s", pid, cmd)
                return [{"pid": str(pid), "cmdline": cmd}]
        except psutil.NoSuchProcess:
            if audit:
                LOG.info("[OK] Job Object audit pid=%s already gone", pid)
            return [{"pid": str(pid), "cmdline": ""}]

    if sys.platform == "win32":
        return _psutil_kill_tree(pid, audit=audit)
    return _posix_kill_tree(pid, audit=audit)


def audit_agent_processes(
    agent_exe_name: str = "OmniFrame_Agent.exe",
) -> list[dict[str, str]]:
    """Return live agent processes (post-shutdown verification)."""
    import psutil

    name_lower = agent_exe_name.lower()
    found: list[dict[str, str]] = []
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            pname = (proc.info.get("name") or "").lower()
            if name_lower not in pname and "omniframe_agent" not in pname:
                continue
            cmd = " ".join(proc.info.get("cmdline") or [])
            found.append(
                {"pid": str(proc.pid), "name": pname, "cmdline": cmd}
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return found

# Created and developed by Jai Singh
