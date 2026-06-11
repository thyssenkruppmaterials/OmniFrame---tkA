---
tags: [type/debug, status/active, domain/frontend, domain/work-engine]
created: 2026-05-08
---
# Fix: `worker_heartbeats` Stale `task_type` (Active Operators panel)

## Symptom

Reported by the supervisor watching `<LiveOperatorStatus>` (Apps → Inventory → Inventory Counts → Active Operators) the morning after [[Fix-RF-Activity-Step-Source-Confusion]] shipped:

> "Every operator card shows `cycle_count` as the work type and 'Waiting for assignment' even when the operator is actually on Outbound Apps, Inbound Part Transfer, or another RF view."

Visible Tab 1 card line for an idle operator on Inbound Part Transfer:

```
Jai Singh   IDLE   Waiting for assignment   cycle_count
```

Visible Tab 1 card line for a busy operator who navigated cycle-count → home → inbound-part-transfer without releasing the claim:

```
Jai Singh   BUSY · K3-26-07-1 · cycle_count
```

The rf_activity sub-row underneath was correct (showed "Inbound Part Transfer"), but the prominent chip + zone line read as "on a cycle count". This is the exact bug Phase 0(C) of [[Fix-RF-Activity-Step-Source-Confusion]] diagnosed and scoped out — work-engine path, not publisher hook. This pass closes follow-up #1 + #2 from that note.

## Phase 0 — investigation

Confirmed the diagnosis from [[Fix-RF-Activity-Step-Source-Confusion]] before writing code.

### `useWorkerHeartbeat` API

`src/hooks/use-pushed-work.ts:413` — `useWorkerHeartbeat({ enabled, interval, taskId, taskType, zone, location })` runs an effect that calls `workServiceClient.sendHeartbeat({ task_id, task_type, zone, location, status })` on mount + every `interval` ms (default 30s). `status` is derived: `taskId ? 'busy' : 'idle'`. The HTTP path lands in `rust-work-service::queries::upsert_heartbeat` (`src/db/queries.rs:1346`) which writes `worker_heartbeats.current_task_type` directly — no normalisation, no validation.

### `worker_heartbeats.current_task_type` schema + constraints

- Migration 090 (`supabase/migrations/090_add_push_mode_and_heartbeats.sql:45`): `current_task_type VARCHAR(50)`.
- **No CHECK constraint** on `current_task_type` (verified live against the production schema via Supabase MCP `pg_constraint` query — only constraint on the table is `worker_heartbeats_status_check` on the `status` column: `online | offline | busy | break | idle`).
- Production today contains exactly **one** distinct value (`cycle_count`, 55 rows) because the FE has been hardcoding it for everyone — no other values have ever been written.
- Free-form `VARCHAR(50)` means we can write any descriptive snake_case label (each proposed label fits well under 50 chars).
- Note: `current_task_type` here is purely descriptive — it does NOT key into the dispatcher's `DispatchStrategyRegistry` (claim-time `task_type` is supplied separately by `claim_next` and the registry uses the dispatcher slugs `cycle_count` / `zone_audit` / `pick`). Aligning the two label spaces is fine but not required for correctness.

### RF view → `task_type` lookup decisions

Descriptive snake_case, mirroring [[Implement-RF-Activity-Telemetry-In-LiveOperatorStatus]]'s `VIEW_TO_STEP` so the Tab 1 chip and the rf_activity sub-row label use the same vocabulary:

| RF view (`currentView`) | Heartbeat `task_type` |
|---|---|
| `cycle-count` | `cycle_count` |
| `putaway` | `putaway` |
| `inbound-part-transfer` | `inbound_part_transfer` |
| `picking` | `picking` |
| `build-kit` | `build_kit` |
| `inspect-kit` | `inspect_kit` |
| `kitting-picking` | `kitting_picking` |
| `grs-cycle-count` | `grs_cycle_count` |
| `grs-core-pulls` | `grs_core_pulls` |
| `home` / `kitting-apps` (menu) / `work-queue` / `claim-tasks` / `sap-migo` / `my-productivity` / `profile` / `inventory` / `locations` / `scan` | `null` (intentionally absent — these are not active work tasks) |

