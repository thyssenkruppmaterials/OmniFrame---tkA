---
tags: [type/implementation, status/active, domain/frontend, domain/realtime]
created: 2026-05-07
---
# Implementation: RF Activity Telemetry on `<LiveOperatorStatus>`

FE-only sprint (no Rust changes — the loose `serde_json::Value` payload Worker 1 shipped in [[Implement-Presence-On-Rust-Option-2]] carries the new nested object verbatim) extending the supervisor's Active Operators panel with granular RF activity telemetry. Realises [[ADR-RF-Activity-Telemetry]].

## Why

Third in the same-week presence-evolution train:

1. [[Re-Enable-CurrentPage-In-ActiveOperators]] (2026-05-07 morning) — supervisors see *what page* an operator is on.
2. [[Implement-LiveOperatorStatus-InBuilding-Tab]] (2026-05-07 mid-day) — supervisors see *who else is in the building* (presence union minus work-engine).
3. **This sprint (2026-05-07 evening)** — supervisors see *what RF operators are actually doing* (current workflow step, last scan, idle indicator, work task / zone).

The user's exact ask: *"I want to extend `<LiveOperatorStatus>` with granular RF activity telemetry so the panel shows current workflow step, last scan, idle state, and work task context — not just 'on RF: Cycle Count' but 'Scanning Material · last scan: K3-08 · 25s ago'."*

ADR with the privacy contract + alternatives: [[ADR-RF-Activity-Telemetry]].

## Phase 0 — RF workflow investigation

**The findings determined the implementation strategy.** No code was written until Phase 0 was complete.

### State machine (no central source)

The RF tree has no single state machine across all forms:

- **Cycle count** (`rf-cycle-count-unified.tsx`, ~2825 LOC) drives via `useUnifiedCycleCount`. Local `useState<WorkflowStep>(1..5)` for the 5-step Confirm → Location → Count → Review → Complete flow. Sub-step state for `'pre_extras' | 'post_extras'` for the configured extras hook.
- **Put-away / Build-Kit / Inspect-Kit / Kitting-Picking / GRS** — each form has its OWN bespoke `useState({...currentStep})` machine. `rf-putaway-form.tsx:271` sets `currentStep: 1`; advance/retreat handlers mutate local state inline.
- **Pick / Zone-Audit** (newer work types) — use `useTaskWorkflowRuntime<T>` (`src/hooks/use-task-workflow-runtime.ts`). Generic step navigation; `recordResult` / `advance` / `retreat` / `completeTask` / `releaseTask`. NOT a unified runtime across all RF forms.

### Scan completion (handled per-form)

No central event bus. Each form has its own `handleLocationScan`, `handleScan*`, `handleQuantitySubmit` callbacks. `<ScannerInput>` (`src/components/ui/scanner-input.tsx`) is a styled `<input>` with `inputMode='none'` + `data-slot="scanner-input"` — no event normalization.

### Idle detection (presence-side only)

The presence service already runs an `IdleDetector` (`IDLE_TIMEOUT = 5min`). No RF-specific idle detector. Acceptable to reuse the presence-side detector + add a sub-minute `last_input_at` ref maintained by the activity hook for the panel's idle/live indicator.

### Task lifecycle (semi-central)

`<RFInterface>` parent state holds `currentTask: {id, location} | null` and `currentZone: string | null` — but ONLY for cycle-count (other forms keep task state in their own components). The parent's heartbeat path (`useWorkerHeartbeat`) consumes this; the activity hook reuses the same source.

### Sign-in path (one separate route)

`/rf-signin` is a sibling route to `/rf-interface` (separate `RFLayout` mount). Pre-auth. Stays kiosk-opted-out by design — no value broadcasting "on sign-in screen" before the operator authenticates.

### Critical architectural finding

**`/rf-interface` is OUTSIDE `_authenticated`**. Today's `<PresenceProvider>` mounts at `<AuthenticatedLayout>` only — RF tabs were doubly-opted-out: by the kiosk constant AND by not mounting the provider. Narrowing the constant alone would have done nothing. The implementation enrolls `<RFLayout>` in `<PresenceProvider>` to fix this.

