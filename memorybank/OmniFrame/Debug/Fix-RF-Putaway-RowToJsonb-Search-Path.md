---
tags: [type/debug, status/active, domain/database, domain/backend]
created: 2026-05-07
---

# Fix RF Putaway `row_to_jsonb` Trigger Bug

## Symptom

Warehouse RF Putaway operators couldn't submit putaways. The browser console emitted, on every submit attempt:

```
❌ RF Putaway Service: Database error: {
  code: '42883',
  details: null,
  hint: 'No function matches the given name and argument types. You might need to add explicit type casts.',
  message: 'function row_to_jsonb(rf_putaway_operations) does not exist'
}
```

The entire putaway insert + cart-clear transaction rolled back, so the operator saw a hard failure with no row written.

**Calling chain (FE → PG):**

- `src/lib/supabase/rf-putaway.service.ts → createPutaway()` calls the RPC `complete_putaway_and_clear_cart` (migration 186, `SECURITY DEFINER`).
- Inside that RPC: `INSERT INTO rf_putaway_operations (…)`.
- The INSERT fires the `AFTER INSERT` trigger `rf_putaway_notify_changed` (migration 276), which executes `public.notify_rf_putaway_changed()`.
- That function attempted to call `row_to_jsonb(NEW)` — **a function that does not exist in any Postgres version**. The 42883 surfaced inside the trigger and rolled back the entire RPC transaction.

## Root cause

**This is NOT a `search_path` bug** — the framing the incident report initially proposed. Verified directly against the live database:

```sql
SELECT proname, pronamespace::regnamespace::text AS schema,
       pg_catalog.pg_get_function_identity_arguments(oid) AS args,
       pg_catalog.pg_get_function_result(oid) AS returns
FROM   pg_catalog.pg_proc
WHERE  proname IN ('row_to_jsonb','row_to_json');

--  proname     | schema     | args              | returns
--  row_to_json | pg_catalog | record            | json
--  row_to_json | pg_catalog | record, boolean   | json
--  (no rows for row_to_jsonb in any schema)
```

Postgres 17 (and every prior version) provides:

- `pg_catalog.row_to_json(record) → json` — returns json (not jsonb), can be cast.
- `pg_catalog.to_jsonb(anyelement) → jsonb` — returns jsonb directly, accepts records.

There has never been a `row_to_jsonb(record)` built-in. Migration 276 (`276_notify_rf_putaway_changed.sql`, applied 2026-05-07 03:25 UTC as part of the rust-work-service Phase 4 ship) was written with a typo — the author mentally combined `row_to_json` and `to_jsonb` into a non-existent third function. The function definition itself parsed and stored fine because Postgres only resolves call sites at execution time; the failure first surfaced when the trigger actually fired against an inserted row.

The `SET search_path = public, pg_temp` setting on the function is a red herring. Postgres always implicitly searches `pg_catalog` first regardless of `search_path` (per the docs: *"the system catalog schema, pg_catalog, is always searched, whether it is mentioned in the path or not"*), and the other built-ins in the same function body (`pg_notify`, `json_build_object`) resolved correctly.

## Fix

New migration [`supabase/migrations/285_fix_notify_rf_putaway_row_to_jsonb.sql`](../../../supabase/migrations/285_fix_notify_rf_putaway_row_to_jsonb.sql) — minimal `CREATE OR REPLACE FUNCTION` that swaps the single offending line and preserves every other attribute verbatim (SECURITY DEFINER, search_path, language, returns):

```sql
CREATE OR REPLACE FUNCTION public.notify_rf_putaway_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_notify('rf_putaway_operation_changed', json_build_object(
    'row_id',           NEW.id,
    'organization_id',  NEW.organization_id,
    'op',               TG_OP,
    'new',              to_jsonb(NEW)   -- was: row_to_jsonb(NEW)
  )::text);
  RETURN NEW;
END;
$$;
```

Applied via Supabase MCP `apply_migration` 2026-05-07. The trigger `rf_putaway_notify_changed` was NOT touched — it still binds to this function by name.

**Wire-format compatibility:** `to_jsonb(NEW)` and the (intended) `row_to_jsonb(NEW)` produce semantically identical jsonb — a JSON object keyed by column name. The Rust listener (`rust-work-service/src/rf_putaway_listener.rs`) deserializes `new` as a loose `serde_json::Value`, so consumers see no observable difference.

**Rollback documented in the migration header.**

## Verification

1. Function definition refreshed:

   ```sql
   SELECT pg_get_functiondef(oid)
   FROM pg_proc
   WHERE proname = 'notify_rf_putaway_changed' AND pronamespace = 'public'::regnamespace;
   -- returns the new body with to_jsonb(NEW)
   ```

