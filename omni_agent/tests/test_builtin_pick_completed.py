# Created and developed by Jai Singh
"""Unit tests for the `builtin-pick-completed` agent-side trigger branches
in `omni_agent/agent.py`.

Covers the three pure functions that house each builtin trigger:
    - `_hardcoded_trigger_match(trigger, row) -> bool`
    - `_hardcoded_trigger_payload(trigger, row) -> dict`
    - `_hardcoded_trigger_post_patch(trigger, row) -> dict`

Run with:
    python3 -m pytest omni_agent/tests/test_builtin_pick_completed.py -v

We import `agent` directly from the omni_agent module. `agent.py` imports
`fastapi`, `pydantic`, `requests`, etc. at module scope — when those are
missing from the sandbox the tests short-circuit with `pytest.skip(...)`
instead of failing (the operator verification step still runs on their
local venv). The tests are pure-logic — they stub out only the two
agent-side helpers (`state` and `_agent_self_id`) that would otherwise
touch network state.
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


TRIGGER = {
    "id": "builtin-pick-completed",
    "name": "Auto-Confirm Completed Picks \u2192 LT12 (agent-side)",
    "table": "work_tasks",
    "events": {"INSERT", "UPDATE"},
    "endpoint": "/sap/lt12",
}


def _make_row(**overrides) -> dict:
    """Realistic `work_tasks` row shape matching what the Realtime
    record payload delivers (flat dict, JSONB columns as plain dicts)."""
    row = {
        "id": "11111111-1111-1111-1111-111111111111",
        "organization_id": "c9d89a74-7179-4033-93ea-56267cf42a17",
        "task_type": "pick",
        "task_subtype": "standard_pick",
        "task_number": "PICK-0001",
        "warehouse": "PDC",
        "status": "completed",
        "assigned_to": "22222222-2222-2222-2222-222222222222",
        "payload": {
            "pick_qty": 3,
            "destination_location": "DOCK-12",
            "transfer_order": "0000012345",
            "movement_type": "601",
        },
        "result_payload": {
            "picked_qty": 3,
            "destination_location_confirmed": "DOCK-12",
            "notes": None,
        },
    }
    # Deep-merge overrides on payload / result_payload so callers can
    # tweak one field without retyping the whole sub-dict.
    payload_overrides = overrides.pop("payload", None)
    result_overrides = overrides.pop("result_payload", None)
    row.update(overrides)
    if payload_overrides is not None:
        merged = dict(row["payload"])
        merged.update(payload_overrides)
        row["payload"] = merged
    if result_overrides is not None:
        merged = dict(row["result_payload"])
        merged.update(result_overrides)
        row["result_payload"] = merged
    return row


skipif_no_agent = pytest.mark.skipif(
    not _AGENT_OK,
    reason=f"omni_agent/agent.py import failed: {_AGENT_IMPORT_ERROR}",
)


# ---------------------------------------------------------------------------
# _hardcoded_trigger_match
# ---------------------------------------------------------------------------
@skipif_no_agent
def test_match_valid_pick_completed_row_is_true():
    row = _make_row()
    assert agent._hardcoded_trigger_match(TRIGGER, row) is True


@skipif_no_agent
def test_match_skips_when_lt12_already_confirmed():
    """Idempotency guard — a row that already carries the
    `lt12_confirmed_at` marker (written back by the post-patch) must
    not re-fire. Without this guard the mig-257 shadow-writer replay
    path would double-confirm."""
    row = _make_row(payload={"lt12_confirmed_at": "2026-05-02T15:30:00Z"})
    assert agent._hardcoded_trigger_match(TRIGGER, row) is False


@skipif_no_agent
def test_match_skips_when_transfer_order_missing():
    row = _make_row(payload={"transfer_order": None})
    assert agent._hardcoded_trigger_match(TRIGGER, row) is False


@skipif_no_agent
def test_match_skips_when_transfer_order_empty_string():
    row = _make_row(payload={"transfer_order": ""})
    assert agent._hardcoded_trigger_match(TRIGGER, row) is False


@skipif_no_agent
def test_match_skips_wrong_task_type():
    """cycle_count / zone_audit rows live on the same table — the
    branch must never fall through to them."""
    row = _make_row(task_type="cycle_count")
    assert agent._hardcoded_trigger_match(TRIGGER, row) is False
    row = _make_row(task_type="zone_audit")
    assert agent._hardcoded_trigger_match(TRIGGER, row) is False


@skipif_no_agent
def test_match_skips_non_completed_status():
    row = _make_row(status="claimed")
    assert agent._hardcoded_trigger_match(TRIGGER, row) is False
    row = _make_row(status="in_progress")
    assert agent._hardcoded_trigger_match(TRIGGER, row) is False


@skipif_no_agent
def test_match_tolerates_missing_payload_dict():
    """Defensive — a malformed row with payload=None (e.g. stale
    Realtime delivery) shouldn't crash the dispatcher."""
    row = _make_row()
    row["payload"] = None
    assert agent._hardcoded_trigger_match(TRIGGER, row) is False


# ---------------------------------------------------------------------------
# _hardcoded_trigger_payload
# ---------------------------------------------------------------------------
@skipif_no_agent
def test_payload_shape_realistic_input():
    row = _make_row()
    out = agent._hardcoded_trigger_payload(TRIGGER, row)
    assert out == {
        "transfer_order": "0000012345",
        "warehouse": "PDC",
        "picked_qty": 3,
        "destination_location": "DOCK-12",
        "movement_type": "601",
    }


@skipif_no_agent
def test_payload_falls_back_to_pick_qty_when_result_missing_picked_qty():
    row = _make_row(
        payload={"pick_qty": 5},
        result_payload={"picked_qty": None},
    )
    out = agent._hardcoded_trigger_payload(TRIGGER, row)
    assert out["picked_qty"] == 5


@skipif_no_agent
def test_payload_defaults_movement_type_to_601():
    row = _make_row(payload={"movement_type": None})
    out = agent._hardcoded_trigger_payload(TRIGGER, row)
    assert out["movement_type"] == "601"


# ---------------------------------------------------------------------------
# _hardcoded_trigger_post_patch
# ---------------------------------------------------------------------------
@skipif_no_agent
def test_post_patch_returns_work_tasks_jsonb_merge():
    row = _make_row()
    patch = agent._hardcoded_trigger_post_patch(TRIGGER, row)
    assert patch["table"] == "work_tasks"
    assert patch["row_id"] == row["id"]
    assert patch["skip_if"] == {}
    merged = patch["patch"]["payload"]
    # Original fields preserved.
    assert merged["pick_qty"] == 3
    assert merged["destination_location"] == "DOCK-12"
    assert merged["transfer_order"] == "0000012345"
    assert merged["movement_type"] == "601"
    # Confirmation marker added (the idempotency guard the match-branch reads).
    assert "lt12_confirmed_at" in merged
    assert merged["lt12_confirmed_at"].endswith("Z")
    assert "lt12_confirmed_by_agent_id" in merged
    assert merged["lt12_confirmed_source"] == "agent_trigger_direct"


@skipif_no_agent
def test_post_patch_tolerates_missing_row_payload():
    row = _make_row()
    row["payload"] = None
    patch = agent._hardcoded_trigger_post_patch(TRIGGER, row)
    merged = patch["patch"]["payload"]
    # A `None` payload is normalized to `{}` so the confirmation marker
    # still lands (the agent self-heals the row schema).
    assert "lt12_confirmed_at" in merged
    assert "lt12_confirmed_by_agent_id" in merged

# Created and developed by Jai Singh
