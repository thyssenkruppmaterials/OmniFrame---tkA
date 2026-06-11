# Created and developed by Jai Singh
"""System label parsing tests."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.diagnostic import SAP_LABEL_CACHE_TTL_S  # noqa: E402
from omni_agent.connect.system_label import (  # noqa: E402
    SystemLabelCache,
    fetch_system_label,
    parse_label,
)
from omni_agent.connect.state import format_health_subtitle, format_subtitle  # noqa: E402
from omni_agent.connect.state import ConnectState  # noqa: E402


def test_parse_label_pinned_session():
    payload = {
        "ok": True,
        "connections": [
            {
                "index": 0,
                "sessions": [
                    {
                        "index": 0,
                        "pinned": False,
                        "user": "OTHER",
                        "system": "DEV",
                        "transaction": "SM37",
                    },
                    {
                        "index": 1,
                        "pinned": True,
                        "user": "U8206556",
                        "system": "PRD",
                        "transaction": "SESSION_MANAGER",
                    },
                ],
            }
        ],
    }
    label = parse_label(payload)
    assert label is not None
    assert label.user == "U8206556"
    assert label.system == "PRD"
    assert label.transaction == "SESSION_MANAGER"


def test_parse_label_not_ok():
    assert parse_label({"ok": False}) is None


def test_fetch_system_label_mock():
    payload = {
        "ok": True,
        "connections": [
            {
                "index": 0,
                "sessions": [
                    {
                        "index": 0,
                        "pinned": True,
                        "user": "A",
                        "system": "PRD",
                        "transaction": "MM03",
                    }
                ],
            }
        ],
    }
    resp = mock.Mock(status_code=200)
    resp.json.return_value = payload
    label = fetch_system_label(get_fn=lambda *a, **k: resp)
    assert label is not None
    assert label.system == "PRD"


def test_system_label_cache_stale():
    cache = SystemLabelCache(fetched_at=time.time() - SAP_LABEL_CACHE_TTL_S - 1)
    assert cache.is_stale()


def test_format_health_subtitle_with_cache():
    state = ConnectState(user_label="—", sap_system_label="—")
    cache = SystemLabelCache(user="U1", system="PRD", transaction="SESSION_MANAGER")
    text = format_health_subtitle(state, cache)
    assert text == format_subtitle("U1", "PRD", "SESSION_MANAGER")

# Created and developed by Jai Singh
