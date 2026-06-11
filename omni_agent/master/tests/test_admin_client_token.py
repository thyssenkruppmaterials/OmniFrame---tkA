# Created and developed by Jai Singh
"""Tests for master admin token persistence and supervisor env injection."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.admin_client import (  # noqa: E402
    load_or_create_master_admin_token,
)
from omni_agent.master.config import MasterConfig, MasterSettings, WorkerConfig  # noqa: E402


def test_load_or_create_master_admin_token_creates_restricted_file(tmp_path, monkeypatch):
    token_path = tmp_path / "master_admin_token.txt"
    monkeypatch.setattr(
        "omni_agent.master.admin_client._ADMIN_TOKEN_FILE",
        token_path,
    )
    monkeypatch.setattr(
        "omni_agent.master.admin_client._ADMIN_TOKEN_DIR",
        tmp_path,
    )

    first = load_or_create_master_admin_token()
    second = load_or_create_master_admin_token()

    assert first
    assert first == second
    assert token_path.read_text(encoding="utf-8").strip() == first
    if sys.platform != "win32":
        assert oct(token_path.stat().st_mode & 0o777) == oct(0o600)


def test_supervisor_build_env_injects_admin_token() -> None:
    pytest.importorskip("psutil")
    from omni_agent.master.supervisor import WorkerSupervisor
    w = WorkerConfig(
        id="TESTHOST-W1",
        label="Bay 1",
        sap_conn_idx=0,
        sap_session_index=0,
        auto_start=True,
        health_port=8765,
    )
    cfg = MasterConfig(master=MasterSettings(workers=1), workers=[w])

    with mock.patch(
        "omni_agent.master.supervisor.load_or_create_master_admin_token",
        return_value="test-master-admin-token",
    ):
        sup = WorkerSupervisor(cfg)
        env = sup.build_env(w)

    assert env["OMNIFRAME_AGENT_ADMIN_TOKEN"] == "test-master-admin-token"

# Created and developed by Jai Singh
