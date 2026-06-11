# Created and developed by Jai Singh
"""Phase F2 orphan adoption — mocked socket, httpx, psutil."""

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
from omni_agent.master.orphan_adoption import (  # noqa: E402
    adopt_running_workers,
)


def _worker(n: int, port: int | None = None) -> WorkerConfig:
    p = port if port is not None else 8764 + n
    return WorkerConfig(
        id=f"HOST-W{n}",
        label=f"Bay {n}",
        sap_conn_idx=0,
        sap_session_index=n - 1,
        health_port=p,
    )


def _cfg(workers: list[WorkerConfig]) -> MasterConfig:
    return MasterConfig(
        master=MasterSettings(workers=len(workers)),
        workers=workers,
    )


class _FakeProc:
    def __init__(self, pid: int, info: dict):
        self.pid = pid
        self.info = info


def test_positive_adoption():
    w = _worker(1, 8765)
    cfg = _cfg([w])

    def socket_ok(host, port, timeout):
        return port == 8765

    def httpx_get(url, *, timeout):
        assert "8765" in url
        return 200, {"ok": True, "agent_id": "HOST-W1"}

    procs = [
        _FakeProc(
            9001,
            {
                "pid": 9001,
                "name": "OmniFrame_Agent.exe",
                "cmdline": [],
                "environ": {"OMNIFRAME_AGENT_PORT": "8765"},
            },
        )
    ]

    result = adopt_running_workers(
        cfg,
        agent_exe_path="/opt/OmniFrame_Agent.exe",
        master_pid=4242,
        socket_connect=socket_ok,
        httpx_get=httpx_get,
        process_iter=lambda: procs,
    )

    assert len(result.adopted) == 1
    assert result.adopted[0].worker_id == "HOST-W1"
    assert result.adopted[0].pid == 9001
    assert result.adopted[0].health_port == 8765
    assert result.adopted[0].agent_id == "HOST-W1"
    assert result.not_adopted == []


def test_port_not_listening():
    w = _worker(2, 8770)
    cfg = _cfg([w])

    result = adopt_running_workers(
        cfg,
        agent_exe_path="agent.exe",
        socket_connect=lambda h, p, t: False,
        httpx_get=lambda url, timeout=1.0: (200, {}),
        process_iter=lambda: [],
    )

    assert result.adopted == []
    assert len(result.not_adopted) == 1
    assert result.not_adopted[0].reason == "port_not_listening"


def test_mismatched_agent_id_no_self_id_fallback():
    w = _worker(3, 8767)
    cfg = _cfg([w])

    result = adopt_running_workers(
        cfg,
        agent_exe_path="agent.exe",
        socket_connect=lambda h, p, t: True,
        httpx_get=lambda url, timeout=1.0: (
            200,
            {"ok": True, "agent_id": "OTHER-W3"},
        ),
        process_iter=lambda: [
            _FakeProc(
                9010,
                {
                    "pid": 9010,
                    "environ": {"OMNIFRAME_AGENT_PORT": "8767"},
                },
            )
        ],
    )

    assert result.adopted == []
    assert result.not_adopted[0].reason.startswith("agent_id_mismatch:")


def test_self_id_fallback_adopts():
    w = _worker(4, 8768)
    cfg = _cfg([w])

    result = adopt_running_workers(
        cfg,
        agent_exe_path="agent.exe",
        socket_connect=lambda h, p, t: True,
        httpx_get=lambda url, timeout=1.0: (
            200,
            {"ok": True, "self_id": "HOST-W4"},
        ),
        process_iter=lambda: [
            _FakeProc(
                9020,
                {"pid": 9020, "environ": {"OMNIFRAME_AGENT_PORT": "8768"}},
            )
        ],
    )

    assert len(result.adopted) == 1
    assert result.adopted[0].agent_id == "HOST-W4"


def test_partial_fleet_three_of_six():
    workers = [_worker(i, 8764 + i) for i in range(1, 7)]
    cfg = _cfg(workers)
    adoptable_ports = {8765, 8766, 8767}

    def socket_ok(host, port, timeout):
        return port in adoptable_ports

    def httpx_get(url, *, timeout):
        port = int(url.rsplit(":", 1)[-1].split("/")[0])
        wid = f"HOST-W{port - 8764}"
        if port in adoptable_ports:
            return 200, {"agent_id": wid}
        return 200, {"agent_id": "wrong"}

    proc_by_port = {
        8765: 9101,
        8766: 9102,
        8767: 9103,
    }

    def iter_procs():
        for port, pid in proc_by_port.items():
            yield _FakeProc(
                pid,
                {"pid": pid, "environ": {"OMNIFRAME_AGENT_PORT": str(port)}},
            )

    result = adopt_running_workers(
        cfg,
        agent_exe_path="OmniFrame_Agent.exe",
        socket_connect=socket_ok,
        httpx_get=httpx_get,
        process_iter=iter_procs,
    )

    assert len(result.adopted) == 3
    assert {a.worker_id for a in result.adopted} == {"HOST-W1", "HOST-W2", "HOST-W3"}
    assert len(result.not_adopted) == 3
    not_ports = {8768, 8769, 8770}
    for na in result.not_adopted:
        w = next(x for x in workers if x.id == na.worker_id)
        if w.health_port in not_ports:
            assert na.reason == "port_not_listening"


def test_multiple_process_matches_picks_non_master():
    w = _worker(1, 8765)
    cfg = _cfg([w])
    procs = [
        _FakeProc(4242, {"pid": 4242, "environ": {"OMNIFRAME_AGENT_PORT": "8765"}}),
        _FakeProc(5555, {"pid": 5555, "environ": {"OMNIFRAME_AGENT_PORT": "8765"}}),
    ]

    with mock.patch("omni_agent.master.orphan_adoption.LOG") as log_mock:
        result = adopt_running_workers(
            cfg,
            agent_exe_path="agent.exe",
            master_pid=4242,
            socket_connect=lambda h, p, t: True,
            httpx_get=lambda url, timeout=1.0: (200, {"agent_id": "HOST-W1"}),
            process_iter=lambda: procs,
        )

    assert result.adopted[0].pid == 5555
    log_mock.warning.assert_called()

# Created and developed by Jai Singh
