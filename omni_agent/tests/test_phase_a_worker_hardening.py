# Created and developed by Jai Singh
"""Unit tests for Phase A worker hardening in `omni_agent/agent.py`.

Covers the Multi-Session Agent Master plan (Phase A exit criteria):
    - POST /admin/ws/reconnect
    - POST /admin/job/abort
    - POST /admin/sap/reattach
    - GET /health extended snapshot fields
    - Boot-time env vars (port, self_id, SAP indices)
    - AGENT_VERSION 2.1.0 + new AGENT_CAPABILITIES entries

Run with:
    python3 -m pytest omni_agent/tests/test_phase_a_worker_hardening.py -v

Pure Python — no SAP COM, no live rust-work-service. Mocks
`WorkServiceWsClient`, `jobs_fail`, `sap_connect`, and COM init.

When `fastapi` / `agent.py` cannot be imported the suite short-circuits
with `pytest.skip` (same pattern as `test_builtin_pick_completed.py`).
"""
from __future__ import annotations

import os
import sys
import time
from typing import Any
from unittest import mock

import pytest


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)


try:
    import agent  # type: ignore
    from fastapi.testclient import TestClient

    _AGENT_OK = True
    _AGENT_IMPORT_ERROR: str | None = None
except Exception as e:  # pragma: no cover - defensive
    _AGENT_OK = False
    _AGENT_IMPORT_ERROR = f"{type(e).__name__}: {e}"
    agent = None  # type: ignore
    TestClient = None  # type: ignore


skipif_no_agent = pytest.mark.skipif(
    not _AGENT_OK,
    reason=f"omni_agent/agent.py import failed: {_AGENT_IMPORT_ERROR}",
)


# Phase A capability ids (sub-agent A1 edit plan).
PHASE_A_CAPABILITIES: tuple[str, ...] = (
    "master-controller-supported",
    "admin-ws-reconnect",
    "admin-job-abort",
    "admin-sap-reattach",
    "health-extended-fields",
    "agent-port-override",
    "agent-self-id-override",
    "agent-sap-pin-env-override",
)


class _FakeWorkServiceWsClient:
    """Minimal stand-in for `work_service_ws.WorkServiceWsClient`."""

    def __init__(self) -> None:
        self.stop_calls = 0
        self.start_calls = 0
        self._connected = True
        self._last_message_received_at = 1000.0

    def stop(self) -> None:
        self.stop_calls += 1
        self._connected = False

    def start(self) -> None:
        self.start_calls += 1
        self._connected = True
        self._last_message_received_at = 3000.0

    def is_connected(self) -> bool:
        return self._connected

    def last_message_received_at(self) -> float:
        return self._last_message_received_at


def _slug(s: str) -> str:
    return "".join(c if (c.isalnum() or c in "-_.") else "_" for c in s.strip())


def _default_agent_self_id() -> str:
    host = os.getenv("COMPUTERNAME") or "unknown-host"
    sess = os.getenv("SESSIONNAME") or "Console"
    user = os.getenv("USERNAME") or os.getenv("USER") or "unknown-user"
    return f"{_slug(host)}-{_slug(sess)}-{_slug(user)}"


@pytest.fixture
def client() -> TestClient:
    assert agent is not None and TestClient is not None
    return TestClient(agent.app)


@pytest.fixture(autouse=True)
def _reset_agent_self_id_cache() -> None:
    """`_agent_self_id()` caches in `_AGENT_SELF_ID`; clear between tests."""
    if agent is not None:
        agent._AGENT_SELF_ID = None  # type: ignore[attr-defined]
    yield
    if agent is not None:
        agent._AGENT_SELF_ID = None  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Version + capabilities
# ---------------------------------------------------------------------------
@skipif_no_agent
def test_agent_version_is_2_1_0() -> None:
    assert agent.AGENT_VERSION == "2.1.0"


@skipif_no_agent
def test_agent_capabilities_include_phase_a_entries() -> None:
    caps = set(agent.AGENT_CAPABILITIES)
    missing = [c for c in PHASE_A_CAPABILITIES if c not in caps]
    assert not missing, f"AGENT_CAPABILITIES missing Phase A ids: {missing}"


