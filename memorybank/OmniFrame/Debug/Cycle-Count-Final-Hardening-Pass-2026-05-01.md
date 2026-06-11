---
tags: [type/debug, status/active, domain/database, domain/backend, domain/frontend, cycle-count, zone-exclusivity, supervisor-intent, websocket, audit]
created: 2026-05-01
---

# Cycle-count final hardening — audit-driven pass (2026-05-01, evening)

Debug-companion for [[Cycle-Count-Final-Hardening-Pass-Migration-253]]. After [[Cycle-Count-Bug-Fix-Pass-Migration-252]] shipped earlier today, three parallel review agents audited the entire post-252 codebase and reported 10 remaining gaps. This note records the validation, fix decisions, and the few audit findings that turned out to be wrong.

## Validation outcome (per gap)

| Gap | Severity | Audit claim | Validation outcome |
|---|---|---|---|
| 1 | CRITICAL | `push_cycle_count` doesn't stamp supervisor cols | **REAL** — UPDATE on lines 795–815 omits both columns. |
| 2 | CRITICAL | Phase 1 priority not first sort key | **NOT REAL** — Phase 1 ORDER BY already starts with `CASE rcc.priority::text` (line 238). 252 already shipped this. |
| 3 | HIGH | WS leak before Subscribe | **REAL** — `(Some, Some)` filter in `handle_socket` doesn't trigger when `subscribed_org = None`. |
| 4 | HIGH | Queue stats predicates diverge REST vs scheduler | **REAL** — confirmed both `pending` and `completed_today` differ + scheduler missing two fields. |
| 5 | HIGH | Zone Rules UI missing 252 controls | **REAL** — frontend types + UI both omit `treat_null_zone_as_locked` and `supervisor_assignment_protection_hours`. |
| 6 | HIGH | handlePush fire-and-forget | **REAL** — sync `pushToUser({...})` call, immediate `onPushComplete()` in finally. |
| 7 | MED | Mutations don't invalidate ACTIVE_ZONES; bulk toast spam | **REAL** — confirmed 3 mutations only invalidate 2 keys; bulk caller did per-row + summary. |
| 8 | MED | 252 smoke `WHEN raise_exception` invalid | **REAL** — line 746 of 252 file. |
| 9 | MED | Phase 1 zone collision raw, not pattern-aware | **REAL** — lines 224–233 use `held.zone = rcc.zone`. |
| 10 | LOW | `assign_next_cycle_count` arbitrary p_user_id | **REAL + worse than reported** — grants are PUBLIC + anon + authenticated + service_role + postgres. |

Gap 2 was the only false positive. Skipped.

## Live-DB invariants run BEFORE any change

Org `c9d89a74-7179-4033-93ea-56267cf42a17`:

1. Multiple distinct holders per zone in `v_cycle_count_active_zones`: 0
2. `pending+assigned` rows with `supervisor_assigned_at IS NULL` AND a recent admin reassignment in `cycle_count_assignment_history`: 0
3. Orphaned zone assignments (user not in org / deleted): 0
4. `worker_heartbeats.current_zone` containing `-` (raw location not normalized) within last 12h: 0

Nothing to backfill. The whole pass is forward-looking hardening.

## Live-DB invariants run AFTER migration 253

All five (added gap-10 grant audit) come back at 0. Verified clean.

## Notable decisions during the pass

### `WsEvent::QueueStatsUpdated` payload extension is wire-compatible

Added `pushed_pending` + `total_workers_online` fields. Both carry `#[serde(default)]`. Existing JS/TS clients (`manual-counts-search.tsx::1834`, `rf-interface.tsx::1016`) only read `pending` / `deferred_pending` / `in_progress` / `completed_today` from the event payload, so they're unchanged. The TypeScript `WsEvent` interface in `src/lib/work-service/types.ts` is already permissive (extra unknown keys are tolerated by the consumers' switch statements).

### Why I bypassed the React Query mutation in handlePush

`useWorkQueue().pushToUser` is `pushMutation.mutate` — the success/error toasts fire INSIDE the mutation's `onSuccess` / `onError`, per call. Even if I switched to `mutateAsync`, the per-call lifecycle handlers still run, so I'd get N toasts. Cleanest path: call `workServiceClient.pushToUser(taskId, userId)` directly from `handlePush`, wrap in `Promise.allSettled`, then `queryClient.invalidateQueries` once at the end. The single-row push elsewhere in the dashboard still uses the mutation — unaffected.

### Grant tightening on `assign_next_cycle_count`

The two deprecated frontend services (`cycle-count.service.ts` and `rf-cycle-count.service.ts`) call this RPC and ALWAYS pass `auth.user.id` (their own uid). With the auth.uid() guard installed, both continue to work for legitimate self-claim. The only behavior change is that an authenticated session can no longer pass another user's UUID and have the function obey — which was the security gap.

I considered fully revoking `authenticated` (the audit's option B), but two callers still exist in app code, so a strict tightening (auth.uid() bind + revoke PUBLIC/anon) preserves the deprecated-but-functional path while closing the hole.

### Repeatability fix on the 252 smoke block

`raise_exception` is the NAME of the SQLSTATE 'P0001' condition in some references but Postgres's PL/pgSQL exception list does NOT recognize it as a condition keyword. Confirmed via test:

```sql
DO $$ BEGIN PERFORM 1; EXCEPTION WHEN raise_exception THEN NULL; END $$;
-- ERROR: 42601: unrecognized exception condition "raise_exception"
```

`SQLSTATE 'P0001'` is the canonical match for `RAISE EXCEPTION ... USING ERRCODE = 'P0001'`. Fixed in-place; no production impact (252 already applied), but fresh-environment provisioning would have failed.

## Pre-existing failures NOT introduced by this pass

- `src/features/rf-interface/__tests__/rf-cycle-count-unified.test.tsx:554` — "Release Confirmation" suite, `getByText` match throws on multi-element match because the ConfirmDialog renders twice in the test environment. Documented as pre-existing in 252's session log; verified by running pre and post with identical output.
- 13 ESLint warnings on touched files — `no-explicit-any` on lines I didn't touch in `manual-counts-search.tsx` + `tanstack/query/no-unstable-deps` on `useCallback` usages in `use-zone-rules.ts` that pre-date this pass. Not regressed.

## Related

- [[Cycle-Count-Final-Hardening-Pass-Migration-253]] — implementation note (the WHAT and HOW).
- [[Cycle-Count-Bug-Fix-Pass-Migration-252]] — the predecessor pass that this audited.
- [[Cycle-Count-Bug-Fix-Pass-2026-05-01]] — sibling debug note for 252.
