# Created and developed by Jai Singh
"""Replace-helper argv builder and run() tests."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.self_replace import build_replace_argv, run  # noqa: E402


def test_build_replace_argv():
    helper = Path("C:/Apps/OmniFrame_Connect.exe")
    target = Path("C:/Apps/OmniFrame_Connect.exe")
    source = Path("C:/Temp/OmniFrame_Connect_0.2.0.exe.verified")
    argv = build_replace_argv(helper, target=target, source=source, restart=True)
    assert argv == [
        str(helper),
        "--replace-helper",
        "--target",
        str(target),
        "--source",
        str(source),
        "--restart",
    ]


def test_run_replaces_and_restarts(tmp_path, monkeypatch):
    target = tmp_path / "OmniFrame_Connect.exe"
    target.write_bytes(b"old")
    source = tmp_path / "new.exe"
    source.write_bytes(b"new")
    popen_calls: list[list[str]] = []

    monkeypatch.setattr("omni_agent.connect.self_replace.time.sleep", lambda _s: None)
    monkeypatch.setattr(
        "omni_agent.connect.self_replace.subprocess.Popen",
        lambda argv, **kwargs: popen_calls.append(list(argv)),
    )
    code = run(target, source, restart=True)
    assert code == 0
    assert target.read_bytes() == b"new"
    assert popen_calls == [[str(target)]]

# Created and developed by Jai Singh
