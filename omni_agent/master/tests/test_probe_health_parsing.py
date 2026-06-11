# Created and developed by Jai Singh
"""Health probe parsing and three-strike failure logic."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.config import WorkerConfig  # noqa: E402
from omni_agent.master.probe import (  # noqa: E402
    FAILURES_FOR_RED,
    failure_patch,
    parse_health_payload,
)
from omni_agent.master.state import TilePillState  # noqa: E402


def _worker():
    return WorkerConfig(
        id="H-W1",
        label="Bay 1",
        sap_conn_idx=0,
        sap_session_index=2,
        health_port=8767,
    )


def test_parse_health_all_phase_a_fields():
    body = {
        "ok": True,
        "version": "2.1.0",
        "ws_connected": True,
        "sap_attached": True,
        "sap_connected": True,
        "job_age_seconds": 12,
        "job_progress_unchanged_seconds": 3,
        "identity_status": "ok",
        "last_sap_error": None,
    }
    patch = parse_health_payload(_worker(), body)
    assert patch["ws_connected"] is True
    assert patch["sap_attached"] is True
    assert patch["job_age_seconds"] == 12
    assert patch["identity_status"] == "ok"
    assert patch["pill"] == TilePillState.CONNECTED
    assert "running (12s)" in patch["in_flight_job"]


def test_parse_health_missing_optional_fields():
    patch = parse_health_payload(_worker(), {"ok": True})
    assert patch["job_age_seconds"] is None
    assert patch["in_flight_job"] == "idle"
    assert patch["last_error"] == "--"


def test_three_strikes_red_pill():
    w = _worker()
    p2 = failure_patch(w, process_alive=True, consecutive_failures=2)
    assert p2["pill"] == TilePillState.CONNECTING
    p3 = failure_patch(w, process_alive=True, consecutive_failures=FAILURES_FOR_RED)
    assert p3["pill"] == TilePillState.DISCONNECTED


def test_success_resets_failure_semantics():
    body = {"ok": True, "ws_connected": True, "sap_attached": True}
    patch = parse_health_payload(_worker(), body)
    assert patch["consecutive_failures"] == 0
    assert patch["http_ok"] is True

# Created and developed by Jai Singh
