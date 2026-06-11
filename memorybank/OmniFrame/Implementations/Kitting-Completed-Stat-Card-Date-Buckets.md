---
tags: [type/implementation, status/active, domain/frontend, domain/database, kitting]
created: 2026-06-11
---

# Kitting Completed Stat Card — Today / Yesterday / Week Buckets

## What

The Kitting Data Manager's **Completed** stat card now shows EST date-scoped completion buckets — **Today / Yesterday / This Week (rolling 7 days)** — instead of a single all-time number. The all-time total moved into the card header ("N all-time"). Card restyled to match the outbound data manager's pattern: `KpiGrid` + `StatTile` pills with icon chip + uppercase title + hover gradient.

## Where

- `src/lib/supabase/rr-kitting-data.service.ts` → `getStatistics()` returns three new fields: `completedTodayCount`, `completedYesterdayCount`, `completedThisWeekCount`.
- `src/components/kitting-data-manager.tsx` → Completed card rebuilt with `KpiGrid columns={3}` + three `StatTile`s (emerald / default / sky accents).

## How completion is dated

- Completion moment = `kit_ready_on_dock_date_time` (stamped by `stageKitToDock` as UTC ISO on every row of the kit — "on dock = done" invariant, see [[Kit-Grid-Derived-Stage-Status]]).
- Rows are per TO line; the timestamp is snapshot-replicated, so the first non-null per `kit_serial_number` is taken (`Map<serial, estDate>`) — counts are DISTINCT kits, not rows.
- UTC timestamp → EST calendar date via `getStartOfDayEST(new Date(ts)).slice(0, 10)` from `@/lib/utils/timezone` (codebase convention: all "today" metrics are EST/America-New_York).
- Buckets: `today === getTodayEST()`, `yesterday === getDaysAgoEST(1)`, `week >= getDaysAgoEST(7)` (rolling 7 days including today — same convention as outbound `getStatistics`' `weekAgo`).

## Gotcha

Legacy kits stored as `kit_build_status = 'completed'` with **no** dock timestamp can't be dated — they count toward the all-time total (`completedCount`, which keeps the on-dock-OR-status-completed rule) but are excluded from the day buckets.

## Related

- [[Kit-Build-Plan-Completed-Tab]] — the Completed Kits tab the total must agree with
- Outbound pattern source: `src/components/outbound-data-manager.tsx` StatisticsCards (May 5, 2026 redesign)
