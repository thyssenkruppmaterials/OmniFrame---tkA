# Runbook — PIN Failure Spike

**Symptom.** `work_pin_failed_total` spike beyond baseline, or
`supervisor_pin_failures` table grows by >5 rows / minute.

## Triage

1. **Inspect recent failures.**
   ```sql
   SELECT user_id, attempted_by, organization_id, reason, count(*)
     FROM supervisor_pin_failures
    WHERE failed_at > now() - interval '15 minutes'
    GROUP BY 1,2,3,4
    ORDER BY 5 DESC
    LIMIT 20;
   ```
   Look for `reason = 'rate_limited'`, `wrong_pin`, or `no_pin_set`.

2. **Confirm GRANT shape.** Run `supabase/tests/pin_grants.sql`. Should
   return `NOTICE` with no `EXCEPTION`.

3. **Recent role changes.**
   ```sql
   SELECT id, user_id, role_id, updated_at
     FROM user_profiles
    WHERE organization_id = $org AND updated_at > now() - interval '1 hour'
    ORDER BY updated_at DESC;
   ```
   A user freshly demoted from manager+ would now fail the supervisor
   eligibility check inside `verify_supervisor_pin`.

## Recovery

- **Brute force.** Rate limit kicks in at 5 failures / 5 min per supervisor;
  it returns `false` for all calls until the window expires. No further
  action needed.
- **PIN was rotated.** Have the supervisor `set_supervisor_pin($newPin)` via
  the profile UI.
- **Backend regression.** If `verify_supervisor_pin` returns false despite a
  valid PIN, capture the `pg_stat_statements` row for the function and
  attach to a Sentry ticket.
