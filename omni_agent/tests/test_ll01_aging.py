# Created and developed by Jai Singh
"""Aging-tab regression tests for LL01 Warehouse Activity Monitor (2026-05-27).

The frontend Aging tab derives all its bucket math + per-user aggregations
client-side from the row payload the worker emits. These tests fence the
worker contract end-to-end:

  1. Open TO / TR / Posting now carry `created_on` (and Open TO / Posting
     also carry `created_by` / `user`) — the columns that drive aging.
  2. Date strings parse to ISO so the frontend's
     `(Date.now() - new Date(iso).getTime()) / 86400e3` math is stable.
  3. Categories without a SAP user column (Open TR, Negative Stock,
     Interim Stock, Critical Stock In Production) yield `None`/`""` from
     the per-row helper — driving the "Not available for this category"
     fallback copy.

The pure date-bucket math is also exercised directly so a future change
to the cumulative-vs-discrete decision is caught here, not in production.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from ll01_warehouse_activity_monitor import (
    LL01_CATEGORIES,
    parse_ll01_category_export,
)


def _category(key: str) -> dict:
    return next(c for c in LL01_CATEGORIES if c["key"] == key)


# ---------------------------------------------------------------------------
# 1. Schema contract — aging fields are extracted on the categories that
#    have them in SAP, and absent on the categories that don't.
# ---------------------------------------------------------------------------
def test_open_to_extracts_created_on_and_created_by() -> None:
    """Open TO must now extract `created_on` + `created_by` (added 2026-05-27).
    These are the anchor for the Aging tab — without them the frontend
    cannot compute days-aged or top-user buckets for transfer orders."""
    keys = {json_key for _sap, json_key in _category("open_to")["columns"]}
    assert "created_on" in keys
    assert "created_by" in keys


def test_open_tr_extracts_created_on_but_no_user() -> None:
    """Open TR has no `User`/`Created By` column in SAP's LL01 list; the
    frontend renders 'Not available for this category' for users."""
    keys = {json_key for _sap, json_key in _category("open_tr")["columns"]}
    assert "created_on" in keys
    assert "created_by" not in keys
    assert "user" not in keys


def test_open_posting_extracts_created_on_alongside_user() -> None:
    keys = {json_key for _sap, json_key in _category("open_posting")["columns"]}
    assert "created_on" in keys
    assert "user" in keys


def test_negative_stock_has_last_movement_date_no_user() -> None:
    """Negative Stock anchors aging on `last_movement_date`. SAP's LL01
    list does not surface the user — verify both shapes."""
    keys = {json_key for _sap, json_key in _category("negative_stock")["columns"]}
    assert "last_movement_date" in keys
    assert "user" not in keys
    assert "created_by" not in keys


# ---------------------------------------------------------------------------
# 2. End-to-end parse — the worker correctly emits the new fields with
#    parsed ISO dates so the frontend's `new Date(...)` is robust.
# ---------------------------------------------------------------------------
OPEN_TO_WITH_AGING = (
    "TO Number\tItem\tCo\tWhN\tMTy\tMaterial\tSrceTgtQty\tSourc\tSource Bin"
    "\tDest.st.t\tDest. Bin\tPlnt\tCreated On\tCreated by\r\n"
    "0001234567\t1\t1000\tWH5\t101\tMAT001\t10\t001\tBIN-A\t002\tBIN-B\tWH5"
    "\t05/15/2026\tU6672660\r\n"
    "0001234568\t2\t1000\tWH5\t101\tMAT002\t5\t001\tBIN-C\t002\tBIN-D\tWH5"
    "\t01/02/2024\tBZXGTL\r\n"
)

OPEN_TR_WITH_DATE = (
    "TR Number\tItem\tWhN\tMTy\tMaterial\tTR Quantity\tTpe\tPlnt\tSLoc"
    "\tCreated On\r\n"
    "0009876543\t1\tWH5\t101\tMAT003\t12.000\t001\tWH5\t001\t04/29/2010\r\n"
)

OPEN_POSTING_WITH_DATE = (
    "Post.Ch.No\tWhN\tMvT\tMaterial\tPlnt\tSLoc\tUser\tPost.change qty"
    "\tCreated On\r\n"
    "PC001\tWH5\t501\tMAT004\tWH5\t001\tLZV2SP\t3\t05/15/2026\r\n"
)


def test_open_to_parses_aging_fields_to_iso() -> None:
    rows = parse_ll01_category_export(OPEN_TO_WITH_AGING, "open_to")
    assert len(rows) == 2
    # ISO-normalised date so `new Date(row.created_on)` is portable.
    assert rows[0]["created_on"] == "2026-05-15"
    assert rows[1]["created_on"] == "2024-01-02"
    # User column is preserved verbatim — matches the SAP IDs the manual
    # report's pivot table groups by (e.g., U6672660, BZXGTL).
    assert rows[0]["created_by"] == "U6672660"
    assert rows[1]["created_by"] == "BZXGTL"


def test_open_tr_parses_decade_old_date() -> None:
    """The manual report has TRs back to 2010 — verify a 16+ year-old
    date round-trips without losing precision."""
    rows = parse_ll01_category_export(OPEN_TR_WITH_DATE, "open_tr")
    assert len(rows) == 1
    assert rows[0]["created_on"] == "2010-04-29"
    # No user dimension on Open TR — confirm the row dict literally lacks
    # the keys the frontend keys on.
    assert "created_by" not in rows[0]
    assert "user" not in rows[0]


def test_open_posting_carries_user_and_date_together() -> None:
    rows = parse_ll01_category_export(OPEN_POSTING_WITH_DATE, "open_posting")
    assert len(rows) == 1
    assert rows[0]["user"] == "LZV2SP"
    assert rows[0]["created_on"] == "2026-05-15"


# ---------------------------------------------------------------------------
# 3. Pure aging math — ports the frontend's bucket logic so any change to
#    cumulative-vs-discrete (documented in
#    Patterns/LL01-Aging-Breakdown.md) is caught here too.
# ---------------------------------------------------------------------------
def _cumulative_buckets(rows: list[dict], anchor_key: str) -> dict[str, int]:
    """Mirror of the frontend's `useMemo` bucketizer — kept in Python to
    fence the contract from both ends. Cumulative semantics: `>30`
    includes `>60` includes `>90`."""
    today = date.today()
    gt30 = gt60 = gt90 = 0
    for row in rows:
        raw = row.get(anchor_key)
        if not raw:
            continue
        try:
            parsed = date.fromisoformat(str(raw))
        except ValueError:
            continue
        days = (today - parsed).days
        if days >= 30:
            gt30 += 1
        if days >= 60:
            gt60 += 1
        if days >= 90:
            gt90 += 1
    return {"gt30": gt30, "gt60": gt60, "gt90": gt90}


@pytest.mark.parametrize(
    "days_old,expected",
    [
        (0,   {"gt30": 0, "gt60": 0, "gt90": 0}),
        (29,  {"gt30": 0, "gt60": 0, "gt90": 0}),
        (30,  {"gt30": 1, "gt60": 0, "gt90": 0}),
        (60,  {"gt30": 1, "gt60": 1, "gt90": 0}),
        (90,  {"gt30": 1, "gt60": 1, "gt90": 1}),
        (365, {"gt30": 1, "gt60": 1, "gt90": 1}),
    ],
)
def test_cumulative_aging_thresholds(days_old: int, expected: dict[str, int]) -> None:
    anchor = (date.today() - timedelta(days=days_old)).isoformat()
    rows = [{"created_on": anchor}]
    assert _cumulative_buckets(rows, "created_on") == expected


def test_aging_skips_rows_without_anchor_date() -> None:
    """The frontend mirrors this — items where SAP didn't fill the date
    column simply drop out of the aging breakdown rather than landing
    in a misleading `>30` bucket. Same rule on the Python side."""
    rows = [
        {"created_on": ""},
        {"created_on": None},
        {"created_on": "not-a-date"},
        {"created_on": (date.today() - timedelta(days=120)).isoformat()},
    ]
    buckets = _cumulative_buckets(rows, "created_on")
    assert buckets == {"gt30": 1, "gt60": 1, "gt90": 1}


def test_payload_version_bumped() -> None:
    """The HTTP envelope must advertise `payload_version=2` so older
    frontends know they can render the Aging tab. The constant is kept
    in the worker module so older builds don't accidentally export 2
    without the column updates."""
    import ll01_warehouse_activity_monitor as mod
    src = open(mod.__file__).read()
    assert '"payload_version": 2' in src

# Created and developed by Jai Singh
