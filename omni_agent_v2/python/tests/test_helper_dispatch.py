# Created and developed by Jai Singh
"""
End-to-end dispatch tests for the helper.

Verifies the full path: dispatcher build → method registration → COM
acquire / mock COM call → JSON-RPC response shape.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from rpc_protocol import RpcError, RpcRequest
from sap_helper import build_dispatcher
from session_manager import SessionManager


@pytest.fixture
def helper():
    """Sync fixture — pool / dispatcher don't need a running event loop
    until handlers actually `run_on_com`. The tests `await` directly
    on the dispatcher."""
    pool = SessionManager()
    pool.force_mock_mode(True)
    pool.start_all()

    captured_notifications: list[tuple[str, dict]] = []

    async def _notify(method, params):
        captured_notifications.append((method, params))

    dispatcher = build_dispatcher(pool, _notify)

    yield {"pool": pool, "dispatcher": dispatcher,
           "notifications": captured_notifications}

    pool.shutdown_all()


# ---------------------------------------------------------------------------
#  Dispatcher registration
# ---------------------------------------------------------------------------
class TestDispatcher:
    @pytest.mark.asyncio
    async def test_all_expected_methods_registered(self, helper):
        h = helper
        methods = h["dispatcher"].methods()
        # Spot-check the canonical methods Worker A's RpcMethod enum
        # depends on. If any of these is missing, the contract is broken.
        expected = [
            "sap.connect",
            "sap.disconnect",
            "sap.sessions",
            "sap.session",
            "sap.selectSession",
            "sap.unpinSession",
            "sap.health",
            "sap.fleet",
            "sap.confirmTo",
            "sap.transferInventory",
            "sap.binBlocks",
            "sap.materialMasterBin",
            "sap.materialMasterStorageTypes",
            "sap.materialMasterReadBin",
            "sap.materialMasterReadStorageTypes",
            "sap.createStorageBin",
            "sap.query",
            "sap.queryHandlers",
            "sap.processShipment",
            "sap.shipmentProgress",
            "sap.importLt22",
            "sap.zmm60Lookup",
            "sap.lx25InventoryCompletion",
            "sap.recording.start",
            "sap.recording.stop",
            "sap.recording.status",
            "sap.recording.list",
            "sap.recording.get",
            "sap.recording.delete",
            "sap.recording.translate",
            "sap.recording.replay",
            "sap.reverseTransaction",
        ]
        for m in expected:
            assert m in methods, f"missing method: {m}"

    @pytest.mark.asyncio
    async def test_unknown_method_returns_method_not_found(self, helper):
        h = helper
        with pytest.raises(RpcError) as exc:
            await h["dispatcher"].dispatch("sap.nonexistent", {})
        assert exc.value.code == -32601


# ---------------------------------------------------------------------------
#  sap.health & sap.sessions
# ---------------------------------------------------------------------------
class TestHealthAndSessions:
    @pytest.mark.asyncio
    async def test_sap_health_reports_mock_mode(self, helper):
        h = helper
        result = await h["dispatcher"].dispatch("sap.health", {})
        assert result["ok"] is True
        assert result["mock_mode"] is True
        assert result["num_slots"] == 6

    @pytest.mark.asyncio
    async def test_sap_sessions_returns_pool_snapshot(self, helper):
        h = helper
        result = await h["dispatcher"].dispatch("sap.sessions", {})
        assert "sessions" in result
        assert len(result["sessions"]) == 6
        assert all(s["state"] == "empty" for s in result["sessions"])


# ---------------------------------------------------------------------------
#  sap.connect with mock COM
# ---------------------------------------------------------------------------
class TestConnect:
    @pytest.mark.asyncio
    async def test_connect_slot_zero_succeeds(self, helper):
        h = helper
        result = await h["dispatcher"].dispatch("sap.connect", {"slot_id": 0})
        assert result["ok"] is True
        assert result["slot"]["state"] == "idle"
        assert result["slot"]["system"] == "MOCK"

    @pytest.mark.asyncio
    async def test_connect_missing_slot_id_raises_invalid_params(self, helper):
        h = helper
        with pytest.raises(RpcError) as exc:
            await h["dispatcher"].dispatch("sap.connect", {})
        assert exc.value.code == -32602


# ---------------------------------------------------------------------------
#  sap.confirmTo end-to-end via mock COM
# ---------------------------------------------------------------------------
class TestConfirmTo:
    @pytest.mark.asyncio
    async def test_missing_to_number_rejected(self, helper):
        h = helper
        await h["dispatcher"].dispatch("sap.connect", {"slot_id": 0})
        with pytest.raises(RpcError) as exc:
            await h["dispatcher"].dispatch("sap.confirmTo",
                                           {"slot_id": 0, "warehouse": "WH5"})
        assert exc.value.code == -32602
        assert "to_number" in exc.value.message

    @pytest.mark.asyncio
    async def test_confirmTo_against_mock_session_runs_to_completion(self, helper):
        h = helper
        await h["dispatcher"].dispatch("sap.connect", {"slot_id": 0})

        # Mock SAP returns "" sbar — handler treats this as
        # "unrecognised" and surfaces ok=false / warning=true.
        # The important thing is the dispatch path completes without
        # an unhandled exception and produces a structured response.
        result = await h["dispatcher"].dispatch(
            "sap.confirmTo",
            {"slot_id": 0, "to_number": "7289311", "warehouse": "WH5"},
        )
        assert isinstance(result, dict)
        assert "ok" in result
        # Verify slot returned to idle after the op.
        assert h["pool"].slots[0].state == "idle"


# ---------------------------------------------------------------------------
#  Stub handlers
# ---------------------------------------------------------------------------
class TestStubHandlers:
    @pytest.mark.asyncio
    async def test_reversal_returns_pointer_to_rust(self, helper):
        h = helper
        result = await h["dispatcher"].dispatch("sap.reverseTransaction", {})
        assert result["ok"] is False
        assert result["stub"] is True
        assert result["owner"] == "rust-reversal-service"

    @pytest.mark.asyncio
    async def test_query_unknown_handler_rejected(self, helper):
        h = helper
        await h["dispatcher"].dispatch("sap.connect", {"slot_id": 0})
        result = await h["dispatcher"].dispatch(
            "sap.query", {"slot_id": 0, "handler": "nope"},
        )
        assert result["ok"] is False
        assert "unknown handler" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_query_handlers_lists_known_handlers(self, helper):
        h = helper
        result = await h["dispatcher"].dispatch("sap.queryHandlers", {})
        assert result["ok"] is True
        ids = [h["id"] for h in result["handlers"]]
        assert "lt10" in ids
        assert "mb52" in ids


# ---------------------------------------------------------------------------
#  Recording lifecycle
# ---------------------------------------------------------------------------
class TestRecording:
    @pytest.mark.asyncio
    async def test_recording_status_when_idle(self, helper):
        h = helper
        result = await h["dispatcher"].dispatch("sap.recording.status", {})
        assert result["ok"] is True
        assert result["active"] is False

    @pytest.mark.asyncio
    async def test_recording_start_then_stop(self, helper, tmp_path,
                                              monkeypatch):
        monkeypatch.setenv("OMNI_RECORDINGS_DIR", str(tmp_path))
        h = helper

        start = await h["dispatcher"].dispatch(
            "sap.recording.start", {"name": "test rec"},
        )
        assert start["ok"] is True
        assert start["recording_id"].startswith("rec_")

        # While recording is active, status should reflect that.
        status = await h["dispatcher"].dispatch("sap.recording.status", {})
        assert status["active"] is True

        stop = await h["dispatcher"].dispatch("sap.recording.stop", {})
        assert stop["ok"] is True
        assert stop["status"] == "stopped"

        # The recording should be discoverable via list.
        listed = await h["dispatcher"].dispatch("sap.recording.list", {})
        assert listed["ok"] is True
        assert listed["count"] >= 1
        assert any(item["id"] == start["recording_id"]
                   for item in listed["items"])


# ---------------------------------------------------------------------------
#  Smoke: the JSON-RPC framing flow end-to-end
# ---------------------------------------------------------------------------
class TestEndToEndFraming:
    @pytest.mark.asyncio
    async def test_full_request_response_cycle(self, helper):
        from rpc_protocol import (decode_frame, encode_frame,
                                  make_response)
        h = helper

        # Encode a request as a wire frame.
        req_frame = encode_frame({
            "jsonrpc": "2.0", "id": 100,
            "method": "sap.health", "params": {},
        })

        # Decode + dispatch + re-encode the response.
        obj = decode_frame(req_frame)
        req = RpcRequest.from_obj(obj)
        result = await h["dispatcher"].dispatch(req.method, req.params)
        resp_frame = encode_frame(make_response(req.id, result=result))

        # Verify the response is a valid JSON line that parses back to
        # the expected shape.
        assert resp_frame.endswith(b"\n")
        decoded = json.loads(resp_frame.decode("utf-8"))
        assert decoded["jsonrpc"] == "2.0"
        assert decoded["id"] == 100
        assert decoded["result"]["ok"] is True

# Created and developed by Jai Singh
