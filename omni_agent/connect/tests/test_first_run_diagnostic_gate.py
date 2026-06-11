# Created and developed by Jai Singh
"""First-run diagnostic modal gate tests."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.diagnostic import (  # noqa: E402
    MODAL_SUPPRESS_AFTER_S,
    CheckResult,
    SelfDiagnosticResult,
    should_show_diagnostic_modal,
    update_diagnostic_state,
)


def test_all_ok_never_shows_modal(tmp_path):
    result = SelfDiagnosticResult(
        overall="all_ok",
        checks=[CheckResult("port_free", "ok", "free")],
    )
    state = update_diagnostic_state(result, path=tmp_path / "s.json")
    assert not should_show_diagnostic_modal(result, state)


def test_recurring_failure_suppressed_after_24h(tmp_path):
    path = tmp_path / "s.json"
    result = SelfDiagnosticResult(
        overall="warnings",
        checks=[CheckResult("web_unreachable", "warning", "down")],
    )
    start = 2_000_000.0
    state = update_diagnostic_state(result, now=start, path=path)
    assert should_show_diagnostic_modal(result, state, now=start + 60)
    later = start + MODAL_SUPPRESS_AFTER_S + 5
    state = update_diagnostic_state(result, now=later, path=path)
    assert not should_show_diagnostic_modal(result, state, now=later)

# Created and developed by Jai Singh
