# Created and developed by Jai Singh
"""WatchdogSupervisor lifecycle tests (mocked Popen + httpx)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

pytest.importorskip("psutil")

from omni_agent.connect.supervisor import WatchdogSupervisor  # noqa: E402


class _FakePopen:
    instances: list["_FakePopen"] = []

    def __init__(self, args, **kwargs):
        _FakePopen.instances.append(self)
        self.args = args
        self.kwargs = kwargs
        self.pid = 9000 + len(_FakePopen.instances)
        self._returncode = None
        from io import StringIO

        self.stdout = StringIO("")
        self.stderr = StringIO("")

    def poll(self):
        return self._returncode

    def wait(self, timeout=None):
        return 0

    def terminate(self):
        pass

    def kill(self):
        pass


@pytest.fixture(autouse=True)
def _clear_fake_popen():
    _FakePopen.instances.clear()
    yield
    _FakePopen.instances.clear()


def test_spawn_soft_fallback_env(tmp_path):
    fake_exe = tmp_path / "OmniFrame_Agent.exe"
    fake_exe.write_text("", encoding="utf-8")

    with mock.patch(
        "omni_agent.connect.supervisor.subprocess.Popen", _FakePopen
    ), mock.patch.object(
        WatchdogSupervisor, "resolve_agent_exe", lambda self: fake_exe
    ), mock.patch(
        "omni_agent.connect.supervisor.create_windows_job_handle", lambda: None
    ), mock.patch(
        "omni_agent.connect.supervisor.assign_pid_to_job", lambda *a, **k: None
    ), mock.patch(
        "omni_agent.connect.supervisor.HealthProbeLoop.start", lambda self: None
    ):
        sup = WatchdogSupervisor()
        sup.spawn_worker()

    assert len(_FakePopen.instances) == 1
    env = _FakePopen.instances[0].kwargs["env"]
    assert env["PYTHONIOENCODING"] == "utf-8:replace"
    assert env["OMNIFRAME_AGENT_PORT"] == "8765"
    assert "OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY" not in env
    assert "OMNIFRAME_AGENT_SELF_ID_OVERRIDE" not in env
    assert "OMNIFRAME_SAP_CONN_IDX" not in env


def test_pause_sets_paused_state(tmp_path):
    fake_exe = tmp_path / "OmniFrame_Agent.exe"
    fake_exe.write_text("", encoding="utf-8")

    with mock.patch(
        "omni_agent.connect.supervisor.subprocess.Popen", _FakePopen
    ), mock.patch.object(
        WatchdogSupervisor, "resolve_agent_exe", lambda self: fake_exe
    ), mock.patch(
        "omni_agent.connect.supervisor.create_windows_job_handle", lambda: None
    ), mock.patch(
        "omni_agent.connect.supervisor.assign_pid_to_job", lambda *a, **k: None
    ), mock.patch(
        "omni_agent.connect.supervisor.httpx.post", mock.Mock()
    ), mock.patch(
        "omni_agent.connect.supervisor.kill_descendants", lambda *a, **k: []
    ), mock.patch(
        "omni_agent.connect.supervisor.audit_agent_processes", lambda: []
    ):
        sup = WatchdogSupervisor()
        sup.spawn_worker()
        sup.pause()
        assert sup.is_paused() is True
        assert sup.state.pill.value == "paused"


def test_restart_resets_circuit_breaker(tmp_path):
    fake_exe = tmp_path / "OmniFrame_Agent.exe"
    fake_exe.write_text("", encoding="utf-8")

    with mock.patch(
        "omni_agent.connect.supervisor.subprocess.Popen", _FakePopen
    ), mock.patch.object(
        WatchdogSupervisor, "resolve_agent_exe", lambda self: fake_exe
    ), mock.patch(
        "omni_agent.connect.supervisor.create_windows_job_handle", lambda: None
    ), mock.patch(
        "omni_agent.connect.supervisor.assign_pid_to_job", lambda *a, **k: None
    ), mock.patch(
        "omni_agent.connect.supervisor.httpx.post", mock.Mock()
    ), mock.patch(
        "omni_agent.connect.supervisor.kill_descendants", lambda *a, **k: []
    ), mock.patch(
        "omni_agent.connect.supervisor.audit_agent_processes", lambda: []
    ), mock.patch(
        "omni_agent.connect.supervisor.HealthProbeLoop.start", lambda self: None
    ), mock.patch(
        "omni_agent.connect.supervisor.HealthProbeLoop.stop", lambda self: None
    ):
        sup = WatchdogSupervisor()
        sup.state.circuit_breaker_tripped = True
        sup.restart()
        assert sup.state.circuit_breaker_tripped is False

# Created and developed by Jai Singh
