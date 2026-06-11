# Created and developed by Jai Singh
"""v1.8.2 regression test — multi-factor header scorer + banner penalty.

Validates `_parse_attempt_b_tab_delimited` against the real SAP LT22
PDC export the user shipped. The v1.7.7 single-factor scorer (max
non-empty cell count, with a `non_empty < 3` floor) was vulnerable to
SAP banners that ship exactly 3 non-empty cells — the LT22 banner
(`Warehouse No.\\t\\t\\tPDC\\tIndianapolis PDC`) carries exactly 3
non-empty cells, sneaks past the floor, and could in principle outrank
the real header on a sparse layout. v1.8.2 replaces the single factor
with `_score_header_candidate(non_empty, total_cells, following_data_rows)`
(base score `non_empty * 10` + similar-row bonus + banner penalty),
which reliably ranks the real header above any banner-shaped candidate.

Expected post-v1.8.2:
  - parser detects ≥19 columns (real header line has 22 tab-cells, 19
    non-empty after stripping; permissive matcher pads shorter rows).
  - parser returns ≥500 data rows (the file has ~573 data rows).
  - one column title contains "TO Number".
  - first data row's "TO Number" column is non-empty.
  - `meta.header_score` is positive (post-penalty) and `meta.header_y`
    is the line index of the real header (line 3, since lines 0-2 are
    banner + 2 blanks).

Sister test to `test_lt10export_smart_header.py` — same self-contained
namespace pattern (slice the parser block out of `agent.py`, exec it
in a controlled namespace, call functions directly) so the test runs
on Python 3.9 dev boxes even though the rest of `agent.py` uses 3.10+
`X | Y` union syntax in unrelated code paths.

Run with:
  python3 omni_agent/tests/test_lt22_smart_header.py
or
  python3 -m pytest omni_agent/tests/test_lt22_smart_header.py

Override the LT22 file path with `OMNIFRAME_LT22_TEST_FILE`.
"""
from __future__ import annotations

import csv
import io
import os
import re
from typing import Any, Callable, Optional


DEFAULT_FILE = "/Users/jaisingh/Downloads/MacWindowsBridge/LT22DeliveryData.txt"
TEST_FILE = os.environ.get("OMNIFRAME_LT22_TEST_FILE", DEFAULT_FILE)
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
    if not os.path.exists(TEST_FILE):
        raise FileNotFoundError(
            f"LT22 test fixture not found at {TEST_FILE} — set "
            f"OMNIFRAME_LT22_TEST_FILE to the actual location."
        )
    with open(TEST_FILE, "r", encoding="cp1252", errors="replace") as f:
        text = f.read()
    return text, text.splitlines()


def test_lt22_delivery_data_format() -> None:
    """Real LT22 export from production. v1.7.7 picked the right header
    by raw `non_empty` (19 vs 3) but a banner with 4-5 non-empty cells
    on a sparser layout could outscore it. v1.8.2's banner penalty
    reliably outranks any banner shape — this test guards the LT22
    happy path AND the banner-penalty regression."""
    ns = _load_parser_namespace()
    parse_b = ns["_parse_attempt_b_tab_delimited"]
    text, lines = _load_text()

    result = parse_b(text, lines)
    assert result is not None, "Format B parser returned None on a valid LT22 export"

    cols = result["columns"]
    rows = result["rows"]
    meta = result.get("meta", {})

    assert len(cols) >= 19, f"expected ≥19 columns, got {len(cols)}"
    assert len(rows) >= 500, f"expected ≥500 data rows, got {len(rows)}"

    titles = [c["title"] for c in cols]
    assert any("TO Number" in t for t in titles), (
        f"expected a 'TO Number' column, got titles: {titles}"
    )

    to_col_id = next(c["id"] for c in cols if "TO Number" in c["title"])
    first_row = rows[0]
    first_to = str(first_row.get(to_col_id, "")).strip()
    assert first_to, (
        f"first row TO Number is empty: row={first_row}, col_id={to_col_id}"
    )

    # Real header is on line index 3 (lines 0=banner, 1=blank, 2=blank,
    # 3=header). Banner rows must be filtered.
    assert meta.get("header_y", 0) >= 3, (
        "smart header detection should skip banner rows 0-2; "
        f"got header_y={meta.get('header_y')}"
    )
    # Header score is exposed for diagnostic dashboards — make sure
    # the new field is populated and non-trivial.
    assert meta.get("header_score", 0) > 0, (
        f"expected positive header_score, got {meta.get('header_score')}"
    )


