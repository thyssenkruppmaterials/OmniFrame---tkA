---
tags: [type/decision, status/active, domain/frontend, domain/database]
created: 2026-04-25
---
# ADR — Single Source of Truth for Standard Work "Today"

## Context

The Standard Work dashboard previously read "today" metrics from three independent sources that were never reconciled in the UI:
1. `useDashboardTasks` — RPC `get_scheduled_tasks_for_date` grouped client-side into `{ overdue, dueSoon, upcoming, completed }`.
2. `useUserProgress` — RPC `get_user_standard_work_stats` returning `completed_today`, `due_today`, `overdue_count`, `current_streak`, `on_time_rate`.
3. `todaySubmissions` — submissions filtered by `shift_date = today`.

KPI strip, Today's Tasks list, My Progress rail, and Recent Activity each consumed a different slice. Numbers could disagree (e.g. KPI says 5 tasks, rail says 2/3, list shows 4) without explanation.

A second related issue: the in-memory dashboard-tasks bucket was named `upcoming` ("due more than an hour from now, today") which collided with the 7-day Upcoming Schedule, two different concepts wearing the same word.

## Decision

1. **Introduce `useStandardWorkOverview`** (`src/features/standard-work/hooks/use-standard-work-overview.ts`) as the only call site that fetches dashboard surfaces. It returns:
   - `today.{ total, completed, overdue, dueSoon, laterToday, completionPct }`
   - `buckets.{ overdue, dueSoon, laterToday, completed }`
   - `progress: UserProgressStats | null` (from RPC)
   - `upcoming` (next-N-days list)
   - `isError`, `errors`, `isLoading`, `refetchAll`
2. **Precedence rules**:
   - KPI "Today's progress" prefers `progress.due_today / progress.completed_today` so the rail and KPI agree; falls back to live bucket counts when the RPC is unavailable.
   - "Attention needed" KPI uses live buckets (`overdue + dueSoon`) — server stats can lag.
   - Streak / on-time rate come from `progress` only (these are server-aggregated trailing metrics).
3. **Rename** the dashboard-tasks bucket internally from `upcoming` to `laterToday` to eliminate naming collision with the 7-day Upcoming Schedule (which retains its name).
4. **Cache invalidation**: every submission-lifecycle mutation invalidates `standard-work-dashboard-tasks`, `standard-work-user-progress`, `standard-work-upcoming-tasks`, `standard-work-overdue-tasks`, and `standard-work-scheduled-tasks`. Refresh refetches all three queries via `refetchAll`.

## Consequences

- **Pro**: Numbers cannot diverge silently. The dashboard renders an explicit error banner when any of the three queries fails (was previously hidden as the "All caught up!" empty state).
- **Pro**: Phase 1 redesign can collapse the four KPI cards into canonical metrics without worrying about bucket-vs-RPC drift.
- **Pro**: Renaming `upcoming -> laterToday` removes the "upcoming" overload that confused both readers and reviewers.
- **Con**: All three queries fire on dashboard mount even if only one stat is needed. Acceptable: they're cheap and parallel.
- **Con**: Server-side `due_today` / `completed_today` can drift from live bucket counts during the 60-second refetch window. Mitigation: precedence rule favors RPC (rail-aligned) for the KPI strip; the Today list still shows live buckets so users see new tasks immediately.

## Alternatives Considered

- **One mega-RPC** returning everything in one call — rejected because the three RPCs already exist and refresh on different intervals (60s vs 5min); merging would force the longer interval.
- **Live aggregation in SQL views** — rejected for now; the precedence rule in the selector is simpler and more flexible.

## Related

- [[Standard Work - Feature Module]]
- [[Redesign-StandardWork-Comprehensive]]
- [[StandardWorkAndOperations - Supabase Service]]
- [[React-Query-Patterns]]
