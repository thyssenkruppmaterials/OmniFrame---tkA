# Created and developed by Jai Singh
"""Config loader validation tests."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
import sys

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.config import (  # noqa: E402
    default_config,
    load_config,
    validate_config,
    MasterConfig,
    MasterSettings,
    WorkerConfig,
)


def test_default_config_six_workers_w6_no_autostart():
    cfg = default_config()
    assert cfg.master.workers == 6
    assert len(cfg.workers) == 6
    assert cfg.workers[5].auto_start is False
    assert cfg.workers[0].health_port == 8765
    assert cfg.workers[5].health_port == 8770
    assert cfg.using_builtin_defaults is True


def test_validate_rejects_duplicate_ports():
    cfg = default_config()
    cfg.workers[1].health_port = cfg.workers[0].health_port
    with pytest.raises(ValueError, match="Duplicate health_port"):
        validate_config(cfg)


def test_validate_rejects_worker_count_out_of_range():
    cfg = default_config()
    cfg.master.workers = 13
    with pytest.raises(ValueError, match="master.workers"):
        validate_config(cfg)


def test_load_yaml_roundtrip():
    cfg = default_config()
    host = os.environ.get("COMPUTERNAME", "TESTHOST")
    yaml_text = f"""
master:
  workers: 2
workers:
  - id: {host}-W1
    label: A
    sap_conn_idx: 0
    sap_session_index: 0
    auto_start: true
    health_port: 8765
  - id: {host}-W2
    label: B
    sap_conn_idx: 0
    sap_session_index: 1
    auto_start: true
    health_port: 8766
"""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "master_config.yaml"
        path.write_text(yaml_text, encoding="utf-8")
        loaded = load_config(path)
        assert loaded.master.workers == 2
        assert loaded.workers[0].id.endswith("-W1")

# Created and developed by Jai Singh
