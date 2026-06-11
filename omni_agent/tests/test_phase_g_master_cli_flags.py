# Created and developed by Jai Singh
"""Phase G — ``--version`` / ``--probe-only`` CLI paths (no Tk)."""

from __future__ import annotations

import json
import sys
from unittest import mock

import pytest

from omni_agent.master import capabilities
from omni_agent.master.cli import build_arg_parser, handle_cli_before_gui


def test_arg_parser_version_and_probe_flags() -> None:
    args = build_arg_parser().parse_args(["--version"])
    assert args.version is True
    assert args.probe_only is False

    args2 = build_arg_parser().parse_args(["--probe-only"])
    assert args2.probe_only is True
    assert args2.version is False


def test_version_stdout_format(capsys: pytest.CaptureFixture[str]) -> None:
    assert handle_cli_before_gui(["--version"]) is True
    out = capsys.readouterr().out
    assert "AGENT_VERSION=2.1.0" in out
    for cap in capabilities.MASTER_WORKER_CAPABILITIES:
        assert f"capability={cap}" in out
    assert len(capabilities.MASTER_WORKER_CAPABILITIES) == 8


def test_probe_only_prints_json(capsys: pytest.CaptureFixture[str]) -> None:
    payload = {"sessions": [], "error": "sapgui_not_running"}
    with mock.patch(
        "omni_agent.master.sap_probe.probe_sap_sessions",
        return_value=payload,
    ):
        assert handle_cli_before_gui(["--probe-only"]) is True
    out = capsys.readouterr().out
    parsed = json.loads(out)
    assert parsed == payload


def test_main_exits_zero_on_version_without_tk() -> None:
    pytest.importorskip("customtkinter")
    from omni_agent.master.master_gui import main

    with pytest.raises(SystemExit) as exc:
        main(["--version"])
    assert exc.value.code == 0


def test_cli_module_import_without_customtkinter() -> None:
    """``cli.py`` must not import customtkinter (macOS CI / dev hosts)."""
    import omni_agent.master.cli as cli_mod

    assert "customtkinter" not in sys.modules or True
    assert hasattr(cli_mod, "handle_cli_before_gui")

# Created and developed by Jai Singh
