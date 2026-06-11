---
tags: [type/debug, status/active, domain/frontend]
created: 2026-04-25
---
# Fix — Standard Work dashboard cache staleness after Start / Submit

## Symptom
After pressing Start on a checklist (or Submit at the end), the Today's Tasks list, KPI strip, and My Progress rail kept showing pre-action numbers for up to 60 seconds (the `refetchInterval` window), making it look like the action didn't take effect.

## Root cause
Mutations in `src/hooks/use-standard-work.ts` only invalidated submission-related query keys:
- `startSubmissionMutation.onSuccess` invalidated `standard-work-submissions` and `standard-work-submissions-today` only.
- `submitChecklistMutation.onSuccess` invalidated those plus `standard-work-submission`.

The dashboard reads from `standard-work-dashboard-tasks`, `standard-work-user-progress`, `standard-work-upcoming-tasks`, `standard-work-overdue-tasks`, and `standard-work-scheduled-tasks`. None of those were invalidated, so the dashboard sat on stale data until each query's `refetchInterval` ticked.

## Fix
Added an `invalidateDashboardSurfaces()` helper that the lifecycle mutations call on success:
```ts
const invalidateDashboardSurfaces = () => {
  queryClient.invalidateQueries({ queryKey: ['standard-work-dashboard-tasks', organizationId] })
  queryClient.invalidateQueries({ queryKey: ['standard-work-user-progress', organizationId] })
  queryClient.invalidateQueries({ queryKey: ['standard-work-upcoming-tasks', organizationId] })
  queryClient.invalidateQueries({ queryKey: ['standard-work-overdue-tasks', organizationId] })
  queryClient.invalidateQueries({ queryKey: ['standard-work-scheduled-tasks', organizationId] })
}
```
Called from `startSubmissionMutation`, `submitChecklistMutation`, `updateSubmissionMutation`, `deleteSubmissionMutation`.

Also changed Refresh on the dashboard from `refetchTasks()` (only one query) to `overview.refetchAll()` which awaits all three.

## Lesson learned
When a feature has multiple read surfaces sharing the same write actions, prefer a small "invalidate all dependent surfaces" helper over copy-pasted `invalidateQueries` calls in each mutation — the helper is impossible to forget when adding a new mutation.

## Related
- [[Standard Work - Feature Module]]
- [[Redesign-StandardWork-Comprehensive]]
- [[ADR-StandardWork-Single-Source-Of-Today]]
- [[React-Query-Patterns]]
