# Runbook — Cross-Tenant Leak

**Symptom.** Any RLS probe alarm, any cross-tenant log line in the work
service, any user report that they saw work belonging to another org.
**This is a P0.**

## Immediate response (under 5 minutes)

1. **Freeze writes for the affected org.** Toggle the break-glass flag
   either from the admin Configurability Surface (Feature Flags tab) or via
   SQL:
   ```sql
   UPDATE work_engine_settings
      SET feature_flags = feature_flags || '{"work_tasks_rollback_to_legacy": true}'::jsonb,
          updated_at = now()
    WHERE organization_id = $org;
   ```
2. **Capture forensics BEFORE remediation.**
   - `mcp__supabase__get_advisors({type:'security'})` and `({type:'performance'})`.
   - `mcp__supabase__get_logs({service:'postgres'})` and `({service:'realtime'})`.
   - WS subscriber list + recent `work_ws_auth_failure_total` rate.
   - Last 50 `work_events` rows for both orgs.
3. **Identify the surface.**
   - **HTTP route:** check `org_id` derivation in the handler. Plan §2.0 —
     user routes derive from `user_profiles`, never from request body.
   - **WebSocket:** confirm `WS-Subscribe-Token` was issued and verified
     (Phase 2.0). If a client reached subscribe state without a token,
     auth-on-upgrade is bypassed — file Sev1.
   - **SQL:** look for an unqualified `organization_id` reference in a JOIN
     (Patterns/Claim-500-Ambiguous-Organization-Id-Fix). Always-qualify
     columns with `wt.*`.

## Recovery

- Roll back `work_tasks_rollback_to_legacy` only after the offending code
  path is corrected and a regression test added under `supabase/tests/` or
  `rust-work-service/tests/`.
- Re-enable shadow read for the affected orgs and watch
  `work_engine_drift` for 24h before flipping `work_tasks_read_primary`
  back on.

## Hard rule

Cross-tenant leakage paging threshold is **zero tolerance** (Phase 13.1).
Any non-zero RLS probe failure pages immediately.
