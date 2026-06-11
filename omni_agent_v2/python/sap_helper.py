# Created and developed by Jai Singh
"""
OmniAgent v2 — Python helper, JSON-RPC server entry point.

Run modes:
  python sap_helper.py             # production (Windows, real COM)
  python sap_helper.py --mock      # offline mode (mac/Linux validation)
  python sap_helper.py --probe     # print registered methods + exit
  python sap_helper.py --version   # print version + exit

Wire protocol: line-delimited JSON-RPC 2.0. See `rpc_protocol.py` for the
exact frame shapes. The Rust shell (Worker A) speaks this protocol over
stdin/stdout; stderr is reserved for free-form diagnostic logs.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import sys
import threading
import traceback
from typing import Any, Awaitable, Callable, Optional

# Make this directory importable so submodules resolve at runtime.
_HELPER_DIR = os.path.dirname(os.path.abspath(__file__))
if _HELPER_DIR not in sys.path:
    sys.path.insert(0, _HELPER_DIR)

from com_compat import is_com_available  # noqa: E402
from rpc_protocol import (  # noqa: E402
    INTERNAL_ERROR,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    RpcError,
    RpcRequest,
    decode_frame,
    encode_frame,
    make_notification,
    make_response,
)
from session_manager import SessionManager  # noqa: E402


HELPER_VERSION = "2.0.0"


# ---------------------------------------------------------------------------
#  Logging — stderr only, never stdout (stdout is the JSON-RPC channel)
# ---------------------------------------------------------------------------
def _log(message: str, level: str = "info") -> None:
    sys.stderr.write(f"[helper:{level}] {message}\n")
    sys.stderr.flush()


# ---------------------------------------------------------------------------
#  Dispatcher — registry of method_name -> async handler
# ---------------------------------------------------------------------------
HandlerFn = Callable[[SessionManager, dict, "NotifyFn"], Awaitable[Any]]
NotifyFn = Callable[[str, dict], Awaitable[None]]


class Dispatcher:
    """Maps JSON-RPC method names to async handler functions.

    Each handler has the signature
        async def handler(session_pool, params, notify) -> result

    where `result` is any JSON-serialisable object that becomes the
    `result` field of the response.
    """

    def __init__(self, session_pool: SessionManager,
                 notify: NotifyFn) -> None:
        self.session_pool = session_pool
        self.notify = notify
        self._handlers: dict[str, HandlerFn] = {}

    def register(self, method: str, fn: HandlerFn) -> None:
        if method in self._handlers:
            raise ValueError(f"duplicate handler for {method}")
        self._handlers[method] = fn

    def methods(self) -> list[str]:
        return sorted(self._handlers.keys())

    async def dispatch(self, method: str, params: dict) -> Any:
        fn = self._handlers.get(method)
        if fn is None:
            raise RpcError.method_not_found(method)
        return await fn(self.session_pool, params, self.notify)


def build_dispatcher(session_pool: SessionManager,
                     notify: NotifyFn) -> Dispatcher:
    """Build a dispatcher with every handler module registered.

    Imported here (function-local) so a malformed handler module doesn't
    prevent the helper from starting up — we degrade by skipping the
    bad module and logging the import error.
    """
    dispatcher = Dispatcher(session_pool, notify)

    handler_modules = [
        ("connection", "handlers.connection"),
        ("lt12",       "handlers.lt12"),
        ("lt01",       "handlers.lt01"),
        ("ls02n",      "handlers.ls02n"),
        ("mm02",       "handlers.mm02"),
        ("ls01n",      "handlers.ls01n"),
        ("mm03",       "handlers.mm03"),
        ("query",      "handlers.query"),
        ("shipment",   "handlers.shipment"),
        ("lt22",       "handlers.lt22"),
        ("zmm60",      "handlers.zmm60"),
        ("lx25",       "handlers.lx25"),
        ("recording",  "handlers.recording"),
        ("reversal",   "handlers.reversal"),
    ]
    for name, modpath in handler_modules:
        try:
            import importlib
            mod = importlib.import_module(modpath)
            register = getattr(mod, "register", None)
            if register is None:
                _log(f"handler module {name} has no register() — skipping",
                     level="warn")
                continue
            register(dispatcher)
        except Exception as e:
            _log(f"failed to load handler module {name}: {e}\n"
                 f"{traceback.format_exc()}", level="error")
    return dispatcher


# ---------------------------------------------------------------------------
#  Stdout writer — single-writer mutex so notifications + responses
#  never interleave mid-line
# ---------------------------------------------------------------------------
class StdoutWriter:
    """Thread-safe + asyncio-safe writer for the stdout JSON-RPC channel.

    The Rust shell expects line-delimited JSON, so we MUST emit each
    frame atomically. We use a sync lock (not asyncio) because notify
    can fire from any thread (e.g. a recording capture thread emitting
    `recording.event` from a Windows hook).
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stdout = sys.stdout.buffer

    def write_frame(self, frame: dict) -> None:
        data = encode_frame(frame)
        with self._lock:
            try:
                self._stdout.write(data)
                self._stdout.flush()
            except BrokenPipeError:
                # Parent (Rust shell) closed stdin/stdout — initiate
                # shutdown. Don't re-raise; the main loop will notice
                # the EOF on its read.
                pass


