# Created and developed by Jai Singh
"""child_kill descendant kill tests (mocked psutil / Job Object)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

pytest.importorskip("psutil")

from omni_agent.connect import child_kill  # noqa: E402


class _FakeProc:
    def __init__(self, pid: int, *, alive: bool = True):
        self.pid = pid
        self._alive = alive

    def children(self, recursive=False):
        return []

    def terminate(self):
        self._alive = False

    def kill(self):
        self._alive = False

    def is_running(self):
        return self._alive

    def cmdline(self):
        return ["OmniFrame_Agent.exe"]


def test_kill_descendants_psutil_tree(monkeypatch):
    monkeypatch.setattr(
        child_kill,
        "_psutil_kill_tree",
        lambda pid, audit=True: [{"pid": str(pid), "cmdline": "x"}],
    )
    monkeypatch.setattr(child_kill.sys, "platform", "win32")
    result = child_kill.kill_descendants(100, job_handle=None, audit=False)
    assert result == [{"pid": "100", "cmdline": "x"}]


def test_close_job_handle_calls_win32(monkeypatch):
    closed = {"n": 0}

    def _close(h):
        closed["n"] += 1

    monkeypatch.setitem(sys.modules, "win32api", mock.Mock(CloseHandle=_close))
    child_kill.close_job_handle(object())
    assert closed["n"] == 1


def test_creationflags_includes_new_process_group_on_win32(monkeypatch):
    import subprocess

    monkeypatch.setattr(child_kill.sys, "platform", "win32")
    if not hasattr(subprocess, "CREATE_NO_WINDOW"):
        pytest.skip("CREATE_NO_WINDOW not available on this platform")
    no_window = subprocess.CREATE_NO_WINDOW
    new_group = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    flags = child_kill.creationflags_for_worker()
    assert flags & no_window == no_window
    if new_group:
        assert flags & new_group == new_group

# Created and developed by Jai Singh