### Phase 0 verdict: **partial blocker**, achievable scope identified

The "if Phase 0 reveals a blocker, STOP" gate triggered for **per-form sub-step granularity** (would require touching 8–12 forms). It did NOT trigger for the work-type-level telemetry surface, which is achievable with one parent-level hook + a document-level scan listener delegate. The user's ADR allows this trade-off (the field types are explicitly permissive: `last_scan.type` as `'material' | 'bin' | 'to_number' | 'serial' | string`). Sub-step granularity is staged as additive future work — forms can call `presenceService.updateRfActivity(...)` directly when ready, and the consumer-side `STEP_LABELS` lookup already includes labels for those future steps.

## End-to-end

```
<RFInterface>  (parent of all RF screens)
  │
  ├── useRfPresenceActivity({ currentView, workTaskId, workZone })
  │     │
  │     ├─ prop sync → stepRef / taskRef / zoneRef → presenceService.updateRfActivity(...)
  │     │
  │     ├─ document keydown listener (capture)
  │     │     └─ Enter on data-slot="scanner-input" → lastScanRef → broadcast
  │     │     └─ every keydown → lastInputAtRef (throttled 1/s, no broadcast)
  │     │
  │     └─ document pointerdown listener (capture)
  │           └─ every pointerdown → lastInputAtRef
  │
  └── unmount → presenceService.updateRfActivity(null) (clears panel)

        ↓

presenceService (singleton; PresenceService or PresenceServiceRust)
  │
  ├─ updateRfActivity(activity)
  │     │
  │     ├─ rfActivityShapeEqual(prev, activity)?
  │     │     └─ yes → in-place update last_input_at, NO broadcast
  │     │     └─ no  → mutate currentPayload.rf_activity, scheduleTrack/Heartbeat
  │
  └─ next debounced heartbeat carries the new payload to Rust/Supabase

        ↓

<LiveOperatorStatus>  (Inventory Counts tab, RBAC-gated)
  │
  ├─ Tab 1 ("On Counts") — <OperatorCard rfActivity={presenceUser.rf_activity}>
  │     └─ <RfActivityRow> sub-row — step · last scan · idle/live indicator
  │
  └─ Tab 2 ("In Building") — <PresenceUserCard>
        └─ <RfActivityIndicator> inline icon (tooltip with snapshot)
```

## File deltas

