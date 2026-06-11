# Created and developed by Jai Singh
"""SAP probe pure tests — mock win32com."""

from __future__ import annotations

import builtins
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.sap_probe import (  # noqa: E402
    enumerate_scripting_sessions,
    probe_sap_sessions,
    session_label,
)

_REAL_IMPORT = builtins.__import__


@pytest.fixture(autouse=True)
def _isolate_win32com_modules():
    """Prevent real pywin32 from shadowing mocks on Windows dev hosts."""
    saved = {k: sys.modules.pop(k) for k in list(sys.modules) if k.startswith("win32com")}
    saved.update({k: sys.modules.pop(k) for k in list(sys.modules) if k == "pythoncom"})
    yield
    sys.modules.update(saved)


def _import_without_win32com(name: str, *args, **kwargs):
    if name in ("win32com.client", "win32com"):
        raise ImportError("no win32com")
    return _REAL_IMPORT(name, *args, **kwargs)


def _build_application_mock() -> MagicMock:
    info = MagicMock()
    info.SystemName = "ECC"
    info.Client = "100"
    info.User = "USER1"
    info.Transaction = "MM03"

    session = MagicMock()
    session.Info = info

    conn_children = MagicMock(side_effect=lambda _idx: session)
    conn_children.Count = 1
    connection = MagicMock()
    connection.Children = conn_children

    app_children = MagicMock(side_effect=lambda _idx: connection)
    app_children.Count = 1
    application = MagicMock()
    application.Children = app_children
    return application


def test_session_label_formats():
    label = session_label(
        {
            "conn_idx": 0,
            "sess_idx": 1,
            "system_name": "PRD",
            "user": "OPS",
            "transaction": "LT12",
        }
    )
    assert "c0" in label
    assert "s1" in label
    assert "PRD" in label


def test_enumerate_scripting_sessions_shape():
    sessions = enumerate_scripting_sessions(_build_application_mock())
    assert len(sessions) == 1
    row = sessions[0]
    assert row["conn_idx"] == 0
    assert row["sess_idx"] == 0
    assert row["system_name"] == "ECC"
    assert row["client"] == "100"
    assert row["user"] == "USER1"
    assert row["transaction"] == "MM03"


def test_probe_returns_error_when_win32com_missing():
    with patch("builtins.__import__", side_effect=_import_without_win32com):
        result = probe_sap_sessions()
    assert result["sessions"] == []
    assert result.get("error") == "sapgui_not_running"


def test_probe_com_exception_returns_typed_error():
    import types

    fake_client = MagicMock()
    fake_client.GetObject.side_effect = Exception("SAPGUI scripting disabled")
    win32com_pkg = types.ModuleType("win32com")
    win32com_pkg.client = fake_client  # type: ignore[attr-defined]
    sys.modules["win32com"] = win32com_pkg
    sys.modules["win32com.client"] = fake_client
    sys.modules["pythoncom"] = MagicMock()

    result = probe_sap_sessions()

    assert result["sessions"] == []
    assert result["error"] in ("scripting_disabled", "sapgui_not_running", "unknown")

# Created and developed by Jai Singh
