---
tags: [type/debug, status/active, domain/frontend, domain/realtime]
created: 2026-05-07
---
# Fix: RF Activity Telemetry — `current_step` Source Confusion

## Symptom

Reported the same evening the RF activity telemetry shipped (see [[Implement-RF-Activity-Telemetry-In-LiveOperatorStatus]]). Operator quote:

> "I am in the Inbound Part Transfer but the LiveOperatorStatus panel shows I am in a cycle count."

Screenshot showed Tab 1 ("On Counts") card for the operator with the line: `Jai Singh BUSY · K3-26-07-1 · cycle_count`. The new `<RfActivityRow>` sub-row (added in the morning sprint) was rendering correctly and showed the right `current_step` for whatever screen the operator was on — but the user's perception was that the panel was "wrong" because the prominent `cycle_count` chip persisted across navigations.

## Phase 0 — diagnosis

Opened with three candidate root causes (A/B/C). Verified each in turn before writing any code.

### A. Deploy not complete? — NO

Latest `onebox-ai-logistics` deployment via Railway MCP: ID `326694b7-55b2-4e05-a82d-62f55e6d4478`, status `SUCCESS`, `2026-05-08T01:52:59Z`, image digest `sha256:d5a0981248a4b3ddca2f3b7276a79eb408300b5ca35aa83f08d6008b922b452b`. The previous deploy (`4cadff03-…`) failed but a fresh push succeeded after. Live build IS the morning RF activity telemetry sprint. Not a deploy problem.

### B. Publisher hook reading the wrong source? — NO (the original fix proposal's premise was incorrect)

The initial fix proposal was "switch the source of truth from `currentView` to `useLocation().pathname` + `resolveFeature()`". This **would have made things strictly worse**, because:

- The RF tree mounts at the SINGLE route `/rf-interface/` (`src/routes/rf-interface/index.tsx`).
- All RF sub-views (cycle-count, inbound-part-transfer, putaway, picking, kitting-apps, build-kit, inspect-kit, kitting-picking, grs-cycle-count, grs-core-pulls, work-queue, claim-tasks, sap-migo, my-productivity, profile, etc.) are switched via `setCurrentView('inbound-part-transfer')` inside `<RFInterface>` — NOT via `navigate({ to: '/rf-interface/inbound-part-transfer' })`.
- Therefore `useLocation().pathname` is ALWAYS `/rf-interface` regardless of which RF sub-app the operator is on.
- The `^/rf-interface/cycle-count` etc. patterns inside `route-features.ts` are forward-looking (they cover the shape if the RF tree ever gets nested file-routes) but they DO NOT FIRE today.
- A pathname-based switch would map every RF sub-view to the catch-all `/^\/rf-interface/` → "RF Terminal" entry, collapsing the per-view granularity the morning sprint just shipped.

Traced the actual broadcast path end-to-end:

- `<RFInterface>` `setCurrentView('inbound-part-transfer')` → `useRfPresenceActivity` effect deps fire → `presenceService.updateRfActivity({ current_step: 'inbound_part_transfer', … })` → `rfActivityShapeEqual(prev, next)` returns false (`current_step` changed) → `scheduleTrack()` / `scheduleHeartbeat()` debounce 1500ms → broadcast.
- Office tab's `<RfActivityRow>` reads `presence?.getUserPresence(worker.user_id)?.rf_activity` and renders the humanised label from `STEP_LABELS`. `STEP_LABELS['inbound_part_transfer']` already mapped to `'Inbound Transfer'` (renamed to `'Inbound Part Transfer'` as part of this fix, see below).

**The publisher hook IS already correct for this architecture.** Everything from the morning sprint works as designed. The supervisor was looking at a working sub-row but interpreting the prominent `worker_heartbeats`-driven chip as the bug.

### C. `worker_heartbeats` is stale? — YES (out of scope but real)

Two concrete root causes for the persistent `cycle_count` chip:

