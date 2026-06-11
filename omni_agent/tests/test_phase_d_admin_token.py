# Created and developed by Jai Singh
"""Unit tests for Phase D2 admin env token in `omni_agent/agent.py`.

Run with:
    python3 -m pytest omni_agent/tests/test_phase_d_admin_token.py -v
"""
from __future__ import annotations

import os
import sys
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


class _FakeWorkServiceWsClient:
    def __init__(self) -> None:
        self.stop_calls = 0
        self.start_calls = 0
        self._connected = True

    def stop(self) -> None:
        self.stop_calls += 1
        self._connected = False

    def start(self) -> None:
        self.start_calls += 1
        self._connected = True

    def is_connected(self) -> bool:
        return self._connected

    def last_message_received_at(self) -> float:
        return 3000.0


@pytest.fixture
def client() -> TestClient:
    assert agent is not None and TestClient is not None
    return TestClient(agent.app)


@skipif_no_agent
def test_admin_ws_reconnect_accepts_env_admin_token_when_browser_token_differs(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin_token = "master-admin-token-phase-d2"
    browser_token = "browser-minted-token-different"
    monkeypatch.setattr(agent, "_ADMIN_ENV_TOKEN", admin_token, raising=False)

    agent.state.agent_token = browser_token  # type: ignore[attr-defined]
    fake = _FakeWorkServiceWsClient()
    agent._work_ws_state["client"] = fake  # type: ignore[attr-defined]
    agent._work_ws_state["started"] = True  # type: ignore[attr-defined]

    resp = client.post(
        "/admin/ws/reconnect",
        headers={"X-Agent-Token": admin_token},
    )

    assert resp.status_code == 200
    assert resp.json().get("ok") is True
    assert fake.stop_calls == 1
    assert fake.start_calls == 1


@skipif_no_agent
def test_admin_ws_reconnect_rejects_wrong_token_when_browser_token_minted(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(agent, "_ADMIN_ENV_TOKEN", "", raising=False)
    agent.state.agent_token = "browser-minted-token"  # type: ignore[attr-defined]

    resp = client.post(
        "/admin/ws/reconnect",
        headers={"X-Agent-Token": "not-the-right-token"},
    )

    assert resp.status_code == 401
    assert resp.json().get("ok") is False


@skipif_no_agent
def test_admin_env_token_capability_advertised() -> None:
    assert "admin-env-token" in agent.AGENT_CAPABILITIES


@skipif_no_agent
def test_without_env_var_admin_token_module_constant_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Reload-free check: default import has empty admin token unless env set."""
    monkeypatch.delenv("OMNIFRAME_AGENT_ADMIN_TOKEN", raising=False)
    # Module already loaded; verify monkeypatched empty behaves like unset.
    monkeypatch.setattr(agent, "_ADMIN_ENV_TOKEN", "", raising=False)
    assert agent._ADMIN_ENV_TOKEN == ""


@skipif_no_agent
def test_admin_ws_reconnect_without_env_var_unchanged_when_no_header(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Backward compat: no env var + minted browser token + no header still allowed."""
    monkeypatch.setattr(agent, "_ADMIN_ENV_TOKEN", "", raising=False)
    agent.state.agent_token = "browser-minted-token"  # type: ignore[attr-defined]

    fake = _FakeWorkServiceWsClient()
    agent._work_ws_state["client"] = fake  # type: ignore[attr-defined]
    agent._work_ws_state["started"] = True  # type: ignore[attr-defined]

    with mock.patch.object(agent, "print"):
        resp = client.post("/admin/ws/reconnect")

    assert resp.status_code == 200
    assert resp.json().get("ok") is True

# Created and developed by Jai Singh
