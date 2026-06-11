# Created and developed by Jai Singh
"""Console reader thread tests (Phase C)."""

from __future__ import annotations

import io
import queue
import sys
import threading
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.console_buffer import ConsoleRingBuffer  # noqa: E402
from omni_agent.master.console_reader import (  # noqa: E402
    read_stream_loop,
    spawn_stream_reader,
)


class _FakeStream:
    def __init__(self, lines: list[str]):
        self._lines = [ln + "\n" for ln in lines]
        self._idx = 0
        self.closed = False

    def readline(self) -> str:
        if self._idx >= len(self._lines):
            return ""
        line = self._lines[self._idx]
        self._idx += 1
        return line

    def close(self) -> None:
        self.closed = True


def test_read_stream_tags_stdout_and_appends_buffer():
    buf = ConsoleRingBuffer(maxlen=100)
    tail: queue.Queue = queue.Queue(maxsize=50)
    stop = threading.Event()
    stream = _FakeStream(["hello", "world"])

    read_stream_loop("HOST-W1", stream, "stdout", buf, tail, stop)

    entries = buf.snapshot()
    assert len(entries) == 2
    assert entries[0]["stream"] == "stdout"
    assert entries[0]["worker_id"] == "HOST-W1"
    assert entries[0]["line"] == "hello"
    assert stream.closed is True


def test_reader_exits_on_eof():
    buf = ConsoleRingBuffer(maxlen=100)
    tail: queue.Queue = queue.Queue(maxsize=10)
    stop = threading.Event()
    stream = _FakeStream([])

    read_stream_loop("HOST-W2", stream, "stderr", buf, tail, stop)
    assert len(buf) == 0


def test_tail_queue_full_increments_drop_counter():
    buf = ConsoleRingBuffer(maxlen=100)
    tail: queue.Queue = queue.Queue(maxsize=1)
    stop = threading.Event()
    stream = _FakeStream(["a", "b", "c"])

    read_stream_loop("HOST-W1", stream, "stdout", buf, tail, stop)
    assert len(buf) == 3
    assert buf.tail_drops >= 2


def test_spawn_stream_reader_daemon():
    buf = ConsoleRingBuffer(maxlen=100)
    tail: queue.Queue = queue.Queue(maxsize=50)
    stop = threading.Event()
    stream = _FakeStream(["ping"])

    thread = spawn_stream_reader(
        "HOST-W1", stream, "stdout", buf, tail, stop
    )
    assert thread is not None
    assert thread.daemon is True
    thread.join(timeout=2)
    assert buf.snapshot()[0]["line"] == "ping"


def test_encoding_fallback_via_text_io():
    buf = ConsoleRingBuffer(maxlen=100)
    tail: queue.Queue = queue.Queue(maxsize=10)
    stop = threading.Event()
    raw = io.TextIOWrapper(
        io.BytesIO("caf\xe9\n".encode("latin-1")),
        encoding="utf-8",
        errors="replace",
    )
    read_stream_loop("HOST-W1", raw, "stdout", buf, tail, stop)
    assert len(buf.snapshot()) == 1

# Created and developed by Jai Singh