1. `src/features/rf-interface/rf-interface.tsx` (~line 1058): `useWorkerHeartbeat({ taskType: 'cycle_count', … })` — the `taskType` prop is **HARDCODED** to `'cycle_count'`. Even when the operator is on Inbound Part Transfer / Putaway / Picking / Kitting, the heartbeat still claims `current_task_type='cycle_count'`.
2. `<RFCycleCountUnified>` calls `onTaskChange(null)` only when its INTERNAL `currentTask` becomes null (~line 528) — NOT on its unmount. So when the operator navigates cycle-count → home → inbound-part-transfer with a still-claimed task, `<RFInterface>`'s `currentTask` and `currentZone` REMAIN SET. The heartbeat keeps reporting `current_zone='K3-26-07-1'` and `current_location='K3-26-07-1'`.

These together produce the visible chip `BUSY · K3-26-07-1 · cycle_count` on Tab 1, which is what the user reports as "shows I am in a cycle count". Both edits live in the work-engine path and are out of scope for the publisher hook — flagged for follow-up below.

## Fix

Minimal, in-scope. Avoided the proposed pathname-based switch because Phase 0(B) above showed it would break, not fix, the panel.

### 1. Step label clarity — `src/components/live-operator-status.tsx`

Updated `STEP_LABELS['inbound_part_transfer']` from `'Inbound Transfer'` → `'Inbound Part Transfer'` to match the RF UI button label exactly. Comment block in the file points back here so the next maintainer can see why.

### 2. Defensive task/zone gating — `src/features/rf-interface/rf-interface.tsx`

The parent's `currentTask` / `currentZone` state is set by `<RFCycleCountUnified>` and is NOT cleared when the user navigates away from cycle-count without releasing the claim (Phase 0(C)). To stop a stale `K3-26-07-1` zone from leaking onto the rf_activity payload of an unrelated workflow (e.g. inbound-part-transfer), gate the props at the call site:

```ts
const isInsideCycleCount = currentView === 'cycle-count'
useRfPresenceActivity({
  currentView,
  workTaskId: isInsideCycleCount ? (currentTask?.id ?? null) : null,
  workZone: isInsideCycleCount ? currentZone : null,
})
```

This only affects the publisher hook's emit shape. It does NOT touch `useWorkerHeartbeat` (still hardcoded — see follow-up #1) and it does NOT change how `currentView` is set. Per the Phase 0 trade-off in [[Implement-RF-Activity-Telemetry-In-LiveOperatorStatus]], `work_task_id` / `work_zone` populate ONLY for cycle-count today; this gating just makes that explicit at the call site so a stale cycle-count value can't accidentally ride along.

### 3. Hook docstring update — `src/hooks/use-rf-presence-activity.ts`

Added a `"Why currentView (not useLocation().pathname)"` paragraph with the architectural reasoning so the next engineer reading the hook doesn't repeat the same incorrect assumption. Cites this debug note + `src/routes/rf-interface/index.tsx` as evidence that there are NO RF sub-routes today.

### What's intentionally NOT done

- `useLocation().pathname` switch — would map every RF view to "RF Terminal" (see Phase 0(B)).
- `useWorkerHeartbeat` `taskType` un-hardcoding — out of scope for the publisher hook (work-engine path).
- Clearing `currentTask` / `currentZone` on `<RFCycleCountUnified>` unmount — same out-of-scope reasoning. Cleanest fix lives inside that component.
- New permission keys / new ADR — none needed; this is purely a label + defensive-gating fix on existing surfaces.

## Quality gates

