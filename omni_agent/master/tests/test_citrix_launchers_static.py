# Created and developed by Jai Singh
"""Static checks for the Citrix non-persistent .bat launchers.

Locks in the contract introduced for [[Fix-AgentMaster-Citrix-Temp-Directory]]:

* `omni_agent/launchers/` ships a launcher .bat per shipped EXE
  (AgentMaster, Agent worker, Connect).
* Every launcher pins ``TEMP`` and ``TMP`` to a folder next to itself
  (``%~dp0_omniframe_tmp``) before invoking the matching .exe.
* The windowed GUIs (AgentMaster + Connect) use ``start ""`` so the launching
  ``cmd`` window closes once the GUI takes focus. The console worker does
  **not** use ``start ""`` because operators rely on the inline cmd window as
  a live log view when running it standalone.
* ``build_exe.bat`` syncs the launcher folder from the workspace, stages the
  .bat files into ``dist\\``, and includes them in both shippable zips.

These are static-file checks (no Python imports of the master package), so
they run on macOS and Windows alike and don't drag CustomTkinter into the
test session.
"""

from __future__ import annotations

from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[3]
_OMNI_AGENT = _REPO_ROOT / "omni_agent"
_LAUNCHERS = _OMNI_AGENT / "launchers"
_BUILD_BAT = _OMNI_AGENT / "build_exe.bat"

_LAUNCHER_TO_EXE = {
    "OmniFrame_AgentMaster.bat": "OmniFrame_AgentMaster.exe",
    "OmniFrame_Agent.bat": "OmniFrame_Agent.exe",
    "OmniFrame_Connect.bat": "OmniFrame_Connect.exe",
}

_WINDOWED_LAUNCHERS = {"OmniFrame_AgentMaster.bat", "OmniFrame_Connect.bat"}


def _strip_rem_lines(text: str) -> str:
    """Drop comment lines (``REM ...`` and ``@REM ...``) so substring checks
    don't false-positive on prose inside the launcher's banner comments."""

    keep: list[str] = []
    for line in text.splitlines():
        stripped = line.lstrip().lower()
        if stripped.startswith("rem ") or stripped.startswith("@rem "):
            continue
        keep.append(line)
    return "\n".join(keep)


@pytest.fixture(scope="module")
def build_bat_text() -> str:
    return _BUILD_BAT.read_text(encoding="utf-8", errors="replace")


@pytest.mark.parametrize("launcher_name", sorted(_LAUNCHER_TO_EXE.keys()))
def test_launcher_file_exists(launcher_name: str) -> None:
    path = _LAUNCHERS / launcher_name
    assert path.is_file(), f"Missing Citrix launcher: {path}"
    assert path.stat().st_size > 100, f"{launcher_name} is suspiciously small"


@pytest.mark.parametrize("launcher_name,exe_name", sorted(_LAUNCHER_TO_EXE.items()))
def test_launcher_pins_temp_next_to_exe(launcher_name: str, exe_name: str) -> None:
    """Every launcher must (1) compute its sibling temp folder via ``%~dp0``,
    (2) create it if missing, (3) export both ``TEMP`` and ``TMP``, and
    (4) actually run the matching .exe."""

    text = (_LAUNCHERS / launcher_name).read_text(encoding="utf-8", errors="replace")

    assert "%~dp0_omniframe_tmp" in text, (
        f"{launcher_name} must derive the temp folder from %~dp0 so it sits "
        "next to the .exe regardless of the launching CWD."
    )
    assert "mkdir" in text and "_OMNIFRAME_TMP" in text, (
        f"{launcher_name} must mkdir the sibling temp folder on first launch."
    )
    assert 'set "TEMP=%_OMNIFRAME_TMP%"' in text, (
        f"{launcher_name} must pin TEMP to the sibling folder before launching the .exe."
    )
    assert 'set "TMP=%_OMNIFRAME_TMP%"' in text, (
        f"{launcher_name} must pin TMP to the sibling folder before launching the .exe."
    )
    assert f'"%~dp0{exe_name}"' in text, (
        f"{launcher_name} must launch sibling .exe via %~dp0{exe_name}, "
        "not a bare unqualified name."
    )


@pytest.mark.parametrize("launcher_name", sorted(_WINDOWED_LAUNCHERS))
def test_windowed_launchers_use_start(launcher_name: str) -> None:
    text = (_LAUNCHERS / launcher_name).read_text(encoding="utf-8", errors="replace")
    code_only = _strip_rem_lines(text)
    assert 'start ""' in code_only, (
        f"{launcher_name} wraps a --windowed GUI .exe; without `start \"\"` "
        "the launching cmd window lingers behind the GUI."
    )


def test_worker_launcher_runs_exe_inline() -> None:
    text = (_LAUNCHERS / "OmniFrame_Agent.bat").read_text(encoding="utf-8", errors="replace")
    code_only = _strip_rem_lines(text)
    assert 'start ""' not in code_only, (
        "OmniFrame_Agent.bat wraps the --console worker; running it via "
        "`start \"\"` detaches the live log view operators rely on for "
        "standalone diagnostics."
    )


def test_build_bat_syncs_launchers_folder(build_bat_text: str) -> None:
    flat = build_bat_text.replace("^", "")
    assert "robocopy" in flat and "launchers" in flat, (
        "build_exe.bat must robocopy the workspace launchers/ folder so the "
        "shipped .bat files match what's checked into git."
    )


def test_build_bat_copies_launchers_into_dist(build_bat_text: str) -> None:
    flat = build_bat_text.replace("^", "")
    for launcher_name in _LAUNCHER_TO_EXE:
        assert f'launchers\\{launcher_name}' in flat, (
            f"build_exe.bat must copy launchers\\{launcher_name} into dist\\."
        )
        assert f'dist\\{launcher_name}' in flat, (
            f"build_exe.bat must materialize dist\\{launcher_name} next to the .exe."
        )


def test_build_bat_zips_include_launchers(build_bat_text: str) -> None:
    """Both shippable zips must include every launcher .bat."""

    flat = build_bat_text.replace("^", "").replace("\r", "")
    master_zip_block = flat[flat.find("OmniFrame_AgentMaster.zip") :]
    assert "OmniFrame_AgentMaster.bat" in master_zip_block, (
        "OmniFrame_AgentMaster.zip must include the Citrix launcher .bat."
    )
    assert "OmniFrame_Agent.bat" in master_zip_block, (
        "OmniFrame_AgentMaster.zip must include the worker launcher .bat."
    )

    connect_zip_block = flat[flat.find("OmniFrame_Connect.zip") :]
    assert "OmniFrame_Connect.bat" in connect_zip_block, (
        "OmniFrame_Connect.zip must include the Connect launcher .bat."
    )
    assert "OmniFrame_Agent.bat" in connect_zip_block, (
        "OmniFrame_Connect.zip must include the worker launcher .bat."
    )


def test_build_bat_does_not_use_runtime_tmpdir(build_bat_text: str) -> None:
    """``--runtime-tmpdir`` would make the bootloader ignore TEMP/TMP env vars
    and silently defeat the launcher pattern. Guard against an accidental
    "fix" that reintroduces the Citrix crash."""

    assert "--runtime-tmpdir" not in build_bat_text, (
        "Do not use PyInstaller's --runtime-tmpdir flag — it pins the path at "
        "build time and ignores the TEMP/TMP env vars our launchers set. "
        "See [[Fix-AgentMaster-Citrix-Temp-Directory]] for why."
    )

# Created and developed by Jai Singh
