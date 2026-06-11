---
tags: [type/implementation, status/active, domain/backend]
created: 2026-04-29
---
# Bulk Export via SAP `%pc`

## Purpose / Context
Phase B4 — large SAP list output extraction (LT10 warehouse-wide, LT22, LX*) was paginating via Ctrl+PgDn through `_extract_sap_list_output`, taking minutes for 15k-row reports. SAP's classic transaction `%pc` (Save list in file → Unconverted) writes the entire list to a TXT file in one round-trip.

## Implementation
`omni_agent/agent.py` → `_extract_via_pc_export(sess)` does:
1. Type `%pc` in the OK code, Enter.
2. Pick the "Unconverted" radio on the export-format dialog (tries multiple ID variants for SAP skin differences).
3. Set `DY_PATH = %TEMP%\` and `DY_FILENAME = omniframe_<uuid>.txt`. Press Save (btn[11]) and accept the optional "replace existing" popup.
4. Read the file as cp1252 (SAP Latin1).
5. Find the dash-row separator that SAP renders between header block and data rows. Use the `-` runs on that row to compute fixed-width column boundaries.
6. Slice each subsequent line on those boundaries → `{columns, rows, total, meta: {extraction_mode: 'pc_bulk_export'}}`.

## Wiring
- `QueryRequest` got a `use_bulk_export: bool = False` field.
- `/sap/query` stashes the flag on `state._use_bulk_export` so the existing `_extract_alv_grid` fallback chain can consult it without changing every handler signature.
- `_extract_alv_grid` now tries `_extract_via_pc_export` BEFORE `_extract_sap_list_output` when the flag is set.
- `handler_lt10` opts in automatically when `storage_type == '*'` (warehouse-wide queries) — the most common case where the row count blows past 200.

## File paths edited
- `omni_agent/agent.py`

## Edge cases
- **Dialog ID variation**: the unconverted radio button has at least three known IDs across SAP releases; we try them in order and fall through on failure.
- **TEMP path missing**: defaults to user home if `$TEMP` is unset.
- **Empty result**: parser raises if it can't find a dash row; the calling extractor catches and falls back to `_extract_sap_list_output`.
- **Trailing footer**: parser stops on lines matching `\d+ records selected` so the row count line doesn't show up as data.
- **Encoding**: cp1252 with `errors='replace'` — non-Latin1 characters become `?` rather than crashing the parse.

## Effort
Medium. ~250 lines including parser. Existing fallback chain made wiring trivial.

## Related
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Implementations/Job-Queue-Architecture]]