- `pnpm tsc -b --noEmit` — clean (~25s).
- `npx eslint src/hooks/use-rf-presence-activity.ts src/lib/presence/route-features.ts src/components/live-operator-status.tsx src/features/rf-interface/rf-interface.tsx` — 0 errors, 0 warnings.
- `pnpm vitest run src/lib/presence src/hooks` — 29/29 passing.
- `pnpm build` — clean in 12.25s. PWA precache regenerated (182 entries / 10269.56 KiB). `feature-rf-interface` chunk: 503.18 KB / 115.11 KB gzipped (well within the budget script's per-chunk threshold; only the pre-existing `warehouse-location-map` and `feature-admin` chunks fail, identical baseline to the morning sprint).
- Bundle budget — fails on the same 2 pre-existing chunks. Identical baseline failure mode documented in [[Implement-RF-Activity-Telemetry-In-LiveOperatorStatus]] (which itself documented the failure as carried over from earlier sister sprints).
- Lint ratchet — touched files contribute 0 to either count.

## Manual verification procedure

1. Sign in to a tenant where the current user has `view inventory_apps`. Open **Apps → Inventory → Inventory Counts** in an office tab. Confirm `<LiveOperatorStatus>` renders.
2. In a second tab/device, sign in via `/rf-signin` and arrive at `/rf-interface`.
3. RF tab — tap **Cycle Count**, claim a task. Office tab — within ~1.5s the operator's Tab 1 card shows the new sub-row "Cycle Count" + a green pulse.
4. RF tab — tap back, then tap **Inbound Part Transfer** (DO NOT release the cycle-count claim first — this reproduces the original symptom).
5. Office tab — within ~1.5s the sub-row label updates to **"Inbound Part Transfer"** (NOT "Inbound Transfer", NOT "Cycle Count"). The green pulse stays live as long as the operator keeps interacting with the new screen.
6. Hover the radar tooltip — `Zone:` line should be ABSENT (we gated `work_zone` to cycle-count only). The cycle-count claim is still active in `worker_heartbeats` (see follow-up #2 below) so the prominent chip on the same card still reads `cycle_count` — but the supervisor now has the disambiguating sub-row directly underneath.
7. RF tab — go back to home, then back into Cycle Count. Office tab — sub-row flips back to "Cycle Count", and the radar tooltip's `Zone:` line repopulates with the active task's zone.

Expected post-fix UX: the `worker_heartbeats` chip and the rf_activity sub-row tell two complementary stories — "the operator has an active cycle-count CLAIM (chip)" and "the operator is currently looking at this OTHER screen (sub-row)" — and the supervisor can read both without confusion.

## Follow-up (out of scope for this fix; tracked here)

1. **`useWorkerHeartbeat` `taskType` un-hardcoding** — the prop should reflect what the operator is actually doing (or be omitted when not on a work-type task). Likely needs the `<RFInterface>` parent to track "current work-type" alongside `currentView`. Touches the work-engine path; coordinate with whoever owns `worker_heartbeats` semantics.
2. **`<RFCycleCountUnified>` unmount cleanup** — call `onTaskChange(null)` on unmount so navigating away (without releasing) doesn't leak `currentTask` / `currentZone` to the parent, which then leaks them to `useWorkerHeartbeat`. Probably belongs as a separate effect with an empty cleanup that's explicit about the trade-off (does this implicitly release the claim? if not, the claim survives and the chip stays — same observable outcome).
3. **Per-form opt-in for sub-step granularity** — already flagged in the morning sprint's note; revisit once worker_heartbeats parity is restored.

## Related

- [[Implement-RF-Activity-Telemetry-In-LiveOperatorStatus]] — the sprint this hardens.
- [[ADR-RF-Activity-Telemetry]] — the privacy contract (unchanged).
- [[ADR-Scoped-CurrentPage-In-ActiveOperators]] — sibling field's privacy contract (unchanged).
- [[Re-Enable-CurrentPage-In-ActiveOperators]] — the same-day pathname-based pattern this fix consciously did NOT mirror, with reasoning.
- [[Realtime-Presence-Browser-Hardening]] — Layer 4 narrowed by the morning sprint.
- [[Sessions/2026-05-07]] — today's session log.
