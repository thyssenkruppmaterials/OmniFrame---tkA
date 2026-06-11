---
tags: [type/pattern, status/active, domain/agent, domain/frontend, ll01]
created: 2026-05-27
---

# LL01 Aging Breakdown — design (2026-05-27)

Follow-up to [[Implement-LL01-Warehouse-Activity-Monitor]]. Adds **aging by warehouse / quarter / user** below the existing Plant × Category heatmap.

## What the manual report (`LL01 Stack.xlsx`) gave us

7 PQ-* sheets — one per LL01 category. Per-row schema verified against the Excel:

| Category | Date column | Aging Days col? | User column |
|---|---|---|---|
| Open Transfer Orders | `Created On` (2016-02-09 → 2026-05-15) | yes | `Created by` |
| Open Transfer Requirements | `Created On` (2010-04-29 → 2026-05-15) | yes | — |
| Open Posting Changes | `Created On` (2022-05-06 → 2026-05-15) | yes | `User` |
| Critical Deliveries | `Created On` (2020-12-09 → 2026-05-16) | yes | `Created By` |
| Negative Stock | `Last mvmnt` (2024-03-05 → 2026-05-15) | yes | — |
| Interim Stock w/o Movement | `Last mvmnt` (2019-12-31 → 2026-05-15) | yes | — |
| Critical Stock In Production | `Last mvmnt` (2026-01-29 → 2026-05-17) | yes | — |

The `Aging Days` column is non-null only for items where the manual pivot put them in the `<30 / 30-60 / >60` bins; items older than that get `null` and a `Timebound` label like `Q1 - 2025` or `Older Than Jan 2023`. Aging is therefore best derived from the date column (`today − date`), not from the pre-computed `Aging Days`. The `Timebound` column confirms the existing report uses **discrete** day buckets (`<30`, `30 To 60`, `>60`) plus quarterly fallbacks for older items.

## What today's worker emits

[[Components/Rust-Work-Service]] is not in the path — LL01 is a **direct** agent route. Flow: browser → `executionMode.dispatch` → either local agent (`POST /sap/ll01/warehouse-activity` over HTTPS) or fleet agent (queued via `sap_agent_jobs`). The agent runs `LL01` per plant, parses tab-delimited exports, and returns `{ plants, categories: [{ key, label, thresholds, counts_by_plant, total, rows: [...] }], errors }`. Counts also persist to `ll01_activity_snapshots` for trend history.

Problem: today's `LL01_CATEGORIES` column spec drops `Created On` / `Created by` / `Last mvmnt` from `open_to`, `open_tr`, and `open_posting`. Aging cannot be derived from rows that don't carry their anchor date. **Fix is additive:** extend the column spec — the smart-header parser will pick up new fields where SAP emits them, and missing fields just stay blank for that row.

## Aging-bucket semantics — cumulative

User asked for "things that are over 30, 60, 90 by quarter". Cumulative reads natural for that phrasing ("over X") and matches operations: leadership wants "how stuck is this category" at a glance, not three disjoint counts. Tooltip and a small note in the section header document the choice. Discrete bins are derivable from cumulative (30-60 = `>30 - >60`) so power users aren't blocked.

- `>30 days` — items aged ≥ 30 days (includes `>60` and `>90`)
- `>60 days` — items aged ≥ 60 days (includes `>90`)
- `>90 days` — items aged ≥ 90 days

Age = `today_utc − parsed_date_iso`, in days, only for rows that have a parseable date in the category's anchor column.

## Quarter axis

For every row that parses a date, label it `YYYY-Qn` based on calendar quarter of the anchor date. Render quarters in chronological order. Surface a date-span pill above the section: `Data spans 2010-Q2 → 2026-Q2`. The Excel shows transactional categories go back **16+ years**; "how far back" can genuinely be that old.

## User axis

For categories whose underlying SAP rows expose a user column (Open TO `created_by`, Open Posting `user`, Critical Delivery `created_by`), show a top-N table of users by row count. For Open TR / Negative Stock / Interim Stock / Critical Stock In Production, render a clear "Not available for this category — SAP's LL01 list view does not expose a user column" placeholder.

## Payload shape (additive, backward-compatible)

Keep the current envelope. Add optional row keys to existing categories — frontend derives buckets via `useMemo`, no second fetch (per [[_Index/Patterns]]-style guidance and the task's TanStack Query directive).

```ts
// Per-row additions emitted by the worker:
open_to:            row.created_on, row.created_by
open_tr:            row.created_on
open_posting:       row.created_on        // already has row.user
critical_delivery:  unchanged             // already has created_on, created_by
negative_stock:     unchanged             // already has last_movement_date
interim_stock:      unchanged             // already has last_movement_date, aging_days
critical_stock_*:   unchanged             // already has last_movement_date, goods_receipt_date
```

Add a top-level `payload_version: 2` to the response to make older clients explicit. Front-end falls back to skipping the aging tab when version < 2.

## UX placement — new "Aging" tab

The Heatmap tab is already dense (5×7 grid + run controls + drilldown drawer). Aging adds a 5×3-bucket grid + quarter chart + per-user drilldown — three substantial cards. Inlining below the heatmap makes the page scroll long and competes for attention with the heatmap drilldown drawer. A sibling `Aging` tab next to `Heatmap` / `Trend` is the cleanest split: same data source, complementary lens, one click to switch.

Fallback for the user's preference ("in the heatmap area or below it"): the Aging tab itself begins with the Plant × Category counts pulled from the heatmap so the spatial context is preserved.

## Test plan

- `omni_agent/tests/test_ll01_aging.py` — pure-function unit tests for the bucket math, quarter derivation, and the top-users aggregation. Includes the `created_on` extraction path for the 3 categories that gained it.
- `src/features/admin/sap-testing/components/__tests__/ll01-aging.test.tsx` — render checks for the new section: empty state, populated 5×3 grid, "user breakdown not available for this category" copy.

## Notes

- No new `supabase.channel(...)` callsites — the data flow is the existing direct agent HTTP response (per [[Realtime-Policy]]).
- No EXE rebuild this turn — the Python edits land in source; next build mirror copies them.
- Realtime envelope unchanged — see [[Implement-LL01-Warehouse-Activity-Monitor]] for the existing flow.
