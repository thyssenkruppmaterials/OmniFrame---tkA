# Created and developed by Jai Singh
"""Unit tests for the Work Engine zoning dispatch path in `lt22_import.py`.

Covers the additive `dispatch_zoning_tasks` shim that fans LT22 rows out
as `work_tasks` rows of type `zone_audit`. The legacy
`sap_outbound_to_imports` insert is unchanged and not exercised here.

Run with:
    python3 -m pytest omni_agent/tests/test_zoning_dispatch.py -v

The tests are pure-Python — no SAP COM, no Supabase, no FastAPI app. We
import `lt22_import` directly and stub out `_lt22_request` so the HTTP
boundary is fully observable.
"""
from __future__ import annotations

import os
import sys
import types
import unittest
from typing import Any
from unittest import mock


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)


import lt22_import  # noqa: E402


def _make_state() -> types.SimpleNamespace:
    return types.SimpleNamespace(
        supabase_token="fake-jwt",
        supabase_url="https://example.supabase.co",
        supabase_key="fake-anon-key",
    )


def _make_request() -> lt22_import.Lt22ImportRequest:
    return lt22_import.Lt22ImportRequest(
        warehouse="PDC",
        storage_type="916",
        show_verified=False,
        show_open_waiting=True,
        layout_variant="ONEBOXAPPX",
        organization_id="c9d89a74-7179-4033-93ea-56267cf42a17",
        triggered_by=None,
        import_run_id="00000000-0000-0000-0000-000000000001",
        use_bulk_export=True,
    )


def _make_normalized_row(
    *,
    to_number: str = "0010234567",
    item: str = "0001",
    storage_type: str = "916",
    source_bin: str = "916-A1-01",
    quantity: float = 12.0,
    material: str = "23089792",
) -> dict:
    """Mirror of the dict shape `normalize_lt22_row` returns."""
    return {
        "organization_id": "c9d89a74-7179-4033-93ea-56267cf42a17",
        "to_number": to_number,
        "warehouse": "PDC",
        "storage_type": storage_type,
        "status": "open",
        "status_code": "O",
        "movement_type": "311",
        "source_storage_type": storage_type,
        "source_storage_bin": source_bin,
        "dest_storage_type": "001",
        "dest_storage_bin": "001-RECV-01",
        "material": material,
        "quantity": quantity,
        "unit_of_measure": "EA",
        "delivery": "",
        "reference_doc": "",
        "created_in_sap": None,
        "confirmed_in_sap": None,
        "confirmed_by_sap": "",
        "raw_row": {"item": item},
        "import_batch_id": "batch-1",
        "import_run_id": "run-1",
    }


class _StubResponse:
    """Minimal `requests.Response`-like stub for `_lt22_request` mocks."""

    def __init__(self, status_code: int = 200, json_body: Any = None, text: str = ""):
        self.status_code = status_code
        self._json = json_body
        self.text = text
        self.content = bool(json_body) if json_body is not None else False

    def json(self) -> Any:
        return self._json


class IsZoningEligibleTests(unittest.TestCase):
    def test_true_when_storage_type_in_zoning_list(self):
        row = _make_normalized_row(storage_type="916")
        self.assertTrue(lt22_import.is_zoning_eligible(row))

    def test_true_when_source_storage_type_in_zoning_list(self):
        row = _make_normalized_row(storage_type="")
        row["source_storage_type"] = "916"
        self.assertTrue(lt22_import.is_zoning_eligible(row))

    def test_false_when_storage_types_outside_zoning_list(self):
        row = _make_normalized_row(storage_type="001")
        row["source_storage_type"] = "002"
        self.assertFalse(lt22_import.is_zoning_eligible(row))

    def test_false_when_storage_type_blank(self):
        row = _make_normalized_row(storage_type="")
        row["source_storage_type"] = ""
        self.assertFalse(lt22_import.is_zoning_eligible(row))


class DeriveZoneIdTests(unittest.TestCase):
    def test_uses_first_segment_of_source_bin(self):
        row = _make_normalized_row(source_bin="916-A1-01")
        self.assertEqual(lt22_import.derive_zone_id(row), "916")

    def test_falls_back_to_storage_type_when_no_bin(self):
        row = _make_normalized_row(source_bin="")
        row["dest_storage_bin"] = ""
        self.assertEqual(lt22_import.derive_zone_id(row), "916")

    def test_handles_slash_separator(self):
        row = _make_normalized_row(source_bin="916/A1/01")
        self.assertEqual(lt22_import.derive_zone_id(row), "916")


class BuildZoningTaskTests(unittest.TestCase):
    def test_constructs_expected_task_payload(self):
        row = _make_normalized_row()
        req = _make_request()
        task = lt22_import.build_zoning_task(row, req)
        self.assertIsNotNone(task)
        assert task is not None  # for type checkers
        self.assertEqual(task["task_type"], "zone_audit")
        self.assertEqual(task["task_subtype"], "standard_audit")
        self.assertEqual(task["primary_location"], "916-A1-01")
        self.assertEqual(task["subject_material"], "23089792")
        self.assertEqual(task["payload"]["zone_id"], "916")
        self.assertEqual(task["payload"]["expected_count"], 12.0)
        self.assertEqual(task["payload"]["lt22_to_number"], "0010234567")
        self.assertEqual(task["payload_version"], 1)
        self.assertEqual(task["priority"], "normal")
        self.assertEqual(task["idempotency_key"], "lt22:0010234567:0001")
        self.assertEqual(task["source_table"], "sap_outbound_to_imports")
        self.assertEqual(task["organization_id"], req.organization_id)

    def test_returns_none_when_to_number_missing(self):
        row = _make_normalized_row(to_number="")
        task = lt22_import.build_zoning_task(row, _make_request())
        self.assertIsNone(task)

    def test_returns_none_when_no_location(self):
        row = _make_normalized_row(source_bin="")
        row["dest_storage_bin"] = ""
        task = lt22_import.build_zoning_task(row, _make_request())
        self.assertIsNone(task)