2. End-to-end trigger fire under transaction, rolled back so no production data was touched:

   ```sql
   DO $$
   DECLARE v_org uuid; v_user uuid; v_id uuid;
   BEGIN
     SELECT organization_id INTO v_org FROM rf_putaway_operations LIMIT 1;
     SELECT created_by      INTO v_user FROM rf_putaway_operations WHERE created_by IS NOT NULL LIMIT 1;
     v_id := gen_random_uuid();

     INSERT INTO rf_putaway_operations (
       id, organization_id, material_number, to_location, to_number, raw_to_number,
       warehouse, shelf_location, putaway_driver, to_status, is_mca_workflow,
       putaway_date, putaway_time, scanner_type, created_by, created_at, updated_at
     ) VALUES (
       v_id, v_org, 'TEST_MIG285', 'K1-23-03-2', '9999999', '9999999$X0001$XXX',
       'XXX', 'K1-23-03-2', 'migration-285-verify', 'Completed', false,
       CURRENT_DATE, CURRENT_TIME, 'RF Terminal Verify', v_user, now(), now()
     );
     RAISE EXCEPTION 'rollback_after_verify';
   EXCEPTION WHEN raise_exception THEN
     IF SQLERRM = 'rollback_after_verify' THEN NULL; ELSE RAISE; END IF;
   END $$;
   ```

   Result: no error. Pre-fix the INSERT would have raised `42883` *before* the explicit `rollback_after_verify`, surfacing the original failure mode. Post-fix the trigger ran cleanly. `pg_notify` payloads are themselves suppressed by transaction rollback, so the rust-work-service WS bus never saw the test event — zero observable side effects.

3. Leak check confirmed zero `TEST_MIG285` / `migration-285-verify` rows persisted (`SELECT count(*) ... = 0`).

## Manual verification procedure (for the user)

1. Open the RF Terminal in a browser, sign in as a putaway operator.
2. Scan a TO Number + material + shelf location and submit one putaway operation.
3. Expected: the operation completes, the row appears in `rf_putaway_operations` (visible in the recent putaways list), no `❌ RF Putaway Service: Database error` line in the console.
4. Optional second check: in any other tab open `rust-work-service` logs and confirm a `WsEvent::RfPutawayChanged` line is broadcast within ~50ms of the submit.

## Why this is unrelated to today's realtime/presence sprint

Today's UI/presence sprint ([[Implement-LiveOperatorStatus-InBuilding-Tab]], [[Re-Enable-CurrentPage-In-ActiveOperators]], [[Realtime-Presence-Browser-Hardening]]) did not touch any backend trigger, RPC, migration, or `rf_putaway_*` code path. None of the workers' diffs reference `notify_rf_putaway_changed`, `rf_putaway_operations`, `complete_putaway_and_clear_cart`, or the `row_to_jsonb` typo.

The broken function was introduced by migration 276 (`v1.9.0 — agent-on-Rust-WS migration, Phase 4`, see [[Implement-Rust-Work-Service-Phase4]]) which was applied **earlier today (2026-05-07 03:25 UTC) as part of the Rust-Work-Service integration plan**, not as part of the realtime/presence sprint. Future post-mortems should attribute the regression to the Phase 4 ship, not the presence work that ran in parallel.

A secondary lesson: this typo slipped through CI because PL/pgSQL only resolves call-site overloads at execution time, and there is no `rf_putaway_operations` row inserted during `pnpm build` or `cargo test`. The trigger first fired against a real warehouse putaway in production. We should consider adding an integration test that asserts INSERTs through `complete_putaway_and_clear_cart` succeed end-to-end (including the AFTER trigger).

## Suspected latent siblings

Queried the entire database for other functions calling the non-existent `row_to_jsonb`:

```sql
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  p.prokind = 'f'
  AND  pg_get_functiondef(p.oid) ILIKE '%row_to_jsonb%'
  AND  n.nspname NOT IN ('pg_catalog','information_schema');

--  nspname | proname                    | args
--  public  | notify_rf_putaway_changed  | (empty)
```

**Zero other functions affected** — the typo is contained to migration 276. The codebase grep confirmed: only `supabase/migrations/276_notify_rf_putaway_changed.sql` and a comment-only reference in `supabase/migrations/284_optimize_rf_putaway_replica_identity.sql` mention `row_to_jsonb`. No latent sibling fixes required.

(Aside on the `SET search_path = public, pg_temp` pattern: many of today's NOTIFY-trigger functions — `notify_sap_agent_changed`, `notify_sap_agent_jobs_changed`, etc. — use the same hardening pattern. They all use `jsonb_build_object` / `pg_notify` / column lookups, none use `row_to_jsonb`. They are correct as-shipped.)

## Related

- [[Implement-Rust-Work-Service-Phase4]] — the migration that introduced the typo (276)
- [[Omni-Agent - Headless SAP Agent]] — the omni_agent's `_on_rf_putaway_change` evaluator consumes the (now-working) NOTIFY payload
- [[Rust-Work-Service]] — hosts the `rf_putaway_listener.rs` PgListener that broadcasts `WsEvent::RfPutawayChanged`
- [[Roadmap-Rust-WS-Unlocks]] — the broader "move org-fanout off Supabase Realtime" plan that motivated migration 276
- [[2026-05-07]] — today's session log
