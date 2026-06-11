# Created and developed by Jai Singh
"""Supervisor kill/restart/register for adopted orphans (mocked psutil)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.config import (  # noqa: E402
    MasterConfig,
    MasterSettings,
    WorkerConfig,
)
from omni_agent.master.supervisor import WorkerSupervisor  # noqa: E402


class _FakeProc:
    def __init__(self, pid: int):
        self.pid = pid
        self.terminated = False
        self.killed = False

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True

    def wait(self, timeout=None):
        if self.terminated and not self.killed:
            raise type("TimeoutExpired", (Exception,), {})()


@pytest.fixture
def supervisor_cfg():
    w = WorkerConfig(
        id="TESTHOST-W1",
        label="Bay 1",
        health_port=8765,
    )
    return MasterConfig(master=MasterSettings(workers=1), workers=[w])


def test_register_adopted_sets_flags(supervisor_cfg):
    sup = WorkerSupervisor(supervisor_cfg)
    sup.register_adopted("TESTHOST-W1", 7777)
    mw = sup.managed["TESTHOST-W1"]
    assert mw.is_adopted
    assert mw.adopted_pid == 7777
    assert mw.popen is None


def test_kill_adopted_terminate_then_kill_ladder(supervisor_cfg):
    pytest.importorskip("psutil")
    import psutil

    class _TimeoutProc(_FakeProc):
        def wait(self, timeout=None):
            raise psutil.TimeoutExpired(timeout)

    fake = _TimeoutProc(7777)
    sup = WorkerSupervisor(supervisor_cfg)
    sup.register_adopted("TESTHOST-W1", 7777)

    with mock.patch.object(psutil, "Process", return_value=fake):
        sup.kill_adopted("TESTHOST-W1")

    assert fake.terminated
    assert fake.killed
    assert sup.managed["TESTHOST-W1"].adopted_pid is None
    assert not sup.managed["TESTHOST-W1"].is_adopted


def test_spawn_skips_console_for_alive_adopted(supervisor_cfg, tmp_path):
    fake_exe = tmp_path / "OmniFrame_Agent.exe"
    fake_exe.write_text("", encoding="utf-8")
    supervisor_cfg.master.agent_exe_path = str(fake_exe)

    sup = WorkerSupervisor(supervisor_cfg)
    sup.register_adopted("TESTHOST-W1", 8888)

    with mock.patch.object(sup.managed["TESTHOST-W1"], "is_alive", return_value=True):
        with mock.patch.object(sup, "_teardown_console") as teardown:
            with mock.patch.object(sup, "spawn_worker", wraps=sup.spawn_worker):
                mw = sup.spawn_worker(supervisor_cfg.workers[0])

    teardown.assert_not_called()
    assert mw.is_adopted
    assert mw.adopted_pid == 8888


def test_restart_adopted_kills_then_spawns(supervisor_cfg, tmp_path):
    _FakePopen_instances: list = []

    class _FakePopen:
        def __init__(self, args, **kwargs):
            self.pid = 9999
            self.stdout = None
            self.stderr = None
            _FakePopen_instances.append(self)

        def poll(self):
            return None

        def wait(self, timeout=None):
            return 0

        def terminate(self):
            pass

        def kill(self):
            pass

    fake_exe = tmp_path / "OmniFrame_Agent.exe"
    fake_exe.write_text("", encoding="utf-8")
    supervisor_cfg.master.agent_exe_path = str(fake_exe)

    sup = WorkerSupervisor(supervisor_cfg)
    sup.register_adopted("TESTHOST-W1", 7777)

    pytest.importorskip("psutil")
    import psutil

    class _TimeoutProc(_FakeProc):
        def wait(self, timeout=None):
            raise psutil.TimeoutExpired(timeout)

    fake_proc = _TimeoutProc(7777)
    with mock.patch(
        "omni_agent.master.supervisor.subprocess.Popen",
        _FakePopen,
    ), mock.patch(
        "omni_agent.master.supervisor.threading.Thread",
        lambda *a, **k: mock.Mock(start=mock.Mock()),
    ), mock.patch.object(psutil, "Process", return_value=fake_proc):
        sup.restart_adopted("TESTHOST-W1")

    mw = sup.managed["TESTHOST-W1"]
    assert not mw.is_adopted
    assert mw.popen is not None
    assert fake_proc.terminated

# Created and developed by Jai Singh
