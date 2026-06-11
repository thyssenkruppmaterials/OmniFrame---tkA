---
title: "Work Engine Roadmap — Cycle Counts → Picks/Putaways"
date: 2026-04-22
tags: [roadmap, work-engine, cycle-count, picks, putaways, architecture, strategy]
status: proposal
---

# Work Engine Roadmap

Context: in the 225–230 series we built a robust cycle-count engine with zones, mutual exclusion, sticky routing, dedicated zone assignments, dynamic bypass overrides, priority rules, and heartbeat-based auto-release. Most of these primitives are generic — they belong to a **work queue engine** that can also drive picks, putaways, counts, inspections, moves, and replenishment.

This note is a proposed roadmap ordered by **leverage per unit of effort**. Each section explains the problem, the core concept, where it plugs into the existing cycle-count engine, and a rough size estimate.

## Tier 1 — Ship-soon (unlocks multi-task-type operation)

### 1. Work Task abstraction (`work_tasks` + `task_type` enum)

**Problem:** `rr_cyclecount_data` is cycle-count specific. Picks and putaways need the same primitives (priority, assignment, zone lock, heartbeat release) without duplicating code.

**Shape:**
- `work_tasks` table — thin polymorphic row: `{id, org_id, task_type, subject_id (FK to rr_cyclecount_data / rf_pick_tickets / rf_putaway_operations), location, priority, status, assigned_to, assigned_at, zone (generated), …}`.
- Existing cycle-count fields stay on `rr_cyclecount_data` (workflow, scanned_parts, etc). `work_tasks` is the **orchestration layer**; domain rows are the payload.
- Sync via trigger: inserts to `rr_cyclecount_data` / `rf_pick_tickets` / `rf_putaway_operations` auto-create matching `work_tasks` rows. Updates flow through.

**Benefits:**
- One queue view that Rust ranks for pull-next, regardless of task type.
- Zone exclusivity, priority rules, heartbeat release become **free** for picks / putaways — they already apply to the task-orchestration layer.
- One realtime channel (`task_events`) instead of three.

**Effort:** ~2–3 days. The hardest part is backfilling `work_tasks` from existing `rr_cyclecount_data` + `rf_pick_tickets` + `rf_putaway_operations` without breaking current queries.

**Migration path:** additive — `work_tasks` runs in parallel for a release cycle, domain tables stay canonical. Rust reads/writes `work_tasks` for scheduling. UI gradually shifts to `work_tasks` queries.

### 2. Worker capabilities / skills

**Problem:** not every operator can handle every task type. A putaway specialist shouldn't be pulled into a variance-review recount; a cycle counter shouldn't get a complex pick wave.

**Shape:**
- `worker_capabilities (user_id, task_type, level TEXT CHECK IN ('beginner','certified','expert'), granted_at, granted_by)`.
- Rust pull-next filters candidates by `EXISTS (SELECT 1 FROM worker_capabilities WHERE user_id = $claimer AND task_type = work_tasks.task_type)`.
- UI: "Operators" panel (shared with the zone assignments editor) shows skill badges and can grant/revoke.

**Effort:** ~1 day.

### 3. Priority Rules 2.0 — generalized, task-type-aware

After (1), rename `cycle_count_priority_rules` → `work_priority_rules` with a `task_type` column. Evaluator becomes `apply_work_priority_rules(org_id, task_type)`. Same UI, tab per task type.

**Effort:** ~4 hours (mostly SQL rename + UI filter).

## Tier 2 — Operational intelligence

### 4. Shift management

**Problem:** tasks get assigned off-shift (2 AM to first-shift counter), push notifications fire at night, SLA calculations wrong across shift boundaries.