| File | Change |
|---|---|
| `src/lib/presence/types.ts` | +`rf_activity?: PresenceRfActivity \| null` on both `PresencePayload` and `PresenceUser`. New `PresenceRfActivity` interface with `current_step` / `last_scan` / `work_task_id` / `work_zone` / `last_input_at` fields. Privacy contract block-comment update. ~+85 LOC. |
| `src/lib/presence/constants.ts` | Narrowed `PRESENCE_KIOSK_ROUTE_PATTERNS` from `/^\/rf-/` to `/^\/rf-signin(\/|$)/`. JSDoc updated with the 2026-05-07 narrowing rationale + ADR pointer. ~+15 LOC. |
| `src/lib/presence/presence.service.ts` (Supabase mode) | Seeded `rf_activity: null` in initial payload. Added `updateRfActivity(activity)` method with idempotence on shape (`current_step` + `work_task_id` + `work_zone` + `last_scan`). Module-level `rfActivityShapeEqual` helper. ~+55 LOC. |
| `src/lib/presence/presence.service.rust.ts` (Option 2) | Mirror of the Supabase change — seed + `updateRfActivity` + sibling `rfActivityShapeEqual` helper. Routes through `scheduleHeartbeat()`. ~+55 LOC. |
| `src/hooks/use-rf-presence-activity.ts` | NEW (~210 LOC). The publisher hook — `useRfPresenceActivity({ currentView, workTaskId, workZone })`. Mounted once in `<RFInterface>`. Wires the parent state → step label via `VIEW_TO_STEP` lookup. Document-level capture-phase keydown + pointerdown listeners for `last_input_at` (throttled 1/s) + `last_scan` capture (delegated on `data-slot="scanner-input"` Enter). Cleanup on unmount calls `updateRfActivity(null)`. NO-OP when `presenceService.isDisabled`. |
| `src/features/rf-interface/rf-interface.tsx` | +1 import, +1 hook call (`useRfPresenceActivity({ currentView, workTaskId: currentTask?.id ?? null, workZone: currentZone })`) alongside the existing `useWorkerHeartbeat`. ~+15 LOC. |
| `src/features/rf-interface/rf-layout.tsx` | +1 import (`PresenceProvider`), wrapped `<Outlet />` with `<PresenceProvider>`. Block-comment explaining the 2026-05-07 enrolment. RF tabs were OUTSIDE `_authenticated`'s provider mount; this change makes them participate in presence. ~+15 LOC. |
| `src/components/live-operator-status.tsx` | Added imports (`Radar`, `Scan`, `useEffect`, `PresenceRfActivity`). New module-level helpers: `humaniseStep` + `STEP_LABELS` lookup, `freshnessFromLastInput`, `useNowTicker` (5s ticker for visual freshness), `shortAge`. New components: `<RfActivityRow>` (Tab 1 sub-row) and `<RfActivityIndicator>` (Tab 2 inline icon + tooltip). Threaded `rfActivity` prop through `<OperatorCard>` (read from `presence?.getUserPresence(worker.user_id)?.rf_activity`). Tab 2 `<PresenceUserCard>` reads `user.rf_activity`. ~+250 LOC. |

## Privacy guard — grep contract

A grep for `rf_activity\|RfActivity\|rfActivity` in `src/` after this change returns ONLY:

```
src/lib/presence/types.ts                    declaration + privacy block comment
src/lib/presence/presence.service.ts         broadcaster (Supabase mode)
src/lib/presence/presence.service.rust.ts    broadcaster (Rust mode)
src/hooks/use-rf-presence-activity.ts        the publisher hook
src/features/rf-interface/rf-interface.tsx   mounts the publisher hook
src/features/rf-interface/rf-layout.tsx      doc-only reference (excluded from contract count)
src/components/live-operator-status.tsx      THE consumer (Tab 1 + Tab 2 cards)
```

6 code-level files + 1 doc-only file. **Within the contract.** If this list grows without an ADR linked from [[ADR-RF-Activity-Telemetry]], the contract is broken.

The parallel `current_page` grep contract from [[ADR-Scoped-CurrentPage-In-ActiveOperators]] continues to hold unchanged — the new file `use-rf-presence-activity.ts` does NOT consume `current_page`.

## Kiosk opt-out narrowing

| | Old (pre-2026-05-07) | New |
|---|---|---|
| RF | `/^\/rf-/` (entire RF tree) | `/^\/rf-signin(\/|$)/` (sign-in only) |
| Time clock | `/^\/timeclock(app)?(\/|$)/` | (unchanged) |
| Public CP | `/^\/customer-portal(\/|$)/` | (unchanged) |

Rationale: Layer 7 (server-side Rust presence on `rust-work-service`, [[Implement-Presence-On-Rust-Option-2]]) retired the load argument that drove the original RF opt-out. Redis-HSET-backed presence costs ~1 HSET per ~30s heartbeat — well below the per-tab `.track()` RPC cost on the shared Supabase Realtime presence shard.

## Quality gate results

