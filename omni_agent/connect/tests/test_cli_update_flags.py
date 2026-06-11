# Created and developed by Jai Singh
"""CLI update flag tests."""

from __future__ import annotations

import sys
from io import StringIO
from pathlib import Path
from unittest import mock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.cli import handle_cli_before_gui  # noqa: E402
from omni_agent.connect.manifest import ChannelEntry, Manifest, ManifestResult  # noqa: E402


def test_check_update_flag_prints_availability():
    entry = ChannelEntry(
        version="0.2.0",
        exe_url="https://example.com/a.exe",
        exe_sha256="aa" * 32,
        exe_size_bytes=1,
        release_notes_md="Notes",
    )
    manifest = Manifest(
        schema_version=1,
        current_version="0.2.0",
        minimum_required_version="0.1.0",
        released_at="2026-05-21T22:00:00Z",
        stable=entry,
    )
    buf = StringIO()
    with mock.patch(
        "omni_agent.connect.self_update.check_for_update",
        return_value=(True, manifest, entry, ManifestResult(ok=True, manifest=manifest)),
    ), mock.patch("sys.stdout", buf):
        assert handle_cli_before_gui(["--check-update"]) is True
    out = buf.getvalue()
    assert "UPDATE_AVAILABLE=yes" in out
    assert "MANIFEST_VERSION=0.2.0" in out


def test_apply_update_exits_after_spawn():
    entry = ChannelEntry(
        version="0.2.0",
        exe_url="https://example.com/a.exe",
        exe_sha256="aa" * 32,
        exe_size_bytes=1,
    )

    class Controller:
        def start_install(self, *_args, **_kwargs):
            raise SystemExit(0)

    with mock.patch(
        "omni_agent.connect.self_update.check_for_update",
        return_value=(True, None, entry, ManifestResult(ok=True)),
    ), mock.patch(
        "omni_agent.connect.self_update.SelfUpdateController",
        return_value=Controller(),
    ), pytest.raises(SystemExit):
        handle_cli_before_gui(["--apply-update"])


def test_replace_helper_flag_invokes_run():
    with mock.patch(
        "omni_agent.connect.self_replace.run",
        return_value=0,
    ) as run_mock, pytest.raises(SystemExit) as exc:
        handle_cli_before_gui(
            [
                "--replace-helper",
                "--target",
                "C:/Apps/OmniFrame_Connect.exe",
                "--source",
                "C:/Temp/new.exe",
                "--restart",
            ]
        )
    assert exc.value.code == 0
    run_mock.assert_called_once()

# Created and developed by Jai Singh
