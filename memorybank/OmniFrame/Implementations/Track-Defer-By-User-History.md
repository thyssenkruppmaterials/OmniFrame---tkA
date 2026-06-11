---
tags: [type/implementation, status/active, domain/frontend, domain/database, cycle-count, defer-history]
created: 2026-05-04
---

# Track Defer-By-User History — End-to-End

## Purpose / Context

Give supervisors end-to-end visibility for *who deferred / skipped a cycle count, when, and why* on the **Inventory Counts** dashboard (`/apps/inventory?tab=manual-counts`). Builds on the per-operator defer table already in production (`cycle_count_operator_deferred_counts`) — the gap was UI-side, not data-side. The recently-fixed [[Per-Operator-vs-Global-Defer-Scope]] bug surfaced how powerful a per-operator defer event actually is in the system: now we expose it.

Deliverables:

1. **Read-only Postgres view** that joins the defer table with `user_profiles` + `rr_cyclecount_data`.
2. **Frontend service + React Query hooks** that lazy-fetch only when the user wants the data.
3. **Three UI surfaces** wired into the existing Inventory Counts dashboard:
   - Popover on the **Skipped** badge (recent 3 + "View all" link).
   - **Skip / Defer History** section in the `EditCountModal` (full table).
   - **Deferred by [user]** multi-select filter in the dashboard header (with "Include cleared defers" sub-toggle).
4. **Search predicate extension** that maps a typed operator name to every count they've deferred (active or cleared).

## Decision: Option A (view-based) over Option B (cache columns + trigger)

The brief offered two options. Option A wins:

| Concern | Option A (view) | Option B (cached cols + trigger) |
|---|---|---|
| Source of truth | One table — defer table | Two — defer table + `rr_cyclecount_data.last_deferred_*` |
| Drift risk | None (joins on demand) | Trigger has to keep them in sync forever |
| Write amplification | None | Every defer / clear writes both tables |
| RLS reuse | Inherits from defer table via `security_invoker = true` | Need separate policies on the new columns |
| History granularity | Full history (active + cleared) | Only "last" — losing the audit trail |
| Perf on dashboard | Lazy — zero impact on the bulk fetch | Trivially cheap — but at the price of every column above |

The perf delta for Option B is only meaningful if defer-history is queried in the hot path. We chose lazy loading for exactly that reason — see *Lazy-load surfaces* below — so Option A's perf cost is bounded to popover/modal/filter usage. The audit-quality history was the deciding factor.

## Migration 269 — `v_cycle_count_defer_history`

File: `supabase/migrations/269_cycle_count_defer_history_view.sql`. Applied via Supabase MCP `apply_migration` on 2026-05-04.

### View shape

```sql
CREATE OR REPLACE VIEW v_cycle_count_defer_history
WITH (security_invoker = true)
AS
SELECT
    d.id, d.organization_id, d.count_id,
    cc.count_number,
    d.user_id,
    up.full_name AS user_full_name,
    up.email     AS user_email,
    up.username  AS user_username,
    d.defer_reason, d.deferred_at, d.cleared_at, d.reactivated_at, d.is_active,
    d.resume_priority, d.times_deferred,
    d.created_at, d.updated_at
FROM cycle_count_operator_deferred_counts d
LEFT JOIN rr_cyclecount_data cc ON cc.id = d.count_id
LEFT JOIN user_profiles      up ON up.id = d.user_id;

GRANT SELECT ON v_cycle_count_defer_history TO authenticated;
```

`security_invoker = true` makes the existing RLS policies on `cycle_count_operator_deferred_counts` ("Users can view deferred counts in their org") apply transitively. No new policy needed.

### New indexes

The existing partial indexes only cover `is_active = true`; defer-history queries (which include CLEARED defers) need non-partial coverage. Added (all `IF NOT EXISTS`):

- `idx_deferred_counts_count_deferred_at_desc` `(count_id, deferred_at DESC)` — popover / modal per-count history.
- `idx_deferred_counts_user_deferred_at_desc` `(user_id, deferred_at DESC)` — filter by user.
- `idx_deferred_counts_org_deferred_at_desc` `(organization_id, deferred_at DESC)` — org-wide history scans for the search predicate.

### Smoke test

Migration 269 includes a transactional `DO $$ ... END $$` block at the bottom that:

1. Picks an existing `(org, user, count)` tuple.
2. Inserts a synthetic `is_active = false, cleared_at = NOW()` row.
3. Asserts the view returns it joined with non-null `user_full_name` and `count_number`.
4. Deletes the synthetic row (always — runs unconditionally).

No ORM concept of rollback in `apply_migration`, so the smoke is implemented as insert → assert → delete. Confirmed clean on apply.

## Service layer

New file: `src/lib/supabase/defer-history.service.ts`. Singleton `DeferHistoryService` exposes:

- `fetchForCount(countId)` — full per-count timeline, newest first.
- `fetchForOrg(opts)` — org-wide query with `userIds` / `countId` / `includeCleared` / `since` / `until` / `limit` filters.
- `fetchDistinctUsers(opts)` — distinct-by-user roll-up sorted by most-recent activity, used by the filter dropdown.

All three methods return `{ data, error }` mirroring the rest of the supabase service layer.

## React Query hooks

New file: `src/hooks/use-defer-history.ts`. Three hooks, all lazy via the `enabled` flag:

