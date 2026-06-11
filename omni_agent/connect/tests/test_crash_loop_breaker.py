# Created and developed by Jai Singh
"""Pure-function circuit breaker tests."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.state import (  # noqa: E402
    CIRCUIT_BREAKER_WINDOW_NS,
    should_circuit_break,
    record_restart,
)


def test_should_circuit_break_false_below_threshold():
    now = 1_000_000_000_000
    ts = [now - i * 10_000_000_000 for i in range(4)]
    assert should_circuit_break(ts, now) is False


def test_should_circuit_break_true_at_five_in_window():
    now = 1_000_000_000_000
    ts = [now - i * 5_000_000_000 for i in range(5)]
    assert should_circuit_break(ts, now) is True


def test_should_circuit_break_false_when_outside_window():
    now = 1_000_000_000_000
    old = now - CIRCUIT_BREAKER_WINDOW_NS - 1
    ts = [old, old + 1, old + 2, old + 3, now - 1_000]
    assert should_circuit_break(ts, now) is False


def test_record_restart_prunes_old():
    now = 1_000_000_000_000
    stale = now - CIRCUIT_BREAKER_WINDOW_NS - 5
    updated = record_restart([stale, now - 1_000], now)
    assert stale not in updated
    assert updated[-1] == now

# Created and developed by Jai Singh
