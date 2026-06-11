# Created and developed by Jai Singh
"""Phase G — static checks on build_exe.bat and import-safe __main__.py."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[3]
_OMNI_AGENT = _REPO_ROOT / "omni_agent"
_BUILD_BAT = _OMNI_AGENT / "build_exe.bat"
_MAIN_PY = _OMNI_AGENT / "master" / "__main__.py"


@pytest.fixture(scope="module")
def build_bat_text() -> str:
    return _BUILD_BAT.read_text(encoding="utf-8", errors="replace")


def test_build_bat_still_builds_worker_exe(build_bat_text: str) -> None:
    assert "--onefile --console --name OmniFrame_Agent" in build_bat_text.replace("^", "")
    assert "agent.py" in build_bat_text
    assert "OmniFrame_Agent.exe.sha256" in build_bat_text


def test_build_bat_master_pyinstaller_invocation(build_bat_text: str) -> None:
    flat = build_bat_text.replace("^", "").replace("\r", "")
    master_block = flat[flat.find("OmniFrame_AgentMaster") :]
    assert "--onefile --windowed --name OmniFrame_AgentMaster" in master_block
    assert "--icon master_icon.ico" in master_block
    for hid in (
        "customtkinter",
        "psutil",
        "httpx",
        "yaml",
        "omni_agent.master.master_gui",
    ):
        assert f"--hidden-import {hid}" in master_block
    assert "--collect-data customtkinter" in master_block
    assert "master\\__main__.py" in master_block or "master/__main__.py" in master_block


def test_build_bat_master_sha256_sidecar(build_bat_text: str) -> None:
    assert "OmniFrame_AgentMaster.exe SHA256" in build_bat_text
    assert "OmniFrame_AgentMaster.exe.sha256" in build_bat_text


def test_build_bat_additive_worker_steps_unchanged(build_bat_text: str) -> None:
    """Worker PyInstaller block must remain the first EXE build."""
    worker_idx = build_bat_text.find("--name OmniFrame_Agent")
    master_idx = build_bat_text.find("--name OmniFrame_AgentMaster")
    assert worker_idx > 0 and master_idx > worker_idx


def test_master_icon_exists() -> None:
    icon = _OMNI_AGENT / "master_icon.ico"
    assert icon.is_file()
    assert icon.stat().st_size > 50


def test_main_py_import_no_gui_side_effects() -> None:
    spec = importlib.util.spec_from_file_location(
        "omni_agent_master_main_test",
        _MAIN_PY,
    )
    assert spec and spec.loader
    before = set(sys.modules)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    after = set(sys.modules)
    new_gui_modules = {
        name
        for name in after - before
        if name == "customtkinter" or name.startswith("customtkinter.")
    }
    assert callable(mod.main)
    assert not new_gui_modules

# Created and developed by Jai Singh
