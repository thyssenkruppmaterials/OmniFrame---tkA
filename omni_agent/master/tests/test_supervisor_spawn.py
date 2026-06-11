# Created and developed by Jai Singh
"""Supervisor spawn env injection tests (monkeypatched Popen)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.config import WorkerConfig, MasterConfig, MasterSettings  # noqa: E402
pytest.importorskip("psutil")
from omni_agent.master.supervisor import WorkerSupervisor  # noqa: E402


class _FakePopen:
    instances: list["_FakePopen"] = []

    def __init__(self, args, **kwargs):
        _FakePopen.instances.append(self)
        self.args = args
        self.kwargs = kwargs
        self.pid = 4242
        self._returncode = None
        self.stdout = kwargs.get("stdout")
        self.stderr = kwargs.get("stderr")

    def poll(self):
        return self._returncode

    def wait(self, timeout=None):
        return 0

    def terminate(self):
        pass

    def kill(self):
        pass


@pytest.fixture
def supervisor_cfg():
    w = WorkerConfig(
        id="TESTHOST-W1",
        label="Bay 1",
        sap_conn_idx=0,
        sap_session_index=0,
        auto_start=True,
        health_port=8765,
    )
    return MasterConfig(master=MasterSettings(workers=1), workers=[w])


def test_spawn_injects_phase_a_env_vars(supervisor_cfg, tmp_path):
    _FakePopen.instances.clear()
    fake_exe = tmp_path / "OmniFrame_Agent.exe"
    fake_exe.write_text("", encoding="utf-8")
    supervisor_cfg.master.agent_exe_path = str(fake_exe)
    assert supervisor_cfg.master.require_service_keys is True

    with mock.patch(
        "omni_agent.master.supervisor.subprocess.Popen", _FakePopen
    ), mock.patch(
        "omni_agent.master.supervisor.threading.Thread",
        lambda *a, **k: mock.Mock(start=mock.Mock()),
    ):
        sup = WorkerSupervisor(supervisor_cfg)
        sup.spawn_worker(supervisor_cfg.workers[0])

    assert len(_FakePopen.instances) == 1
    env = _FakePopen.instances[0].kwargs["env"]
    assert env["OMNIFRAME_AGENT_SELF_ID_OVERRIDE"] == "TESTHOST-W1"
    assert env["OMNIFRAME_AGENT_PORT"] == "8765"
    assert env["OMNIFRAME_SAP_CONN_IDX"] == "0"
    assert env["OMNIFRAME_SAP_SESS_IDX"] == "0"
    assert env["OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY"] == "1"
    assert "OMNIFRAME_AGENT_SERVICE_KEY_PATH" in env
    kw = _FakePopen.instances[0].kwargs
    assert kw.get("encoding") == "utf-8"
    assert kw.get("errors") == "replace"


def test_spawn_omits_require_service_key_when_soft_mode(supervisor_cfg, tmp_path):
    _FakePopen.instances.clear()
    fake_exe = tmp_path / "OmniFrame_Agent.exe"
    fake_exe.write_text("", encoding="utf-8")
    supervisor_cfg.master.agent_exe_path = str(fake_exe)
    supervisor_cfg.master.require_service_keys = False

    with mock.patch(
        "omni_agent.master.supervisor.subprocess.Popen", _FakePopen
    ), mock.patch(
        "omni_agent.master.supervisor.threading.Thread",
        lambda *a, **k: mock.Mock(start=mock.Mock()),
    ):
        sup = WorkerSupervisor(supervisor_cfg)
        sup.spawn_worker(supervisor_cfg.workers[0])

    env = _FakePopen.instances[0].kwargs["env"]
    assert "OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY" not in env


def test_parallel_spawn_concurrency_cap(supervisor_cfg):
    workers = [
        WorkerConfig(
            id=f"TESTHOST-W{i}",
            label=f"W{i}",
            sap_conn_idx=0,
            sap_session_index=i,
            health_port=8765 + i,
        )
        for i in range(4)
    ]
    cfg = MasterConfig(
        master=MasterSettings(workers=4, parallel_spawn_concurrency=2),
        workers=workers,
    )
    spawn_count = {"n": 0}

    def _fake_spawn(w):
        spawn_count["n"] += 1
        return w.id

    sup = WorkerSupervisor(cfg)
    with mock.patch.object(sup, "spawn_worker", side_effect=lambda w: _fake_spawn(w)):
        started = sup.start_workers(only_auto_start=False)
    assert len(started) == 4
    assert spawn_count["n"] == 4


def test_start_worker_spawns_when_stopped(supervisor_cfg, tmp_path):
    _FakePopen.instances.clear()
    fake_exe = tmp_path / "OmniFrame_Agent.exe"
    fake_exe.write_text("", encoding="utf-8")
    supervisor_cfg.master.agent_exe_path = str(fake_exe)

    with mock.patch(
        "omni_agent.master.supervisor.subprocess.Popen", _FakePopen
    ), mock.patch(
        "omni_agent.master.supervisor.threading.Thread",
        lambda *a, **k: mock.Mock(start=mock.Mock()),
    ):
        sup = WorkerSupervisor(supervisor_cfg)
        assert sup.start_worker("TESTHOST-W1") is True
        assert len(_FakePopen.instances) == 1


def test_start_worker_noop_when_alive(supervisor_cfg, tmp_path):
    _FakePopen.instances.clear()
    fake_exe = tmp_path / "OmniFrame_Agent.exe"
    fake_exe.write_text("", encoding="utf-8")
    supervisor_cfg.master.agent_exe_path = str(fake_exe)

    with mock.patch(
        "omni_agent.master.supervisor.subprocess.Popen", _FakePopen
    ), mock.patch(
        "omni_agent.master.supervisor.threading.Thread",
        lambda *a, **k: mock.Mock(start=mock.Mock()),
    ):
        sup = WorkerSupervisor(supervisor_cfg)
        sup.spawn_worker(supervisor_cfg.workers[0])
        assert sup.start_worker("TESTHOST-W1") is False
        assert len(_FakePopen.instances) == 1

# Created and developed by Jai Singh
