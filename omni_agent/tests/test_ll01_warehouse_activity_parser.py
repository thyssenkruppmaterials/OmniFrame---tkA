# Created and developed by Jai Singh
"""Parser tests for LL01 Warehouse Activity Monitor exports."""

from __future__ import annotations

import pytest

from ll01_warehouse_activity_monitor import parse_ll01_category_export


OPEN_TO_SAMPLE = """\t05/22/2026\t\t\tOpen Transfer Orders\r\n
\r\n
TO Number\tItem\tCo\tWhN\tMTy\tMaterial\tSrceTgtQty\tSourc\tSource Bin\tDest.st.t\tDest. Bin\tPlnt\r\n
0001234567\t1\t1000\tWH5\t101\tMAT001\t10\t001\tBIN-A\t002\tBIN-B\tWH5\r\n
0001234568\t2\t1000\tWH5\t101\tMAT002\t5\t001\tBIN-C\t002\tBIN-D\tWH5\r\n
"""

OPEN_TR_SAMPLE = """Open TR\r\n
\r\n
TR Number\tItem\tWhN\tMTy\tMaterial\tTR Quantity\tTpe\tPlnt\tSLoc\r\n
0009876543\t1\tWH5\t101\tMAT003\t12.000\t001\tWH5\t001\r\n
"""

OPEN_POSTING_SAMPLE = """Open Posting\r\n
Post.Ch.No\tWhN\tMvT\tMaterial\tPlnt\tSLoc\tUser\tPost.change qty\r\n
PC001\tWH5\t501\tMAT004\tWH5\t001\tJSINGH\t3\r\n
"""

CRITICAL_DELIVERY_SAMPLE = """Critical Delivery\r\n
Warehouse\tDelivery\tShPt\tDlvTy\tShip-to\tNo.Pk\tLoadg Date\tCreated On\tCreated By\tDPrio\tDeliv.Date\tExternal Delivery ID\r\n
WH5\t80001234\tSP01\tLF\tCUST01\t2\t05/20/2026\t05/18/2026\tJSINGH\t1\t05/21/2026\tEXT-001\r\n
"""

NEGATIVE_STOCK_SAMPLE = """Negative Stock\r\n
Material\tTR Number\tPlnt\tWhN\tTyp\tStorageBin\tTotal Stock\tBUn\tLast mvmnt\tTime\r\n
MAT005\t000111\tWH5\tWH5\t001\tBIN-N1\t-5\tEA\t05/15/2026\t14:30:00\r\n
"""

INTERIM_STOCK_SAMPLE = """Interim Stock\r\n
Warehouse\tMaterial\tPlnt\tTyp\tStorageBin\tTotal Stock\tBUn\tLast mvmnt\tTime\tAging Days\r\n
WH5\tMAT006\tWH5\t001\tBIN-I1\t20\tEA\t04/01/2026\t09:00:00\t51\r\n
"""

CRITICAL_STOCK_PROD_SAMPLE = """Critical Stock In Production\r\n
Material\tPlnt\tTyp\tStorageBin\tTotal Stock\tBUn\tLast mvmnt\tTime\tAvailable stock\tGR Date\r\n
MAT007\tWH5\t001\tBIN-P1\t8\tEA\t05/10/2026\t11:00:00\t2\t05/01/2026\r\n
"""

SAMPLES = {
    "open_to": OPEN_TO_SAMPLE,
    "open_tr": OPEN_TR_SAMPLE,
    "open_posting": OPEN_POSTING_SAMPLE,
    "critical_delivery": CRITICAL_DELIVERY_SAMPLE,
    "negative_stock": NEGATIVE_STOCK_SAMPLE,
    "interim_stock": INTERIM_STOCK_SAMPLE,
    "critical_stock_production": CRITICAL_STOCK_PROD_SAMPLE,
}


@pytest.mark.parametrize("category_key", list(SAMPLES.keys()))
def test_parse_each_category(category_key: str) -> None:
    rows = parse_ll01_category_export(SAMPLES[category_key], category_key)
    assert len(rows) >= 1
    assert rows[0]


def test_open_to_row_count() -> None:
    rows = parse_ll01_category_export(OPEN_TO_SAMPLE, "open_to")
    assert len(rows) == 2
    assert rows[0]["to_number"] == "0001234567"
    assert rows[0]["material"] == "MAT001"


def test_empty_list() -> None:
    rows = parse_ll01_category_export("\r\n\r\n", "open_to")
    assert rows == []


def test_single_row() -> None:
    rows = parse_ll01_category_export(OPEN_POSTING_SAMPLE, "open_posting")
    assert len(rows) == 1
    assert rows[0]["posting_change_no"] == "PC001"


def test_header_with_extra_blank_lines() -> None:
    text = "\r\n\r\n" + OPEN_TR_SAMPLE
    rows = parse_ll01_category_export(text, "open_tr")
    assert len(rows) == 1
    assert rows[0]["tr_number"] == "0009876543"


def test_malformed_date_kept_raw() -> None:
    text = CRITICAL_DELIVERY_SAMPLE.replace("05/20/2026", "not-a-date")
    rows = parse_ll01_category_export(text, "critical_delivery")
    assert rows[0]["loading_date"] == "not-a-date"


def test_date_parsed_to_iso() -> None:
    rows = parse_ll01_category_export(CRITICAL_DELIVERY_SAMPLE, "critical_delivery")
    assert rows[0]["loading_date"] == "2026-05-20"
    assert rows[0]["created_on"] == "2026-05-18"

# Created and developed by Jai Singh
