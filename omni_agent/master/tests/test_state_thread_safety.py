# Created and developed by Jai Singh
"""Thread-safe queue drain determinism (100 synthetic snapshots)."""

from __future__ import annotations

import queue
import sys
import threading
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.config import WorkerConfig  # noqa: E402
from omni_agent.master.probe import build_initial_runtime  # noqa: E402
from omni_agent.master.state import MasterRuntimeState, TilePillState  # noqa: E402


def test_pump_100_snapshots_from_background_thread():
    runtime = MasterRuntimeState()
    w = WorkerConfig(id="T-W1", label="Test", health_port=8765)
    snap = build_initial_runtime(w)
    runtime.workers[w.id] = snap

    applied: list[tuple[str, dict]] = []

    def handler(worker_id: str, patch: dict) -> None:
        runtime.apply_snapshot(worker_id, patch)
        applied.append((worker_id, patch.copy()))

    q: queue.Queue[tuple[str, dict]] = queue.Queue()

    def producer() -> None:
        for i in range(100):
            q.put((w.id, {"consecutive_failures": i % 5, "http_ok": i % 2 == 0}))

    t = threading.Thread(target=producer)
    t.start()
    t.join()

    batch: list[tuple[str, dict]] = []
    while True:
        try:
            batch.append(q.get_nowait())
        except queue.Empty:
            break

    count = runtime.drain_snapshots_batch(batch, handler)
    assert count == 100
    assert len(applied) == 100
    assert runtime.workers[w.id].consecutive_failures == 99 % 5

# Created and developed by Jai Singh
