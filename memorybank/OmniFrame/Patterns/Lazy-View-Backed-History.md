---
tags: [type/pattern, status/active, domain/frontend, domain/database]
created: 2026-05-04
---

# Lazy view-backed history

## Pattern

When surfacing per-row history (defer / reassignment / dismissal / mute / snooze logs) on a dashboard:

1. Expose the history as a Postgres **view** (`security_invoker = true`) that joins the source table with user / parent identity. *Don't* cache columns on the parent row.
2. Read the view from the frontend through a dedicated **service** + **React Query hooks**.
3. Gate every hook with an `enabled` flag so the bulk dashboard fetch pays ZERO cost when the user isn't asking for the history.

The pattern keeps the parent table simple, lets the audit trail stay full-fidelity, and avoids trigger-based cache drift — at the cost of a per-popover/per-modal/per-filter roundtrip that only fires when the user actually wants the data.

## When to use

- A `<thing>_history` or `<thing>_log` table is already in production and joined with user identity.
- Supervisors need audit-quality reads ("who did X to Y when, and why?") on demand, not in the hot path.
- The parent dashboard already loads thousands of rows and you don't want to inflate that fetch.

## When NOT to use

- The history is needed in the row's primary visible state (e.g. "last counted by" displayed on every row in the default view) — cache columns + trigger is cheaper there.
- The view's join cardinality is high enough that even a per-popover roundtrip is too slow on the user's network.

## Implementation skeleton

```sql
-- Migration: pure CREATE VIEW + CREATE INDEX IF NOT EXISTS.
CREATE OR REPLACE VIEW v_<thing>_history
WITH (security_invoker = true)
AS
SELECT h.*, up.full_name, up.email, parent.<id_label>
FROM <thing>_log h
LEFT JOIN user_profiles up ON up.id = h.user_id
LEFT JOIN <parent_table> parent ON parent.id = h.<parent_fk>;

GRANT SELECT ON v_<thing>_history TO authenticated;

-- Non-partial indexes for history reads (the existing `WHERE is_active`
-- partials only cover the current state).
CREATE INDEX IF NOT EXISTS idx_<thing>_log_<parent>_at_desc
  ON <thing>_log (<parent_fk>, <event_at> DESC);
```

```ts
// service
class HistoryService {
  fetchForParent(id: string) { return supabase.from('v_<thing>_history').select('*').eq('<parent_fk>', id).order('<event_at>', { ascending: false }) }
  fetchForOrg(opts) { /* userIds / since / until / limit / includeCleared */ }
  fetchDistinctActors(opts) { /* feeds the multi-select */ }
}
```

```ts
// hook — ALL hooks default `enabled = false` for the org-wide variants.
function useHistoryForParent(parentId, enabled = true) {
  return useQuery({ enabled: !!parentId && enabled, staleTime: 60_000, ... })
}
```

```tsx
// UI — popover gates fetch on `open`.
<Popover open={open} onOpenChange={setOpen}>
  <PopoverTrigger>{badge}</PopoverTrigger>
  <PopoverContent>{open && <Body data={useHistoryForParent(id, open).data} />}</PopoverContent>
</Popover>
```

## Three-surface contract

The pattern works because the three surfaces share data shape and stale-time:

1. **Inline popover** (per-row hover/click) — fetches one parent's history when triggered.
2. **Detail modal section** (deep dive) — fetches the same parent's history when the modal opens (often shares the cache via TanStack Query).
3. **Filter / search** (org-wide) — enabled only when the filter is selected or the search term length ≥ 2.

All three converge on the same view + the same hooks. No code duplication, no parallel fetch paths.

## Concrete instance

[[Track-Defer-By-User-History]] (migration 269) — surfaces `cycle_count_operator_deferred_counts` history on the Inventory Counts dashboard:

- View: `v_cycle_count_defer_history`.
- Service: `src/lib/supabase/defer-history.service.ts`.
- Hook: `src/hooks/use-defer-history.ts`.
- Surfaces: `SkippedBadgePopover` + `DeferHistorySection` (in `EditCountModal`) + `DeferredByFilter` + search predicate widening, all in `src/components/manual-counts-search.tsx`.

## Trade-offs vs. cached-on-row columns

| Concern | Lazy view-backed | Cached on row + trigger |
|---|---|---|
| Source of truth | One — the log table | Two — must stay in sync via trigger |
| Default-load cost | $0 | One extra column per cached field |
| Click-to-open cost | One roundtrip per popover/modal | $0 |
| Audit trail | Full | Only "last" — truncated |
| Schema migration risk | Pure CREATE VIEW (reversible) | New columns + trigger code + RLS |

## Generalisation

Applies to any `_log` / `_history` / `_event` / `_audit` table joined with user identity:

- `cycle_count_operator_deferred_counts` — implemented (this note's instance).
- `assignment_history` — already follows half of the pattern (modal-only); could be extended to expose a popover on the Reassigned badge.
- `notification_dismissals` — candidate.
- `task_snooze` / `inbox_mute` — candidates.

## Related

- [[Track-Defer-By-User-History]]
- [[Per-Operator-vs-Global-Defer-Scope]]
- [[ManualCountsSearch - Inventory Tab]]