- `pnpm tsc -b --noEmit` — clean (~22s).
- `pnpm build` — clean in 10.81s. PWA precache regenerated.
  - `feature-rf-interface` chunk: 491.35 KB (was 500.84 KB pre-sprint per [[Implement-LiveOperatorStatus-InBuilding-Tab]]) — actually slightly smaller due to incidental dead-code elimination.
  - Total JS: 9857.98 KB. Baseline (post-`Implement-LiveOperatorStatus-InBuilding-Tab`) was 9815 KB — +43 KB delta accounts for the new `<RfActivityRow>` + `<RfActivityIndicator>` rendering UI + 2 lucide icons (`Radar`, `Scan`) + the publisher hook.
  - Pre-existing over-budget chunks (`warehouse-location-map`, `feature-admin`) unchanged.
- `npx eslint src/lib/presence/ src/hooks/use-rf-presence-activity.ts src/components/live-operator-status.tsx src/features/rf-interface/rf-interface.tsx src/features/rf-interface/rf-layout.tsx` — 0 errors, 0 warnings on touched files.
- `pnpm vitest run src/lib/presence src/hooks` — 6 test files / 29 tests passing.
- `pnpm vitest run src/features/rf-interface` — 49/50 passing. The 1 failing test (`rf-cycle-count-unified.test.tsx § 4. Release Confirmation`) reproduces against `git stash` of this PR — **pre-existing failure, unrelated to this sprint**. Flagged for future debug.
- **Bundle budget** — fails on the same two pre-existing chunks (`warehouse-location-map` 1487 KB, `feature-admin` 971 KB) and the same total-JS overage. Identical baseline failure mode documented in the prior two sister implementations.
- **Lint ratchet** — not re-baselined; touched files contribute 0 to either warning or suppression count.

## Manual verification procedure

### Setup

1. **Office tab** — sign in to a tenant where the current user has `view inventory_apps` permission.
2. Navigate to **Apps → Inventory → Inventory Counts** tab.
3. Confirm `<LiveOperatorStatus>` renders below the search bar (toggle defaults on).

### Test 1 — RF user appears in Tab 2 ("In Building")

4. **RF tab** — in a second browser tab (or another browser session for a different operator on the same org), sign in via `/rf-signin` and arrive at `/rf-interface`.
5. **Office tab** — within ~1.5s, flip to Tab 2 ("In Building"). The RF operator should appear with their name + status badge + an inline `<Radar>` icon next to the "in {feature}" line. Hover the radar icon — tooltip shows the activity snapshot (current step, no scans yet, no zone yet).
   - **Pass criteria:** the operator appears at all (this validates the kiosk-opt-out narrowing). Pre-sprint, RF operators were invisible in BOTH tabs.

### Test 2 — Activity updates as operator navigates

6. **RF tab** — click into the **Cycle Count** screen.
7. **Office tab** — within ~1.5s (the `TRACK_DEBOUNCE_MS` window), the radar tooltip's "Step" line should change from `'RF Home'` to `'Cycle Count'`.
8. **RF tab** — click back to home, then into **Put-Away**.
9. **Office tab** — step updates again to `'Put-Away'`.
10. **RF tab** — navigate to a sequence of screens within < 1s. Confirm the office tab sees ONE update with the latest screen, not three (debouncer working).

### Test 3 — Scan capture

11. **RF tab** — inside Cycle Count, claim a task (or run via mock cycle-count flow). When prompted to scan a location, type a value into the location scanner input + press Enter.
12. **Office tab** — within ~1.5s, the radar tooltip's "Last scan" line populates with the value + a fresh timestamp. The **Tab 1** card (if the operator is also in `worker_heartbeats`) shows the `<RfActivityRow>` sub-row with the scan value rendered inline + a small `<Scan>` icon.

### Test 4 — Idle indicator

13. **RF tab** — leave the tab idle for > 60s (no clicks, no key presses).
14. **Office tab** — the `<RfActivityRow>` (Tab 1) badge changes to "Idle 1m" (or similar). The dot before the step label changes to a slate-coloured static circle. The Tab 2 indicator's tooltip says "Idle 1m" + the dot is slate.
15. **RF tab** — click anywhere or press a key.
16. **Office tab** — within ~1.5s, the indicator returns to "live" (green pulse) on the next broadcast. Note: if no other field changed, the broadcast is suppressed by `rfActivityShapeEqual` and the panel re-renders only on the local `useNowTicker` (5s); the visual freshness ladder catches up within ~5s without a fresh heartbeat.

