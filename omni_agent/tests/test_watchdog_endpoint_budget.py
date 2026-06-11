# Created and developed by Jai Singh
"""Unit tests for the per-endpoint stuck-job watchdog budget (2026-05-31).

LL01 / LX25 are multi-minute SAP fan-outs; the flat 120s watchdog mis-fired on
them as a "SAP session hang". `_watchdog_timeout_for` grants those endpoints a
generous budget while keeping the fast 120s default for everything else (so a
genuine COM hang on a normal job still recovers quickly).

Run with:
    python3 -m pytest omni_agent/tests/test_watchdog_endpoint_budget.py -v

Pure Python — no SAP COM, no live rust-work-service. Skips if `agent.py`
cannot be imported (same pattern as the other agent unit tests).
"""
from __future__ import annotations

import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

try:
    import agent  # type: ignore

    _AGENT_OK = True
except Exception:  # pragma: no cover - environment without deps
    _AGENT_OK = False

pytestmark = pytest.mark.skipif(not _AGENT_OK, reason="agent.py import failed")


def test_default_timeout_for_unlisted_endpoint():
    base = agent._WATCHDOG_TIMEOUT_SEC
    assert agent._watchdog_timeout_for("/sap/query") == base
    assert agent._watchdog_timeout_for(None) == base
    assert agent._watchdog_timeout_for("") == base


def test_ll01_gets_generous_budget():
    base = agent._WATCHDOG_TIMEOUT_SEC
    t = agent._watchdog_timeout_for("/sap/ll01/warehouse-activity")
    assert t == 900.0
    assert t > base  # well above the 120s default that was killing the run


def test_lx25_gets_generous_budget():
    assert agent._watchdog_timeout_for("/sap/lx25/inventory-completion") == 600.0


def test_budget_never_below_env_default(monkeypatch):
    # An ops bump of the global default above a per-endpoint value must win
    # (max semantics) so nothing is silently lowered.
    monkeypatch.setattr(agent, "_WATCHDOG_TIMEOUT_SEC", 1200.0)
    assert agent._watchdog_timeout_for("/sap/lx25/inventory-completion") == 1200.0
    assert agent._watchdog_timeout_for("/sap/query") == 1200.0


def test_lease_seconds_per_endpoint():
    # Long SAP fan-outs get a generous claim lease so the server-side zombie
    # reaper doesn't flip a still-completing row to failed; everything else
    # keeps the fast 90s default.
    assert agent._lease_seconds_for("/sap/ll01/warehouse-activity") == 600
    assert agent._lease_seconds_for("/sap/lx25/inventory-completion") == 600
    assert agent._lease_seconds_for("/sap/query") == agent._LEASE_SECONDS_DEFAULT
    assert agent._lease_seconds_for(None) == agent._LEASE_SECONDS_DEFAULT
    assert agent._lease_seconds_for("/sap/ll01/warehouse-activity") > 90

# Created and developed by Jai Singh
