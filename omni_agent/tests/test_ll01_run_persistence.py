# Created and developed by Jai Singh
"""Persistence tests for LL01 full-fidelity run history (ll01_activity_runs).

Covers `_insert_run`, which keeps the ENTIRE run payload (including each
category's `rows`) so the Inventory Management date picker can reload a past
run with drill-down + Aging intact. See migration 333.
"""

from __future__ import annotations

import ll01_warehouse_activity_monitor as mod


CATEGORY_RESULTS = [
    {
        "key": "open_to",
        "label": "Open Transfer Orders",
        "thresholds": {"green": 100, "amber": 500},
        "counts_by_plant": {"WH5": 2},
        "total": 2,
        "rows": [
            {"to_number": "1", "_plant": "WH5", "created_on": "05/01/2026"},
            {"to_number": "2", "_plant": "WH5", "created_on": "05/02/2026"},
        ],
    }
]


def test_insert_run_posts_full_payload(monkeypatch):
    calls: list[tuple[str, list]] = []

    def fake_post(path, payload):
        calls.append((path, payload))
        return len(payload)

    monkeypatch.setattr(mod, "_supabase_post", fake_post)

    errors = [{"plant": "*", "category": "*", "step": "x", "detail": "y"}]
    inserted = mod._insert_run(
        organization_id="org-1",
        snapshot_run_id="run-1",
        ran_at="2026-05-31T12:00:00Z",
        agent_id="agent-1",
        duration_ms=1234,
        payload_version=2,
        plants=["WH5"],
        category_results=CATEGORY_RESULTS,
        errors=errors,
    )

    assert inserted == 1
    assert len(calls) == 1
    path, payload = calls[0]
    assert path == "ll01_activity_runs"
    assert isinstance(payload, list) and len(payload) == 1

    row = payload[0]
    assert row["organization_id"] == "org-1"
    assert row["snapshot_run_id"] == "run-1"
    assert row["ran_at"] == "2026-05-31T12:00:00Z"
    assert row["agent_id"] == "agent-1"
    assert row["ok"] is True
    assert row["payload_version"] == 2
    assert row["duration_ms"] == 1234
    assert row["plants"] == ["WH5"]
    assert row["errors"] == errors

    # The whole point: full row detail is preserved verbatim so the historical
    # drill-down + Aging tab can reconstruct from it.
    assert row["categories"] == CATEGORY_RESULTS
    assert row["categories"][0]["rows"][0]["created_on"] == "05/01/2026"


def test_insert_run_propagates_no_token_skip(monkeypatch):
    # _supabase_post returns 0 when the agent has no Supabase token; _insert_run
    # must propagate that (no crash, no row counted).
    monkeypatch.setattr(mod, "_supabase_post", lambda path, payload: 0)
    inserted = mod._insert_run(
        organization_id="org-1",
        snapshot_run_id="run-1",
        ran_at="2026-05-31T12:00:00Z",
        agent_id="agent-1",
        duration_ms=0,
        payload_version=2,
        plants=[],
        category_results=[],
        errors=[],
    )
    assert inserted == 0

# Created and developed by Jai Singh
