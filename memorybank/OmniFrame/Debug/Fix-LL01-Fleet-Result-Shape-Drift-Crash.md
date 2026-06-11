---
tags: [type/debug, status/active, domain/frontend, sap, ll01, fleet]
created: 2026-05-31
---
# Fix: LL01 Warehouse Activity Monitor — Fleet Result Shape-Drift Crash

## Symptom
Running **Warehouse Activity Monitor** (LL01) from the Inventory Management tab
crashed the whole SAP Testing page into the error-boundary ("500") screen.
Browser console:
```
index-*.js TypeError: Cannot read properties of undefined (reading 'find')
    at feature-admin-sap-*.js (Wd / HeatmapTab)
    at Array.map (<anonymous>)
```
(The `127.0.0.1:8765/health` `ERR_CONNECTION_REFUSED` lines are the expected
local-agent probe in fleet mode — not the crash. The notifications `404` is
unrelated noise.)

## Cause — shape drift at the dispatch boundary
`HeatmapTab` renders inside `LL01_CATEGORY_META.map(...)`:
```ts
const cat = result?.categories.find((c) => c.key === meta.key)
```
Optional chaining `result?.categories.find` only guards a **null** `result`.
When `result` is truthy but `result.categories` is `undefined`, `result?.categories`
evaluates to `undefined`, then `.find` throws.

How a truthy result with no `categories` reaches the render:
- Fleet path (`use-execution-mode.ts` `dispatch`) unwraps the job row as
  `{ ok: finalRow.status === 'completed', error, step, ...(finalRow.result ?? {}) }`.
- A **failed / result-less** job (offline-agent reclaim, claim-lease watchdog,
  non-LL01 error body) has `finalRow.result === null`, so the unwrapped object is
  just `{ ok: false, error, step }` — **no `categories` / `plants` / `errors`**.
- The local path has the same gap when the agent returns a non-2xx error body.
- `inventory-management-tab.tsx` did `setLl01Result(data)` with that drifted
  object; the next render of `HeatmapTab` crashed.

`data.ok === false` skips the success branch (`data.categories.reduce`), so the
crash surfaces in render, not in the run handler.

## Fix — normalize at the boundary (+ defensive render guards)
Primary fix, matching [[Fix-MapStatistics-Shape-Drift]]: coerce the dispatched
result into a well-formed `LL01RunResult` at the **one** boundary, not at every
call site.
```ts
// inventory-management-tab.tsx — after executionMode.dispatch<LL01RunResult>(…)
const raw = data as Partial<LL01RunResult> & { ok: boolean; error?: string }
const ll01: LL01RunResult = {
  ok: raw.ok,
  payload_version: raw.payload_version,
  snapshot_run_id: raw.snapshot_run_id ?? '',
  ran_at: raw.ran_at ?? new Date().toISOString(),
  agent_id: raw.agent_id ?? '',
  duration_ms: raw.duration_ms ?? 0,
  plants: raw.plants ?? [],
  categories: raw.categories ?? [],
  errors: raw.errors ?? [],
}
setLl01Result(ll01)
// success branch now gated on `ll01.ok && ll01.categories.length > 0`;
// failure path pushes the error to the SAP console card too.
```
Belt-and-braces (so future drift renders zeros instead of white-screening):
- `HeatmapTab.tsx` — `result?.categories?.find(...)` (3 sites), drawer
  `result.categories?.find(...)` + `(cat.rows ?? []).filter(...)`.
- `AgingTab.tsx` — `result?.categories?.find(...)`, `(category.rows ?? []).filter`,
  `for (const row of category.rows ?? [])` (×2).

## Verification
- New regression test in `__tests__/warehouse-activity-monitor.test.tsx`:
  "does not crash when a drifted result is missing categories" — renders
  `HeatmapTab` with `{ ok: false, error } as LL01RunResult` and asserts no throw.
- `pnpm vitest run` on `warehouse-activity-monitor.test.tsx` (8) + `aging-tab.test.tsx` (8) — all pass.
- ESLint clean on the three edited source files (one pre-existing `min-w-[3rem]`
  Tailwind warning left untouched — not introduced by this change).

## Lesson
Optional chaining guards only the operand it's attached to. `a?.b.c` still throws
when `a.b` is undefined. When a normalized dispatch result *can* legitimately drop
fields (fleet job failed, agent wrote no result body), **normalize once at the
boundary** so the render layer only ever sees the typed shape.

## Follow-up (2026-05-31) — failed run collapsed the heatmap grid
After the crash fix, a failed run (ok:false) no longer white-screened but
rendered a **misleading collapsed grid**: only Category / Trend / Total columns,
all zeros, with the **plant columns (JSF/JSM/PDC/WH5/WH8) gone**.

Cause: the boundary normalization sets `plants: []` on a failed/result-less run.
`HeatmapTab` (and `AgingTab`) computed columns as
`(result?.plants ?? [...LL01_PLANTS])` — `??` only catches null/undefined, so an
**empty array stayed empty** and `plants.map(...)` rendered zero columns. An
all-zeros grid for a failed run is also indistinguishable from a genuine "zero
issues" run.

Fix:
- Treat empty `plants` the same as missing — fall back to `LL01_PLANTS`:
  `result?.plants && result.plants.length > 0 ? result.plants : [...LL01_PLANTS]`
  (HeatmapTab + AgingTab). Columns never collapse again.
- Surface the reason: normalization now lifts the dispatch-level `error`/`step`
  into `errors[]` on a failed run; `HeatmapTab` shows a red "Last run didn't
  complete — {reason}" banner, and `AgingTab` shows a matching failure state
  instead of the misleading "older agent build" fallback.
- Hardened `result.errors?.[0]?.detail` so a legacy/malformed result can't
  reintroduce a crash.
Regression test: "keeps plant columns and shows a failure banner on a failed
run" in `warehouse-activity-monitor.test.tsx`.

## Related
- [[Fix-MapStatistics-Shape-Drift]] — same class (typed contract ↔ JSON drift).
- [[Implementations/Implement-LL01-Warehouse-Activity-Monitor]] — feature anchor.
- [[Implementations/Implement-Inventory-Management-Fleet-Routing]] — `dispatch` unwrap.
- [[Patterns/Fleet-Aware-Smart-Routing]]
