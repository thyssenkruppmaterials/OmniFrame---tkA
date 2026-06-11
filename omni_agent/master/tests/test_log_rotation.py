# Created and developed by Jai Singh
"""Log rotation tests (Phase C)."""

from __future__ import annotations

import queue
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.log_rotation import (  # noqa: E402
    MAX_FILE_BYTES,
    log_filename,
    rotation_loop,
    sweep_old_logs,
    worker_log_prefix,
    write_current_pointer,
)


def _entry(line: str = "test") -> dict:
    return {
        "ts": "2026-05-21T12:00:00.000Z",
        "stream": "stdout",
        "worker_id": "HOST-W1",
        "line": line,
    }


def test_worker_log_prefix():
    assert worker_log_prefix("CITRIX-W3") == "W3"


def test_rotation_writes_lines(tmp_path: Path):
    log_q: queue.Queue = queue.Queue()
    stop = threading.Event()
    log_q.put(_entry("alpha"))
    log_q.put(_entry("beta"))
    stop.set()

    rotation_loop("HOST-W1", tmp_path, log_q, stop, retention_days=7)

    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    log_path = tmp_path / log_filename("W1", day)
    assert log_path.is_file()
    text = log_path.read_text(encoding="utf-8")
    assert "alpha" in text
    assert "[stdout]" in text
    ptr = tmp_path / "W1-current.txt"
    assert ptr.is_file()


def test_size_rotation_creates_new_file_header(tmp_path: Path):
    log_q: queue.Queue = queue.Queue()
    stop = threading.Event()
    big_line = "x" * (MAX_FILE_BYTES + 1024)
    log_q.put(_entry(big_line))
    stop.set()

    rotation_loop("HOST-W1", tmp_path, log_q, stop, retention_days=7)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    log_path = tmp_path / log_filename("W1", day)
    assert log_path.stat().st_size > 0
    text = log_path.read_text(encoding="utf-8")
    assert "# OmniFrame Agent Master log" in text


def test_retention_sweep_deletes_old_files(tmp_path: Path):
    prefix = "W1"
    old = tmp_path / f"{prefix}-2020-01-01.log"
    old.write_text("old", encoding="utf-8")
    recent = tmp_path / f"{prefix}-2026-05-20.log"
    recent.write_text("recent", encoding="utf-8")

    sweep_old_logs(tmp_path, prefix, retention_days=7)
    assert not old.exists()
    assert recent.exists()


def test_midnight_roll_triggers_sweep(tmp_path: Path):
    log_q: queue.Queue = queue.Queue()
    stop = threading.Event()

    t0 = datetime(2026, 5, 20, 23, 59, 59, tzinfo=timezone.utc)
    t1 = datetime(2026, 5, 21, 0, 0, 1, tzinfo=timezone.utc)

    with mock.patch("omni_agent.master.log_rotation.datetime") as dt_mock:
        dt_mock.now.side_effect = [t0, t0, t1, t1]
        dt_mock.side_effect = lambda *a, **k: datetime(*a, **k)
        dt_mock.strftime = datetime.strftime
        dt_mock.strptime = datetime.strptime
        dt_mock.utcnow = datetime.utcnow

        old = tmp_path / "W1-2020-01-01.log"
        old.write_text("stale", encoding="utf-8")
        log_q.put(_entry("roll"))
        stop.set()
        rotation_loop("HOST-W1", tmp_path, log_q, stop, retention_days=7)

    assert not old.exists()


def test_current_pointer_file(tmp_path: Path):
    target = tmp_path / "W2-2026-05-21.log"
    target.write_text("", encoding="utf-8")
    write_current_pointer(tmp_path, "W2", target)
    ptr = tmp_path / "W2-current.txt"
    assert target.resolve().as_posix() in ptr.read_text(encoding="utf-8")

# Created and developed by Jai Singh
