# Created and developed by Jai Singh
"""HTTP executor tests for master fix actions."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from unittest import mock

import httpx
import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.admin_client import AdminClient  # noqa: E402
from omni_agent.master.fix_actions import (  # noqa: E402
    execute_abort_stale_job,
    execute_sap_reattach,
    execute_ws_reconnect,
)


def _json_response(payload: dict[str, Any], url: str) -> httpx.Response:
    import json

    request = httpx.Request("POST", url)
    return httpx.Response(
        200,
        content=json.dumps(payload).encode("utf-8"),
        request=request,
    )


class _RecordingClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, str], dict[str, Any] | None]] = []

    def post(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
    ) -> httpx.Response:
        self.calls.append((url, "POST", headers or {}, json))
        if url.endswith("/admin/ws/reconnect"):
            return _json_response({"ok": True, "ws_connected": True}, url)
        if url.endswith("/admin/job/abort"):
            return _json_response(
                {
                    "ok": True,
                    "aborted": False,
                    "already_terminal": True,
                    "job_id": "job-1",
                    "rows_affected": 0,
                },
                url,
            )
        if url.endswith("/admin/sap/reattach"):
            return _json_response({"ok": True, "conn_idx": 0, "sess_idx": 1}, url)
        raise AssertionError(f"unexpected url {url}")


def _factory(client: _RecordingClient):
    def _make(_admin_token: str) -> AdminClient:
        return AdminClient(_admin_token, client=client)  # type: ignore[arg-type]

    return _make


def test_execute_ws_reconnect_posts_admin_endpoint_with_token() -> None:
    recording = _RecordingClient()
    on_success = mock.Mock()

    result = execute_ws_reconnect(
        8765,
        admin_token="master-token",
        client_factory=_factory(recording),
        on_success=on_success,
    )

    assert result["ok"] is True
    assert len(recording.calls) == 1
    url, method, headers, body = recording.calls[0]
    assert method == "POST"
    assert url == "http://127.0.0.1:8765/admin/ws/reconnect"
    assert headers["X-Agent-Token"] == "master-token"
    assert body is None
    on_success.assert_called_once_with(result)


def test_execute_sap_reattach_posts_admin_endpoint() -> None:
    recording = _RecordingClient()

    result = execute_sap_reattach(
        8766,
        admin_token="master-token",
        client_factory=_factory(recording),
    )

    assert result["ok"] is True
    url, _, headers, _ = recording.calls[0]
    assert url == "http://127.0.0.1:8766/admin/sap/reattach"
    assert headers["X-Agent-Token"] == "master-token"


def test_execute_abort_stale_job_idempotent_terminal_response() -> None:
    """Second abort on an already-terminal job still returns ok."""
    recording = _RecordingClient()
    results: list[dict[str, Any]] = []

    for _ in range(2):
        results.append(
            execute_abort_stale_job(
                8767,
                admin_token="master-token",
                detail="stale job cleanup",
                client_factory=_factory(recording),
            )
        )

    assert all(r.get("ok") is True for r in results)
    assert all(r.get("already_terminal") is True for r in results)
    assert len(recording.calls) == 2
    _, _, _, body = recording.calls[0]
    assert body == {"detail": "stale job cleanup"}


def test_execute_ws_reconnect_invokes_on_error_callback() -> None:
    broken = mock.Mock()
    broken.post.side_effect = httpx.ConnectError("connection refused")
    on_error = mock.Mock()

    with pytest.raises(httpx.ConnectError):
        execute_ws_reconnect(
            8765,
            admin_token="master-token",
            client_factory=lambda _t: AdminClient("master-token", client=broken),
            on_error=on_error,
        )

    on_error.assert_called_once()

# Created and developed by Jai Singh
