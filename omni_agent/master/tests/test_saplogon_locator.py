# Created and developed by Jai Singh
"""SAPLogon path locator tests."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.saplogon_locator import locate_saplogon  # noqa: E402


def test_locate_returns_first_existing_in_tmp_tree(tmp_path: Path):
    custom = tmp_path / "SAP" / "FrontEnd" / "SapGui" / "saplogon.exe"
    custom.parent.mkdir(parents=True)
    custom.write_text("stub", encoding="utf-8")
    missing = tmp_path / "missing" / "saplogon.exe"
    found = locate_saplogon(extra_paths=[missing, custom])
    assert found == custom


def test_locate_none_when_no_paths_exist(tmp_path: Path):
    assert locate_saplogon(extra_paths=[tmp_path / "nope.exe"]) is None

# Created and developed by Jai Singh
