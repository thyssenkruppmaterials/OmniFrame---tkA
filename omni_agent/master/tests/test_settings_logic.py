# Created and developed by Jai Singh
"""Phase F1 settings_logic validation and diff tests."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.config import (  # noqa: E402
    MasterConfig,
    MasterSettings,
    WorkerConfig,
    apply_config_diff,
    default_config,
)
from omni_agent.master.settings_logic import (  # noqa: E402
    HOT_APPLY_FIELDS,
    RESTART_REQUIRED_FIELDS,
    apply_workers_count_change,
    clamp_health_probe_interval_ms,
    clamp_log_retention_days,
    clamp_ui_refresh_ms,
    detect_restart_required,
    validate_settings_form,
)


def _cfg(workers: int = 2, **master_kw) -> MasterConfig:
    host = "HOST"
    rows = [
        WorkerConfig(
            id=f"{host}-W{n}",
            label=f"Bay {n}",
            sap_conn_idx=0,
            sap_session_index=n - 1,
            health_port=8764 + n,
        )
        for n in range(1, workers + 1)
    ]
    master = MasterSettings(workers=workers, **master_kw)
    return MasterConfig(master=master, workers=rows)


def test_hot_and_restart_field_constants():
    assert "workers[].label" in HOT_APPLY_FIELDS
    assert "master.ui_refresh_ms" in HOT_APPLY_FIELDS
    assert "workers[].health_port" in RESTART_REQUIRED_FIELDS
    assert "master.workers" in RESTART_REQUIRED_FIELDS
    assert "master.require_service_keys" in RESTART_REQUIRED_FIELDS


def test_detect_restart_required_agent_exe_and_port():
    old = _cfg(2)
    new = _cfg(2)
    new.master.agent_exe_path = r"C:\Agent\OmniFrame_Agent.exe"
    new.workers[0].health_port = 9999
    paths = detect_restart_required(old, new)
    assert "master.agent_exe_path" in paths
    assert "workers[0].health_port" in paths
    assert "master.ui_refresh_ms" not in paths


def test_detect_restart_not_required_for_hot_apply_fields():
    old = _cfg(2)
    new = _cfg(2)
    new.master.ui_refresh_ms = 500
    new.master.sap_logon_path = r"D:\saplogon.exe"
    new.workers[0].label = "Renamed Bay"
    new.workers[0].auto_start = False
    assert detect_restart_required(old, new) == set()


def test_apply_config_diff_returns_frozenset():
    old = _cfg(2)
    new = _cfg(2)
    new.master.workers = 3
    diff = apply_config_diff(old, new)
    assert isinstance(diff, frozenset)
    assert "master.workers" in diff


def test_validate_rejects_duplicate_health_port():
    cfg = _cfg(2)
    cfg.workers[1].health_port = cfg.workers[0].health_port
    errors = validate_settings_form(cfg)
    assert any("Duplicate health_port" in e for e in errors)


def test_validate_rejects_label_over_30_chars():
    cfg = _cfg(1)
    cfg.workers[0].label = "x" * 31
    errors = validate_settings_form(cfg)
    assert any("label must be at most 30" in e for e in errors)


def test_validate_rejects_non_string_extra_env_value():
    cfg = _cfg(1)
    cfg.workers[0].extra_env = {"BAD": 1}  # type: ignore[assignment]
    errors = validate_settings_form(cfg)
    assert any("extra_env values must be strings" in e for e in errors)


def test_clamp_ui_refresh_ms_bounds():
    assert clamp_ui_refresh_ms(100) == 250
    assert clamp_ui_refresh_ms(1000) == 1000
    assert clamp_ui_refresh_ms(9000) == 5000


def test_clamp_health_probe_and_log_retention():
    assert clamp_health_probe_interval_ms(100) == 500
    assert clamp_health_probe_interval_ms(2000) == 2000
    assert clamp_log_retention_days(0) == 1
    assert clamp_log_retention_days(400) == 365


def test_apply_workers_count_change_adds_rows():
    old = default_config()
    old.master.workers = 6
    updated = apply_workers_count_change(old, 8, "CITRIX01")
    assert updated.master.workers == 8
    assert len(updated.workers) == 8
    w8 = updated.workers[7]
    assert w8.id == "CITRIX01-W8"
    assert w8.health_port == 8772
    assert w8.sap_session_index == 7


def test_apply_workers_count_change_keep_policy_retains_rows():
    old = _cfg(4, workers_decrement_policy="keep")
    updated = apply_workers_count_change(old, 2, "HOST")
    assert updated.master.workers == 2
    assert len(updated.workers) == 4


def test_apply_workers_count_change_delete_policy_truncates():
    old = _cfg(4, workers_decrement_policy="delete")
    updated = apply_workers_count_change(old, 2, "HOST")
    assert updated.master.workers == 2
    assert len(updated.workers) == 2

# Created and developed by Jai Singh
