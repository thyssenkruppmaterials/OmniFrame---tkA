# Created and developed by Jai Singh
"""Pure tile button enablement — no Tk root."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.state import (  # noqa: E402
    TilePillState,
    WorkerRuntimeState,
    compute_button_state,
    is_running,
)


def _snap(**kwargs) -> WorkerRuntimeState:
    base = dict(
        worker_id="QA-W1",
        label="Bay 1",
        health_port=8765,
        sap_conn_idx=0,
        sap_session_index=0,
    )
    base.update(kwargs)
    return WorkerRuntimeState(**base)


def test_is_running_process_or_adopted():
    assert is_running(_snap(process_alive=True)) is True
    assert is_running(_snap(is_adopted=True, adopted_pid=999)) is True
    assert is_running(_snap()) is False


def test_button_state_stopped():
    snap = _snap(pill=TilePillState.STOPPED, process_alive=False)
    states = compute_button_state(snap)
    assert states["fix"] is True
    assert states["start"] is True
    assert states["stop"] is False
    assert states["restart"] is False
    assert states["reassign"] is False
    assert states["console"] is False


def test_button_state_connecting():
    snap = _snap(pill=TilePillState.CONNECTING, process_alive=True)
    states = compute_button_state(snap)
    assert states["start"] is False
    assert states["stop"] is True
    assert states["restart"] is True
    assert states["reassign"] is True
    assert states["console"] is True
    assert states["fix"] is True


def test_button_state_connected():
    snap = _snap(pill=TilePillState.CONNECTED, process_alive=True)
    states = compute_button_state(snap)
    assert states["start"] is False
    assert states["stop"] is True
    assert states["console"] is True


def test_button_state_disconnected():
    snap = _snap(pill=TilePillState.DISCONNECTED, process_alive=True)
    states = compute_button_state(snap)
    assert states["start"] is False
    assert states["stop"] is True
    assert states["console"] is True


def test_button_state_adopted():
    snap = _snap(
        pill=TilePillState.CONNECTING,
        process_alive=True,
        is_adopted=True,
        console_available=False,
    )
    states = compute_button_state(snap)
    assert states["start"] is False
    assert states["stop"] is True
    assert states["restart"] is True
    assert states["reassign"] is True
    assert states["console"] is False
    assert states["fix"] is True

# Created and developed by Jai Singh