# ---------------------------------------------------------------------------
# POST /admin/ws/reconnect
# ---------------------------------------------------------------------------
@skipif_no_agent
def test_admin_ws_reconnect_stops_and_starts_client(client: TestClient) -> None:
    fake = _FakeWorkServiceWsClient()
    agent._work_ws_state["client"] = fake  # type: ignore[attr-defined]
    agent._work_ws_state["started"] = True  # type: ignore[attr-defined]

    resp = client.post("/admin/ws/reconnect")

    assert resp.status_code == 200
    body = resp.json()
    assert body.get("ok") is True
    assert fake.stop_calls == 1
    assert fake.start_calls == 1
    assert body.get("ws_connected") is True
    assert body.get("last_message_received_at") == 3000.0


@skipif_no_agent
def test_admin_ws_reconnect_when_no_client_still_ok(client: TestClient) -> None:
    agent._work_ws_state["client"] = None  # type: ignore[attr-defined]
    agent._work_ws_state["started"] = False  # type: ignore[attr-defined]

    with mock.patch.object(agent, "_start_work_service_ws_client") as start_mock:
        resp = client.post("/admin/ws/reconnect")

    assert resp.status_code == 200
    assert resp.json().get("ok") is True
    start_mock.assert_called_once()


# ---------------------------------------------------------------------------
# POST /admin/job/abort
# ---------------------------------------------------------------------------
@skipif_no_agent
def test_admin_job_abort_calls_jobs_fail_with_master_abort_step(
    client: TestClient,
) -> None:
    job_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    agent.state.active_job_id = job_id  # type: ignore[attr-defined]
    agent.state.active_job_started_at = time.time() - 400  # type: ignore[attr-defined]

    with mock.patch.object(
        agent, "jobs_fail", return_value={"ok": True, "rows_affected": 1}
    ) as fail_mock:
        resp = client.post(
            "/admin/job/abort",
            json={"detail": "aborted by master controller"},
        )

    assert resp.status_code == 200
    assert resp.json().get("ok") is True
    fail_mock.assert_called_once()
    called_job_id, req = fail_mock.call_args[0]
    assert called_job_id == job_id
    assert req.step == "master-abort"
    assert req.error  # detail propagated into error string


@skipif_no_agent
def test_admin_job_abort_idempotent_when_job_already_terminal(
    client: TestClient,
) -> None:
    agent.state.active_job_id = "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee"  # type: ignore[attr-defined]

    with mock.patch.object(
        agent,
        "jobs_fail",
        return_value={"ok": True, "rows_affected": 0},
    ) as fail_mock:
        resp = client.post("/admin/job/abort", json={})

    assert resp.status_code == 200
    body = resp.json()
    assert body.get("ok") is True
    assert body.get("already_terminal") is True
    fail_mock.assert_called_once()


@skipif_no_agent
def test_admin_job_abort_no_active_job_returns_ok_noop(client: TestClient) -> None:
    agent.state.active_job_id = None  # type: ignore[attr-defined]
    agent.state.active_job_started_at = None  # type: ignore[attr-defined]

    with mock.patch.object(agent, "jobs_fail") as fail_mock:
        resp = client.post("/admin/job/abort", json={})

    assert resp.status_code == 200
    assert resp.json().get("ok") is True
    fail_mock.assert_not_called()


# ---------------------------------------------------------------------------
# POST /admin/sap/reattach
# ---------------------------------------------------------------------------
@skipif_no_agent
def test_admin_sap_reattach_delegates_to_sap_connect(client: TestClient) -> None:
    with mock.patch.object(
        agent,
        "sap_connect",
        return_value={
            "ok": True,
            "message": "Connected",
            "conn_idx": 0,
            "sess_idx": 1,
        },
    ) as connect_mock:
        resp = client.post("/admin/sap/reattach")

    assert resp.status_code == 200
    assert resp.json().get("ok") is True
    connect_mock.assert_called_once_with()


@skipif_no_agent
def test_admin_sap_reattach_getobject_sapgui_failure(client: TestClient) -> None:
    """Master Fix path D — SAP GUI not running surfaces a typed error."""

    with mock.patch.object(
        agent,
        "sap_connect",
        return_value={"ok": False, "error": "GetObject SAPGUI failed"},
    ):
        resp = client.post("/admin/sap/reattach")

    assert resp.status_code == 200
    body = resp.json()
    assert body.get("ok") is False
    assert body.get("error") == "GetObject SAPGUI failed"


@skipif_no_agent
def test_sap_connect_getobject_failure_surfaces_typed_prefix() -> None:
    """Phase A normalizes COM attach failures for master-readable errors."""

    class _BrokenW32:
        def GetObject(self, _name: str) -> Any:
            raise RuntimeError("SAP not running")

    agent.state.sap_connected = True  # type: ignore[attr-defined]
    with mock.patch.object(agent, "_init_com", return_value=_BrokenW32()):
        result = agent.sap_connect()

    assert result.get("ok") is False
    err = result.get("error") or ""
    assert err == "GetObject SAPGUI failed" or err.startswith("GetObject SAPGUI failed")


