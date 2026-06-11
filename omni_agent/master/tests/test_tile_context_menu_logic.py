# Created and developed by Jai Singh
"""Pure tile context menu logic — no Tk root (Phase F3)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.config import (  # noqa: E402
    MasterConfig,
    MasterSettings,
    WorkerConfig,
    load_config,
    master_config_path,
)
from omni_agent.master.tile_context_menu import (  # noqa: E402
    ContextMenuCommand,
    apply_rename_label,
    apply_toggle_auto_start,
    commands_for_state,
    normalize_label,
    toggle_auto_start_label,
)


@pytest.fixture
def isolated_home(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    home = tmp_path / ".omniframe"
    home.mkdir()
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    import omni_agent.master.config as cfg_mod

    monkeypatch.setattr(cfg_mod, "omniframe_home", lambda: home)
    monkeypatch.setattr(
        cfg_mod, "master_config_path", lambda: home / "master_config.yaml"
    )
    yield home


def _sample_cfg(*, auto_start: bool = True) -> MasterConfig:
    w = WorkerConfig(
        id="QA-W1",
        label="Bay 1 — Generic",
        health_port=8765,
        sap_conn_idx=0,
        sap_session_index=0,
        auto_start=auto_start,
    )
    return MasterConfig(master=MasterSettings(workers=1), workers=[w])


def test_commands_for_state_stopped_worker():
    enabled = commands_for_state(process_alive=False, sap_attached=False)
    assert enabled[ContextMenuCommand.RENAME_LABEL] is True
    assert enabled[ContextMenuCommand.TOGGLE_AUTO_START] is True
    assert enabled[ContextMenuCommand.START] is True
    assert enabled[ContextMenuCommand.REPAIR_SESSION] is False
    assert enabled[ContextMenuCommand.RESTART] is False
    assert enabled[ContextMenuCommand.STOP] is False


def test_commands_for_state_alive_sap_attached():
    enabled = commands_for_state(process_alive=True, sap_attached=True)
    assert enabled[ContextMenuCommand.START] is False
    assert enabled[ContextMenuCommand.REPAIR_SESSION] is False
    assert enabled[ContextMenuCommand.RESTART] is True
    assert enabled[ContextMenuCommand.STOP] is True


def test_commands_for_state_alive_sap_detached():
    enabled = commands_for_state(
        process_alive=True, sap_attached=False, identity_ok=True
    )
    assert enabled[ContextMenuCommand.REPAIR_SESSION] is True


def test_commands_for_state_identity_rejected_disables_repair():
    enabled = commands_for_state(
        process_alive=True,
        sap_attached=False,
        identity_ok=False,
    )
    assert enabled[ContextMenuCommand.REPAIR_SESSION] is False


def test_toggle_auto_start_label_text():
    assert toggle_auto_start_label(True) == "Disable auto-start"
    assert toggle_auto_start_label(False) == "Enable auto-start"


def test_normalize_label_trims_and_caps():
    assert normalize_label("  hello world  ") == "hello world"
    assert len(normalize_label("x" * 40)) == 30


def test_apply_rename_label_persists(isolated_home: Path):
    cfg = _sample_cfg()
    path = master_config_path()
    from omni_agent.master.config import write_master_config

    write_master_config(cfg, path)
    apply_rename_label(cfg, "QA-W1", "Bay 1 — Outbound", path=path)
    reloaded = load_config(path)
    assert reloaded.workers[0].label == "Bay 1 — Outbound"


def test_apply_rename_label_rejects_empty(isolated_home: Path):
    cfg = _sample_cfg()
    with pytest.raises(ValueError, match="empty"):
        apply_rename_label(cfg, "QA-W1", "   ")


def test_apply_toggle_auto_start_flips(isolated_home: Path):
    cfg = _sample_cfg(auto_start=True)
    path = master_config_path()
    from omni_agent.master.config import write_master_config

    write_master_config(cfg, path)
    updated, new_val = apply_toggle_auto_start(cfg, "QA-W1", path=path)
    assert new_val is False
    assert updated.workers[0].auto_start is False
    reloaded = load_config(path)
    assert reloaded.workers[0].auto_start is False


def test_apply_toggle_auto_start_unknown_worker():
    cfg = _sample_cfg()
    with pytest.raises(ValueError, match="Unknown worker"):
        apply_toggle_auto_start(cfg, "MISSING-W9")

# Created and developed by Jai Singh
