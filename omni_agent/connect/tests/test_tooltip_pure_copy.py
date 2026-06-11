# Created and developed by Jai Singh
"""Tooltip hover copy tests (pure helper, no Tk)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.state import ConnectPillState, ConnectState  # noqa: E402
from omni_agent.connect.system_label import SystemLabelCache  # noqa: E402
from omni_agent.connect.tooltip import build_tooltip_text  # noqa: E402

JARGON = {
    "Exception",
    "Traceback",
    "Errno",
    "0x",
    "port",
    "127.0.0.1",
    "8765",
    "Python",
    "pywin32",
    "subprocess",
    "dict",
    "None",
}


def test_tooltip_connected_format():
    state = ConnectState(
        pill=ConnectPillState.CONNECTED,
        user_label="OPERATOR1",
        sap_system_label="PRD",
        last_health_at=1000.0,
        restarts_in_window=[1, 2],
    )
    text = build_tooltip_text(state, None, {"citrix": {"user_name": "OPERATOR1"}})
    assert "OmniFrame Connected" in text
    assert "User: OPERATOR1" in text
    assert "System: PRD" in text
    assert "Restarts: 2" in text
    assert "Last check:" in text


def test_tooltip_uses_system_label_cache():
    cache = SystemLabelCache(user="U1", system="QAS", transaction="—", fetched_at=0.0)
    state = ConnectState(pill=ConnectPillState.CONNECTING)
    text = build_tooltip_text(state, cache, None)
    assert "User: U1" in text
    assert "System: QAS" in text


def test_no_python_jargon():
    state = ConnectState(pill=ConnectPillState.RECONNECTING)
    text = build_tooltip_text(state, None, None).lower()
    for token in JARGON:
        assert token.lower() not in text, f"tooltip leaked {token}"

# Created and developed by Jai Singh
