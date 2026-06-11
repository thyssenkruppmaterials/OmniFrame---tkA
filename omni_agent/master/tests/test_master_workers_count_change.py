# Created and developed by Jai Singh
"""Workers count change policy tests (Phase F4)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.config import default_config  # noqa: E402
from omni_agent.master.settings_logic import (  # noqa: E402
    added_worker_ids,
    apply_workers_count_change,
    cleanup_removed_worker_keys,
    detect_restart_required,
    removed_worker_ids,
)


@pytest.fixture
def six_worker_cfg():
    return default_config()


def test_increase_6_to_8_adds_w7_w8(six_worker_cfg):
    host = six_worker_cfg.workers[0].id.rsplit("-W", 1)[0]
    new_cfg = apply_workers_count_change(six_worker_cfg, 8, host_prefix=host)
    assert new_cfg.master.workers == 8
    assert len(new_cfg.workers) == 8
    added = added_worker_ids(six_worker_cfg, new_cfg)
    assert added == [f"{host}-W7", f"{host}-W8"]
    w7 = next(w for w in new_cfg.workers if w.id.endswith("-W7"))
    w8 = next(w for w in new_cfg.workers if w.id.endswith("-W8"))
    assert w7.health_port == 8771
    assert w8.health_port == 8772
    assert w7.sap_session_index == 6
    assert w8.sap_session_index == 7
    assert w7.auto_start is True
    assert new_cfg.workers[0].id == six_worker_cfg.workers[0].id
    assert new_cfg.workers[5].auto_start is False


def test_decrease_6_to_4_orphan_key_cleanup_keep_policy(six_worker_cfg, tmp_path):
    host = six_worker_cfg.workers[0].id.rsplit("-W", 1)[0]
    removed_ids = [f"{host}-W5", f"{host}-W6"]
    with mock.patch(
        "omni_agent.master.config.canonical_service_key_path",
        side_effect=lambda wid: tmp_path / wid / "agent_service_key.txt",
    ):
        for wid in removed_ids:
            path = tmp_path / wid / "agent_service_key.txt"
            path.parent.mkdir(parents=True)
            path.write_text("omni_sk_test", encoding="utf-8")

        new_cfg = apply_workers_count_change(six_worker_cfg, 4, host_prefix=host)
        assert new_cfg.master.workers == 4
        assert removed_worker_ids(six_worker_cfg, new_cfg) == removed_ids

        deleted = cleanup_removed_worker_keys(removed_ids, policy="keep")
        assert deleted == []
        for wid in removed_ids:
            assert (tmp_path / wid / "agent_service_key.txt").is_file()


def test_decrease_6_to_4_orphan_key_cleanup_delete_policy(six_worker_cfg, tmp_path):
    host = six_worker_cfg.workers[0].id.rsplit("-W", 1)[0]
    removed_ids = [f"{host}-W5", f"{host}-W6"]
    with mock.patch(
        "omni_agent.master.config.canonical_service_key_path",
        side_effect=lambda wid: tmp_path / wid / "agent_service_key.txt",
    ):
        for wid in removed_ids:
            path = tmp_path / wid / "agent_service_key.txt"
            path.parent.mkdir(parents=True)
            path.write_text("omni_sk_test", encoding="utf-8")

        deleted = cleanup_removed_worker_keys(removed_ids, policy="delete")
        assert set(deleted) == set(removed_ids)
        for wid in removed_ids:
            assert not (tmp_path / wid / "agent_service_key.txt").exists()


def test_workers_count_change_is_restart_required(six_worker_cfg):
    host = six_worker_cfg.workers[0].id.rsplit("-W", 1)[0]
    new_cfg = apply_workers_count_change(six_worker_cfg, 8, host_prefix=host)
    fields = detect_restart_required(six_worker_cfg, new_cfg)
    assert "master.workers" in fields


def test_label_change_is_hot_apply_not_restart(six_worker_cfg):
    import copy

    new_cfg = copy.deepcopy(six_worker_cfg)
    new_cfg.workers[0].label = "Renamed bay"
    fields = detect_restart_required(six_worker_cfg, new_cfg)
    assert "master.workers" not in fields
    assert "label" not in fields

# Created and developed by Jai Singh