### Test 5 — Operator on Tab 1 simultaneously

17. **RF tab** — stay inside Cycle Count, claim a real task so `worker_heartbeats` records the operator.
18. **Office tab** — flip to Tab 1 ("On Counts"). The operator card now shows the existing zone/work-type display PLUS the `<RfActivityRow>` sub-row beneath. Tab 2 should NO LONGER show this operator (dedup against `worker_heartbeats`).

### Test 6 — Cleanup on RF tab close

19. **RF tab** — force-close the tab (Cmd-W).
20. **Office tab** — within ~1.5s in `'rust'` mode (immediate `PresenceLeft` from the Rust untrack route), the operator disappears from Tab 2. After ~90s in either mode, the operator is also fully evicted from the presence map.
21. The activity hook's unmount handler also fires `updateRfActivity(null)` so the panel doesn't show stale activity if the operator transitions to a non-workflow surface without unmounting RF.

## Anything flagged for user attention

### 1. UX choice — step labels (humanisation)

The sprint humanises ~20 work-type-level snake_case labels via `STEP_LABELS` in `live-operator-status.tsx`. Examples:
- `cycle_count` → `'Cycle Count'`
- `kitting_picking` → `'Kitting: Picking'`
- `inbound_part_transfer` → `'Inbound Transfer'`

Unknown labels fall back to a generic title-case (`unknown_step` → `'Unknown Step'`) so the panel never silently swallows a missing entry. **Flagging in case the user wants to tweak any label** — happy to relabel "Kitting Apps" → "Kitting Menu" or similar.

The lookup also pre-includes future per-form labels (`scanning_material`, `confirming_count`, `reviewing_variance`, `capturing_serial`, `signing_off`) so when forms learn to push finer-grained steps directly, the panel humanises them out-of-the-box.

### 2. Work-type schemas wired at v1

v1 publishes `current_step` from the parent `<RFInterface>`'s `currentView`, which means **work-type-level granularity, not sub-step granularity**. Schemas wired today:

| `currentView` | `current_step` (broadcast) | `STEP_LABELS` |
|---|---|---|
| `home` | `rf_home` | RF Home |
| `cycle-count` | `cycle_count` | Cycle Count |
| `putaway` | `putaway` | Put-Away |
| `picking` | `picking` | Picking |
| `kitting-apps` / `kitting-picking` / `build-kit` / `inspect-kit` | `kitting_apps` etc. | (matching humanised) |
| `grs-cycle-count` / `grs-core-pulls` | `grs_*` | GRS variants |
| `inbound-part-transfer` | `inbound_part_transfer` | Inbound Transfer |
| `work-queue` / `claim-tasks` / `sap-migo` / etc. | (snake_case of `currentView`) | (matching humanised) |

Sub-step granularity (e.g. "Cycle Count: Scanning Material vs Confirming Count") requires **per-form opt-in** — a form's existing `setCurrentStep` callsites would call `presenceService.updateRfActivity(...)` directly with finer labels. Out-of-scope for this sprint per Phase 0; flagged as future work.

### 3. RF surfaces NOT hooked

- **`work_task_id` / `work_zone`** populate ONLY for cycle-count today. Other RF flows (`rf-putaway-form`, `rf-picking-form`, `rf-kitting-picking-form`, `rf-build-kit-form`, etc.) keep their task state in their own component-level `useState`. Bubbling task state up to `<RFInterface>` is the per-form opt-in path — same future-work bucket as above.
- **Native Capacitor scan** — if a future scanner integration bypasses `<ScannerInput>` (e.g. native `@capacitor-community/barcode-scanner`), the document-level capture-phase keydown listener won't see the scan. Forms in that case can call `presenceService.updateRfActivity(...)` directly from their `handleScan*` callback to surface the value.

### 4. Broadcast cadence verified