class DispatchZoningTasksFeatureFlagTests(unittest.TestCase):
    """The zoning dispatch is a complete no-op when the flag is off."""

    @mock.patch.object(lt22_import, "_lt22_request")
    def test_no_op_when_feature_flag_off(self, mock_req: mock.Mock):
        mock_req.return_value = _StubResponse(
            200,
            json_body=[{"feature_flags": {"work_engine_enabled": False}}],
        )
        out = lt22_import.dispatch_zoning_tasks(
            _make_state(),
            _make_request(),
            [_make_normalized_row()],
        )
        self.assertEqual(out, 0)
        self.assertEqual(mock_req.call_count, 1)
        method, url = mock_req.call_args.args[0], mock_req.call_args.args[1]
        self.assertEqual(method, "GET")
        self.assertIn("work_engine_settings", url)

    @mock.patch.object(lt22_import, "_lt22_request")
    def test_no_op_when_feature_flag_missing_row(self, mock_req: mock.Mock):
        mock_req.return_value = _StubResponse(200, json_body=[])
        out = lt22_import.dispatch_zoning_tasks(
            _make_state(),
            _make_request(),
            [_make_normalized_row()],
        )
        self.assertEqual(out, 0)


class DispatchZoningTasksHappyPathTests(unittest.TestCase):
    """When the flag is on we expect one POST per eligible row."""

    @mock.patch.object(lt22_import, "_lt22_request")
    def test_inserts_eligible_rows_with_expected_payload(self, mock_req: mock.Mock):
        # First call: feature-flag GET returns enabled.
        # Second call: work_tasks POST returns the inserted row.
        mock_req.side_effect = [
            _StubResponse(
                200,
                json_body=[{"feature_flags": {"work_engine_enabled": True}}],
            ),
            _StubResponse(
                201,
                json_body=[{"id": "task-uuid-aaa"}],
            ),
        ]
        out = lt22_import.dispatch_zoning_tasks(
            _make_state(),
            _make_request(),
            [_make_normalized_row()],
        )
        self.assertEqual(out, 1)
        # Inspect the POST payload.
        post_call = mock_req.call_args_list[1]
        self.assertEqual(post_call.args[0], "POST")
        self.assertIn("/rest/v1/work_tasks", post_call.args[1])
        body = post_call.kwargs["json"]
        self.assertEqual(len(body), 1)
        task = body[0]
        self.assertEqual(task["task_type"], "zone_audit")
        self.assertEqual(task["idempotency_key"], "lt22:0010234567:0001")
        self.assertEqual(task["payload"]["zone_id"], "916")
        # Prefer header carries the resolution=ignore-duplicates flag so
        # repeats are silent successes rather than HTTP 409s.
        self.assertIn("resolution=ignore-duplicates", post_call.kwargs["headers"]["Prefer"])

    @mock.patch.object(lt22_import, "_lt22_request")
    def test_skips_rows_outside_zoning_storage_types(self, mock_req: mock.Mock):
        mock_req.side_effect = [
            _StubResponse(
                200,
                json_body=[{"feature_flags": {"work_engine_enabled": True}}],
            ),
        ]
        non_zoning_row = _make_normalized_row(storage_type="001")
        non_zoning_row["source_storage_type"] = "001"
        out = lt22_import.dispatch_zoning_tasks(
            _make_state(),
            _make_request(),
            [non_zoning_row],
        )
        self.assertEqual(out, 0)
        # Only the feature-flag GET should have happened.
        self.assertEqual(mock_req.call_count, 1)


class DispatchZoningTasksReplayTests(unittest.TestCase):
    """A replayed LT22 import re-uses the same idempotency_key.

    The unique index `(organization_id, task_type, idempotency_key)`
    plus `Prefer: resolution=ignore-duplicates` makes the second POST
    return an empty body and HTTP 201/200 — neither is treated as an
    error. The test asserts (a) we don't raise and (b) the second
    dispatch reports zero new inserts but does NOT hide an underlying
    HTTP error.
    """

    @mock.patch.object(lt22_import, "_lt22_request")
    def test_replay_is_silent_no_op(self, mock_req: mock.Mock):
        # First import: flag on, insert succeeds.
        # Second import (same row): flag on, POST returns empty body
        # because the unique index suppressed the duplicate.
        mock_req.side_effect = [
            _StubResponse(
                200,
                json_body=[{"feature_flags": {"work_engine_enabled": True}}],
            ),
            _StubResponse(201, json_body=[{"id": "task-uuid-bbb"}]),
            _StubResponse(
                200,
                json_body=[{"feature_flags": {"work_engine_enabled": True}}],
            ),
            _StubResponse(201, json_body=[]),  # ignore-duplicates → empty
        ]
        first = lt22_import.dispatch_zoning_tasks(
            _make_state(),
            _make_request(),
            [_make_normalized_row()],
        )
        second = lt22_import.dispatch_zoning_tasks(
            _make_state(),
            _make_request(),
            [_make_normalized_row()],
        )
        self.assertEqual(first, 1)
        # Second call inserts zero new rows but does not raise.
        self.assertEqual(second, 0)
        # And the idempotency_key is identical across both calls.
        first_key = mock_req.call_args_list[1].kwargs["json"][0]["idempotency_key"]
        second_key = mock_req.call_args_list[3].kwargs["json"][0]["idempotency_key"]
        self.assertEqual(first_key, second_key)


if __name__ == "__main__":
    unittest.main()

# Created and developed by Jai Singh
