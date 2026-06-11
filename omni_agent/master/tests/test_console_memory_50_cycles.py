# Created and developed by Jai Singh
"""50-cycle console memory bound test (Phase C)."""

from __future__ import annotations

import io
import queue
import sys
import threading
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

pytestmark = pytest.mark.skipif(
    sys.version_info < (3, 9),
    reason="tracemalloc cycle test requires Python 3.9+",
)

try:
    import tracemalloc
except ImportError:
    tracemalloc = None  # type: ignore[assignment]

from omni_agent.master.console_buffer import ConsoleRingBuffer  # noqa: E402
from omni_agent.master.console_reader import (  # noqa: E402
    fanout_tail_loop,
    spawn_stream_reader,
)
from omni_agent.master.log_rotation import rotation_loop  # noqa: E402


class _MockPopen:
    def __init__(self, corpus: list[str]):
        joined = "\n".join(corpus) + "\n"
        self.stdout = io.StringIO(joined)
        self.stderr = io.StringIO("")
        self._closed = False

    def poll(self):
        return 0 if self._closed else None

    def wait(self, timeout=None):
        self._closed = True
        return 0


def _simulate_worker_cycle(tmp_path: Path, worker_id: str, corpus: list[str]) -> None:
    buf = ConsoleRingBuffer(maxlen=10_000)
    tail: queue.Queue = queue.Queue(maxsize=2000)
    log_q: queue.Queue = queue.Queue(maxsize=2000)
    gui_pending: list = []
    gui_lock = threading.Lock()
    stop = threading.Event()

    popen = _MockPopen(corpus)
    stdout_t = spawn_stream_reader(
        worker_id, popen.stdout, "stdout", buf, tail, stop
    )
    stderr_t = spawn_stream_reader(
        worker_id, popen.stderr, "stderr", buf, tail, stop
    )
    fanout_t = threading.Thread(
        target=fanout_tail_loop,
        args=(tail, log_q, gui_pending, gui_lock, stop),
        daemon=True,
    )
    fanout_t.start()
    rot_t = threading.Thread(
        target=rotation_loop,
        args=(worker_id, tmp_path, log_q, stop),
        kwargs={"retention_days": 7},
        daemon=True,
    )
    rot_t.start()

    if stdout_t:
        stdout_t.join(timeout=5)
    if stderr_t:
        stderr_t.join(timeout=5)
    stop.set()
    fanout_t.join(timeout=2)
    rot_t.join(timeout=2)


@pytest.mark.skipif(tracemalloc is None, reason="tracemalloc unavailable")
def test_memory_growth_under_100mb_over_50_cycles(tmp_path: Path):
    corpus = [f"log-line-{i}" for i in range(500)]
    tracemalloc.start()
    snap0 = tracemalloc.take_snapshot()

    for n in range(50):
        _simulate_worker_cycle(tmp_path, f"HOST-W{n % 6 + 1}", corpus)

    snap1 = tracemalloc.take_snapshot()
    stats = snap1.compare_to(snap0, "lineno")
    total_growth = sum(s.size_diff for s in stats if s.size_diff > 0)
    tracemalloc.stop()
    assert total_growth < 100 * 1024 * 1024, (
        f"Memory grew {total_growth / (1024 * 1024):.1f} MB"
    )

# Created and developed by Jai Singh
