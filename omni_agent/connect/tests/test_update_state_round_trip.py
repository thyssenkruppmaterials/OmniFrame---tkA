# Created and developed by Jai Singh
"""Update state persistence and 24 h check interval tests."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.update_state import (  # noqa: E402
    UpdateState,
    read_update_state,
    should_check,
    write_update_state,
)


def test_round_trip(tmp_path):
    path = tmp_path / "connect_update_state.json"
    state = UpdateState(
        last_check_utc="2026-05-21T22:30:00Z",
        last_offered_version="0.2.0",
        user_dismissed_for_version=None,
    )
    write_update_state(state, path=path)
    loaded = read_update_state(path=path)
    assert loaded.last_check_utc == "2026-05-21T22:30:00Z"
    assert loaded.last_offered_version == "0.2.0"


def test_corrupt_recovery(tmp_path):
    path = tmp_path / "connect_update_state.json"
    path.write_text("{bad json", encoding="utf-8")
    loaded = read_update_state(path=path)
    assert loaded.last_check_utc is None
    assert not path.exists()


def test_should_check_interval():
    now = datetime(2026, 5, 22, 12, 0, tzinfo=timezone.utc)
    recent = UpdateState(last_check_utc="2026-05-22T11:00:00Z")
    old = UpdateState(last_check_utc="2026-05-20T11:00:00Z")
    assert should_check(UpdateState(), now) is True
    assert should_check(recent, now) is False
    assert should_check(old, now) is True


def test_atomic_write_uses_replace(tmp_path, monkeypatch):
    path = tmp_path / "connect_update_state.json"
    calls: list[tuple] = []

    def _track_replace(src, dst):
        calls.append((Path(src), Path(dst)))
        return Path(src).replace(dst)

    monkeypatch.setattr("omni_agent.connect.update_state.os.replace", _track_replace)
    write_update_state(UpdateState(last_check_utc="2026-05-21T22:30:00Z"), path=path)
    assert calls
    assert json.loads(path.read_text(encoding="utf-8"))["last_check_utc"] == "2026-05-21T22:30:00Z"

# Created and developed by Jai Singh
