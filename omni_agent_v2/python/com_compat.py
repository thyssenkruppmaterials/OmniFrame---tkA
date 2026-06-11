# Created and developed by Jai Singh
"""
COM compatibility layer for OmniAgent v2 helper.

On Windows, this module is a thin alias around `pywin32`'s `pythoncom` and
`win32com.client`. On macOS / Linux (where the helper is built and tested
but cannot exercise SAP COM), it exposes a minimal mock surface that lets
the dispatcher, session manager, and tests run unchanged.

The real-vs-mock decision is made ONCE at import time via `is_com_available()`,
so handler code can simply do `from com_compat import pythoncom, win32com_client`
and call whichever pair of names ended up bound.

The mock surface intentionally implements ONLY what the helper layer needs
(STA init/uninit on a thread, GetObject("SAPGUI") + GetScriptingEngine, the
findById tree, sendVKey, .Text / .selected / .key on common controls). It
does NOT pretend to be a full SAP scripting impl — handler tests should
pass deterministic mock fixtures via dependency injection where the COM
shape matters beyond what the framework exercises.
"""

from __future__ import annotations

import threading
from typing import Any, Iterable


# ---------------------------------------------------------------------------
#  Detection
# ---------------------------------------------------------------------------
def is_com_available() -> bool:
    """True iff the real pywin32 COM stack is importable on this host."""
    try:
        import pythoncom  # noqa: F401
        import win32com.client  # noqa: F401
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
#  Mock pythoncom — just CoInitialize / CoUninitialize / PumpWaitingMessages
# ---------------------------------------------------------------------------
class _MockPythoncom:
    """No-op pythoncom replacement. Used on macOS so the per-slot COM
    thread can still call CoInitialize() at startup without crashing.

    The STA/MTA distinction is irrelevant in mock mode (there is no real
    apartment to enter), but tracking it is useful for assertions in
    tests."""

    COINIT_APARTMENTTHREADED = 2
    COINIT_MULTITHREADED = 0

    def __init__(self) -> None:
        self._initialized: dict[int, str] = {}

    def CoInitialize(self) -> None:  # noqa: N802 — preserve win32 casing
        tid = threading.get_ident()
        self._initialized[tid] = "STA"

    def CoInitializeEx(self, flags: int = 0) -> None:  # noqa: N802
        tid = threading.get_ident()
        self._initialized[tid] = "STA" if flags == self.COINIT_APARTMENTTHREADED else "MTA"

    def CoUninitialize(self) -> None:  # noqa: N802
        tid = threading.get_ident()
        self._initialized.pop(tid, None)

    def PumpWaitingMessages(self) -> int:  # noqa: N802
        return 0


# ---------------------------------------------------------------------------
#  Mock win32com.client — supports GetObject("SAPGUI") returning a mock
#  scripting engine
# ---------------------------------------------------------------------------
class _MockControl:
    """Generic SAP GUI control. Supports the operations our helper layer
    exercises: read/write Text, sendVKey, press, selected, key, setFocus,
    and findById tree navigation."""

    def __init__(self, control_id: str = "wnd[0]", text: str = "") -> None:
        self.id = control_id
        self.Text = text
        self.text = text  # both spellings used in agent.py
        self._selected = False
        self._key = ""
        self._children: dict[str, "_MockControl"] = {}
        self.MessageType = ""

    @property
    def selected(self) -> bool:
        return self._selected

    @selected.setter
    def selected(self, value: bool) -> None:
        self._selected = bool(value)

    @property
    def key(self) -> str:
        return self._key

    @key.setter
    def key(self, value: str) -> None:
        self._key = str(value)

    def findById(self, control_id: str) -> "_MockControl":  # noqa: N802
        # Cache mock controls so repeated lookups return the same object.
        if control_id not in self._children:
            self._children[control_id] = _MockControl(control_id)
        return self._children[control_id]

    def sendVKey(self, vkey: int) -> None:  # noqa: N802
        return None

    def press(self) -> None:
        return None

    def setFocus(self) -> None:  # noqa: N802
        return None

    def select(self) -> None:
        return None


