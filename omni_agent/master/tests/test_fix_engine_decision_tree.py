# Created and developed by Jai Singh
"""Section 5 fix decision tree (modes A–H) and admin-gating."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.fix_engine import (  # noqa: E402
    FixAction,
    HealthSnapshot,
    MasterFixContext,
    pick_fix_action,
    requires_admin_confirm,
)
from omni_agent.master.state import WorkerRuntimeState  # noqa: E402


def _snap(**kwargs) -> HealthSnapshot:
    defaults = {
        "process_alive": True,
        "http_fails": 0,
        "ws_connected": True,
        "ws_down_seconds": 0.0,
        "sap_attached": True,
        "identity_status": "ok",
    }
    defaults.update(kwargs)
    return HealthSnapshot(**defaults)


def _ctx(**kwargs) -> MasterFixContext:
    return MasterFixContext(**kwargs)


# --- Modes A–H ---


def test_mode_a_process_dead_respawn():
    assert pick_fix_action(_snap(process_alive=False), _ctx()) == FixAction.RESPAWN


def test_mode_b_http_fails_kill_and_respawn():
    assert (
        pick_fix_action(_snap(http_fails=3), _ctx())
        == FixAction.KILL_AND_RESPAWN
    )
    assert (
        pick_fix_action(_snap(http_fails=5), _ctx())
        == FixAction.KILL_AND_RESPAWN
    )


def test_mode_h_all_workers_ws_down_network_diagnostic():
    snap = _snap(ws_connected=False, ws_down_seconds=120.0)
    assert (
        pick_fix_action(snap, _ctx(all_workers_ws_down=True))
        == FixAction.SHOW_NETWORK_DIAGNOSTIC
    )


def test_mode_f_identity_rejected_reregister():
    assert (
        pick_fix_action(_snap(identity_status="rejected"), _ctx())
        == FixAction.REREGISTER_KEY
    )


def test_mode_e_session_index_invalid_reassign():
    assert (
        pick_fix_action(
            _snap(sap_attached=False, last_sap_error="session_index_invalid"),
            _ctx(),
        )
        == FixAction.REASSIGN_SESSION
    )


def test_mode_d_sap_not_attached_reattach():
    assert (
        pick_fix_action(
            _snap(sap_attached=False, last_sap_error="GetObject SAPGUI failed"),
            _ctx(),
        )
        == FixAction.SAP_REATTACH
    )
    assert (
        pick_fix_action(_snap(sap_attached=False, last_sap_error=None), _ctx())
        == FixAction.SAP_REATTACH
    )


def test_mode_c_ws_reconnect_under_60s():
    assert (
        pick_fix_action(
            _snap(ws_connected=False, ws_down_seconds=59.0),
            _ctx(),
        )
        == FixAction.WS_RECONNECT
    )


def test_mode_c_ws_kill_at_60s_or_more():
    assert (
        pick_fix_action(
            _snap(ws_connected=False, ws_down_seconds=60.0),
            _ctx(),
        )
        == FixAction.KILL_AND_RESPAWN
    )
    assert (
        pick_fix_action(
            _snap(ws_connected=False, ws_down_seconds=120.0),
            _ctx(),
        )
        == FixAction.KILL_AND_RESPAWN
    )


def test_mode_g_stale_job_abort():
    assert (
        pick_fix_action(
            _snap(job_age_seconds=301, job_progress_unchanged_seconds=61),
            _ctx(),
        )
        == FixAction.ABORT_STALE_JOB
    )


def test_healthy_show_toast():
    assert pick_fix_action(_snap(), _ctx()) == FixAction.SHOW_HEALTHY_TOAST


# --- Priority / edge cases ---


def test_mode_a_wins_over_later_branches():
    snap = _snap(
        process_alive=False,
        http_fails=10,
        ws_connected=False,
        sap_attached=False,
        identity_status="rejected",
    )
    assert pick_fix_action(snap, _ctx(all_workers_ws_down=True)) == FixAction.RESPAWN


def test_mode_b_wins_over_h_and_f():
    snap = _snap(http_fails=3, identity_status="rejected")
    assert (
        pick_fix_action(snap, _ctx(all_workers_ws_down=True))
        == FixAction.KILL_AND_RESPAWN
    )


def test_stale_job_requires_both_thresholds():
    assert (
        pick_fix_action(
            _snap(job_age_seconds=301, job_progress_unchanged_seconds=60),
            _ctx(),
        )
        == FixAction.SHOW_HEALTHY_TOAST
    )
    assert (
        pick_fix_action(
            _snap(job_age_seconds=300, job_progress_unchanged_seconds=61),
            _ctx(),
        )
        == FixAction.SHOW_HEALTHY_TOAST
    )
    assert (
        pick_fix_action(
            _snap(job_age_seconds=None, job_progress_unchanged_seconds=120),
            _ctx(),
        )
        == FixAction.SHOW_HEALTHY_TOAST
    )


def test_worker_runtime_state_to_health_snapshot():
    row = WorkerRuntimeState(
        worker_id="H-W1",
        label="Bay 1",
        health_port=8767,
        sap_conn_idx=0,
        sap_session_index=1,
        process_alive=True,
        consecutive_failures=2,
        ws_connected=True,
        sap_attached=True,
        ws_down_seconds=12.5,
        last_reconnect_reason="TimeoutError: connect",
        job_age_seconds=45,
    )
    snap = row.to_health_snapshot()
    assert snap.http_fails == 2
    assert snap.ws_down_seconds == 12.5
    assert snap.last_reconnect_reason == "TimeoutError: connect"
    assert snap.job_age_seconds == 45


# --- Admin confirm ---


@pytest.mark.parametrize(
    "action,needs_confirm",
    [
        (FixAction.RESPAWN, True),
        (FixAction.KILL_AND_RESPAWN, True),
        (FixAction.SAP_REATTACH, True),
        (FixAction.REASSIGN_SESSION, True),
        (FixAction.WS_RECONNECT, False),
        (FixAction.ABORT_STALE_JOB, False),
        (FixAction.REREGISTER_KEY, False),
        (FixAction.SHOW_HEALTHY_TOAST, False),
    ],
)
def test_admin_confirm_mid_job(action: FixAction, needs_confirm: bool):
    snap = _snap(job_age_seconds=120)
    assert (
        requires_admin_confirm(action, snap, fix_admin_confirm_required=True)
        is needs_confirm
    )


def test_admin_confirm_idle_worker_no_prompt():
    snap = _snap(job_age_seconds=None)
    assert requires_admin_confirm(
        FixAction.RESPAWN, snap, fix_admin_confirm_required=True
    ) is False


def test_admin_confirm_disabled():
    snap = _snap(job_age_seconds=200)
    assert (
        requires_admin_confirm(
            FixAction.KILL_AND_RESPAWN, snap, fix_admin_confirm_required=False
        )
        is False
    )

# Created and developed by Jai Singh