# ---------------------------------------------------------------------------
# GET /health — extended fields
# ---------------------------------------------------------------------------
@skipif_no_agent
def test_health_includes_extended_master_snapshot_fields(client: TestClient) -> None:
    fake = _FakeWorkServiceWsClient()
    agent._work_ws_state["client"] = fake  # type: ignore[attr-defined]

    now = time.time()
    agent.state.sap_connected = True  # type: ignore[attr-defined]
    agent.state.active_job_id = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee"  # type: ignore[attr-defined]
    agent.state.active_job_started_at = now - 120  # type: ignore[attr-defined]
    agent.state.active_job_progress_at = now - 45  # type: ignore[attr-defined]
    agent.state.work_service_jwt = "eyJ.agent.jwt"  # type: ignore[attr-defined]
    agent.state.last_sap_error = "session_index_invalid"  # type: ignore[attr-defined]
    agent._work_service_jwt_state["failures"] = 0  # type: ignore[attr-defined]

    resp = client.get("/health")

    assert resp.status_code == 200
    body = resp.json()
    assert body.get("ok") is True
    assert body.get("version") == "2.1.0"
    assert body.get("ws_connected") is True
    assert body.get("sap_attached") is True
    assert body.get("identity_status") in ("ok", "rejected", "unknown")
    assert body.get("last_sap_error") == "session_index_invalid"
    assert isinstance(body.get("job_age_seconds"), int)
    assert body["job_age_seconds"] >= 119
    assert isinstance(body.get("job_progress_unchanged_seconds"), int)
    assert body["job_progress_unchanged_seconds"] >= 44
    # Legacy fields preserved (backward compat).
    assert "sap_connected" in body
    assert "capabilities" in body


@skipif_no_agent
def test_health_job_metrics_null_when_no_active_job(client: TestClient) -> None:
    agent.state.active_job_id = None  # type: ignore[attr-defined]
    agent.state.active_job_started_at = None  # type: ignore[attr-defined]
    agent.state.active_job_progress_at = None  # type: ignore[attr-defined]

    resp = client.get("/health")

    assert resp.status_code == 200
    body = resp.json()
    assert body.get("job_age_seconds") is None
    assert body.get("job_progress_unchanged_seconds") is None


@skipif_no_agent
def test_health_identity_status_ok_when_agent_jwt_present(
    client: TestClient,
) -> None:
    agent.state.work_service_jwt = "eyJ.agent.jwt"  # type: ignore[attr-defined]
    agent._work_service_jwt_state["failures"] = 0  # type: ignore[attr-defined]

    resp = client.get("/health")

    assert resp.status_code == 200
    assert resp.json().get("identity_status") == "ok"


@skipif_no_agent
def test_health_identity_status_rejected_after_exchange_failure(
    client: TestClient,
) -> None:
    agent.state.work_service_jwt = ""  # type: ignore[attr-defined]
    agent._work_service_jwt_state["failures"] = 3  # type: ignore[attr-defined]
    agent._work_service_jwt_state["last_failure_at"] = time.time()  # type: ignore[attr-defined]

    resp = client.get("/health")

    assert resp.status_code == 200
    assert resp.json().get("identity_status") == "rejected"


@skipif_no_agent
def test_health_identity_status_unknown_without_jwt_or_failure(
    client: TestClient,
) -> None:
    agent.state.work_service_jwt = ""  # type: ignore[attr-defined]
    agent._work_service_jwt_state["failures"] = 0  # type: ignore[attr-defined]
    agent._work_service_jwt_state["last_failure_at"] = 0.0  # type: ignore[attr-defined]

    resp = client.get("/health")

    assert resp.status_code == 200
    assert resp.json().get("identity_status") == "unknown"


# ---------------------------------------------------------------------------
# Env vars at boot
# ---------------------------------------------------------------------------
@skipif_no_agent
def test_read_int_env_helper_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    """Phase A extracts `_read_int_env` for port + SAP index boot vars."""
    if not hasattr(agent, "_read_int_env"):
        pytest.skip("Phase A `_read_int_env` not present yet")
    monkeypatch.delenv("OMNIFRAME_AGENT_PORT", raising=False)
    assert agent._read_int_env("OMNIFRAME_AGENT_PORT", 8765) == 8765