def test_lt22_format_b_outranks_banner_with_score() -> None:
    """Direct probe of `_score_header_candidate(non_empty, total_cells,
    subordinate_data_rows)` to keep the formula pinned. The banner
    has 0 subordinates because subsequent lines (real header + data)
    all have MORE non-empty cells than it; the real header has every
    data row as a subordinate (data rows have ≤ non_empty AND ≤
    total_cells because SAP drops trailing empties)."""
    ns = _load_parser_namespace()
    score = ns["_score_header_candidate"]
    # LT22 PDC banner shape: 3 non-empty out of 5 cells, 0 subordinates
    # (the next non-blank line is the real header with 19 non-empty —
    # NOT ≤ 3, so it's not a subordinate of the banner).
    banner = score(3, 5, 0)
    # LT22 real-header shape: 19 non-empty out of 22 cells, ~572 data
    # rows as subordinates (capped at 20 in the formula).
    header = score(19, 22, 20)
    assert banner < header, (
        f"banner score {banner} must be < real-header score {header}"
    )

    # An adversarial banner with 4 non-empty cells (just above v1.7.7's
    # `non_empty < 3` floor) must STILL lose to a real header on a
    # sparse 50-row extract.
    sparse_banner = score(4, 6, 0)       # 4 non-empty, 67% empty
    sparse_header = score(15, 18, 20)
    assert sparse_banner < sparse_header, (
        f"sparse banner {sparse_banner} must be < sparse-header "
        f"{sparse_header}"
    )

    # A data row pretending to be a header — it has MANY siblings of
    # the same shape but those siblings are ALSO at the data-row
    # non-empty count, so the row's "subordinate" count under v1.8.2
    # is high too. The header's much-higher base score (`non_empty *
    # 10`) is what carries it over the line. This sanity check is
    # the regression-guard for the LT10 CI failure that drove the
    # subordinate-vs-similar refinement.
    data_row = score(9, 13, 20)         # LT10 data row shape
    real_header = score(17, 20, 20)     # LT10 real header shape
    assert data_row < real_header, (
        f"data row {data_row} must be < real header {real_header}"
    )


def test_lt22_ladder_picks_format_b() -> None:
    """Format A (dash separator) should not match — there is no dash
    row in the LT22 export. Confirm B wins, mirroring the LT10 test."""
    ns = _load_parser_namespace()
    parse_a = ns["_parse_attempt_a_dash_separator"]
    parse_b = ns["_parse_attempt_b_tab_delimited"]
    text, lines = _load_text()

    a = parse_a(text, lines)
    assert a is None, "Format A should not match a tab-only LT22 export"

    b = parse_b(text, lines)
    assert b is not None and len(b["rows"]) >= 500


if __name__ == "__main__":
    test_lt22_delivery_data_format()
    test_lt22_format_b_outranks_banner_with_score()
    test_lt22_ladder_picks_format_b()
    ns = _load_parser_namespace()
    text, lines = _load_text()
    result = ns["_parse_attempt_b_tab_delimited"](text, lines)
    cols = result["columns"]
    rows = result["rows"]
    to_col_id = next(c["id"] for c in cols if "TO Number" in c["title"])
    sample_tos = [str(r.get(to_col_id, "")).strip() for r in rows[:3]]
    print(
        f"OK — LT22 Format B parsed {len(rows)} rows × {len(cols)} columns; "
        f"header at line index {result['meta']['header_y']}; "
        f"header_score={result['meta'].get('header_score')}; "
        f"sample TO numbers: {sample_tos}"
    )

# Created and developed by Jai Singh
