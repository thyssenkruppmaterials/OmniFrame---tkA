# Created and developed by Jai Singh
"""Wizard step machine pure logic."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.wizard import (  # noqa: E402
    STEP_IDS,
    can_advance,
    can_finish,
    step_id,
    step_index,
)
from omni_agent.master.wizard_state import (  # noqa: E402
    STEP_CONFIRM_PERSIST,
    STEP_PROBE_SAP,
    STEP_WELCOME,
    WizardState,
)


def test_step_ids_order():
    assert STEP_IDS[0] == "welcome"
    assert STEP_IDS[-1] == "confirm_persist"
    assert len(STEP_IDS) == 6


def test_step_index_roundtrip():
    assert step_index("pair_sessions") == 2
    assert step_id(2) == "pair_sessions"


def test_can_advance_requires_valid_step():
    state = WizardState()
    assert can_advance(STEP_WELCOME, state, step_valid=True)
    assert not can_advance(STEP_WELCOME, state, step_valid=False)
    assert not can_advance(STEP_CONFIRM_PERSIST, state, step_valid=True)


def test_can_finish_only_on_last_step():
    assert not can_finish(STEP_PROBE_SAP, step_valid=True)
    assert can_finish(STEP_CONFIRM_PERSIST, step_valid=True)
    assert not can_finish(STEP_CONFIRM_PERSIST, step_valid=False)

# Created and developed by Jai Singh