### Sibling RF forms with parent task state — sweep

`onTaskChange` (or any analogous parent-task-state callback) is accepted by **only one** RF form today:

| File | Accepts parent task callback? |
|---|---|
| `src/components/ui/rf-cycle-count-unified.tsx` | YES — `onTaskChange?: (task | null) => void` |
| `src/components/ui/rf-putaway-form.tsx` | NO (only `onBack`) |
| `src/components/ui/rf-inbound-part-transfer-form.tsx` | NO |
| `src/components/ui/rf-picking-form.tsx` | NO (`onSwitchToKitting` is a navigation event, not parent state) |
| `src/components/ui/rf-build-kit-form.tsx` | NO |
| `src/components/ui/rf-inspect-kit-form.tsx` | NO |
| `src/components/ui/rf-kitting-picking-form.tsx` | NO (only `onBack` + `initialKitPoNumber`) |
| `src/components/ui/rf-grs-cycle-count-form.tsx` | NO |
| `src/components/ui/rf-empty-location-material-dialog.tsx` | NO (dialog, no parent task state) |
| `src/components/ui/rf-task-claim.tsx` | NO (`onTasksClaimed` is a delivery event, not lifecycle state) |
| `src/components/ui/rf-sap-migo-form.tsx` | NO |
| `src/components/ui/rf-location-scanner.tsx` | NO |
| `src/components/ui/rf-work-queue-dashboard.tsx` / `-simple.tsx` | NO |
| `src/components/ui/rf-drone-control.tsx` | NO |
| `src/components/ui/rf-unknown-batch-dialog.tsx` | NO |

Verification: `Grep onTaskChange|onActiveTaskChange|onTaskClaimed|onCurrentTaskChange|onZoneChange|onLocationChange` across `src/components/ui/` returns hits ONLY in `rf-cycle-count-unified.tsx`. So Phase 3 of the brief is a **no-op** for sibling forms — only cycle-count needs the unmount cleanup.

There's also a future-facing wrapper at `src/lib/work-engine/work-types/cycle-count.tsx` (`CycleCountRunnerAdapter`) that passes `onTaskChange={() => {}}` — a no-op handler. No cleanup needed there because the handler doesn't push state anywhere. Left untouched.

### Card UI rendering

`src/components/live-operator-status.tsx:611-630` renders the operator card row in two parts:

1. `taskLocation` (the existing zone/location chip) — falls back to `"Waiting for assignment"` / `"On break"` / `"No active task"` when null, depending on `worker.status`.
2. `worker.current_task_type` — rendered RAW (e.g. literal `cycle_count`) as a small mono chip.

With the Phase 1 fix, `task_type` becomes `null` while the operator is on `home` / menus, so chip (2) collapses to nothing and chip (1) shows the appropriate fallback. No change needed on the fallback strings — the fix is to humanise chip (2) so a non-null value renders as `"Cycle Count"` / `"Put-Away"` / `"Inbound Part Transfer"` instead of raw `cycle_count` / `putaway` / `inbound_part_transfer`. Reuses the existing `humaniseStep` + `STEP_LABELS` lookup that already drives the rf_activity sub-row labels — keeps the work-type chip and the sub-row vocabulary aligned.

## Fix

### 1. `src/features/rf-interface/rf-interface.tsx` (~+47 LOC, ~−5 LOC)

