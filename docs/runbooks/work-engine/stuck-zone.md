# Runbook — Stuck Zone

**Symptom.** Operator says "I can't claim work in zone X" or the queue strip
shows tasks pending in a zone with no claims for > 10 min.

Since migration 311 (2026-05-18) the admin shell renders a persistent
amber ribbon at the top of the page whenever an org's cycle-count claim
path returns None while real work exists — i.e. **the cascade detector
fires first**, before operators have to complain. If you see that
ribbon, jump straight to "Recovery → Stuck Assignments UI" below.
The ribbon auto-dismisses when the next claim succeeds or the queue
clears.

## Triage (5 minutes)

1. **Check the admin ribbon.** If `ClaimBlockedByZone` is firing the
   ribbon will say `N counts ready, M stale soft-reservations occupying
   zones`. `M > 0` → cascade class (jump to Recovery 1). `M = 0` with
   `N > 0` → unusual (defer-list / capability / capacity mismatch).

2. **Verify operator is online.**
   ```sql
   SELECT user_id, last_heartbeat, status FROM worker_heartbeats
    WHERE organization_id = $org AND user_id = $operator;
   ```
   If `last_heartbeat` < 5 min ago, continue regardless of `status` —
   migration 311's escalator treats `status NOT IN ('online','busy')`
   as inactive, so an idle/break/offline operator with a fresh heartbeat
   no longer blocks the reaper.

3. **Inspect zone state.**
   ```sql
   SELECT * FROM v_cycle_count_active_zones
    WHERE organization_id = $org AND zone = $zone;
   ```

4. **Check for an explicit zone pin.**
   ```sql
   SELECT * FROM cycle_count_zone_assignments
    WHERE organization_id = $org AND zone = $zone;
   ```
   A row here means the zone is reserved for the listed user; the claim
   filter intentionally rejects everyone else.

5. **Check for a stale reservation.**
   ```sql
   SELECT id, assigned_to, reservation_started_at, status
     FROM rr_cyclecount_data
    WHERE organization_id = $org
      AND status = 'pending' AND assigned_to IS NOT NULL
    ORDER BY reservation_started_at ASC
    LIMIT 5;
   ```
   Reservation > the org's `work_type_settings.reservation_escalation_minutes`
   (default 60 min) is stale; the scheduler should have already escalated
   it. If it hasn't, run the migration-311 function with the org filter:

   ```sql
   -- (threshold_minutes int, organization_id uuid)
   SELECT * FROM public.escalate_stale_zone_reservations(
     /* threshold */ 60,
     /* org */ '$org'::uuid
   );
   ```

   The function returns `(out_count_id, out_count_number, out_previous_owner)`
   for each row it hard-unassigns. Empty result = nothing was eligible
   (heartbeat fresh AND status in `('online','busy')` AND supervisor
   protection window still active).

## Recovery

1. **Stuck Assignments UI (preferred — no SQL).**
   - Navigate `/apps/inventory` → Count Settings → Zone Rules →
     **Stuck Assignments** card.
   - Each row shows `count_number`, `zone`, `assigned_to`, `assigned_at`,
     and `minutes_stuck`.
   - Click **+ Unassign** on the offending row. Effect is immediate:
     every operator's next Pull Next succeeds. Audit trail is written
     to `notes`.

2. **Stale heartbeat.** Heartbeat-stale releases run automatically every
   5 min via `public.release_stale_heartbeat_assignments($threshold, $org)`.
   To force a one-off invocation:
   ```sql
   SELECT * FROM public.release_stale_heartbeat_assignments(
     /* threshold */ 10,
     /* org */ '$org'::uuid
   );
   ```

3. **Wrong zone pin.** Use Operation Control's drag-reassign or:
   ```sql
   UPDATE cycle_count_zone_assignments
      SET user_id = $newOperator, updated_by = $admin, updated_at = now()
    WHERE organization_id = $org AND zone = $zone;
   ```