Per the spec's hard constraint *"Don't double-broadcast"*: a route navigation (`updateCurrentPage`) + a workflow transition (`updateRfActivity`) within the same render BOTH route through `scheduleTrack()` (Supabase) / `scheduleHeartbeat()` (Rust) which checks `if (this.heartbeatDebounceTimer) return` — the second call is folded into the existing 1500ms timer. **One heartbeat per coalescer window regardless of how many fields changed.** Verified by reading the debouncer logic + the `rfActivityShapeEqual` early-out for `last_input_at`-only changes.

### 5. RFLayout enrolment in `<PresenceProvider>` is a structural change

The sprint adds `<PresenceProvider>` to `<RFLayout>` — mirroring the `<AuthenticatedLayout>` mount but for the RF tree which sits OUTSIDE `_authenticated`. Side effects:

- RF tabs now run the same idle detector / DB heartbeat / circuit breaker as office tabs.
- RF tabs now show up in the org-wide `<OnlineUsersPanel>` if any office user has it open. The privacy contract is intact — `<OnlineUsersPanel>` doesn't read `current_page` or `rf_activity`, only status + name.
- Sign-out / token-refresh flows on RF now drop through the presence service's `destroy()` path, which fires the explicit untrack (`DELETE /api/v1/presence` in Rust mode) so colleagues see RF operators go offline immediately rather than waiting the 90s evictor.

## Related

- [[ADR-RF-Activity-Telemetry]] — the decision this implements.
- [[ADR-Scoped-CurrentPage-In-ActiveOperators]] — the privacy contract this extends symmetrically (sibling field on the same payload).
- [[Re-Enable-CurrentPage-In-ActiveOperators]] — the same-day implementation pattern this mirrors (idempotent service method + scheduled debouncer + single consumer surface).
- [[Implement-LiveOperatorStatus-InBuilding-Tab]] — the Tab 2 surface this composes onto.
- [[Implement-Presence-On-Rust-Option-2]] — Worker 1's loose `serde_json::Value` design that makes the Rust pass-through transparent for the second time this week.
- [[Realtime-Presence-Browser-Hardening]] — Layer 4 narrowed by this sprint; Layer 7 is the load-relief argument that justified the narrowing.
- [[Roadmap-Rust-WS-Unlocks]] — broader plan context.
- [[Components/PresenceUI - Status Indicators]] — the presence component family this extends.
- [[Sessions/2026-05-07]] — today's session log.



---

## Pathname-based `current_step` fix — 2026-05-07 (PM)

Same-day follow-up debug pass after the operator reported that the new sub-row "showed I am in a cycle count" while they were on Inbound Part Transfer. Full Phase 0 → fix → verification write-up: [[Fix-RF-Activity-Step-Source-Confusion]].

### Symptom

> "I am in the Inbound Part Transfer but the LiveOperatorStatus panel shows I am in a cycle count."

Visible Tab 1 card line: `Jai Singh BUSY · K3-26-07-1 · cycle_count`. The new `<RfActivityRow>` sub-row was rendering correctly; the user was reading the prominent `worker_heartbeats`-driven chip as the bug.

### Root cause (Phase 0 A/B/C breakdown)