# ---------------------------------------------------------------------------
#  Request handler
# ---------------------------------------------------------------------------
async def handle_request(req_obj: dict,
                         dispatcher: Dispatcher,
                         writer: StdoutWriter) -> None:
    """Process a single decoded request object and emit the response."""
    rid: Any = req_obj.get("id") if isinstance(req_obj, dict) else None
    try:
        req = RpcRequest.from_obj(req_obj)
    except RpcError as e:
        writer.write_frame(make_response(rid, error=e.to_dict()))
        return
    except Exception as e:  # pragma: no cover — RpcRequest.from_obj covers most paths
        writer.write_frame(make_response(rid,
                                         error=RpcError.from_exception(e).to_dict()))
        return

    if req.is_notification:
        # Fire-and-forget; never reply. Used for client → server one-way
        # signals (rare — most flow is request/response).
        try:
            await dispatcher.dispatch(req.method, req.params)
        except Exception as e:
            _log(f"notification handler failed: {req.method}: {e}",
                 level="warn")
        return

    try:
        result = await dispatcher.dispatch(req.method, req.params)
        writer.write_frame(make_response(req.id, result=result))
    except RpcError as e:
        writer.write_frame(make_response(req.id, error=e.to_dict()))
    except Exception as e:  # noqa: BLE001
        _log(f"handler {req.method} crashed: {e}\n{traceback.format_exc()}",
             level="error")
        writer.write_frame(make_response(
            req.id, error=RpcError.from_exception(e).to_dict()
        ))


