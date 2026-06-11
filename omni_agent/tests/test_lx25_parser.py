# Created and developed by Jai Singh
r"""LX25 parser regression tests — guards the WH5/JSM round-trip.

`lx25_inventory_completion._parse_lx25_text` walks the unconverted SAP
LX25 text export top-down, tracking the active warehouse + active
storage type so it can emit one record per (warehouse, storage_type)
combination. Two real-world fixtures live next to this file:

    fixtures/lx25_wh5.txt — single storage type, NUMERIC code (`110`)
    fixtures/lx25_jsm.txt — five storage types, ALPHA codes
                            (`DDN`, `DDS`, `DDU`, `DUR`, `SCD`)

The original parser shipped with `_STORAGE_TYPE_RE = re.compile(r"^(\d{1,4})\s+(.+?)\s*$")`
— digits-only — which silently failed on JSM's alpha codes. None of
the storage type marker lines matched, so all five sets of metric rows
fell through to the `current_st is None` defensive branch and wrote
into a single shared `(unspecified)` placeholder. Each new
`Total number of bins` row overwrote the previous, and the warehouse
total ended up = the LAST storage type's count (SCD = 17) instead of
the actual sum (1,546). Other warehouses (WH5/WH8/JSF/PDC) use numeric
storage type codes, so they were unaffected — which is why the bug went
undetected at first ship.

Fix (2026-05-10): broaden the regex to `^([A-Z0-9]{1,4})\s+(.+?)\s*$`
so SAP's alphanumeric storage-type field (1-4 chars, uppercase by SAP
convention) is fully covered. The metric-row guard immediately after
the regex match (and the explicit `typ` / `summary` skip earlier in
the parser) keeps banner / header lines from sneaking past as
false-positive storage type markers.

Run with:
    python3 omni_agent/tests/test_lx25_parser.py
or
    python3 -m pytest omni_agent/tests/test_lx25_parser.py
"""
from __future__ import annotations

import os
import re
from typing import Any, Optional


HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES_DIR = os.path.join(HERE, "fixtures")
LX25_PY = os.path.join(
    os.path.dirname(HERE), "lx25_inventory_completion.py"
)

# Slice the parser block out of the source rather than importing the
# module — `lx25_inventory_completion` pulls in `fastapi` + `pydantic`
# at top level, which keeps the test runnable on a thin Python env.
_PARSER_BLOCK_START = "# The five metric labels"
_PARSER_BLOCK_END = (
    "# ---------------------------------------------------------------------------\n"
    "#  Per-warehouse SAP GUI flow"
)


def _load_parser():
    with open(LX25_PY, "r", encoding="utf-8") as f:
        src = f.read()
    start = src.index(_PARSER_BLOCK_START)
    end = src.index(_PARSER_BLOCK_END)
    block = src[start:end]
    ns: dict[str, Any] = {"re": re, "Any": Any, "Optional": Optional}
    exec(compile(block, LX25_PY, "exec"), ns)
    return ns["_parse_lx25_text"], ns["_parse_sap_int"]


def _read_fixture(name: str) -> str:
    path = os.path.join(FIXTURES_DIR, name)
    with open(path, "r", encoding="cp1252", errors="replace") as f:
        return f.read()


def test_parse_wh5_single_numeric_storage_type():
    """WH5 export: 1 storage type with code `110` (numeric). Verifies
    the digits-only path of `_STORAGE_TYPE_RE` still resolves and the
    column-position math (Absolute is the first integer-looking cell
    after the label) is intact."""
    parse, _ = _load_parser()
    parsed = parse(_read_fixture("lx25_wh5.txt"))
    assert parsed["warehouse_code"] == "WH5"
    assert "Indianapolis" in parsed["warehouse_name"]
    assert len(parsed["storage_types"]) == 1
    st = parsed["storage_types"][0]
    assert st["storage_type"] == "110"
    assert st["storage_type_name"] == "TKA LGE ENG FIXED BIN"
    assert st["total_bins"] == 6133
    assert st["executed"] == 4302
    assert st["active"] == 458
    assert st["planned"] == 0
    assert st["not_executed"] == 1831