- **A (deploy not complete):** NO. Latest `onebox-ai-logistics` deploy `326694b7-55b2-4e05-a82d-62f55e6d4478` SUCCESS at `2026-05-08T01:52:59Z`. Live build is the morning sprint.
- **B (publisher hook source wrong):** **NO** — contrary to the original fix proposal. The proposal was to switch from `currentView` to `useLocation().pathname` + `resolveFeature()`. That would have made things strictly worse: the entire RF tree mounts at the SINGLE route `/rf-interface/` and all sub-views are switched via `setCurrentView('inbound-part-transfer')` (internal state machine), NOT via `navigate({ to: '/rf-interface/inbound-part-transfer' })`. There are NO RF sub-routes today — confirmed by `Glob src/routes/rf-interface/**/*` returning only `index.tsx`. `useLocation().pathname` is always `/rf-interface`, so a pathname-based switch would map every RF sub-view to the catch-all `/^/rf-interface/` → "RF Terminal" entry, collapsing the per-view granularity v1 just shipped. The hook IS already correct for this architecture.
- **C (`worker_heartbeats` stale):** YES, real, and the actual user-observed bug — but in the work-engine path, NOT the publisher hook. Two concrete causes: (i) `useWorkerHeartbeat({ taskType: 'cycle_count', … })` is HARDCODED in `<RFInterface>` (~line 1058); (ii) `<RFCycleCountUnified>` only calls `onTaskChange(null)` when its INTERNAL `currentTask` becomes null, NOT on its unmount, so navigating cycle-count → home → inbound-part-transfer with a still-claimed task leaves `<RFInterface>`'s `currentTask` / `currentZone` set, which feeds the heartbeat. Out of scope per the brief; tracked as follow-up.

### Fix

Minimal, in-scope, did NOT do the proposed pathname-based switch.

1. **`STEP_LABELS['inbound_part_transfer']`** in `src/components/live-operator-status.tsx`: `'Inbound Transfer'` → `'Inbound Part Transfer'` to match the RF UI button label.
2. **Defensive task/zone gating** at the `useRfPresenceActivity` call site in `src/features/rf-interface/rf-interface.tsx`: only pass `workTaskId` / `workZone` when `currentView === 'cycle-count'`. Stops a stale `K3-26-07-1` zone from leaking onto the rf_activity payload of an unrelated workflow if the operator navigates away from cycle-count without releasing the claim. Does NOT touch the parent's state machine (still useful for the work-engine heartbeat) and does NOT change how `currentView` is set.
3. **Hook docstring update** in `src/hooks/use-rf-presence-activity.ts`: added a `"Why currentView (not useLocation().pathname)"` paragraph with the architectural reasoning + a pointer to [[Fix-RF-Activity-Step-Source-Confusion]] so the next engineer reading the hook doesn't repeat the incorrect assumption.

### Manual verification

1. Office tab — sign in with `view inventory_apps`. Open **Apps → Inventory → Inventory Counts**.
2. RF tab — sign in via `/rf-signin`. Tap **Cycle Count**, claim a task. Office tab — within ~1.5s the operator's Tab 1 card shows the sub-row "Cycle Count".
3. RF tab — tap back to home, tap **Inbound Part Transfer** (do NOT release the claim). Office tab — within ~1.5s the sub-row label updates to **"Inbound Part Transfer"** (NOT "Inbound Transfer", NOT "Cycle Count"). The cycle-count chip on the SAME card persists — that's the documented `worker_heartbeats` staleness (see follow-up).
4. Hover the radar tooltip — `Zone:` line should be ABSENT (gating took effect).
5. RF tab — navigate back into Cycle Count. Office tab — sub-row flips back to "Cycle Count" + tooltip's `Zone:` line repopulates.

### Quality gates

- `pnpm tsc -b --noEmit` — clean (~25s).
- `npx eslint <touched files>` — 0 errors / 0 warnings.
- `pnpm vitest run src/lib/presence src/hooks` — 29/29 passing.
- `pnpm build` — clean in 12.25s. `feature-rf-interface` 503.18 KB / 115.11 KB gzipped (within the per-chunk script threshold; same baseline failures as the morning sprint on `warehouse-location-map` + `feature-admin`).
- Lint ratchet — touched files contribute 0 to either count.

### Follow-up

Not fixed in this pass (work-engine concern, not publisher-hook concern):

1. `useWorkerHeartbeat` `taskType` un-hardcoding — should reflect actual screen / be cleared off cycle-count.
2. `<RFCycleCountUnified>` unmount cleanup — call `onTaskChange(null)` on unmount so the parent's `currentTask` / `currentZone` don't leak across screens.
3. Per-form sub-step opt-in (already flagged from the morning sprint).
