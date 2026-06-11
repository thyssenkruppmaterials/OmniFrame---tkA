# Created and developed by Jai Singh
"""Friendly modal copy tests (pure helpers, no Tk)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.dialogs import (  # noqa: E402
    FRIENDLY_COPY,
    build_friendly_copy,
    compute_reset_steps,
    resolve_log_dir,
)

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
}


def test_all_error_kinds_have_copy():
    for kind in (
        "worker_spawn_failed",
        "crash_loop",
        "sap_not_running",
        "web_unreachable",
        "port_blocked",
        "update_available",
        "sap_session_lost",
        "service_key_invalid",
    ):
        copy = build_friendly_copy(kind)
        assert copy["title"]
        assert copy["body"]
        assert copy["cta_label"]


def test_no_python_jargon():
    for kind in FRIENDLY_COPY:
        copy = build_friendly_copy(kind)
        blob = " ".join(copy.values()).lower()
        for token in JARGON:
            assert token.lower() not in blob, f"{kind} leaked {token}"


def test_compute_reset_steps_order():
    assert compute_reset_steps() == [
        "supervisor.pause",
        "cli.run_reset",
        "supervisor.restart",
        "dialogs.show_info_modal",
    ]


def test_resolve_log_dir_ends_with_omniframe(monkeypatch, tmp_path):
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    assert resolve_log_dir() == tmp_path / ".omniframe"

# Created and developed by Jai Singh
