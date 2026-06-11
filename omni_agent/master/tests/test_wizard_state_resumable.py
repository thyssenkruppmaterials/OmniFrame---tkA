# Created and developed by Jai Singh
"""Wizard state persistence tests."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.wizard_state import (  # noqa: E402
    STEP_PAIR_SESSIONS,
    WizardState,
    clear_wizard_state,
    load_wizard_state,
    save_wizard_state,
    wizard_state_path,
)


@pytest.fixture
def isolated_omniframe_home(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    home = tmp_path / ".omniframe"
    home.mkdir()
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path))
    import omni_agent.master.config as cfg_mod

    monkeypatch.setattr(cfg_mod, "omniframe_home", lambda: home)
    import omni_agent.master.wizard_state as ws_mod

    monkeypatch.setattr(ws_mod, "omniframe_home", lambda: home)
    monkeypatch.setattr(ws_mod, "wizard_state_path", lambda: home / "wizard_state.json")
    yield home


def test_save_load_resume(isolated_omniframe_home: Path):
    state = WizardState(
        current_step=STEP_PAIR_SESSIONS,
        worker_count=4,
        host_prefix="TESTHOST",
        pairings=[{"worker_id": "TESTHOST-W1", "label": "A", "conn_idx": 0, "sess_idx": 0}],
    )
    save_wizard_state(state)
    loaded = load_wizard_state()
    assert loaded is not None
    assert loaded.current_step == STEP_PAIR_SESSIONS
    assert loaded.worker_count == 4
    assert loaded.pairings[0]["worker_id"] == "TESTHOST-W1"


def test_clear_removes_state_file(isolated_omniframe_home: Path):
    save_wizard_state(WizardState())
    clear_wizard_state()
    assert load_wizard_state() is None


def test_partial_state_roundtrip_json(isolated_omniframe_home: Path):
    path = isolated_omniframe_home / "wizard_state.json"
    raw = {
        "version": 1,
        "current_step": 3,
        "worker_count": 6,
        "registration_done": {"HOST-W1": True},
    }
    path.write_text(json.dumps(raw), encoding="utf-8")
    loaded = load_wizard_state()
    assert loaded is not None
    assert loaded.current_step == 3
    assert loaded.registration_done.get("HOST-W1") is True

# Created and developed by Jai Singh