class _MockSession:
    """Minimal SAP GUI session with findById root + Info object."""

    class _Info:
        def __init__(self) -> None:
            self.SystemName = "MOCK"
            self.Client = "000"
            self.User = "MOCKUSER"
            self.Transaction = "SESSION_MANAGER"

    def __init__(self, sess_idx: int = 0) -> None:
        self._root = _MockControl("wnd[0]")
        self._root.Text = "SAP Easy Access"
        self.Info = self._Info()
        self.Children = []
        self._sess_idx = sess_idx

    def findById(self, control_id: str) -> _MockControl:  # noqa: N802
        # Trivially resolve any path to a mock control. The shape of
        # `findById` traversal does not need to match real SAP — the
        # framework only needs the calls to not throw.
        return self._root.findById(control_id)


class _MockConnection:
    def __init__(self, idx: int, num_sessions: int = 1) -> None:
        self.Description = f"Mock Connection {idx}"
        self.ConnectionString = f"/H/MOCKHOST/S/MOCK{idx}"
        self.Children = _ChildIndex([_MockSession(i) for i in range(num_sessions)])


class _ChildIndex:
    """COM-like Children collection: Children(idx) returns the i-th child,
    Children.Count returns the total."""

    def __init__(self, items: list) -> None:
        self._items = items

    @property
    def Count(self) -> int:  # noqa: N802
        return len(self._items)

    def __call__(self, idx: int):
        return self._items[int(idx)]

    def __iter__(self) -> Iterable:
        return iter(self._items)


class _MockScriptingEngine:
    def __init__(self, num_connections: int = 1, sessions_per_conn: int = 1) -> None:
        self.Children = _ChildIndex(
            [_MockConnection(i, sessions_per_conn) for i in range(num_connections)]
        )


class _MockSapGui:
    def __init__(self) -> None:
        self.GetScriptingEngine = _MockScriptingEngine()


class _MockWin32Com:
    """Stand-in for `win32com.client`. Only `GetObject("SAPGUI")` is wired
    — every other attribute returns a no-op."""

    class client:  # noqa: N801 — match the real `win32com.client` namespace
        @staticmethod
        def Dispatch(prog_id: str) -> Any:  # noqa: N802
            if prog_id == "SAPGUI":
                return _MockSapGui()
            return None

        @staticmethod
        def GetObject(prog_id: str) -> Any:  # noqa: N802
            if prog_id == "SAPGUI":
                return _MockSapGui()
            raise RuntimeError(f"mock win32com cannot resolve '{prog_id}'")

    @staticmethod
    def Dispatch(prog_id: str) -> Any:  # noqa: N802
        return _MockWin32Com.client.Dispatch(prog_id)

    @staticmethod
    def GetObject(prog_id: str) -> Any:  # noqa: N802
        return _MockWin32Com.client.GetObject(prog_id)


# ---------------------------------------------------------------------------
#  Bind the right pair of names
# ---------------------------------------------------------------------------
_COM_AVAILABLE = is_com_available()

if _COM_AVAILABLE:
    import pythoncom as _real_pythoncom
    import win32com.client as _real_win32com_client

    pythoncom = _real_pythoncom
    win32com_client = _real_win32com_client
else:
    pythoncom = _MockPythoncom()
    win32com_client = _MockWin32Com()


def make_mock_session() -> Any:
    """Helper for tests that want a fresh mock SAP session without going
    through the scripting engine."""
    return _MockSession()


def make_mock_scripting_engine(num_connections: int = 2,
                               sessions_per_conn: int = 3) -> Any:
    """Helper for tests / `--mock` mode that need a populated mock fleet."""
    return _MockScriptingEngine(num_connections, sessions_per_conn)


__all__ = [
    "is_com_available",
    "pythoncom",
    "win32com_client",
    "make_mock_session",
    "make_mock_scripting_engine",
]

# Created and developed by Jai Singh
