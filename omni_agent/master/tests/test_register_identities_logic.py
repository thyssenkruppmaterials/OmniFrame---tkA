# Created and developed by Jai Singh
"""Register identities pure logic tests."""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.config import write_service_key  # noqa: E402
from omni_agent.master.register_identities_logic import (  # noqa: E402
    all_workers_registered,
    is_valid_service_key,
    reregister_url_for,
    worker_key_registered,
)


def test_is_valid_service_key_prefix():
    assert is_valid_service_key("omni_sk_abc123")
    assert not is_valid_service_key("bad_key")
    assert not is_valid_service_key("omni_sk_")


def test_build_reregister_url_reuse():
    url = reregister_url_for("HOST-W2")
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    assert qs.get("register") == ["HOST-W2"]
    assert qs.get("tab") == ["agent-setup"]


def test_write_service_key_and_registered(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    home = tmp_path / ".omniframe"
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    import omni_agent.master.config as cfg_mod

    monkeypatch.setattr(cfg_mod, "omniframe_home", lambda: home)
    path = write_service_key("TEST-W1", "omni_sk_testkey")
    assert path.is_file()
    assert worker_key_registered("TEST-W1")
    assert all_workers_registered(["TEST-W1"])
    assert not all_workers_registered(["TEST-W1", "TEST-W2"])

# Created and developed by Jai Singh
