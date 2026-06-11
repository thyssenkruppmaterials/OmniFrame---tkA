# Created and developed by Jai Singh
"""Tests for master.require_service_keys toggle (wizard + supervisor + settings)."""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.config import (  # noqa: E402
    MasterConfig,
    MasterSettings,
    WorkerConfig,
    apply_config_diff,
    config_to_yaml_dict,
    load_config,
    write_master_config,
)
from omni_agent.master.register_identities_logic import gate_next  # noqa: E402
from omni_agent.master.settings_logic import detect_restart_required  # noqa: E402
from omni_agent.master.wizard import resume_step_for_missing_keys  # noqa: E402
from omni_agent.master.wizard_state import WizardState  # noqa: E402

pytest.importorskip("psutil")
from omni_agent.master.supervisor import WorkerSupervisor  # noqa: E402


def _worker_cfg(require_service_keys: bool = True) -> MasterConfig:
    w = WorkerConfig(
        id="TESTHOST-W1",
        label="Bay 1",
        sap_conn_idx=0,
        sap_session_index=0,
        auto_start=True,
        health_port=8765,
    )
    return MasterConfig(
        master=MasterSettings(workers=1, require_service_keys=require_service_keys),
        workers=[w],
    )


def test_master_settings_require_service_keys_yaml_roundtrip():
    cfg = _worker_cfg(require_service_keys=False)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "master_config.yaml"
        write_master_config(cfg, path)
        loaded = load_config(path)
        assert loaded.master.require_service_keys is False


def test_load_config_defaults_require_service_keys_true_when_key_missing():
    host = "TESTHOST"
    yaml_text = f"""
master:
  workers: 1
workers:
  - id: {host}-W1
    label: A
    sap_conn_idx: 0
    sap_session_index: 0
    auto_start: true
    health_port: 8765
"""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "master_config.yaml"
        path.write_text(yaml_text, encoding="utf-8")
        loaded = load_config(path)
        assert loaded.master.require_service_keys is True


def test_wizard_state_require_service_keys_json_roundtrip():
    state = WizardState(require_service_keys=False, worker_count=2)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "wizard_state.json"
        path.write_text(json.dumps(state.to_dict(), indent=2), encoding="utf-8")
        raw = json.loads(path.read_text(encoding="utf-8"))
        loaded = WizardState.from_dict(raw)
        assert loaded.require_service_keys is False


def test_wizard_state_missing_key_defaults_true():
    loaded = WizardState.from_dict({"worker_count": 6})
    assert loaded.require_service_keys is True


def test_gate_next_skip_strict_allows_empty_workers():
    assert gate_next(skip_strict=True, worker_ids=[]) is True


def test_gate_next_strict_requires_all_registered():
    assert gate_next(skip_strict=False, worker_ids=["HOST-W1"]) is False


def test_supervisor_build_env_omits_require_key_when_false():
    cfg = _worker_cfg(require_service_keys=False)
    sup = WorkerSupervisor(cfg)
    env = sup.build_env(cfg.workers[0])
    assert "OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY" not in env
    assert env["OMNIFRAME_AGENT_SELF_ID_OVERRIDE"] == "TESTHOST-W1"


def test_supervisor_build_env_sets_require_key_when_true():
    cfg = _worker_cfg(require_service_keys=True)
    sup = WorkerSupervisor(cfg)
    env = sup.build_env(cfg.workers[0])
    assert env["OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY"] == "1"


def test_detect_restart_required_for_require_service_keys_flip():
    old = _worker_cfg(require_service_keys=True)
    new = _worker_cfg(require_service_keys=False)
    paths = detect_restart_required(old, new)
    assert "master.require_service_keys" in paths
    diff = apply_config_diff(old, new)
    assert "master.require_service_keys" in diff


def test_resume_step_skips_register_when_soft_mode():
    state = WizardState(
        current_step=2,
        require_service_keys=False,
        pairings=[{"worker_id": "HOST-W1"}],
    )
    assert resume_step_for_missing_keys(state) == 2


def test_config_to_yaml_dict_includes_require_service_keys():
    cfg = _worker_cfg(require_service_keys=False)
    data = config_to_yaml_dict(cfg)
    assert data["master"]["require_service_keys"] is False

# Created and developed by Jai Singh