# ---------------------------------------------------------------------------
#  Stdin reader — yields one JSON object per line
# ---------------------------------------------------------------------------
async def _read_lines_from_stdin() -> "asyncio.Queue[Optional[bytes]]":
    """Spawn a thread that reads stdin line-by-line and pushes onto an
    asyncio queue. Returns the queue (None pushed on EOF).

    We use a thread because Python's asyncio doesn't have a portable
    cross-platform StreamReader for stdin (Windows in particular is
    awkward). The throughput is fine — JSON-RPC frames are small and
    arrive at a low rate (human-driven SAP ops).
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue(maxsize=256)

    def _reader() -> None:
        stdin = sys.stdin.buffer
        try:
            while True:
                line = stdin.readline()
                if not line:
                    asyncio.run_coroutine_threadsafe(queue.put(None), loop)
                    return
                asyncio.run_coroutine_threadsafe(queue.put(line), loop)
        except Exception as e:  # noqa: BLE001
            _log(f"stdin reader thread crashed: {e}", level="error")
            try:
                asyncio.run_coroutine_threadsafe(queue.put(None), loop)
            except Exception:
                pass

    threading.Thread(target=_reader, name="omni-stdin-reader",
                     daemon=True).start()
    return queue


# ---------------------------------------------------------------------------
#  Main loop
# ---------------------------------------------------------------------------
async def _run_main_loop(mock: bool = False) -> int:
    writer = StdoutWriter()

    async def notify(method: str, params: dict) -> None:
        writer.write_frame(make_notification(method, params))

    session_pool = SessionManager()
    if mock:
        session_pool.force_mock_mode(True)
    session_pool.set_notify(notify)
    session_pool.start_all()

    dispatcher = build_dispatcher(session_pool, notify)

    _log(f"OmniAgent helper v{HELPER_VERSION} ready "
         f"(com_available={is_com_available()}, mock={mock}, "
         f"methods={len(dispatcher.methods())})")

    # Send a one-shot "ready" notification so the Rust shell can flip
    # its readiness gauge as soon as we boot.
    await notify("helper.ready", {
        "version": HELPER_VERSION,
        "mock_mode": session_pool.mock_mode,
        "num_slots": len(session_pool.slots),
        "methods": dispatcher.methods(),
    })

    line_queue = await _read_lines_from_stdin()

    pending: set[asyncio.Task] = set()

    def _spawn(coro: Awaitable) -> None:
        task = asyncio.create_task(coro)
        pending.add(task)
        task.add_done_callback(pending.discard)

    try:
        while True:
            line = await line_queue.get()
            if line is None:
                _log("stdin closed — shutting down")
                break
            try:
                obj = decode_frame(line)
            except RpcError as e:
                writer.write_frame(make_response(None, error=e.to_dict()))
                continue
            _spawn(handle_request(obj, dispatcher, writer))

        # Drain in-flight requests gracefully.
        if pending:
            try:
                await asyncio.wait_for(asyncio.gather(*pending,
                                                     return_exceptions=True),
                                       timeout=5.0)
            except asyncio.TimeoutError:
                _log(f"timed out draining {len(pending)} in-flight requests",
                     level="warn")
    finally:
        session_pool.shutdown_all()

    return 0


# ---------------------------------------------------------------------------
#  CLI entry point
# ---------------------------------------------------------------------------
def _parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="sap_helper",
        description="OmniAgent v2 SAP COM helper (JSON-RPC over stdio)",
    )
    parser.add_argument("--mock", action="store_true",
                        help="Force mock COM mode (default on non-Windows)")
    parser.add_argument("--probe", action="store_true",
                        help="Print registered methods as JSON and exit")
    parser.add_argument("--version", action="store_true",
                        help="Print version and exit")
    return parser.parse_args(argv)


def _install_signal_handlers(loop: asyncio.AbstractEventLoop) -> None:
    def _handler(signum, _frame):  # noqa: ARG001
        _log(f"received signal {signum}; shutting down")
        loop.call_soon_threadsafe(loop.stop)

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _handler)
        except (ValueError, OSError):
            # Not all platforms expose SIGTERM via signal.signal in
            # threads / IDEs — best effort.
            pass


def main(argv: Optional[list[str]] = None) -> int:
    args = _parse_args(argv)

    if args.version:
        print(HELPER_VERSION)
        return 0

    if args.probe:
        # Spin up just enough state to enumerate methods.
        pool = SessionManager()
        pool.force_mock_mode(True)

        async def _no_notify(_m: str, _p: dict) -> None:
            return None

        d = build_dispatcher(pool, _no_notify)
        print(json.dumps({
            "version": HELPER_VERSION,
            "methods": d.methods(),
            "num_slots": len(pool.slots),
        }, indent=2))
        return 0

    try:
        return asyncio.run(_run_main_loop(mock=args.mock))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())

# Created and developed by Jai Singh
