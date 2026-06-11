---
tags: [type/implementation, status/active, domain/frontend, domain/backend, sap, ll01]
created: 2026-05-31
---
# Implement LL01 Run History — Save & Date-Picker Re-Reference

Follow-up to [[Implement-LL01-Warehouse-Activity-Monitor]]. Adds the ability to
**save every Warehouse Activity Monitor run at full fidelity** and **reload any
past run** from a date picker next to "Run Query" — drill-down rows + Aging tab
included.

## Problem
`ll01_activity_snapshots` (migration 326) only persists **counts** (5 plants ×
7 categories per run) — enough for the Trend tab but not the Heatmap drill-down
slide-over or the Aging tab, both of which derive from `categories[].rows`. That
row detail lived only in the live run response and was lost on the next run.

## Decisions (user-approved 2026-05-31)
- **Fidelity:** full — historical runs must support drill-down + Aging.
- **Retention:** keep every run indefinitely (no prune).
- **Write path:** agent-write (consistent with the counts insert; durable;
  survives tab close). **Requires an agent EXE rebuild** — full history only
  accrues for runs by the new build; older runs stay counts-only in Trend.

## Data model — one JSONB row per run
New table **`ll01_activity_runs`** (migration `333_create_ll01_activity_runs.sql`,
applied via Supabase MCP). One row = the exact `LL01RunResult`:
`plants` / `categories` (incl. `rows`) / `errors` as JSONB + `ok`,
`payload_version`, `duration_ms`, `agent_id`, `ran_at`. Unique
(organization_id, snapshot_run_id); index (organization_id, ran_at DESC); RLS
org-read + org-insert mirroring `ll01_activity_snapshots`. The counts table is
left untouched — Trend keeps using it (cheap aggregate). Chose a single-JSONB
table over a normalized rows table because the UI computes every aggregate
client-side from `rows`; perfect reconstruction with no shred/regroup.

## Write path
`omni_agent/ll01_warehouse_activity_monitor.py` — new `_insert_run(...)` posts
the full payload to `ll01_activity_runs`, called in its own `try` right after
the existing `_insert_snapshots(...)` (independent so one failing never skips
the other). `payload_version` hoisted to a local var, reused by both the insert
and the response. Idempotent on re-run via the `resolution=merge-duplicates`
Prefer header already in `_supabase_post` (run ids are fresh uuid4 per call, so
collisions don't happen in the normal path anyway).

## Frontend
- **`hooks/use-ll01-history.ts`** (`useLL01History`) — slim INDEX query
  (`snapshot_run_id, ran_at, ok`, newest-first, capped 730) + lazy `loadRun`
  that fetches one full payload and normalizes it to `LL01RunResult` (same
  boundary-normalization discipline as the live dispatch — see
  [[Fix-LL01-Fleet-Result-Shape-Drift-Crash]]). `from` cast through `unknown`
  (table not in `database.types.ts`, regen deferred — matches the snapshots
  fetch).
- **`components/ll01-history-picker.tsx`** (`LL01HistoryPicker`) — Popover +
  shadcn Calendar; only days with a saved run are enabled; a day with one run
  loads immediately, a day with several reveals a per-time list; a "Current run"
  item clears the selection. Trigger shows the selected run's timestamp (or
  "History"); disabled with a hint when no runs exist yet.
- **`inventory-management-tab.tsx`** — `useLL01History(orgId)` +
  `ll01ViewedRunId` / `ll01ViewedRun` / `ll01ViewedLoading` state +
  `selectLl01HistoryRun`. Picker rendered next to Run Query (LL01 only). View
  receives `effectiveResult = ll01ViewedRun ?? ll01Result` and `lastRunAt =
  viewed.ran_at ?? lastRunAt`. A completed live run snaps back to live and
  `refreshIndex()`es so the new run appears immediately.
- **`warehouse-activity-monitor-view.tsx`** — new `isHistorical` /
  `historicalLoading` / `onExitHistorical` props; amber "Viewing saved run
  from {date}" banner with a "Back to current run" button (rendered as the
  first child of `Tabs`, before `TabsList` — no re-indent of the tab content).
- **`warehouse-activity-monitor-types.ts`** — new `LL01RunIndexEntry` (slim
  index row).

## Tests
- `omni_agent/tests/test_ll01_run_persistence.py` (2) — `_insert_run` posts one
  row to `ll01_activity_runs` with full `categories[].rows` preserved; no-token
  skip path.
- `components/__tests__/ll01-history-picker.test.tsx` (4) — disabled with no
  runs; trigger relabels on selection; "Current run" clears to live; multi-run
  day surfaces the time list.
- `pnpm exec tsc -b` clean; full `src/features/admin/sap-testing` suite (20)
  green.

## Caveats / follow-ups
- **Agent EXE rebuild required** before history accrues; runs from the old build
  remain counts-only (visible in Trend, not selectable in the picker).
- `database.types.ts` regen still deferred (consistent with the snapshots table).
- Retention is unbounded by decision; if storage becomes a concern later, a
  rolling-window prune + "pin to keep" is the natural next step.

## Fleet-mode progress bar (2026-05-31, FE-only)
LOCAL mode polls the agent's `/sap/ll01/warehouse-activity/progress` endpoint;
FLEET mode can't (the Citrix agent isn't browser-reachable), so the bar froze at
"Fetching all N plants…". Fix without any agent/rust change: the agent already
relays stdout via `WsEvent::SapAgentConsoleLine` (org-scoped work-service WS) and
the worker prints `[ll01] Plant X/Y: PLANT` per plant. New `useLL01FleetProgress`
hook taps that stream; pure `parseLL01PlantLine` (in
`warehouse-activity-monitor-types.ts`, dependency-free for testability) turns the
line into `LL01Progress`; the view uses
`effectiveProgress = fleetProgress ?? pollProgress ?? progress`. Per-plant
granularity matches "as warehouses complete"; finer per-category would need an
agent-side console line (deferred). Tolerant parse — unknown lines ignored.
Tests: `hooks/__tests__/use-ll01-fleet-progress.test.ts` (6). See
[[Debug/Fix-LL01-Watchdog-120s-Timeout]] (the watchdog fix is what lets a fleet
run survive long enough to emit all 5 plant ticks).

## Related
- [[Implement-LL01-Warehouse-Activity-Monitor]] / [[LL01-Aging-Breakdown]]
- [[Fix-LL01-Fleet-Result-Shape-Drift-Crash]] (boundary-normalization pattern reused)
- [[Fix-LL01-Watchdog-120s-Timeout]] (per-endpoint watchdog budget — unblocks long fleet runs)
- [[Implement-Inventory-Management-Fleet-Routing]]
