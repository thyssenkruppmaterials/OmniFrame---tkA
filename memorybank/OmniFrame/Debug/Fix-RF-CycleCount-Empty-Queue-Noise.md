---
tags: [type/debug, status/active, domain/frontend, domain/api]
created: 2026-05-07
---
# Fix-RF-CycleCount-Empty-Queue-Noise

## Symptom

After `railway up` on 2026-05-07, the RF cycle count screen flooded the
browser console with a four-line stack on every claim attempt:

```
[WorkServiceClient] Server returned success=false: No tasks available
[useUnifiedCycleCount] Failed to claim task: No tasks available
[RFCycleCountUnified] Hook error: No tasks available
Uncaught (in promise) Error: No tasks available
    at De (feature-rf-interface-DIEdT2n-.js:32:3411)
```

The stack repeated continuously — every manual "Pull Next Count" tap
and every 3-second post-completion auto-advance fired four log lines.

## Diagnosis (Phase 1)

| Question | Answer | Evidence |
|---|---|---|
| `work_tasks` queue empty for tenant `c9d89a74`? | **No** — 12 pending + 1 in_progress | `SELECT status, task_type, count(*) FROM work_tasks WHERE organization_id = 'c9d89a74-…'` |
| Pending `rr_cyclecount_data` rows? | **3,515 pending** (huge backlog) | `SELECT status, count(*) FROM rr_cyclecount_data` |
| Dispatcher running on rust-work-service? | **Yes** — `cycle_count_data_changed` listener spawned 11:30:00Z | Railway log: `cycle_count listener spawned (LISTEN cycle_count_data_changed)` |
| HTTP status on empty queue? | **`200 OK`** with `{ success: false, message: "No tasks available", task: null }` | `rust-work-service/src/api/routes/work.rs:232-239` |
| Auto-retry cadence on the FE? | Not infinite — `useMutation` has no `retry` (default 0). Floods come from manual taps + 3s post-completion auto-advance, plus an unhandled rejection from `claimNext()` called without `.catch()`. | `useMutation` config in `use-unified-cycle-count.ts:341-365`; auto-advance at `rf-cycle-count-unified.tsx:706-723` |

### Why each line fired

| Line | Source |
|---|---|
| `[WorkServiceClient] Server returned success=false: No tasks available` | Generic `fetchWithAuth` in `client.ts` threw on every `success: false` body — including the canonical idle-queue signal. |
| `[useUnifiedCycleCount] Failed to claim task: No tasks available` | Hook's `handleError` re-logged the thrown error. |
| `[RFCycleCountUnified] Hook error: No tasks available` | Component's `onError` callback re-logged again. |
| `Uncaught (in promise) Error: No tasks available` | `claimNext()` in the auto-advance interval fired without `.catch()` → rejected promise escaped React. |

## Phase 2 — Noise fix (shipped)

Four minimal-blast-radius edits, FE only, no schema changes, no new
dependencies. The Rust route stays exactly as-is — `200 OK` +
`{ success: false, task: null }` is the contract.

### 1. `src/lib/work-service/client.ts`

Added `FetchWithAuthOptions.allowFalseSuccess?: boolean`. When `true`,
`fetchWithAuth` returns the body verbatim instead of throwing on
`success: false`, and downgrades the log to `logger.debug` (silent in
production — `logger.ts` filters debug out when `import.meta.env.PROD`).

`claimNext()` opts in: it's the one route where `success: false` is the
canonical idle signal, not an error. All other consumers of
`fetchWithAuth` keep the throw-on-success-false behaviour (covered by
the existing `getQueue` test which still asserts the throw).

### 2. `src/hooks/use-unified-cycle-count.ts`

- `claimMutation.onSuccess` now branches on `task === null` and calls
  `logger.debug(...)` instead of `toast.info('No tasks available')`.
  The parent component already renders a "Pull Next Count" landing UI
  when `currentTask === null` — the toast was redundant noise.
- `skipTask` previously relied on `claimMutateAsync()` THROWING on
  empty queue to trigger its "No more counts available right now"
  toast. With the new contract it RESOLVES with
  `{ success: false, task: null }` instead. Updated to inspect the
  resolved response AND keep the existing throw-handler for genuine
  errors (`ZONE_LOCKED`, `ZONE_ASSIGNED`, network).

### 3. `src/hooks/use-work-queue.ts`

Added a comment above the existing `claimMutation` documenting the new
contract. Code unchanged — the existing `if (task) … else …` branch
handles the resolved-empty case correctly out of the box.

### 4. `src/components/ui/rf-cycle-count-unified.tsx`

Wrapped the two fire-and-forget `claimNext()` callsites
(auto-advance interval + manual button) in
`Promise.resolve(claimNext()).catch(...)` with a `logger.warn`. The
empty-queue case no longer throws, but the `.catch` guards against any
future genuine-error regression and prevents the uncaught-rejection
escape. `Promise.resolve(...)` normalises sync mock returns from tests.

## Before / after console behaviour

| Scenario | Before | After |
|---|---|---|
| Empty queue, tap "Pull Next Count" once | 4 lines (`error`, `error`, `error`, `Uncaught error`) | 1 line (`debug` — invisible in production) |
| Empty queue, post-completion 3s auto-advance | 4 lines | 1 line (`debug`) |
| Genuine error (network 5xx, zone-locked, etc.) | Same 4 lines + toast | Same 4 lines + toast (unchanged — only the empty-queue branch differs) |

Per-minute log volume on a quiet shift, before vs after:
- Before: ~12 error lines / minute (3 manual retries × 4 lines)
- After:  0 error lines / minute (debug logs filtered in prod)

## Phase 3 — Product issue (deferred, see follow-up)

The noise fix is shipped. The genuine product issue surfaced by
this investigation is **scoped to a separate task** —
[[Investigate-Work-Tasks-Capacity-Gate-Returning-Existing-Task]].

Short version: Rust log shows `claim_next_task: capacity exhausted; returning None`
for user `8fe94172` even though they already have an in-progress task
that `claim_next_cycle_count` Phase 1 is supposed to return back to
them. The new capacity gate in `db/queries.rs::resolve_effective_capacity`
short-circuits BEFORE Phase 1 runs, so a worker who already holds 1
task can never re-claim their own row via `/claim` — they get
"No tasks available" instead. **Do not fix without explicit approval.**

## Quality gates

- `pnpm tsc -b --noEmit` — passes
- `pnpm build` — passes (10.46s)
- `npx eslint <touched files>` — 0 new warnings (1 pre-existing
  `react-hooks/exhaustive-deps` on `handleWsEvent` from prior PR)
- `pnpm vitest run src/lib/work-service src/features/rf-interface` —
  35/36 (1 pre-existing failure on `release-confirm` test, verified on
  baseline `main` HEAD before my edits)
- `client.test.ts` — 6/6 (added 2 new cases for `claimNext` empty +
  HTTP 5xx)

## Touched files

- `src/lib/work-service/client.ts`
- `src/lib/work-service/__tests__/client.test.ts` (+ 2 tests)
- `src/hooks/use-unified-cycle-count.ts`
- `src/hooks/use-work-queue.ts` (comment only — code already correct)
- `src/components/ui/rf-cycle-count-unified.tsx`

## Related

- [[Investigate-Work-Tasks-Capacity-Gate-Returning-Existing-Task]]
- [[Rust-Work-Service]]
- [[2026-05-07]]
