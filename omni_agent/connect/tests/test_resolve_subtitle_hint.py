# Created and developed by Jai Singh
"""Subtitle hint priority resolver tests."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.state import (  # noqa: E402
    ConnectPillState,
    ConnectState,
    is_paused_state,
    resolve_subtitle_hint,
)


def test_paused_wins_over_all():
    state = ConnectState(
        paused=True,
        pill=ConnectPillState.PAUSED,
        circuit_breaker_tripped=True,
        subtitle_hint="Tap Restart to try again",
    )
    assert is_paused_state(state)
    assert (
        resolve_subtitle_hint(
            state,
            diagnostic_hint="Open SAP to connect",
            probe_hint="Connecting…",
        )
        == "Tap Resume to start."
    )


def test_crash_loop_over_diagnostic_and_probe():
    state = ConnectState(
        circuit_breaker_tripped=True,
        pill=ConnectPillState.RESET_NEEDED,
        subtitle_hint="Tap Restart to try again",
    )
    assert (
        resolve_subtitle_hint(
            state,
            diagnostic_hint="Open SAP to connect",
            probe_hint="Reconnecting…",
        )
        == "Tap Restart to try again"
    )


def test_diagnostic_over_probe():
    state = ConnectState(pill=ConnectPillState.CONNECTING)
    assert (
        resolve_subtitle_hint(
            state,
            diagnostic_hint="Open SAP to connect",
            probe_hint="Connecting…",
        )
        == "Open SAP to connect"
    )


def test_probe_state_subtitle_hint():
    state = ConnectState(
        pill=ConnectPillState.RECONNECTING,
        subtitle_hint="Custom probe hint",
    )
    assert resolve_subtitle_hint(state) == "Custom probe hint"


def test_probe_hint_fallback():
    state = ConnectState(pill=ConnectPillState.CONNECTING)
    assert resolve_subtitle_hint(state, probe_hint="Connecting…") == "Connecting…"


def test_healthy_empty_hint():
    state = ConnectState(pill=ConnectPillState.CONNECTED)
    assert resolve_subtitle_hint(state) == ""

# Created and developed by Jai Singh
