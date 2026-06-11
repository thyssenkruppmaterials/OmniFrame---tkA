# Created and developed by Jai Singh
"""Console ring buffer tests (Phase C)."""

from __future__ import annotations

import sys
import threading
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.console_buffer import (  # noqa: E402
    ConsoleRingBuffer,
    DEFAULT_RING_SIZE,
    format_console_line,
)


def _entry(n: int, worker_id: str = "HOST-W1") -> dict:
    return {
        "ts": f"2026-05-21T12:00:{n:02d}.000Z",
        "stream": "stdout",
        "worker_id": worker_id,
        "line": f"line-{n}",
    }


def test_ring_enforces_maxlen():
    buf = ConsoleRingBuffer(maxlen=100)
    for i in range(150):
        buf.append(_entry(i))
    snap = buf.snapshot()
    assert len(snap) == 100
    assert snap[0]["line"] == "line-50"
    assert snap[-1]["line"] == "line-149"


def test_fifo_ordering():
    buf = ConsoleRingBuffer(maxlen=100)
    for i in range(20):
        buf.append(_entry(i))
    lines = [e["line"] for e in buf.snapshot()]
    assert lines == [f"line-{i}" for i in range(20)]


def test_snapshot_last_n():
    buf = ConsoleRingBuffer(maxlen=100)
    for i in range(30):
        buf.append(_entry(i))
    tail = buf.snapshot(last_n=5)
    assert len(tail) == 5
    assert tail[-1]["line"] == "line-29"


def test_tail_drop_counter():
    buf = ConsoleRingBuffer(maxlen=100)
    assert buf.tail_drops == 0
    buf.record_tail_drop()
    buf.record_tail_drop()
    assert buf.tail_drops == 2


def test_thread_safety_under_load():
    buf = ConsoleRingBuffer(maxlen=1000)
    errors: list[Exception] = []

    def writer(start: int) -> None:
        try:
            for i in range(200):
                buf.append(_entry(start + i))
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(i * 200,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)
    assert not errors
    assert len(buf) <= DEFAULT_RING_SIZE if buf.maxlen >= 1600 else len(buf) <= 1000


def test_format_console_line():
    text = format_console_line(_entry(1))
    assert "[stdout]" in text
    assert "line-1" in text

# Created and developed by Jai Singh
