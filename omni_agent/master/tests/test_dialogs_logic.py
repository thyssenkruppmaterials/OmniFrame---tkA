# Created and developed by Jai Singh
"""Pure dialog logic — no Tk root (Phase D4)."""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.dialogs import (  # noqa: E402
    build_reregister_url,
    fetch_free_sessions_from_peer,
    parse_free_session_tuples,
    select_healthy_peer_port,
    should_show_admin_confirm,
)
from omni_agent.master.fix_engine import FixAction  # noqa: E402
from omni_agent.master.state import WorkerRuntimeState, TilePillState  # noqa: E402


def _worker(
    *,
    worker_id: str,
    port: int,
    process_alive: bool = True,
    sap_attached: bool = False,
) -> WorkerRuntimeState:
    return WorkerRuntimeState(
        worker_id=worker_id,
        label=worker_id,
        health_port=port,
        sap_conn_idx=0,
        sap_session_index=0,
        pill=TilePillState.CONNECTED if sap_attached else TilePillState.DEGRADED,
        process_alive=process_alive,
        sap_attached=sap_attached,
    )


# --- Admin confirm gating ---


@pytest.mark.parametrize(
    "action",
    [
        FixAction.RESPAWN,
        FixAction.KILL_AND_RESPAWN,
        FixAction.SAP_REATTACH,
        FixAction.REASSIGN_SESSION,
    ],
)
def test_admin_confirm_required_for_destructive_actions(action: FixAction):
    assert should_show_admin_confirm(action, job_age_seconds=42, fix_admin_confirm_required=True)


@pytest.mark.parametrize(
    "action",
    [
        FixAction.WS_RECONNECT,
        FixAction.ABORT_STALE_JOB,
        FixAction.REREGISTER_KEY,
        FixAction.SHOW_NETWORK_DIAGNOSTIC,
        FixAction.SHOW_HEALTHY_TOAST,
    ],
)
def test_admin_confirm_not_required_for_bypass_actions(action: FixAction):
    assert not should_show_admin_confirm(
        action, job_age_seconds=42, fix_admin_confirm_required=True
    )


def test_admin_confirm_skipped_when_no_job():
    assert not should_show_admin_confirm(
        FixAction.KILL_AND_RESPAWN,
        job_age_seconds=None,
        fix_admin_confirm_required=True,
    )


def test_admin_confirm_skipped_when_toggle_off():
    assert not should_show_admin_confirm(
        FixAction.KILL_AND_RESPAWN,
        job_age_seconds=99,
        fix_admin_confirm_required=False,
    )


def test_admin_confirm_accepts_string_action_values():
    assert should_show_admin_confirm(
        "kill_and_respawn",
        job_age_seconds=10,
        fix_admin_confirm_required=True,
    )


# --- Peer selection ---


def test_select_healthy_peer_port_first_match_only():
    workers = {
        "W1": _worker(worker_id="W1", port=8765, sap_attached=False),
        "W2": _worker(worker_id="W2", port=8766, sap_attached=True),
        "W3": _worker(worker_id="W3", port=8767, sap_attached=True),
    }
    assert select_healthy_peer_port(workers, exclude_id="W1") == 8766


def test_select_healthy_peer_port_excludes_self_and_dead():
    workers = {
        "W1": _worker(worker_id="W1", port=8765, process_alive=False, sap_attached=True),
        "W2": _worker(worker_id="W2", port=8766, sap_attached=False),
    }
    assert select_healthy_peer_port(workers, exclude_id="W2") is None


def test_select_healthy_peer_port_accepts_dict_rows():
    workers = {
        "peer": {"process_alive": True, "sap_attached": True, "health_port": 8770},
    }
    assert select_healthy_peer_port(workers, exclude_id="self") == 8770


# --- parse_free_session_tuples ---


def test_parse_free_session_tuples_skips_active():
    payload = {
        "ok": True,
        "connections": [
            {
                "index": 0,
                "sessions": [
                    {"index": 0, "is_active": True},
                    {"index": 1, "is_active": False},
                    {"index": 2, "is_active": False},
                ],
            },
            {
                "index": 1,
                "sessions": [
                    {"index": 0, "is_active": False},
                ],
            },
        ],
    }
    assert parse_free_session_tuples(payload) == [(0, 1), (0, 2), (1, 0)]


def test_parse_free_session_tuples_empty_on_failure():
    assert parse_free_session_tuples({"ok": False, "connections": []}) == []


# --- build_reregister_url ---


def test_build_reregister_url_includes_register_param():
    url = build_reregister_url("CITRIX01-W3")
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    assert parsed.path.endswith("/admin/sap-testing")
    assert qs["tab"] == ["agent-setup"]
    assert qs["register"] == ["CITRIX01-W3"]


def test_build_reregister_url_custom_base():
    url = build_reregister_url("HOST-W1", base="https://example.test/")
    assert url.startswith("https://example.test/admin/sap-testing?")


def test_fetch_free_sessions_from_peer_calls_one_peer():
    workers = {
        "W1": {"process_alive": True, "sap_attached": True, "health_port": 8765},
        "W2": {"process_alive": True, "sap_attached": False, "health_port": 8766},
    }
    calls: list[int] = []

    def fetcher(port: int) -> dict:
        calls.append(port)
        return {
            "ok": True,
            "connections": [
                {
                    "index": 0,
                    "sessions": [
                        {"index": 1, "is_active": False},
                        {"index": 2, "is_active": True},
                    ],
                }
            ],
        }

    peer, free = fetch_free_sessions_from_peer(
        workers, "W2", fetch_sessions=fetcher
    )
    assert peer == 8765
    assert free == [(0, 1)]
    assert calls == [8765]

# Created and developed by Jai Singh
