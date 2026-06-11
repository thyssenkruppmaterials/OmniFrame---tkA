# Created and developed by Jai Singh
"""CLI flag tests (--version, --reset)."""

from __future__ import annotations

import sys
from io import StringIO
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.cli import handle_cli_before_gui, run_reset  # noqa: E402


def test_version_flag_prints_manifest():
    buf = StringIO()
    with mock.patch("sys.stdout", buf):
        assert handle_cli_before_gui(["--version"]) is True
    out = buf.getvalue()
    assert "CONNECT_VERSION=0.1.0" in out
    assert "capability=connect-widget-supervisor" in out


def test_reset_deletes_targets(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    appdata = tmp_path / "appdata" / "OmniFrameAgent"
    appdata.mkdir(parents=True)
    pos = home / ".omniframe" / "connect_widget_pos.json"
    pos.parent.mkdir(parents=True)
    pos.write_text("{}", encoding="utf-8")
    cfg = appdata / "config.json"
    cfg.write_text("{}", encoding="utf-8")

    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.setenv("APPDATA", str(appdata.parent))

    with mock.patch("omni_agent.connect.cli._omniframe_home", lambda: home / ".omniframe"), mock.patch(
        "omni_agent.connect.cli._worker_config_path", lambda: cfg
    ):
        run_reset()

    assert not pos.exists()
    assert not cfg.exists()

# Created and developed by Jai Singh
