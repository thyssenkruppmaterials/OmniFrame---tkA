# Created and developed by Jai Singh
"""Unit tests for `_is_retryable_sap_error` in `omni_agent/agent.py`.

Covers the LT12 confirm-TO error classifier added to stop a transient
SAP GUI layout race from burning a job's single attempt:

    - The 619 "(control could not be found by id.)" COM error is classified
      RETRYABLE (transient GUI scripting race under fleet load).
    - A non-transient SAP business/data error — e.g. the T300 "-03 does not
      exist" warehouse rejection — stays TERMINAL.

Run with:
    python3 -m pytest omni_agent/tests/test_confirm_to_retryable_error.py -v

We import `agent` directly from the omni_agent module. `agent.py` imports
`fastapi`, `pydantic`, `requests`, etc. at module scope AND uses 3.10+
union syntax, so on the 3.9 sandbox the import fails and the tests
short-circuit with `pytest.skip(...)` instead of erroring (the operator
verification step still runs on their local 3.10+ venv). This mirrors the
established convention in `test_builtin_pick_completed.py`. The classifier
itself is a pure string function — no network / SAP / DB state touched.

See [[Debug/Fix-Putaway-Confirms-Stuck-At-29-Layout-Race]].
"""
from __future__ import annotations

import os
import sys

import pytest


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)


try:
    import agent  # type: ignore
    _AGENT_OK = True
    _AGENT_IMPORT_ERROR: str | None = None
except Exception as e:  # pragma: no cover - defensive
    _AGENT_OK = False
    _AGENT_IMPORT_ERROR = f"{type(e).__name__}: {e}"
    agent = None  # type: ignore


# The verbatim COM error string the agent logs/stores for the 619 layout
# race (from `sap_audit_log` + `sap_agent_jobs.error` on 2026-05-28).
ERR_619 = (
    "(-2147352567, 'Exception occurred.', "
    "(619, 'SAP Frontend Server', "
    "'The control could not be found by id.', "
    "'C:\\\\Program Files (x86)\\\\SAP\\\\FrontEnd\\\\SAPgui"
    "\\\\sapfront.HLP', 393215, 0), None)"
)

# The verbatim terminal business error for the malformed '-03' warehouse.
ERR_T300 = "Entry -03   does not exist in T300 (check entry)"


pytestmark = pytest.mark.skipif(
    not _AGENT_OK,
    reason=f"agent.py not importable here ({_AGENT_IMPORT_ERROR})",
)


def test_619_layout_race_is_retryable():
    assert agent._is_retryable_sap_error(ERR_619) is True


def test_generic_control_not_found_is_retryable():
    assert agent._is_retryable_sap_error(
        "WH:PDC | The control could not be found by id."
    ) is True


def test_t300_invalid_warehouse_is_terminal():
    # The '-03' bad-warehouse rejection must NOT be retried — the same
    # payload will fail again forever.
    assert agent._is_retryable_sap_error(ERR_T300) is False


@pytest.mark.parametrize(
    "msg",
    [
        "TO 0001794265 does not exist",
        "No authorization for warehouse WH5",
        "Transfer order is locked by another user",
        "Material does not belong to this warehouse",
    ],
)
def test_known_business_errors_stay_terminal(msg):
    assert agent._is_retryable_sap_error(msg) is False


def test_terminal_marker_wins_over_transient_marker():
    # Defensive: if a message ever carries BOTH a transient and a terminal
    # marker, classify conservatively as terminal (don't churn the queue).
    mixed = "The control could not be found by id. ... does not exist in T300"
    assert agent._is_retryable_sap_error(mixed) is False


@pytest.mark.parametrize(
    "msg",
    [None, "", "   ", "Transfer order 0003687766 confirmed"],
)
def test_empty_or_success_is_not_retryable(msg):
    assert agent._is_retryable_sap_error(msg) is False

# Created and developed by Jai Singh