def test_parse_jsm_five_alpha_storage_types():
    """JSM export: 5 storage types with ALPHA codes (DDN/DDS/DDU/DUR/SCD).

    Regression for the "TKAJSM returns 17 bins instead of 1,546" bug —
    pre-fix the digits-only regex skipped every storage type marker and
    the parser mis-summed to the last storage type's count (SCD = 17).
    """
    parse, _ = _load_parser()
    parsed = parse(_read_fixture("lx25_jsm.txt"))
    assert parsed["warehouse_code"] == "JSM"
    assert parsed["warehouse_name"] == "Lift System Warehouse"

    by_type = {st["storage_type"]: st for st in parsed["storage_types"]}
    assert set(by_type.keys()) == {"DDN", "DDS", "DDU", "DUR", "SCD"}, (
        f"Expected all 5 alpha storage types, got {sorted(by_type.keys())}"
    )

    expected = {
        "DDN": ("DOD NEW",          935, 446, 12, 0, 489),
        "DDS": ("DOD SERV",         132,  78,  0, 0,  54),
        "DDU": ("DOD UNSV",         461, 118,  4, 0, 343),
        "DUR": ("DOD Unrepairable",   1,   0,  0, 0,   1),
        "SCD": ("Scrap DoD",         17,   0,  0, 0,  17),
    }
    for code, (name, tb, ex, ac, pl, ne) in expected.items():
        st = by_type[code]
        assert st["storage_type_name"] == name, (
            f"{code} name mismatch: {st['storage_type_name']!r} != {name!r}"
        )
        assert st["total_bins"] == tb, f"{code} total_bins {st['total_bins']} != {tb}"
        assert st["executed"] == ex,   f"{code} executed {st['executed']} != {ex}"
        assert st["active"] == ac,     f"{code} active {st['active']} != {ac}"
        assert st["planned"] == pl,    f"{code} planned {st['planned']} != {pl}"
        assert st["not_executed"] == ne, f"{code} not_executed {st['not_executed']} != {ne}"


def test_jsm_aggregates_to_warehouse_total():
    """Confirms the warehouse-total roll-up the FE uses (sum of all 5
    storage types) hits the user-reported true value of ~1,546 bins.
    Pre-fix this was 17."""
    parse, _ = _load_parser()
    parsed = parse(_read_fixture("lx25_jsm.txt"))
    total = sum(int(st["total_bins"] or 0) for st in parsed["storage_types"])
    executed = sum(int(st["executed"] or 0) for st in parsed["storage_types"])
    assert total == 1546, f"JSM warehouse total {total} != 1546 (pre-fix would be 17)"
    assert executed == 642, f"JSM executed total {executed} != 642"


def test_parse_sap_int_handles_thousand_separators():
    """`_parse_sap_int` must collapse locale thousand separators —
    `6,133` (US), `6.133` (DE), `6 133` (FR), `1\u00A0234` (NBSP) —
    to plain integers so warehouses that exceed 999 bins (WH5 = 6,133;
    JSM = 1,546 split across 5 codes) parse without ValueError."""
    _, parse_int = _load_parser()
    assert parse_int("6,133") == 6133
    assert parse_int("6.133") == 6133
    assert parse_int("6 133") == 6133
    assert parse_int("1\u00A0234") == 1234
    assert parse_int("    935") == 935
    assert parse_int("17") == 17
    assert parse_int("0") == 0
    assert parse_int("") is None
    assert parse_int("   ") is None
    assert parse_int("100-") == -100  # SAP trailing-minus convention


if __name__ == "__main__":
    test_parse_wh5_single_numeric_storage_type()
    print("PASS test_parse_wh5_single_numeric_storage_type")
    test_parse_jsm_five_alpha_storage_types()
    print("PASS test_parse_jsm_five_alpha_storage_types")
    test_jsm_aggregates_to_warehouse_total()
    print("PASS test_jsm_aggregates_to_warehouse_total")
    test_parse_sap_int_handles_thousand_separators()
    print("PASS test_parse_sap_int_handles_thousand_separators")
    print("\nAll LX25 parser tests green.")

# Created and developed by Jai Singh