- `useDeferHistoryForCount(countId, enabled)` — popover + modal.
- `useDistinctDeferUsers(enabled, opts)` — filter dropdown.
- `useDeferHistoryForOrg(opts, enabled)` — search predicate + filter row scope.

Key design choice: `enabled` defaults to `false` for the org-wide hooks — the dashboard fetches them ONLY when (1) the filter has selections, (2) the dropdown is open, or (3) the search query is at least 2 characters. Stale-time = 60s.

## UI surfaces

File: `src/components/manual-counts-search.tsx` (existing).

### 1. SkippedBadgePopover (helper inside the file)

Wraps the existing **Skipped** pill in a Radix Popover that lazy-fetches the count's history via `useDeferHistoryForCount`. Shows the most recent 3 entries with user / timestamp / Active|Cleared badge / reason; "View all →" link opens the parent's `EditCountModal`. Two variants — `pill` (status column) and `subtle` (assigned-to column) — share the data fetch.

### 2. DeferHistorySection (helper inside the file)

New section in `EditCountModal` placed between the Assignment History block and the Recount section. Renders the FULL history as a 5-column table (User, Deferred at, Reason, Cleared at, State). Returns `null` if no history rows — keeps the modal clean for counts that were never skipped.

### 3. DeferredByFilter (helper inside the file)

New dropdown in the dashboard header (next to *Clear filters*). Multi-select populated from `useDistinctDeferUsers`, with a sub-toggle "Include cleared defers?" defaulting to **on**. Selected user_ids stored on `columnFilters.deferredByUserIds`; `columnFilters.includeClearedDefers` controls the cleared toggle. Filters intersect with all other column filters in the existing `columnFilteredData` memo — selecting users narrows to counts whose defer history matches.

### 4. Search predicate extension

Extended `manual-counts-search.tsx` to widen `filteredData` with any `count_id` whose defer history matches the search term against `user_full_name | user_email | user_username | defer_reason`. Activates only when search ≥ 2 chars and the org-wide history is loaded; falls back to identity when nothing matches. Preserves the existing OR-style search semantics (the new term widens, never narrows).

## Lazy-load discipline

The brief's perf constraint — *do NOT eager-join defer history into the main dashboard fetch* — drove three guardrails:

1. The popover / modal hooks `enabled` only when their UI is open.
2. The org-wide hooks `enabled` only when `columnFilters.deferredByUserIds.length > 0 || deferByDropdownOpen || searchQuery.length >= 2`.
3. The bulk `fetchCycleCountData` query in `cycle-count.service.ts` is unchanged — it still joins `active_defer` columns minimally as it did before.

Result: a dashboard load with no search and no defer filter pays ZERO additional roundtrips. Pattern documented in [[Lazy-View-Backed-History]].

## Backwards-compat

- The existing **Skipped** badge logic (gated on `item.assigned_to && item.active_defer.some(is_active)`) is preserved. The popover wraps it without changing visibility rules.
- `cycle_count_operator_deferred_counts` schema is untouched.
- The dashboard table column count is unchanged — the new "Deferred by" filter sits in the header chip area, not as a new column.
- Migration is pure CREATE VIEW + CREATE INDEX IF NOT EXISTS — fully reversible via DROP VIEW + DROP INDEX.

## Files touched

```
+ supabase/migrations/269_cycle_count_defer_history_view.sql
+ src/lib/supabase/defer-history.service.ts
+ src/hooks/use-defer-history.ts
~ src/lib/supabase/database.types.ts                (surgical add: v_cycle_count_defer_history Row + Relationships)
~ src/components/manual-counts-search.tsx           (helpers: SkippedBadgePopover, DeferHistorySection, DeferredByFilter; columnFilters extension; search widening; modal wiring)
```

## Validation

- `npx tsc -b --noEmit` — clean (0 errors).
- `npx eslint <touched files>` — clean on new files; the 8 `no-explicit-any` warnings still in `manual-counts-search.tsx` pre-date this pass (lines 1397, 1448, 2009, 2022, 2023, 4633, 4638, 4640 — all in the EditCountModal effect or the existing reassignment badge, all `(item as any).reassignment_count` and `(countData as any).reassignment_count`).
- `pnpm vitest run src/lib/supabase/__tests__/cycle-count-photos.service.test.ts src/lib/supabase/__tests__/rf-cycle-count.service.test.ts` — 2 files, **15/15 pass**. The unhandled `storage.getItem is not a function` rejection is a pre-existing jsdom mock issue called out in earlier session notes, not regressed by this pass.
- Lint ratchet (`scripts/lint-ratchet.mjs`) — already failing on `main` before this change (96 vs. baseline 16); re-verified by stashing and re-running. Not introduced by this pass.

## Related

- [[Per-Operator-vs-Global-Defer-Scope]] — the audit pattern that motivated surfacing defer-by-user.
- [[Fix-Critical-Hidden-By-Global-Defer-Filter]] — concrete bug fixed 2026-05-01 that exposed how powerful per-operator defer state is.
- [[Fix-Unassigned-Deferred-Reassigned-Badges]] — prior UI rule for the Skipped badge (kept intact).
- [[ManualCountsSearch - Inventory Tab]] — host component.
- [[Lazy-View-Backed-History]] — pattern documented out of this work.
