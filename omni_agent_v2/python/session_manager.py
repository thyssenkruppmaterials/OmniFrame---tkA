# Created and developed by Jai Singh
"""
6-slot SAP session pool with per-slot COM STA isolation.

The current Python agent (omni_agent/agent.py) had two module-level
singletons `_sap_conn_idx` / `_sap_sess_idx` and used a single COM thread
implicitly inherited from FastAPI's worker pool. v2 replaces that with
six named slots, each owning:

  - A dedicated OS thread (the "COM thread") that calls
    `pythoncom.CoInitialize()` exactly once at startup so STA threading
    requirements are honored.
  - A `queue.Queue` of work items the COM thread drains in order. Each
    work item is a callable `fn(sap_session, *args, **kwargs)` plus an
    `asyncio.Future` for the asyncio main thread to await on.
  - A bound (conn_idx, sess_idx) pointing at a SAP GUI session, plus
    cached identity (system / client / user) for diagnostics.
  - A finite-state-machine status: empty | connecting | idle | busy |
    error | disconnected. Handlers acquire a slot via
    `acquire_slot_for_op()` which atomically transitions idle → busy
    and back.

Key invariants:
  - All COM calls for slot N happen on slot N's COM thread. The asyncio
    main thread NEVER touches a COM object directly.
  - At most one operation per slot at a time (enforced by the FSM lock).
    Multiple slots can run COM ops concurrently — the whole point.
  - A slot can be safely re-bound to a different SAP session (e.g. user
    closes session 0 and re-pins to session 2 on the same connection)
    without restarting the COM thread.
"""

from __future__ import annotations

import asyncio
import queue
import threading
import time
import traceback
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

from com_compat import is_com_available, pythoncom, win32com_client
from rpc_protocol import RpcError


# ---------------------------------------------------------------------------
#  Constants
# ---------------------------------------------------------------------------
NUM_SLOTS = 6
DEFAULT_OP_TIMEOUT_S = 120.0   # any single COM op must finish within 2 min
COM_THREAD_JOIN_TIMEOUT_S = 5.0
PUMP_INTERVAL_S = 0.05         # how often the COM thread pumps Windows messages


# ---------------------------------------------------------------------------
#  Slot state
# ---------------------------------------------------------------------------
SlotState = str  # one of: empty | connecting | idle | busy | error | disconnected

