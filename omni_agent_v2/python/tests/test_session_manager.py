# Created and developed by Jai Singh
"""
Unit tests for session_manager.py — slot allocation, COM thread,
state transitions. Runs on macOS via the mock COM layer.
"""
from __future__ import annotations

import asyncio

import pytest

from rpc_protocol import RpcError
from session_manager import NUM_SLOTS, SessionManager


@pytest.fixture
def pool():
    p = SessionManager()
    p.force_mock_mode(True)
    p.start_all()
    yield p
    p.shutdown_all()


# ---------------------------------------------------------------------------
#  Pool snapshot + lifecycle
# ---------------------------------------------------------------------------
class TestPoolSnapshot:
    def test_default_size_is_six(self, pool):
        assert len(pool.slots) == NUM_SLOTS == 6

    def test_initial_snapshot_all_empty(self, pool):
        snap = pool.snapshot()
        assert snap["num_slots"] == 6
        assert all(s["state"] == "empty" for s in snap["sessions"])
        assert all(s["conn_idx"] is None for s in snap["sessions"])

    def test_mock_mode_flag_propagates(self, pool):
        assert pool.snapshot()["mock_mode"] is True

    def test_get_slot_out_of_range(self, pool):
        with pytest.raises(RpcError):
            pool.get_slot(99)
        with pytest.raises(RpcError):
            pool.get_slot(-1)


# ---------------------------------------------------------------------------
#  COM thread + run_on_com
# ---------------------------------------------------------------------------
class TestComThread:
    @pytest.mark.asyncio
    async def test_run_on_com_returns_callable_result(self, pool):
        slot = pool.slots[0]
        # Manually set a session ref so the closure receives something.
        slot._sap_session = {"hello": "world"}

        def _read(sess):
            return sess["hello"]

        out = await slot.run_on_com(_read, timeout=5.0)
        assert out == "world"

    @pytest.mark.asyncio
    async def test_run_on_com_propagates_exceptions(self, pool):
        slot = pool.slots[0]
        slot._sap_session = None

        def _boom(_sess):
            raise RuntimeError("mock fail")

        with pytest.raises(RuntimeError, match="mock fail"):
            await slot.run_on_com(_boom, timeout=5.0)

    @pytest.mark.asyncio
    async def test_run_on_com_passes_args_kwargs(self, pool):
        slot = pool.slots[0]
        slot._sap_session = "sess"

        def _f(sess, a, b, c=0):
            return f"{sess}-{a}-{b}-{c}"

        out = await slot.run_on_com(_f, 1, 2, c=3, timeout=5.0)
        assert out == "sess-1-2-3"


# ---------------------------------------------------------------------------
#  Connect / disconnect
# ---------------------------------------------------------------------------
class TestConnectDisconnect:
    @pytest.mark.asyncio
    async def test_connect_to_mock_session(self, pool):
        snap = await pool.connect_slot(slot_id=0)
        assert snap["state"] == "idle"
        assert snap["conn_idx"] == 0
        assert snap["sess_idx"] == 0
        assert snap["system"] == "MOCK"

    @pytest.mark.asyncio
    async def test_connect_with_explicit_indexes(self, pool):
        snap = await pool.connect_slot(slot_id=0, conn_idx=0, sess_idx=0)
        assert snap["conn_idx"] == 0
        assert snap["sess_idx"] == 0

    @pytest.mark.asyncio
    async def test_disconnect_resets_state(self, pool):
        await pool.connect_slot(slot_id=0)
        assert pool.slots[0].state == "idle"
        snap = await pool.disconnect_slot(0)
        assert snap["state"] == "empty"
        assert snap["conn_idx"] is None


# ---------------------------------------------------------------------------
#  acquire_slot_for_op state transitions
# ---------------------------------------------------------------------------
class TestAcquireSlot:
    @pytest.mark.asyncio
    async def test_acquire_transitions_idle_to_busy_to_idle(self, pool):
        await pool.connect_slot(slot_id=0)

        async with pool.acquire_slot_for_op(slot_id=0, op_name="test.op") as slot:
            assert slot.state == "busy"
            assert slot.last_op == "test.op"

        assert pool.slots[0].state == "idle"
        assert pool.slots[0].last_op == "test.op"

    @pytest.mark.asyncio
    async def test_acquire_handles_exception_to_error_state(self, pool):
        await pool.connect_slot(slot_id=0)

        with pytest.raises(RuntimeError):
            async with pool.acquire_slot_for_op(slot_id=0, op_name="test.op"):
                raise RuntimeError("handler boom")

        assert pool.slots[0].state == "error"
        assert "handler boom" in (pool.slots[0].last_error or "")

    @pytest.mark.asyncio
    async def test_acquire_rpc_error_returns_to_idle(self, pool):
        await pool.connect_slot(slot_id=0)

        with pytest.raises(RpcError):
            async with pool.acquire_slot_for_op(slot_id=0, op_name="test.op"):
                raise RpcError(-32602, "bad params")

        # RpcError is "expected" — slot returns to idle, NOT error.
        assert pool.slots[0].state == "idle"

    @pytest.mark.asyncio
    async def test_acquire_empty_slot_raises_not_connected(self, pool):
        with pytest.raises(RpcError) as exc:
            async with pool.acquire_slot_for_op(slot_id=0):
                pass
        assert "not connected" in exc.value.message.lower()

    @pytest.mark.asyncio
    async def test_acquire_no_idle_slot_raises_busy(self, pool):
        # All slots empty (no connect call) → no idle slot found.
        with pytest.raises(RpcError):
            async with pool.acquire_slot_for_op(slot_id=None):
                pass

    @pytest.mark.asyncio
    async def test_find_idle_picks_first_idle_slot(self, pool):
        await pool.connect_slot(slot_id=2)
        await pool.connect_slot(slot_id=4)
        idle = pool.find_idle_slot()
        assert idle is not None
        assert idle.slot_id == 2

    @pytest.mark.asyncio
    async def test_concurrent_acquires_serialise_per_slot(self, pool):
        await pool.connect_slot(slot_id=0)

        events: list[str] = []

        async def _op(label: str):
            async with pool.acquire_slot_for_op(slot_id=0, op_name=label):
                events.append(f"{label}-start")
                await asyncio.sleep(0.05)
                events.append(f"{label}-end")

        await asyncio.gather(_op("A"), _op("B"))
        # The two ops MUST NOT interleave on the same slot.
        assert events in (
            ["A-start", "A-end", "B-start", "B-end"],
            ["B-start", "B-end", "A-start", "A-end"],
        )


# ---------------------------------------------------------------------------
#  Notify hook
# ---------------------------------------------------------------------------
class TestNotify:
    @pytest.mark.asyncio
    async def test_notify_hook_can_be_set(self, pool):
        captured: list[tuple[str, dict]] = []

        async def _notify(method, params):
            captured.append((method, params))

        pool.set_notify(_notify)
        await pool._emit_log(slot_id=1, level="info", message="hello")
        assert captured == [("log", captured[0][1])]
        assert captured[0][1]["slot_id"] == 1
        assert captured[0][1]["message"] == "hello"

# Created and developed by Jai Singh
