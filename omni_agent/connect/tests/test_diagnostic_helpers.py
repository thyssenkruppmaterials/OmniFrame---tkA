# Created and developed by Jai Singh
"""Self-diagnostic pure helper tests."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.diagnostic import (  # noqa: E402
    MODAL_SUPPRESS_AFTER_S,
    CheckResult,
    SelfDiagnosticResult,
    build_friendly_summary,
    check_port_free,
    check_sap_gui,
    check_web_reachable,
    compute_diagnostic_subtitle_hint,
    compute_overall,
    mark_diagnostic_modal_shown,
    run_self_diagnostic,
    should_show_diagnostic_modal,
    update_diagnostic_state,
)


def test_check_port_free_when_connection_fails():
    def boom(*args, **kwargs):
        raise OSError("refused")

    result = check_port_free(8765, connect_fn=boom)
    assert result.status == "ok"
    assert result.check_id == "port_free"


def test_check_port_free_when_port_in_use():
    result = check_port_free(8765, connect_fn=lambda *a, **k: mock.Mock())
    assert result.status == "critical"
    assert result.check_id == "port_blocked"


def test_check_sap_gui_non_windows():
    with mock.patch.object(sys, "platform", "darwin"):
        result = check_sap_gui()
    assert result.check_id == "sap_unavailable_dev_host"


def test_check_sap_gui_running():
    class FakeEngine:
        Children = mock.Mock(Count=1)

    class FakeSap:
        GetScriptingEngine = FakeEngine()

    with mock.patch.object(sys, "platform", "win32"):
        result = check_sap_gui(dispatch_fn=lambda _: FakeSap())
    assert result.check_id == "sap_running"
    assert result.status == "ok"


def test_check_sap_gui_not_running():
    def fail(_):
        raise RuntimeError("GetObject failed")

    with mock.patch.object(sys, "platform", "win32"):
        result = check_sap_gui(dispatch_fn=fail)
    assert result.check_id == "sap_not_running"


def test_check_web_reachable_ok():
    resp = mock.Mock(status_code=200)
    result = check_web_reachable("https://example.com", get_fn=lambda *a, **k: resp)
    assert result.check_id == "web_ok"


def test_check_web_unreachable():
    def fail(*a, **k):
        raise ConnectionError("down")

    result = check_web_reachable("https://example.com", get_fn=fail)
    assert result.check_id == "web_unreachable"


def test_run_self_diagnostic_all_ok():
    def boom(*args, **kwargs):
        raise OSError("refused")

    resp = mock.Mock(status_code=200)
    with mock.patch.object(sys, "platform", "darwin"):
        result = run_self_diagnostic(
            "http://127.0.0.1:8765/health",
            "https://example.com",
            connect_fn=boom,
            get_fn=lambda *a, **k: resp,
        )
    assert result.overall == "all_ok"
    assert result.friendly_summary == ""


def test_build_friendly_summary_sap():
    result = SelfDiagnosticResult(
        overall="warnings",
        checks=[
            CheckResult("sap_not_running", "warning", "SAP GUI is not running."),
        ],
    )
    summary = build_friendly_summary(result)
    assert "SAP" in summary
    assert "automatically" in summary


def test_first_run_modal_gate(tmp_path):
    path = tmp_path / "state.json"
    result = SelfDiagnosticResult(
        overall="warnings",
        checks=[
            CheckResult("sap_not_running", "warning", "SAP GUI is not running."),
        ],
    )
    now = 1_000_000.0
    state = update_diagnostic_state(result, now=now, path=path)
    assert should_show_diagnostic_modal(result, state, now=now + 10)
    mark_diagnostic_modal_shown(result, now=now + 10, path=path)
    state = update_diagnostic_state(result, now=now + 20, path=path)
    assert not should_show_diagnostic_modal(result, state, now=now + 20)


def test_stale_failure_subtitle_hint(tmp_path):
    path = tmp_path / "state.json"
    result = SelfDiagnosticResult(
        overall="warnings",
        checks=[
            CheckResult("sap_not_running", "warning", "SAP GUI is not running."),
        ],
    )
    start = 1_000_000.0
    update_diagnostic_state(result, now=start, path=path)
    state = update_diagnostic_state(result, now=start + 100, path=path)
    assert compute_diagnostic_subtitle_hint(result, state, now=start + 100) == ""
    assert (
        compute_diagnostic_subtitle_hint(
            result,
            state,
            now=start + MODAL_SUPPRESS_AFTER_S + 1,
        )
        == "Open SAP to connect"
    )


def test_compute_overall_critical():
    checks = [
        CheckResult("port_blocked", "critical", "blocked"),
        CheckResult("web_ok", "ok", "ok"),
    ]
    assert compute_overall(checks) == "critical"

# Created and developed by Jai Singh
