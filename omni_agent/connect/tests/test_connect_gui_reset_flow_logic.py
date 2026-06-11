# Created and developed by Jai Singh
"""Reset orchestration pure-logic tests (no Tk root)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.connect_gui import orchestrate_reset  # noqa: E402
from omni_agent.connect.dialogs import compute_reset_steps  # noqa: E402


def test_compute_reset_steps_content():
    steps = compute_reset_steps()
    assert steps[0] == "supervisor.pause"
    assert steps[-1] == "dialogs.show_info_modal"
    assert len(steps) == 4


def test_orchestrate_reset_calls_in_order():
    supervisor = mock.Mock()
    with mock.patch("omni_agent.connect.connect_gui.run_reset") as reset_fn:
        reset_fn.return_value = {"ok": True, "deleted": [], "skipped": []}
        orchestrate_reset(supervisor)
    assert supervisor.method_calls[0][0] == "pause"
    reset_fn.assert_called_once()
    assert supervisor.method_calls[-1][0] == "restart"

# Created and developed by Jai Singh
