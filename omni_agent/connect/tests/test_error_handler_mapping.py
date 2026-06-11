# Created and developed by Jai Singh
"""Exception classification tests for the GUI error hook."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.error_handler import classify_exception  # noqa: E402


def test_classify_connection_refused():
    assert classify_exception(ConnectionRefusedError("refused")) == "web_unreachable"


def test_classify_port_blocked_oserror():
    exc = OSError("[Errno 10048] address already in use")
    assert classify_exception(exc) == "port_blocked"


def test_classify_service_key():
    assert classify_exception(RuntimeError("service key invalid")) == "service_key_invalid"


def test_classify_unknown():
    assert classify_exception(ValueError("something else")) == "unknown"

# Created and developed by Jai Singh
