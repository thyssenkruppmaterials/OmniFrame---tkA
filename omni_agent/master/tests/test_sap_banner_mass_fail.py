# Created and developed by Jai Singh
"""SAP restart banner + mass WS-fail detection (Phase D5)."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.fix_engine import (  # noqa: E402
    SAP_BANNER_SUPPRESS_SECONDS,
    SAP_BANNER_WINDOW_S,
    all_workers_ws_down,
    detect_sap_restart_banner,
    should_suppress_sap_fix_toast,
)


@dataclass
class _BannerWorker:
    process_alive: bool
    sap_attached: bool
    ws_connected: bool = True


def test_detect_sap_restart_banner_requires_two_transitions_in_window():
    now = 1000.0
    workers = {
        "W1": _BannerWorker(process_alive=True, sap_attached=False),
        "W2": _BannerWorker(process_alive=True, sap_attached=False),
    }
    transitions = [(now - 2.0, "W1"), (now - 1.0, "W2")]
    assert detect_sap_restart_banner(workers, transitions, now) is True


def test_detect_sap_restart_banner_rejects_stale_transitions():
    now = 1000.0
    workers = {
        "W1": _BannerWorker(process_alive=True, sap_attached=False),
        "W2": _BannerWorker(process_alive=True, sap_attached=False),
    }
    transitions = [(now - SAP_BANNER_WINDOW_S - 1.0, "W1"), (now - 1.0, "W2")]
    assert detect_sap_restart_banner(workers, transitions, now) is False


def test_detect_sap_restart_banner_requires_all_running_workers_down():
    now = 1000.0
    workers = {
        "W1": _BannerWorker(process_alive=True, sap_attached=False),
        "W2": _BannerWorker(process_alive=True, sap_attached=True),
    }
    transitions = [(now - 1.0, "W1"), (now - 0.5, "W2")]
    assert detect_sap_restart_banner(workers, transitions, now) is False


def test_detect_sap_restart_banner_clears_when_any_sap_attached():
    now = 1000.0
    workers = {
        "W1": _BannerWorker(process_alive=True, sap_attached=True),
        "W2": _BannerWorker(process_alive=True, sap_attached=False),
    }
    transitions = [(now - 1.0, "W1"), (now - 0.5, "W2")]
    assert detect_sap_restart_banner(workers, transitions, now) is False


def test_detect_sap_restart_banner_ignores_stopped_workers():
    now = 1000.0
    workers = {
        "W1": _BannerWorker(process_alive=False, sap_attached=False),
        "W2": _BannerWorker(process_alive=True, sap_attached=False),
    }
    transitions = [(now - 1.0, "W1"), (now - 0.5, "W2")]
    assert detect_sap_restart_banner(workers, transitions, now) is False


def test_all_workers_ws_down_true_when_all_alive_disconnected():
    workers = {
        "W1": _BannerWorker(process_alive=True, sap_attached=True, ws_connected=False),
        "W2": _BannerWorker(process_alive=True, sap_attached=True, ws_connected=False),
    }
    assert all_workers_ws_down(workers) is True


def test_all_workers_ws_down_false_when_one_connected():
    workers = {
        "W1": _BannerWorker(process_alive=True, sap_attached=True, ws_connected=False),
        "W2": _BannerWorker(process_alive=True, sap_attached=True, ws_connected=True),
    }
    assert all_workers_ws_down(workers) is False


def test_all_workers_ws_down_false_when_no_running_workers():
    workers = {
        "W1": _BannerWorker(process_alive=False, sap_attached=False, ws_connected=False),
    }
    assert all_workers_ws_down(workers) is False


def test_should_suppress_sap_fix_toast_within_60s_window():
    now = 1000.0
    until = now + SAP_BANNER_SUPPRESS_SECONDS
    assert should_suppress_sap_fix_toast(now, until) is True
    assert should_suppress_sap_fix_toast(now + 59.0, until) is True
    assert should_suppress_sap_fix_toast(now + SAP_BANNER_SUPPRESS_SECONDS, until) is False


def test_should_suppress_sap_fix_toast_inactive_when_not_armed():
    assert should_suppress_sap_fix_toast(1000.0, 0.0) is False

# Created and developed by Jai Singh