@skipif_no_agent
def test_read_int_env_helper_honours_override(monkeypatch: pytest.MonkeyPatch) -> None:
    if not hasattr(agent, "_read_int_env"):
        pytest.skip("Phase A `_read_int_env` not present yet")
    monkeypatch.setenv("OMNIFRAME_AGENT_PORT", "8767")
    assert agent._read_int_env("OMNIFRAME_AGENT_PORT", 8765) == 8767


@skipif_no_agent
def test_agent_port_module_constant_matches_boot_default() -> None:
    """Without OMNIFRAME_AGENT_PORT in the process env, AGENT_PORT stays 8765."""
    if os.environ.get("OMNIFRAME_AGENT_PORT"):
        pytest.skip("OMNIFRAME_AGENT_PORT already set in test runner environment")
    assert agent.AGENT_PORT == 8765


@skipif_no_agent
def test_agent_self_id_honours_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMNIFRAME_AGENT_SELF_ID_OVERRIDE", "CITRIX01-W1")
    agent._AGENT_SELF_ID = None  # type: ignore[attr-defined]
    assert agent._agent_self_id() == "CITRIX01-W1"


@skipif_no_agent
def test_agent_self_id_default_without_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OMNIFRAME_AGENT_SELF_ID_OVERRIDE", raising=False)
    agent._AGENT_SELF_ID = None  # type: ignore[attr-defined]
    assert agent._agent_self_id() == _default_agent_self_id()


@skipif_no_agent
def test_sap_indices_env_win_over_pinned_session(monkeypatch: pytest.MonkeyPatch) -> None:
    """Master-supplied indices must win over config.json `pinned_session`."""
    if not hasattr(agent, "_seed_sap_indices_from_env"):
        pytest.skip("Phase A `_seed_sap_indices_from_env` not present yet")

    monkeypatch.setenv("OMNIFRAME_SAP_CONN_IDX", "2")
    monkeypatch.setenv("OMNIFRAME_SAP_SESS_IDX", "3")
    agent.state.pinned_session = {"conn_idx": 0, "sess_idx": 0}  # type: ignore[attr-defined]
    agent._sap_conn_idx = 0  # type: ignore[attr-defined]
    agent._sap_sess_idx = 0  # type: ignore[attr-defined]

    agent._seed_sap_indices_from_env()
    agent._restore_pinned_session_indexes()

    assert agent._sap_conn_idx == 2
    assert agent._sap_sess_idx == 3


@skipif_no_agent
def test_sap_indices_restore_pin_when_no_env_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if not hasattr(agent, "_seed_sap_indices_from_env"):
        pytest.skip("Phase A `_seed_sap_indices_from_env` not present yet")

    monkeypatch.delenv("OMNIFRAME_SAP_CONN_IDX", raising=False)
    monkeypatch.delenv("OMNIFRAME_SAP_SESS_IDX", raising=False)
    agent.state.pinned_session = {"conn_idx": 1, "sess_idx": 4}  # type: ignore[attr-defined]
    agent._sap_conn_idx = 0  # type: ignore[attr-defined]
    agent._sap_sess_idx = 0  # type: ignore[attr-defined]

    agent._seed_sap_indices_from_env()
    agent._restore_pinned_session_indexes()

    assert agent._sap_conn_idx == 1
    assert agent._sap_sess_idx == 4


# ---------------------------------------------------------------------------
# Backward compatibility
# ---------------------------------------------------------------------------
@skipif_no_agent
def test_health_backward_compat_fields_unchanged(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    for key in ("ok", "version", "sap_connected", "started_at", "citrix", "capabilities"):
        assert key in body, f"legacy /health field {key!r} removed"


@skipif_no_agent
def test_backward_compat_default_port_and_self_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Single-exe launch with no master env vars keeps the v2.0 contract."""
    for name in (
        "OMNIFRAME_AGENT_PORT",
        "OMNIFRAME_AGENT_SELF_ID_OVERRIDE",
        "OMNIFRAME_SAP_CONN_IDX",
        "OMNIFRAME_SAP_SESS_IDX",
    ):
        monkeypatch.delenv(name, raising=False)

    if hasattr(agent, "_read_int_env"):
        assert agent._read_int_env("OMNIFRAME_AGENT_PORT", 8765) == 8765
    elif not os.environ.get("OMNIFRAME_AGENT_PORT"):
        assert agent.AGENT_PORT == 8765

    agent._AGENT_SELF_ID = None  # type: ignore[attr-defined]
    assert agent._agent_self_id() == _default_agent_self_id()

# Created and developed by Jai Singh
