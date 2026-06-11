# Created and developed by Jai Singh
"""v1.7.7 regression test — smart header detection in Format B parser.

Validates `_parse_attempt_b_tab_delimited` (and the supporting parser
ladder) against the real SAP LT10 export file the v1.7.6 parser
misread as 1 row × 6 columns. Expected post-v1.7.7:
  - parser detects ≥18 columns (header line 5 has 20 tab-cells)
  - parser returns ≥200 data rows (file has 232 data rows + 1 totals)
  - first data row's "Material" column = "23089792"
  - banner lines 1-2 ("Whse number"/"Stge type") are NOT picked as header

Why this is a self-contained test:

`agent.py` uses Python 3.10+ `X | Y` union syntax in *unrelated* code
paths (not in the parser), so importing it from a Python 3.9 dev box
would crash before the parser definitions are even reached. Production
runs on the PyInstaller-bundled Python 3.11+ on Windows where the full
import works fine, but for local/CI verification we want to exercise
just the parser logic. The strategy: read agent.py, slice out exactly
the parser block (markers below), exec it in a controlled namespace
with the imports it needs, and call the functions directly.

Run with:
  python3 omni_agent/tests/test_lt10export_smart_header.py
or
  python3 -m pytest omni_agent/tests/test_lt10export_smart_header.py

Override the LT10 file path with `OMNIFRAME_LT10_TEST_FILE`.
"""
from __future__ import annotations

import csv
import io
import os
import re
from typing import Any, Callable, Optional


DEFAULT_FILE = "/Users/jaisingh/Downloads/MacWindowsBridge/lt10export"
TEST_FILE = os.environ.get("OMNIFRAME_LT10_TEST_FILE", DEFAULT_FILE)
AGENT_PY = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "agent.py",
)

_PARSER_BLOCK_START = "_FOOTER_RE = re.compile"
_PARSER_BLOCK_END = "def _save_failed_export_debug_copy"


def _load_parser_namespace() -> dict[str, Any]:
    with open(AGENT_PY, "r", encoding="utf-8") as f:
        src = f.read()
    start = src.index(_PARSER_BLOCK_START)
    end = src.index(_PARSER_BLOCK_END)
    block = src[start:end]
    ns: dict[str, Any] = {
        "re": re,
        "csv": csv,
        "io": io,
        "Any": Any,
        "Callable": Callable,
        "Optional": Optional,
    }
    exec(compile(block, AGENT_PY, "exec"), ns)
    return ns


def _load_text() -> tuple[str, list[str]]:
    with open(TEST_FILE, "r", encoding="cp1252", errors="replace") as f:
        text = f.read()
    return text, text.splitlines()


def test_format_b_smart_header() -> None:
    ns = _load_parser_namespace()
    parse_b = ns["_parse_attempt_b_tab_delimited"]
    text, lines = _load_text()

    result = parse_b(text, lines)
    assert result is not None, "Format B parser returned None on a valid LT10 export"

    cols = result["columns"]
    rows = result["rows"]
    meta = result.get("meta", {})

    assert len(cols) >= 18, f"expected ≥18 columns, got {len(cols)}"
    assert len(rows) >= 200, f"expected ≥200 data rows, got {len(rows)}"

    titles = [c["title"] for c in cols]
    for needle in ("Sl", "Typ", "Plnt", "SLoc", "StorageBin", "Material"):
        assert needle in titles, (
            f"missing expected header column '{needle}' in {titles}"
        )

    material_col_id = next(c["id"] for c in cols if c["title"] == "Material")
    first_material = rows[0][material_col_id]
    assert first_material == "23089792", (
        f"first data row Material expected '23089792', got '{first_material}'"
    )

    assert meta.get("header_y", 0) > 2, (
        "smart header detection should skip banner rows 1-2; "
        f"got header_y={meta.get('header_y')}"
    )


def test_ladder_picks_format_b_first() -> None:
    """Format A (dash separator) should not match — there is no dash row.
    The ladder must therefore settle on Format B."""
    ns = _load_parser_namespace()
    parse_a = ns["_parse_attempt_a_dash_separator"]
    parse_b = ns["_parse_attempt_b_tab_delimited"]
    text, lines = _load_text()

    a = parse_a(text, lines)
    assert a is None, "Format A should not match a tab-only export with no dash row"

    b = parse_b(text, lines)
    assert b is not None and len(b["rows"]) >= 200


def test_format_c_smart_header_does_not_pick_banner() -> None:
    """Format C is the next-line-of-defense if a future SAP variant emits
    banners without tabs. Confirm it never returns a 1-row banner-only
    result on this file (data rows are tab-only so C may legitimately
    return None — both outcomes are acceptable, picking the banner is not)."""
    ns = _load_parser_namespace()
    parse_c = ns["_parse_attempt_c_fixed_width"]
    text, lines = _load_text()

    result = parse_c(text, lines)
    if result is None:
        return
    rows = result["rows"]
    cols = result["columns"]
    assert not (len(rows) <= 1 and len(cols) <= 6), (
        "Format C still mistook the banner for a header: "
        f"{len(rows)} row(s) × {len(cols)} col(s)"
    )


if __name__ == "__main__":
    test_format_b_smart_header()
    test_ladder_picks_format_b_first()
    test_format_c_smart_header_does_not_pick_banner()
    ns = _load_parser_namespace()
    text, lines = _load_text()
    result = ns["_parse_attempt_b_tab_delimited"](text, lines)
    print(
        f"OK — Format B parsed {len(result['rows'])} rows × "
        f"{len(result['columns'])} columns; "
        f"header at line index {result['meta']['header_y']}"
    )

# Created and developed by Jai Singh
