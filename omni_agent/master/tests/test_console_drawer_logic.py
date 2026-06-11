# Created and developed by Jai Singh
"""Console drawer pure logic tests — no Tk root (Phase C)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.console_buffer import ConsoleRingBuffer  # noqa: E402
from omni_agent.master.console_drawer import (  # noqa: E402
    ConsoleDrawerLogic,
    DRAWER_VISIBLE_LINES,
    drain_gui_pending,
)


def _logic() -> ConsoleDrawerLogic:
    return ConsoleDrawerLogic(
        worker_ids=["HOST-W1", "HOST-W2"],
        worker_labels={"HOST-W1": "Bay 1", "HOST-W2": "Bay 2"},
        selected_worker_id="HOST-W1",
    )


def test_selector_label_mapping():
    logic = _logic()
    assert logic.selector_options() == ["Bay 1", "Bay 2"]
    assert logic.label_to_worker_id("Bay 2") == "HOST-W2"
    logic.select_by_label("Bay 2")
    assert logic.selected_worker_id == "HOST-W2"


def test_pause_is_per_worker_and_remembered():
    logic = _logic()
    assert logic.pause_selected() is True
    assert logic.is_paused("HOST-W1")
    logic.select_worker("HOST-W2")
    assert not logic.is_paused("HOST-W2")
    logic.select_worker("HOST-W1")
    assert logic.is_paused("HOST-W1")


def test_clear_view_only():
    logic = _logic()
    logic.clear_selected()
    assert logic.is_cleared("HOST-W1")
    buf = ConsoleRingBuffer(maxlen=100)
    buf.append(
        {
            "ts": "t",
            "stream": "stdout",
            "worker_id": "HOST-W1",
            "line": "keep",
        }
    )
    assert len(buf.snapshot()) == 1
    lines = logic.refill_after_clear_or_select(buf, "HOST-W1")
    assert "keep" in lines[0]


def test_drawer_last_200_from_buffer():
    logic = _logic()
    buf = ConsoleRingBuffer(maxlen=500)
    for i in range(250):
        buf.append(
            {
                "ts": "t",
                "stream": "stdout",
                "worker_id": "HOST-W1",
                "line": f"n{i}",
            }
        )
    lines = logic.drawer_lines_from_buffer(buf, "HOST-W1")
    assert len(lines) == DRAWER_VISIBLE_LINES
    assert "n249" in lines[-1]


def test_apply_pending_respects_pause():
    logic = _logic()
    logic.pause_selected()
    pending = [
        {
            "ts": "t",
            "stream": "stdout",
            "worker_id": "HOST-W1",
            "line": "x",
        }
    ]
    lines, consumed, changed = logic.apply_pending_lines("HOST-W1", pending, [])
    assert lines == []
    assert consumed == []
    assert changed is False


def test_drain_gui_pending_filters_worker():
    import threading

    pending = [
        {"ts": "t", "stream": "stdout", "worker_id": "HOST-W1", "line": "a"},
        {"ts": "t", "stream": "stdout", "worker_id": "HOST-W2", "line": "b"},
    ]
    lock = threading.Lock()
    out = drain_gui_pending(
        pending,
        lock,
        worker_filter=lambda e: e["worker_id"] == "HOST-W1",
    )
    assert len(out) == 1
    assert out[0]["line"] == "a"
    assert len(pending) == 1
    assert pending[0]["worker_id"] == "HOST-W2"

# Created and developed by Jai Singh
