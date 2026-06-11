# Created and developed by Jai Singh
"""Phase H.4 — static checks on build_exe.bat Connect packaging block."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

_OMNI_AGENT = REPO_ROOT / "omni_agent"
_BUILD_BAT = _OMNI_AGENT / "build_exe.bat"


@pytest.fixture(scope="module")
def build_bat_text() -> str:
    return _BUILD_BAT.read_text(encoding="utf-8", errors="replace")


def test_build_bat_connect_pyinstaller_invocation(build_bat_text: str) -> None:
    flat = build_bat_text.replace("^", "").replace("\r", "")
    connect_block = flat[flat.find("OmniFrame_Connect") :]
    assert "--onefile --windowed --name OmniFrame_Connect" in connect_block
    assert "--icon master_icon.ico" in connect_block
    for hid in (
        "customtkinter",
        "psutil",
        "httpx",
        "yaml",
        "pywin32",
        "omni_agent.connect.connect_gui",
        "omni_agent.connect.capabilities",
        "omni_agent.connect.self_replace",
    ):
        assert f"--hidden-import {hid}" in connect_block
    assert "--collect-data customtkinter" in connect_block
    assert "connect\\__main__.py" in connect_block or "connect/__main__.py" in connect_block


def test_build_bat_connect_sha256_sidecar(build_bat_text: str) -> None:
    assert "OmniFrame_Connect.exe SHA256" in build_bat_text
    assert "OmniFrame_Connect.exe.sha256" in build_bat_text


def test_build_bat_connect_zip_artifact(build_bat_text: str) -> None:
    assert "OmniFrame_Connect.zip" in build_bat_text
    assert "dist\\README.txt" in build_bat_text or "dist/README.txt" in build_bat_text


def test_build_bat_worker_and_master_unchanged(build_bat_text: str) -> None:
    flat = build_bat_text.replace("^", "").replace("\r", "")
    worker_idx = flat.find("--name OmniFrame_Agent")
    master_idx = flat.find("--name OmniFrame_AgentMaster")
    connect_idx = flat.find("--name OmniFrame_Connect")
    assert worker_idx > 0 and master_idx > worker_idx and connect_idx > master_idx
    assert "--onefile --console --name OmniFrame_Agent" in flat
    assert "--onefile --windowed --name OmniFrame_AgentMaster" in flat
    assert "OmniFrame_AgentMaster.zip" in build_bat_text


def test_build_bat_syncs_connect_tree(build_bat_text: str) -> None:
    assert "OMNIFRAME_AGENT_SOURCE%\\connect" in build_bat_text.replace("/", "\\")

# Created and developed by Jai Singh
