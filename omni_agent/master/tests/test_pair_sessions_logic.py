# Created and developed by Jai Singh
"""Pair sessions pure logic tests."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.pair_sessions_logic import (  # noqa: E402
    default_worker_pairings,
    find_duplicate_session_tuples,
    validate_pair_sessions,
)


def test_default_mapping_w1_to_sess0():
    pairings = default_worker_pairings(6, host_prefix="CITRIX01")
    assert len(pairings) == 6
    assert pairings[0].worker_id == "CITRIX01-W1"
    assert pairings[0].sess_idx == 0
    assert pairings[0].conn_idx == 0
    assert pairings[0].label == "Bay 1 — Generic"
    assert pairings[0].auto_start is True
    assert pairings[0].health_port == 8765


def test_w6_auto_start_false_when_six_workers():
    pairings = default_worker_pairings(6, host_prefix="HOST")
    assert pairings[5].worker_id.endswith("-W6")
    assert pairings[5].auto_start is False


def test_duplicate_detection():
    pairings = default_worker_pairings(2, host_prefix="H")
    pairings[1].sess_idx = pairings[0].sess_idx
    dups = find_duplicate_session_tuples(pairings)
    assert (0, 0) in dups


def test_validate_rejects_empty_label():
    pairings = default_worker_pairings(2, host_prefix="H")
    pairings[0].label = "   "
    assert validate_pair_sessions(pairings, 2) is not None


def test_validate_accepts_unique_sessions():
    pairings = default_worker_pairings(3, host_prefix="H")
    assert validate_pair_sessions(pairings, 3) is None

# Created and developed by Jai Singh