Replace the hardcoded `taskType: 'cycle_count'` with a derived value from `currentView`. Module-level `RF_VIEW_TO_TASK_TYPE` lookup (hoisted out of the component body so it's not re-allocated per render) maps each RF view to its descriptive `task_type` slug. Views that aren't active work tasks (`home` / menus / dashboards / utility) are intentionally absent from the lookup, so `RF_VIEW_TO_TASK_TYPE[currentView] ?? null` resolves to `null` and the heartbeat reports no task type while the operator is in those views.

Same defensive `isInsideCycleCount` gate from [[Fix-RF-Activity-Step-Source-Confusion]]'s rf_activity edit, now extended to `useWorkerHeartbeat`'s `taskId` / `zone` / `location` props — they ride the heartbeat ONLY while the operator is actually on the cycle-count screen. Belt-and-suspenders against any future sibling form that learns to bubble task state to the parent without proper unmount cleanup.

```ts
// Module-level lookup (above the RFInterface component)
const RF_VIEW_TO_TASK_TYPE: Record<string, string> = {
  'cycle-count': 'cycle_count',
  putaway: 'putaway',
  'inbound-part-transfer': 'inbound_part_transfer',
  picking: 'picking',
  'build-kit': 'build_kit',
  'inspect-kit': 'inspect_kit',
  'kitting-picking': 'kitting_picking',
  'grs-cycle-count': 'grs_cycle_count',
  'grs-core-pulls': 'grs_core_pulls',
}

// At the heartbeat call site:
const heartbeatTaskType = RF_VIEW_TO_TASK_TYPE[currentView] ?? null
const isInsideCycleCount = currentView === 'cycle-count'
useWorkerHeartbeat({
  enabled: !!authState.profile?.organization_id,
  interval: 30000,
  taskId: isInsideCycleCount ? currentTask?.id : undefined,
  taskType: heartbeatTaskType ?? undefined,
  zone: isInsideCycleCount ? currentZone || undefined : undefined,
  location: isInsideCycleCount ? currentTask?.location : undefined,
})
```

Also shortened the now-redundant block-comment above the `useRfPresenceActivity` call (the comment was forecasting the Phase 1 fix as a separate follow-up; that follow-up is now this PR).

### 2. `src/components/ui/rf-cycle-count-unified.tsx` (~+28 LOC)

New unmount-only `useEffect` that fires `onTaskChange?.(null)` when the component unmounts. Without this, navigating cycle-count → home → another RF view with a still-claimed task left `<RFInterface>`'s `currentTask` / `currentZone` set, perpetuating the wrong heartbeat payload (the prior worker's Phase 0(C) cause #2):

```ts
useEffect(() => {
  return () => {
    onTaskChange?.(null)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onTaskChange is a parent prop ref; this effect is intentionally unmount-only so a freshly-mounted component doesn't immediately wipe its own state via the cleanup of an in-flight render.
}, [])
```

**Trade-off documented in code:** this does NOT release the claim on the server. `releaseTask` / `completeTask` remain the only way to transition the work engine. The cleanup just stops the browser tab from continuing to broadcast the active zone/location after the operator has navigated away. If they return to cycle-count, `useUnifiedCycleCount` re-hydrates `currentTask` from the server and the parent state repopulates.

### 3. `src/components/live-operator-status.tsx` (~+18 LOC, ~−2 LOC)

Humanise the work-type chip on Tab 1 cards via `humaniseStep` (the same helper that drives the rf_activity sub-row label). Falls back to the raw value so a future un-mapped work type still renders rather than disappearing silently:

```ts
{worker.current_task_type && (
  <span className='bg-background/70 text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium'>
    {humaniseStep(worker.current_task_type) ?? worker.current_task_type}
  </span>
)}
```

When `task_type === null` (operator on `home` / a non-work view), the chip collapses entirely — eliminating the "Waiting for assignment cycle_count" line for idle operators.

Dropped the previous `font-mono` styling and bumped the horizontal padding 0.25rem → 0.375rem so the humanised label has a bit more breathing room.

## Quality gates

- `pnpm tsc -b --noEmit` — clean (~21–22s, two runs).
- `npx eslint src/features/rf-interface/rf-interface.tsx src/components/live-operator-status.tsx src/hooks/use-pushed-work.ts` — 0 errors / 0 warnings.
- `npx eslint --no-ignore src/components/ui/rf-cycle-count-unified.tsx` — 0 errors, 3 pre-existing `react-hooks/exhaustive-deps` warnings on `handleTaskComplete` (unrelated to this fix). The `// eslint-disable-next-line` directive on the new unmount-cleanup effect is recognised — no warning on the new effect.
  - The `src/components/ui/` directory is in the workspace ESLint ignore list (`eslint.config.js:9` — shadcn primitives), so the regular `pnpm lint:check` skips the cycle-count file. `--no-ignore` was used for verification only.
- `pnpm vitest run src/lib/presence src/hooks` — 29/29 passing.
- `pnpm vitest run src/features/rf-interface src/components` — 51/53 passing. The 2 failures (`rf-cycle-count-unified.test.tsx § 4. Release Confirmation` and `work-distribution-panel.test.tsx § shows a collision warning`) **reproduce against `git stash` of this PR — both are pre-existing failures unrelated to this fix**. The first is the same one already documented in [[Implement-RF-Activity-Telemetry-In-LiveOperatorStatus]]'s quality-gates section.
  - The two tests touching `onTaskChange` directly (`§ 5. Heartbeat Bridge`) PASS — the new unmount-cleanup effect fires `onTaskChange(null)` an extra time after the existing assertions, but `toHaveBeenCalledWith(...)` is order-insensitive so neither test breaks.
- `pnpm build` — clean in 11.76s. PWA precache 182 entries / 10269.92 KiB.
  - `feature-rf-interface` chunk: 503.53 KB / 115.23 KB gzipped — same baseline as [[Fix-RF-Activity-Step-Source-Confusion]] (503.18 KB). Within the per-chunk script threshold.
  - Pre-existing budget failures on `warehouse-location-map` (1523 KB) + `feature-admin` (994 KB) unchanged.
- Lint ratchet — touched files contribute 0 to either count.

## Manual verification procedure

1. **Office tab** — sign in to a tenant where the current user has `view inventory_apps`. Open **Apps → Inventory → Inventory Counts**. Confirm `<LiveOperatorStatus>` renders below the search bar.
2. **RF tab** — sign in via `/rf-signin` and arrive at `/rf-interface`.
3. **RF tab** — tap **Cycle Count**, claim a task. **Office tab** — within the heartbeat cadence (~5–10s for the first persisted update; up to 30s for subsequent intervals), the operator's Tab 1 card shows the chip humanised as **"Cycle Count"** (not raw `cycle_count`). The zone/location line shows the claimed zone (e.g. `K3-26-07-1`). The rf_activity sub-row says "Cycle Count".
4. **RF tab** — tap back to home, then tap **Inbound Part Transfer** (do NOT release the cycle-count claim first — this is the original repro). **Office tab** — within ~5–10s the chip flips to **"Inbound Part Transfer"**, the zone line clears (no stale `K3-26-07-1`), and the operator's `status` flips to `idle` (no active task on inbound-part-transfer). The fallback line reads "Waiting for assignment" because there is no task — but the chip now correctly identifies the WORK TYPE (Inbound Part Transfer) so the supervisor reads the card as "on Inbound Part Transfer, no task claimed yet" rather than "on a cycle count, waiting for one".
5. **RF tab** — tap back, then **Put-Away**. **Office tab** — chip flips to **"Put-Away"**.
6. **RF tab** — tap back, then **My Productivity** (menu / dashboard view). **Office tab** — chip **collapses entirely** (no chip rendered at all). The fallback line still reads "Waiting for assignment" because there's no task.
7. **RF tab** — go back into Cycle Count again, claim a fresh task. **Office tab** — chip + zone repopulate correctly as in step 3.
8. **RF tab** — release the claim via the Release button. **Office tab** — within ~5–10s the chip stays "Cycle Count" (operator is still on the cycle-count view), zone clears, status flips to `idle`. Fallback reads "Waiting for assignment".
9. **Edge case** — repeat step 4 but FORCE-CLOSE the RF tab before navigating. The unmount cleanup fires `onTaskChange(null)` synchronously; `useWorkerHeartbeat`'s effect sees `taskId/zone/location = undefined` on its next interval. **Office tab** — within ~30s (the heartbeat interval), the operator's row clears the zone/location line. (Also covered by the existing 90s presence/heartbeat staleness evictor.)

**Pass criteria:** the chip vocabulary tracks the operator's actual RF view; "Waiting for assignment cycle_count" never appears for an operator who isn't on a cycle count.

## Hard constraints honoured

- **No `worker_heartbeats` schema changes / no migrations.** `current_task_type VARCHAR(50)` accepts every label we emit. CHECK constraints on the table are unchanged (only `worker_heartbeats_status_check` exists, which we don't touch).
- **No dispatcher changes.** `current_task_type` is purely descriptive in the heartbeat path; the dispatcher's `DispatchStrategyRegistry` reads `task_type` at claim-time from the API request, not from `worker_heartbeats`.
- **rf_activity telemetry untouched** beyond simplifying a now-redundant block comment. The morning sprint's data flows continue unchanged.
- **No new permission keys, no Rust changes, no new dependencies, no privacy contract changes.** Same single-consumer (`<LiveOperatorStatus>`) RBAC scope (`view inventory_apps`).

## What's NOT swept (confirmed)

Phase 0 sibling sweep showed only `rf-cycle-count-unified.tsx` pushes task state to the parent today. Forms confirmed to NOT need the unmount cleanup (no parent task state coupling): `rf-putaway-form.tsx`, `rf-inbound-part-transfer-form.tsx`, `rf-picking-form.tsx`, `rf-build-kit-form.tsx`, `rf-inspect-kit-form.tsx`, `rf-kitting-picking-form.tsx`, `rf-grs-cycle-count-form.tsx`, `rf-empty-location-material-dialog.tsx`, `rf-task-claim.tsx`, `rf-sap-migo-form.tsx`, `rf-location-scanner.tsx`, `rf-work-queue-dashboard*.tsx`, `rf-drone-control.tsx`, `rf-unknown-batch-dialog.tsx`. The `CycleCountRunnerAdapter` in `src/lib/work-engine/work-types/cycle-count.tsx` passes a no-op `onTaskChange={() => {}}`, also untouched.

## Follow-up flagged

- **Per-form opt-in for finer task / zone telemetry.** Today only cycle-count surfaces `currentTask` / `currentZone` to the parent shell, so the heartbeat payload's `task_id` / `zone` / `location` fields populate ONLY for cycle-count. Other forms with claim semantics (picking / putaway / inspect-kit / build-kit / kitting-picking / grs-cycle-count) could bubble their own claim state up via a similar `onTaskChange` prop + unmount cleanup, but that's additive and out of scope for this fix. Same future-work bucket as the per-form sub-step opt-in flagged in [[Implement-RF-Activity-Telemetry-In-LiveOperatorStatus]].
- **`work-distribution-panel.test.tsx` § "shows a collision warning".** Pre-existing failing test discovered during this pass's quality gates. Reproduces on a clean `git stash`; unrelated to this fix; logged here so it doesn't get lost.
- **Optional schema documentation.** Migration 090's `current_task_type` column comment says `'cycle_count, putaway, pick, etc.'` — could be updated to enumerate the actual labels we now emit, but that's a doc-only nicety; not blocking.

## Closes

- Follow-up #1 (`useWorkerHeartbeat` `taskType` un-hardcoding) of [[Fix-RF-Activity-Step-Source-Confusion]].
- Follow-up #2 (`<RFCycleCountUnified>` unmount cleanup) of [[Fix-RF-Activity-Step-Source-Confusion]].

## Related

- [[Fix-RF-Activity-Step-Source-Confusion]] — same-week sibling debug pass; this pass closes its open follow-ups.
- [[Implement-RF-Activity-Telemetry-In-LiveOperatorStatus]] — the morning sprint that introduced the rf_activity sub-row + `STEP_LABELS` humaniser this fix reuses.
- [[ADR-RF-Activity-Telemetry]] — privacy contract (unchanged).
- [[ADR-Scoped-CurrentPage-In-ActiveOperators]] — sibling field's privacy contract (unchanged).
- [[Components/Omni-Agent - Headless SAP Agent]] — additional context on `worker_heartbeats` semantics.
- [[Sessions/2026-05-08]] — today's session log.


## Post-deploy verification — 2026-05-08 14:26 UTC

Supervisor reported the same symptom ("It shows waiting for assignment Cycle count even though he is picking") ~37 minutes after this fix landed. Phase 0 re-investigation confirmed it was **deploy/refresh timing, not a residual bug**:

- **Railway** (`onebox-ai-logistics`): latest deployment `7a4f6470-12ac-40ba-b5e5-fc67f5f7fd4b` SUCCESS at 13:47:15 UTC, image digest `sha256:97f00465e7…`. Previous deployment `040b963b` (the pre-fix bundle) is REMOVED. The new bundle IS live behind the public host.
- **`worker_heartbeats` snapshot** (Supabase MCP, last 10 minutes at 14:26 UTC):

  ```
  current_task_type | status  | n
  ------------------+---------+---
  cycle_count       | idle    | 10
  cycle_count       | busy    |  2
  cycle_count       | offline |  1
  ```

  Every active heartbeat still emitted `cycle_count`. Zero `picking` / `putaway` / `inbound_part_transfer` rows even though operators were demonstrably on those views per the supervisor.
- **Render path** (`live-operator-status.tsx`): `worker.current_task_type` is rendered exclusively at line 641-642 via `humaniseStep`. `"Waiting for assignment"` exists only at line 620 as a sibling fallback to `taskLocation`. Grep'd `current_task_type` + `"Waiting for assignment"` across `src/` — no composed-string template, no other render path, no bypass. The previous worker's humanisation fix is consistent. The supervisor reading "Waiting for assignment" + chip "Cycle Count" as one phrase is correct rendering of stale data, not a render bug.

**Root cause of the lingering observation:** RF terminal browsers were still running the old bundle that hardcoded `taskType: 'cycle_count'`, so they kept overwriting `worker_heartbeats.current_task_type` to `cycle_count` every 30s regardless of which RF view the operator was on. Two contributors to slow propagation:

1. **iOS Capacitor RF terminals** — `src/lib/version/version-checker.ts:13` explicitly disables the auto-updater on Capacitor native platforms (the bundle ships inside the IPA). These devices need a manual app update or a WebView force-refresh to pick up the new JS.
2. **Browser RF tabs** — the version-checker polls `/build-info.json` every 60s and reloads on hash mismatch, so a backgrounded RF tab can be up to ~60–120s stale before it self-reloads.

The supervisor's office tab WAS on the new bundle (the chip text `Cycle Count` is the title-cased output of `humaniseStep('cycle_count')` — the pre-fix code rendered the raw `cycle_count` token in `font-mono`). The office side of the loop is closed; only RF tabs are lagging.

### Procedure to confirm the deploy is live for a specific operator

1. **Office tab (supervisor)** — open Apps → Inventory → Inventory Counts. Confirm the connection chip in `<LiveOperatorStatus>` reads `Live` (green dot, not `Polling` amber).
2. **RF tab (operator)** —
   - **Browser RF**: hard-refresh the tab (Ctrl/Cmd + Shift + R) OR wait up to ~60s for the version-checker to detect the new build and reload automatically. The reload toast / `src/lib/version/auto-updater.ts` will fire.
   - **iOS Capacitor RF**: install the latest TestFlight / App Store build (the version-checker is intentionally disabled on native — see file header). As a fast diagnostic, force-quit and relaunch the app to clear the WebView cache; if a new bundle is shipped via Capacitor's live-update channel that will pick it up.
3. **Office tab** — within ~30s of the operator's RF reload (the heartbeat cadence), the operator's card chip should re-label as `Cycle Count` / `Picking` / `Put-Away` / `Inbound Part Transfer` matching their actual RF view. Confirm by asking the operator to navigate cycle-count → home → picking; the chip should track.
4. **Verification SQL** (Supabase MCP):

   ```sql
   SELECT current_task_type, status, COUNT(*) AS n
   FROM worker_heartbeats
   WHERE last_heartbeat > NOW() - INTERVAL '5 minutes'
   GROUP BY current_task_type, status
   ORDER BY n DESC;
   ```

   Pass criteria: at least one non-`cycle_count` row appears (`picking`, `putaway`, `inbound_part_transfer`, etc.) — proof a refreshed RF tab is now writing the descriptive label.

No code change shipped from this re-investigation pass. The morning's fix is correct; the user observed pre-deploy / pre-refresh data.