VALID_STATES = {"empty", "connecting", "idle", "busy", "error", "disconnected"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class _ComWorkItem:
    """Work item dispatched onto a slot's COM thread."""
    fn: Callable[..., Any]
    args: tuple
    kwargs: dict
    loop: asyncio.AbstractEventLoop
    future: asyncio.Future
    enqueued_at: float = field(default_factory=time.time)


# ---------------------------------------------------------------------------
#  SessionSlot — one slot in the pool
# ---------------------------------------------------------------------------
class SessionSlot:
    """One slot in the 6-slot pool. Owns a COM thread + work queue."""

    def __init__(self, slot_id: int) -> None:
        self.slot_id = slot_id
        self.state: SlotState = "empty"
        self.conn_idx: Optional[int] = None
        self.sess_idx: Optional[int] = None
        self.label: Optional[str] = None
        self.system: Optional[str] = None
        self.client: Optional[str] = None
        self.user: Optional[str] = None
        self.transaction: Optional[str] = None
        self.last_op: Optional[str] = None
        self.last_op_at: Optional[datetime] = None
        self.last_error: Optional[str] = None
        self.busy_since: Optional[datetime] = None
        self.connected_at: Optional[datetime] = None

        self._sap_session: Any = None        # bound COM object
        self._scripting_engine: Any = None   # cached SAPGUI scripting engine

        # Concurrency primitives. The asyncio busy lock is created
        # lazily per-event-loop because Python 3.9 binds asyncio.Lock to
        # the loop at construction time — pre-creating it in __init__
        # would break tests that spin up a fresh loop per case.
        self._state_lock = threading.Lock()
        self._busy_lock: Optional[asyncio.Lock] = None
        self._busy_lock_loop: Optional[asyncio.AbstractEventLoop] = None
        self._com_queue: "queue.Queue[Optional[_ComWorkItem]]" = queue.Queue()
        self._com_thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._started = threading.Event()
        self._init_error: Optional[str] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def start(self) -> None:
        """Spawn the COM worker thread. Idempotent."""
        if self._com_thread and self._com_thread.is_alive():
            return
        self._stop.clear()
        self._started.clear()
        self._init_error = None
        self._com_thread = threading.Thread(
            target=self._com_thread_loop,
            name=f"omni-com-slot-{self.slot_id}",
            daemon=True,
        )
        self._com_thread.start()
        # Wait briefly for CoInitialize to settle. If it failed, surface
        # the error to the caller via _init_error.
        self._started.wait(timeout=2.0)

    def shutdown(self) -> None:
        """Signal the COM thread to drain its queue and exit. Idempotent."""
        self._stop.set()
        # Push a sentinel so the queue.get() unblocks.
        try:
            self._com_queue.put(None)
        except Exception:
            pass
        if self._com_thread and self._com_thread.is_alive():
            self._com_thread.join(timeout=COM_THREAD_JOIN_TIMEOUT_S)
        self._com_thread = None

    def _com_thread_loop(self) -> None:
        """Per-slot COM worker. Initialises COM in STA on this thread,
        then drains the work queue until shutdown."""
        try:
            try:
                pythoncom.CoInitialize()
            except Exception as e:  # noqa: BLE001
                self._init_error = f"CoInitialize failed: {e}"
                self._started.set()
                return
            self._started.set()

            while not self._stop.is_set():
                try:
                    item = self._com_queue.get(timeout=PUMP_INTERVAL_S)
                except queue.Empty:
                    # Pump waiting COM messages on Windows so events get
                    # delivered. On the mock pythoncom this is a no-op.
                    try:
                        pythoncom.PumpWaitingMessages()
                    except Exception:
                        pass
                    continue

                if item is None:  # shutdown sentinel
                    break

                self._execute_item(item)

            # Drain any remaining items on shutdown so callers don't hang
            # forever on the future.
            while True:
                try:
                    item = self._com_queue.get_nowait()
                except queue.Empty:
                    break
                if item is None:
                    continue
                self._fail_future(
                    item,
                    RpcError(-32007, "Helper shutting down",
                             {"slot_id": self.slot_id}),
                )
        finally:
            try:
                pythoncom.CoUninitialize()
            except Exception:
                pass

    def _execute_item(self, item: _ComWorkItem) -> None:
        """Run a single work item on this thread, marshalling the result
        back to the asyncio loop that enqueued it."""
        try:
            result = item.fn(self._sap_session, *item.args, **item.kwargs)
            self._set_future_result(item, result)
        except BaseException as exc:  # noqa: BLE001
            self._fail_future(item, exc)

    @staticmethod
    def _set_future_result(item: _ComWorkItem, result: Any) -> None:
        loop = item.loop
        fut = item.future
        if loop.is_closed():
            return
        loop.call_soon_threadsafe(_safe_set_result, fut, result)

    @staticmethod
    def _fail_future(item: _ComWorkItem, exc: BaseException) -> None:
        loop = item.loop
        fut = item.future
        if loop.is_closed():
            return
        loop.call_soon_threadsafe(_safe_set_exception, fut, exc)

    # ------------------------------------------------------------------
    # COM marshalling
    # ------------------------------------------------------------------
    async def run_on_com(
        self,
        fn: Callable[..., Any],
        *args: Any,
        timeout: float = DEFAULT_OP_TIMEOUT_S,
        **kwargs: Any,
    ) -> Any:
        """Marshal `fn(sap_session, *args, **kwargs)` onto this slot's COM
        thread and await its result.

        `fn` MUST be a synchronous callable — it runs on the COM thread,
        not the asyncio loop. Use this for any `sess.findById(...)`,
        `.text = ...`, `.press()`, etc. Mixing asyncio inside `fn` will
        deadlock.
        """
        if self._com_thread is None or not self._com_thread.is_alive():
            raise RpcError(-32603,
                           f"Slot {self.slot_id} COM thread is not running",
                           {"slot_id": self.slot_id,
                            "init_error": self._init_error or ""})

        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        item = _ComWorkItem(fn=fn, args=args, kwargs=kwargs,
                            loop=loop, future=fut)
        self._com_queue.put(item)

        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError as e:
            raise RpcError(-32006,
                           f"Slot {self.slot_id} COM op timed out after {timeout}s",
                           {"slot_id": self.slot_id, "timeout": timeout}) from e

    # ------------------------------------------------------------------
    # State management
    # ------------------------------------------------------------------
    def snapshot(self) -> dict:
        """Public-safe snapshot of slot status (for sap.sessions response)."""
        with self._state_lock:
            return {
                "slot_id": self.slot_id,
                "state": self.state,
                "conn_idx": self.conn_idx,
                "sess_idx": self.sess_idx,
                "label": self.label,
                "system": self.system,
                "client": self.client,
                "user": self.user,
                "transaction": self.transaction,
                "last_op": self.last_op,
                "last_op_at": _iso(self.last_op_at),
                "last_error": self.last_error,
                "busy_since": _iso(self.busy_since),
                "connected_at": _iso(self.connected_at),
            }

    def _busy_lock_for_loop(self) -> asyncio.Lock:
        """Return the asyncio.Lock bound to the current running loop.

        Recreates the lock if the loop has changed since the last call.
        On Python 3.10+ this is a no-op (asyncio.Lock binds at first
        await), but on 3.9 the Lock is bound at construction so we must
        rebuild on loop change to avoid `attached to a different loop`
        errors.
        """
        loop = asyncio.get_running_loop()
        if self._busy_lock is None or self._busy_lock_loop is not loop:
            self._busy_lock = asyncio.Lock()
            self._busy_lock_loop = loop
        return self._busy_lock

    def _set_state(self, new_state: SlotState, *,
                   error: Optional[str] = None,
                   last_op: Optional[str] = None) -> None:
        if new_state not in VALID_STATES:
            raise ValueError(f"invalid slot state: {new_state}")
        with self._state_lock:
            self.state = new_state
            if error is not None:
                self.last_error = error
            if last_op is not None:
                self.last_op = last_op
                self.last_op_at = _utcnow()
            if new_state == "busy":
                self.busy_since = _utcnow()
            else:
                self.busy_since = None

    def _set_identity(self, *, conn_idx: int, sess_idx: int,
                      system: str, client: str, user: str,
                      transaction: str, label: str) -> None:
        with self._state_lock:
            self.conn_idx = conn_idx
            self.sess_idx = sess_idx
            self.system = system
            self.client = client
            self.user = user
            self.transaction = transaction
            self.label = label
            self.connected_at = _utcnow()

    # ------------------------------------------------------------------
    # SAP connect / disconnect
    # ------------------------------------------------------------------
    async def connect(self,
                      conn_idx: Optional[int] = None,
                      sess_idx: Optional[int] = None,
                      label: Optional[str] = None) -> dict:
        """Bind this slot to a SAP GUI (conn_idx, sess_idx) pair.

        If indexes are None, auto-pick the first valid (conn=0, sess=0)
        if that exists; otherwise the first responsive pair.
        """
        if self.state == "busy":
            raise RpcError.slot_busy(self.slot_id, last_op=self.last_op or "")

        self._set_state("connecting")

        def _do_connect(_sess_unused: Any) -> dict:
            try:
                sap_gui = win32com_client.GetObject("SAPGUI")
            except Exception as e:
                raise RuntimeError(
                    f"GetObject('SAPGUI') failed: {e}. Is the SAP GUI "
                    f"running with scripting enabled?"
                ) from e
            try:
                engine = sap_gui.GetScriptingEngine
            except Exception as e:
                raise RuntimeError(f"GetScriptingEngine failed: {e}") from e

            ci, si = conn_idx, sess_idx
            if ci is None or si is None:
                ci, si = _auto_pick_session(engine)
                if ci is None:
                    raise RuntimeError(
                        "No active SAP GUI session found. Open SAP "
                        "Logon, sign in to a system, then retry."
                    )
            try:
                conn = engine.Children(int(ci))
                sess = conn.Children(int(si))
                sess.findById("wnd[0]")
            except Exception as e:
                raise RuntimeError(
                    f"SAP session ({ci}, {si}) is not usable: {e}"
                ) from e

            try:
                desc = conn.Description
            except Exception:
                desc = f"Connection {ci}"

            sys_name = client_no = user_id = tx = ""
            try:
                info = sess.Info
                sys_name = str(info.SystemName or "")
                client_no = str(info.Client or "")
                user_id = str(info.User or "")
                tx = str(info.Transaction or "")
            except Exception:
                pass

            self._sap_session = sess
            self._scripting_engine = engine
            return {
                "conn_idx": int(ci),
                "sess_idx": int(si),
                "label": label or f"{desc} / {sys_name or 'session'}",
                "system": sys_name,
                "client": client_no,
                "user": user_id,
                "transaction": tx,
                "description": str(desc),
            }

        try:
            info = await self.run_on_com(_do_connect)
        except Exception as e:
            self._set_state("error",
                            error=str(e),
                            last_op="sap.connect")
            raise

        self._set_identity(**{k: info[k] for k in (
            "conn_idx", "sess_idx", "system", "client", "user",
            "transaction", "label",
        )})
        self._set_state("idle", last_op="sap.connect", error=None)
        # Clear any stale error from a prior attempt.
        with self._state_lock:
            self.last_error = None
        return self.snapshot()

    async def disconnect(self) -> None:
        """Release the SAP COM reference but keep the COM thread alive
        so the slot can be re-bound. State → empty."""
        def _drop(_sess_unused: Any) -> None:
            self._sap_session = None
            self._scripting_engine = None
            return None

        try:
            await self.run_on_com(_drop)
        except Exception:
            pass
        with self._state_lock:
            self.conn_idx = None
            self.sess_idx = None
            self.label = None
            self.system = None
            self.client = None
            self.user = None
            self.transaction = None
            self.connected_at = None
            self.last_error = None
            self.state = "empty"


def _safe_set_result(fut: asyncio.Future, value: Any) -> None:
    if not fut.done():
        fut.set_result(value)


def _safe_set_exception(fut: asyncio.Future, exc: BaseException) -> None:
    if not fut.done():
        fut.set_exception(exc)


def _auto_pick_session(engine: Any) -> tuple[Optional[int], Optional[int]]:
    """Walk the SAP scripting engine and return the first (ci, si) pair
    that has a usable wnd[0]."""
    try:
        n_conns = engine.Children.Count
    except Exception:
        return None, None
    for ci in range(int(n_conns)):
        try:
            conn = engine.Children(ci)
            n_sess = conn.Children.Count
        except Exception:
            continue
        for si in range(int(n_sess)):
            try:
                sess = conn.Children(si)
                sess.findById("wnd[0]")
                return ci, si
            except Exception:
                continue
    return None, None


# ---------------------------------------------------------------------------
#  SessionManager — the pool itself
# ---------------------------------------------------------------------------
class SessionManager:
    """Owns the 6 slots, exposes pool-wide operations + acquire context."""

    def __init__(self, num_slots: int = NUM_SLOTS) -> None:
        self.slots: list[SessionSlot] = [SessionSlot(i) for i in range(num_slots)]
        self._notify: Optional[Callable[[str, dict], Awaitable[None]]] = None
        self._mock_mode = not is_com_available()

    @property
    def mock_mode(self) -> bool:
        return self._mock_mode

    def force_mock_mode(self, enabled: bool = True) -> None:
        """Override mock-mode detection (used when --mock is passed
        explicitly even on Windows for offline tests)."""
        self._mock_mode = bool(enabled)

    def set_notify(self, notify: Callable[[str, dict], Awaitable[None]]) -> None:
        self._notify = notify

    async def _emit_log(self, slot_id: Optional[int], level: str,
                        message: str) -> None:
        if self._notify is None:
            return
        try:
            await self._notify("log", {
                "slot_id": slot_id,
                "level": level,
                "message": message,
                "ts": _iso(_utcnow()),
            })
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def start_all(self) -> None:
        for slot in self.slots:
            slot.start()

    def shutdown_all(self) -> None:
        for slot in self.slots:
            slot.shutdown()

    # ------------------------------------------------------------------
    # Snapshots
    # ------------------------------------------------------------------
    def snapshot(self) -> dict:
        return {
            "num_slots": len(self.slots),
            "mock_mode": self._mock_mode,
            "sessions": [slot.snapshot() for slot in self.slots],
        }

    def get_slot(self, slot_id: int) -> SessionSlot:
        if not isinstance(slot_id, int):
            raise RpcError.invalid_params("slot_id must be int",
                                          slot_id=slot_id)
        if slot_id < 0 or slot_id >= len(self.slots):
            raise RpcError.slot_not_found(slot_id)
        return self.slots[slot_id]

    # ------------------------------------------------------------------
    # Connection management (used by handlers/connection.py)
    # ------------------------------------------------------------------
    async def connect_slot(
        self,
        slot_id: int,
        conn_idx: Optional[int] = None,
        sess_idx: Optional[int] = None,
        label: Optional[str] = None,
    ) -> dict:
        slot = self.get_slot(slot_id)
        slot.start()
        return await slot.connect(conn_idx=conn_idx, sess_idx=sess_idx,
                                  label=label)

    async def disconnect_slot(self, slot_id: int) -> dict:
        slot = self.get_slot(slot_id)
        await slot.disconnect()
        return slot.snapshot()

    def find_idle_slot(self) -> Optional[SessionSlot]:
        """First idle slot, or None if all are empty/busy/error."""
        for slot in self.slots:
            if slot.state == "idle":
                return slot
        return None

    # ------------------------------------------------------------------
    # Operation context — the canonical "I want to run a handler" entry
    # ------------------------------------------------------------------
    @asynccontextmanager
    async def acquire_slot_for_op(
        self,
        slot_id: Optional[int] = None,
        op_name: str = "op",
        require_connected: bool = True,
    ) -> AsyncIterator[SessionSlot]:
        """Async context that locks one slot for the duration of an
        operation. State transitions: idle → busy on enter, busy → idle
        on success, busy → error on exception.

        If `slot_id` is None, picks the first idle slot. If no slot is
        idle, raises SLOT_BUSY (callers can retry / surface to UI).
        """
        if slot_id is None:
            slot = self.find_idle_slot()
            if slot is None:
                raise RpcError(-32002,
                               "No idle SAP session slots available",
                               {"sessions": [s.snapshot() for s in self.slots]})
        else:
            slot = self.get_slot(slot_id)

        if require_connected and slot.state == "empty":
            raise RpcError.sap_not_connected(slot_id=slot.slot_id)

        # The asyncio.Lock guarantees we can't have two concurrent
        # acquire_slot_for_op() calls win the race for the same slot.
        async with slot._busy_lock_for_loop():
            if slot.state not in ("idle", "error"):
                # Someone else moved us out of idle in between — retry
                raise RpcError.slot_busy(slot.slot_id, last_op=slot.last_op or "")

            slot._set_state("busy", last_op=op_name)
            try:
                yield slot
            except RpcError:
                slot._set_state("idle", last_op=op_name,
                                error=None)  # known/expected → still idle
                raise
            except Exception as exc:
                slot._set_state("error", last_op=op_name,
                                error=f"{type(exc).__name__}: {exc}")
                raise
            else:
                slot._set_state("idle", last_op=op_name, error=None)


__all__ = [
    "SessionManager",
    "SessionSlot",
    "NUM_SLOTS",
    "DEFAULT_OP_TIMEOUT_S",
]

# Created and developed by Jai Singh
