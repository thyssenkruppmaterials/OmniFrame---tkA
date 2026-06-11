# Created and developed by Jai Singh
"""Connect pill / label pure helper tests."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.state import (  # noqa: E402
    ConnectPillState,
    ConnectState,
    apply_health_failure,
    apply_health_success,
    compute_pill_color,
    format_state_label,
    format_subtitle,
    parse_health_subtitle,
    trip_circuit_breaker,
)
from omni_agent.connect.theme import (  # noqa: E402
    PILL_CONNECTED,
    PILL_CONNECTING,
    PILL_DISCONNECTED,
)


def test_format_state_labels():
    assert format_state_label(ConnectPillState.CONNECTED) == "Connected"
    assert format_state_label(ConnectPillState.CONNECTING) == "Connecting…"
    assert format_state_label(ConnectPillState.RECONNECTING) == "Reconnecting…"
    assert format_state_label(ConnectPillState.RESET_NEEDED) == "Reset needed"
    assert format_state_label(ConnectPillState.PAUSED) == "Paused"


def test_compute_pill_color_mapping():
    assert compute_pill_color(ConnectPillState.CONNECTED) == PILL_CONNECTED
    assert compute_pill_color(ConnectPillState.RESET_NEEDED) == PILL_DISCONNECTED
    assert compute_pill_color(ConnectPillState.PAUSED) == PILL_CONNECTING


def test_format_subtitle_placeholders():
    assert format_subtitle("—", "—") == "— · —"
    assert format_subtitle("U8206556", "PRD") == "U8206556 · PRD"
    assert (
        format_subtitle("U8206556", "PRD", "SESSION_MANAGER")
        == "U8206556 · PRD · SESSION_MANAGER"
    )


def test_parse_health_subtitle_from_citrix():
    body = {"citrix": {"user_name": "OPERATOR1"}, "sap_attached": False}
    user, sap, tx = parse_health_subtitle(body)
    assert user == "OPERATOR1"
    assert sap == "—"
    assert tx == "—"


def test_apply_health_success_resets_failures():
    state = ConnectState(consecutive_failures=2)
    out = apply_health_success(state, {"citrix": {"user_name": "X"}})
    assert out.pill == ConnectPillState.CONNECTED
    assert out.consecutive_failures == 0
    assert out.user_label == "X"


def test_apply_health_failure_reconnecting_at_threshold():
    state = ConnectState()
    out = apply_health_failure(state, failures=3, process_alive=True)
    assert out.pill == ConnectPillState.RECONNECTING


def test_trip_circuit_breaker_hint():
    out = trip_circuit_breaker(ConnectState())
    assert out.pill == ConnectPillState.RESET_NEEDED
    assert out.subtitle_hint == "Tap Restart to try again"

# Created and developed by Jai Singh