**Shape:**
- `shifts (org_id, name, starts_at, ends_at, timezone, days_of_week INT[])`.
- `worker_shifts (user_id, shift_id)`.
- Rust claim filter: only match workers whose current shift covers NOW().
- Auto-release at shift end: any in-progress work owned by a user whose shift has ended → released back to queue (reuses migration 230's RPC pattern).

**Effort:** ~1–2 days.

### 5. SLA timers + escalation

**Problem:** critical counts / hot picks have deadlines. Without timers, they silently slip.

**Shape:**
- `work_sla_rules (org_id, task_type, priority, assign_within_minutes, complete_within_minutes, notify_channels TEXT[])`.
- Scheduler tick: detect breaches; log to `work_sla_breaches`; optional escalation (bump priority one level, notify supervisor, Slack webhook).

**Effort:** ~1–2 days.

### 6. Wave / Batch picking + batch counting

**Problem:** for picks especially, you want to give an operator 10 related tasks at once (same zone, same order, sequential locations) to minimize walking.

**Shape:**
- `work_batches (org_id, task_type, created_by, created_at, status)`.
- `work_batch_members (batch_id, task_id, sequence)`.
- Rust pull-next accepts `batch_size: usize` — returns a batch of N tasks to the same operator, zone-aware.
- UI: "Batch mode" toggle in RF that claims 10 at a time.

**Effort:** ~2–3 days. Moderate UX work.

### 7. Heatmaps + analytics

**Problem:** supervisors lack visibility into zone hot spots, operator productivity, SLA compliance.

**Shape:**
- `work_task_metrics` materialized view with (date, zone, task_type, operator, completed, avg_seconds, sla_breaches).
- Dashboard: zone heatmap (shades zones by work volume / variance), operator leaderboard, SLA funnel.

**Effort:** ~2–3 days.

## Tier 3 — Polish

### 8. Work interruption + context stash

When a `critical` task lands and the current operator is mid-task, park the current one (`work_tasks.status = 'paused'`, stash sub-step state in `workflow_result`), hand them the urgent one, resume when done.

### 9. Workload balancing

Round-robin fairness when multiple operators are online: prefer the operator with the fewest completed-today tasks. Optional — many warehouses prefer sticky-zone instead.

### 10. Unified audit log

Replace scattered `audit_logs` + `cycle_count_assignment_history` + ad-hoc notes with a single `work_audit_events` table. One timeline per task. Every assignment, push, release, override, completion, variance review writes one row.

### 11. Cross-warehouse routing

For multi-DC operations, route tasks based on warehouse capacity / operator availability. Requires (4) shifts + (2) capabilities to be meaningful.

### 12. Mobile push notifications

With SLA timers (5) + heartbeat (229/230), the system already knows who's online and what's urgent. Wire up Expo push / FCM so supervisors can nudge idle operators into urgent zones.

## Proposed sequencing

| Order | Item | Size | Unlocks |
|-----:|------|-----|---------|
| 1 | Work Task abstraction | L | Multi-task-type foundation |
| 2 | Worker capabilities | S | Correct routing |
| 3 | Priority Rules 2.0 | XS | Task-type-aware priorities |
| 4 | Shift management | M | Off-hours hygiene |
| 5 | SLA timers | M | Deadline enforcement |
| 6 | Wave / Batch | M | Productivity for picks |
| 7 | Heatmaps | M | Supervisor visibility |
| 8–12 | Polish | varies | As demand surfaces |

## What's already built (leverage for the above)

- **Zone engine** (225/227/228/229/230): zones, exclusivity, sticky, dedicated assignments, bypass overrides, heartbeat release. All of this applies to `work_tasks` for free if we introduce it correctly.
- **Rust work-service**: structured API for claim/start/complete/release/skip, already task-queue shaped. Extending `task_type` enum is straightforward.
- **Priority Rules engine** (230): generalize to `work_priority_rules` with one column rename.
- **RF interface**: already task-agnostic in structure (fetches `CycleCountTask`, renders dynamic workflow steps). Adding pick / putaway workflows is a matter of new step components + workflow configs — the claim / release / heartbeat plumbing is already in place.

## Not in scope here

- ERP integration (SAP ECC putaway confirmations, ATP blocks on picks). Separate track.
- Warehouse labor management (productivity bonuses, shift incentives). Separate HR system.
- Voice picking / AR overlays. Bolt-ons to the RF interface after (6) batch picking is live.