4. **Zone-rule misconfig.** Check `cycle_count_zone_rules` for the org.
   The `zone_pattern` regex must yield a value for the operator's
   location; empty regex falls back to `split_part(loc, '-', 1)`.
   `zone_pattern=NULL` is the worst-case cascade radius (whole-floor
   lock if any row is stuck) — see
   [`Decisions/ADR-Cycle-Count-Soft-Reservation-Cascade-Mitigation.md`][adr-cascade].

## What changed in migration 311 (2026-05-18)

- `escalate_stale_zone_reservations` now takes an optional
  `p_organization_id uuid` parameter (NULL = all orgs, legacy
  behavior). The Rust scheduler now loops per-org with each org's
  `reservation_escalation_minutes` setting (default 60 if no
  `work_type_settings` row exists). Closes F18 from
  [`Decisions/ADR-Work-Distribution-Pipeline-Architecture-Review-2026-05-18.md`][adr-review].
- **Idle-aware heartbeat guard.** The escalator's LATERAL on
  `worker_heartbeats` now reads `status` as well as `last_heartbeat`.
  Any row with `status NOT IN ('online','busy')` — i.e. idle, break,
  offline, or NULL — is treated as inactive even when the heartbeat is
  fresh. This is the B2 fix from the 2026-05-18 cascade incident:
  James Dearman was still heartbeating idle while his `pending+assigned`
  row blocked zone RP for nine other operators.
- `release_stale_heartbeat_assignments` also gained the optional
  `p_organization_id` parameter for the same scheduler-side per-org
  loop (closes F21).
- `detect_and_release_abandoned` is now per-org and reads
  `work_type_settings.abandonment_minutes` (default 30) instead of a
  hardcoded interval (closes F20).

## What changed for operators (rf-cycle-count-unified)

- The Confirm-step **Release** chip in the header was upgraded from a
  subtle text link to a visible outlined button (T-7 part 1). Operators
  on the Confirm review surface now have an obvious self-recovery
  control.
- The **Pull Next Count** landing now pre-fetches the operator's held
  row (if any). When the operator opens RF Cycle Count after a
  disconnect and they still hold a row, the landing renders an amber
  alert with the held row's `count_number` + location + two buttons:
  **Resume** (Phase 0 routes them back) and **Release** (hands the row
  back to the queue). T-7 part 2 — closes the David / James / Marvin
  class without requiring admin intervention.

## Verify the deploy actually took effect (M-9)

If the cascade reappears immediately after a `railway up`, run the
post-deploy smoke script BEFORE assuming the code change is broken —
the binary may not actually be serving yet (the 2026-05-14 AM trap
where Railway showed deploy=healthy while the OLD container kept
serving for 90 min):

```sh
node scripts/post-deploy-smoke-claim.mjs \
  --url https://rust-work-service.railway.app \
  --expected-version "$(grep '^version' rust-work-service/Cargo.toml | head -1 | cut -d'"' -f2)"
```

Exit 0 = new binary serving and `/health/detailed` is green.
Exit 1 = either Railway is still routing to the old container or
`db` / `redis` are unhealthy. Check Railway deploy logs before
escalating to a code-level issue.

## Escalation

- If the dispatcher repeatedly returns None for a zone with
  pending+assignable rows, capture: claim p95 (Phase 12 metric),
  `work_engine_health` view, and the operator's `worker_capabilities`
  row. File a Sentry ticket tagged `work_type=cycle_count` and
  `flow=rf`. Attach the most recent `ClaimBlockedByZone` event payload
  if available.

[adr-cascade]: ../../../memorybank/OmniFrame/Decisions/ADR-Cycle-Count-Soft-Reservation-Cascade-Mitigation.md
[adr-review]: ../../../memorybank/OmniFrame/Decisions/ADR-Work-Distribution-Pipeline-Architecture-Review-2026-05-18.md
