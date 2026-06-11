---
tags: [type/debug, status/active, domain/agent, domain/backend]
created: 2026-05-10
---
# Fix LX25 JSM Undercount (TKAJSM warehouse total reported 17 instead of 1,546)

## Symptom

User reported the **TKAJSM** variant of the LX25 Inventory Completion query (SAP Testing → Inventory Management → Inventory Completion) returned **17 bins** for warehouse JSM. The actual warehouse holds ~1,400-1,500 bins. Other variants — TKAWH5, TKAWH8, TKAJSF, TKAPDC — returned correct totals.

## Root cause (one sentence)

`omni_agent/lx25_inventory_completion.py`'s `_STORAGE_TYPE_RE` regex was `^(\d{1,4})\s+(.+?)\s*$` — **digits-only** — but JSM uses **alpha** storage type codes (`DDN`, `DDS`, `DDU`, `DUR`, `SCD`), so none of JSM's 5 storage type marker lines matched, every metric row fell through to the `current_st is None` defensive branch and wrote into a single shared `(unspecified)` placeholder, and each new `Total number of bins` row overwrote the previous — leaving the warehouse total = the LAST storage type's count (`SCD = 17`).

## Why other warehouses were unaffected

WH5 / WH8 / PDC use **numeric** storage type codes (`110`, `826`, `010` patterns), which matched the `\d{1,4}` regex cleanly. JSF (single storage type, numeric) was also fine. The regression was JSM-specific because JSM is the only warehouse in the fan-out using SAP's alpha-code convention for its storage types.

## Reproduction (pre-fix)

Slicing `_parse_lx25_text` out of `lx25_inventory_completion.py` and running it against `/Users/jaisingh/Downloads/MacWindowsBridge/jsm.txt`:

```
=== JSM (broken) ===
  warehouse_code: 'JSM'
  warehouse_name: 'Lift System Warehouse'
  storage_types (1 entries):
    - ''       '(unspecified)'           total_bins=17     # <-- LAST-ST overwrite
  SUM total_bins (across storage_types) = 17
```

Versus `WH5LX25x`:

```
=== WH5 (working) ===
  warehouse_code: 'WH5'
  warehouse_name: 'Indianapolis Plt 5 Stores'
  storage_types (1 entries):
    - '110'    'TKA LGE ENG FIXED BIN'   total_bins=6133
```

## Fix

`omni_agent/lx25_inventory_completion.py:227` — broaden the regex from digits-only to **uppercase alphanumeric**:

```python
# Before
_STORAGE_TYPE_RE = re.compile(r"^(\d{1,4})\s+(.+?)\s*$")

# After
_STORAGE_TYPE_RE = re.compile(r"^([A-Z0-9]{1,4})\s+(.+?)\s*$")
```

SAP storage type codes are 1-4 chars, uppercase by convention. The character class `[A-Z0-9]` covers numeric (`110`), pure-alpha (`DDN`), and mixed alnum codes — matches the SAP storage-type field convention. Lowercase prose (e.g. `inventory active`) cannot match because the metric-row branch matches FIRST by label prefix and short-circuits with `continue`. The post-regex guard `if m and not first_cell_lower.startswith(tuple(p for _, p in _METRIC_LABELS))` is defence-in-depth.

Mirror in `MacWindowsBridge/Omni-Agent/lx25_inventory_completion.py` is byte-equal (`cmp` clean).

## Verification

Re-running the parser slice against `jsm.txt`:

```
=== JSM (after fix) ===
  warehouse_code: 'JSM'
  warehouse_name: 'Lift System Warehouse'
    - 'DDN'   'DOD NEW'           bins=  935  exec=  446  active= 12  plan=  0  notexec=  489
    - 'DDS'   'DOD SERV'          bins=  132  exec=   78  active=  0  plan=  0  notexec=   54
    - 'DDU'   'DOD UNSV'          bins=  461  exec=  118  active=  4  plan=  0  notexec=  343
    - 'DUR'   'DOD Unrepairable'  bins=    1  exec=    0  active=  0  plan=  0  notexec=    1
    - 'SCD'   'Scrap DoD'         bins=   17  exec=    0  active=  0  plan=  0  notexec=   17
  WAREHOUSE TOTAL: bins=1546 executed=642 active=16 planned=0 not_executed=904
```

Cross-checks:
- `1,546 bins total` — inside the user's expected 1,400-1,500 range (slightly above because the user's estimate was rounded — exact = 935 + 132 + 461 + 1 + 17 = 1,546).
- `executed=642` → completion = `642 / 1546 ≈ 41.5%` — matches the per-storage-type Proportio cells (47.70% × 935 + 59.09% × 132 + 25.60% × 461 + 0% × 1 + 0% × 17, weighted).
- WH5 unchanged: 6,133 bins / 4,302 executed / 70.15% completion. No regression.

## Regression test

`omni_agent/tests/test_lx25_parser.py` — 4 test cases:

1. `test_parse_wh5_single_numeric_storage_type` — pinned at `110 / TKA LGE ENG FIXED BIN / 6133 / 4302 / 458 / 0 / 1831`.
2. `test_parse_jsm_five_alpha_storage_types` — pinned per-storage-type metrics for all 5 alpha codes (`DDN/DDS/DDU/DUR/SCD`).
3. `test_jsm_aggregates_to_warehouse_total` — pinned warehouse total at `1546 bins / 642 executed`. Pre-fix this would have been `17`.
4. `test_parse_sap_int_handles_thousand_separators` — locale (`6,133` US, `6.133` DE, `6 133` FR, `1\u00A0234` NBSP) + SAP trailing-minus convention.

Fixtures live next to the test:
- `omni_agent/tests/fixtures/lx25_jsm.txt` (1577 bytes — copy of `jsm.txt`)
- `omni_agent/tests/fixtures/lx25_wh5.txt` (462 bytes — copy of `WH5LX25x`)

Test loader uses the same "slice the parser block out of source, exec in controlled namespace" pattern as `test_lt22_smart_header.py` / `test_lt10export_smart_header.py` so the test runs without pulling in `fastapi` / `pydantic` and without instantiating the lazy `agent` import bridge.

Run with:
```
python3 omni_agent/tests/test_lx25_parser.py        # all 4 PASS
python3 -m pytest omni_agent/tests/test_lx25_parser.py -v  # 4 passed
```

## Build status

- `python3 -c "import ast; ast.parse(...)"` — clean for source + mirror.
- `cmp omni_agent/lx25_inventory_completion.py MacWindowsBridge/Omni-Agent/lx25_inventory_completion.py` — byte-equal.
- AGENT_VERSION untouched (still 2.0.0 — per task constraint).
- No other handlers modified (per task constraint — LX25 parser only).

## Files modified

| File | Change |
|---|---|
| `omni_agent/lx25_inventory_completion.py` (lines 224-238) | Regex broadened to `[A-Z0-9]{1,4}` + extended docstring linking back to this Debug note. |
| `MacWindowsBridge/Omni-Agent/lx25_inventory_completion.py` | Byte-equal mirror. |
| `omni_agent/tests/test_lx25_parser.py` (new, 4 tests) | Regression coverage. |
| `omni_agent/tests/fixtures/lx25_jsm.txt` (new) | JSM 5-alpha-code sample. |
| `omni_agent/tests/fixtures/lx25_wh5.txt` (new) | WH5 single-numeric-code sample. |

## Related

- [[Implementations/Implement-LX25-Inventory-Completion]] — the feature that ships this parser.
- [[Components/Omni-Agent - Headless SAP Agent]] — the agent runtime that hosts the LX25 endpoint.
- [[Sessions/2026-05-10]]
