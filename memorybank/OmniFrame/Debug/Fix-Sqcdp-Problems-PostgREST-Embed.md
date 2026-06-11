---
tags: [type/debug, status/active, domain/database, domain/api, domain/frontend]
created: 2026-05-10
---
# Fix — `sqcdp_problems` PostgREST Embed (PGRST200)

## Symptom

Production console error, repeating every 60 s (the SQCDP problems poll cadence):

```
GET /rest/v1/sqcdp_problems?select=...&owner:user_profiles!assigned_to(full_name)&...
  400 (Bad Request)

[useSqcdpProblems] query failed
{
  code: 'PGRST200',
  message: "Could not find a relationship between 'sqcdp_problems' and 'user_profiles' in the schema cache"
}
```

Originated from [[Implement-Production-Boards-Hourly-Grid]] § v6 (migration 295) and recurred for every Production-Boards user-attribution column.

## Root Cause

Migration 295 created `sqcdp_problems.assigned_to uuid REFERENCES auth.users(id)`. PostgREST builds its relationship cache by walking foreign-key constraints whose **target table lives in an exposed schema**. `auth.users` lives in the `auth` schema (not exposed via PostgREST), so PostgREST can never see a relationship between `public.sqcdp_problems.assigned_to` and `public.user_profiles.id` — even though `user_profiles.id` is itself a 1-to-1 FK back to `auth.users.id`.

The browser's embed `owner:user_profiles!assigned_to(full_name)` therefore 400'd with `PGRST200` on every poll cycle. Same shape impacted **seven** columns across the Production Boards feature module:

| Table | Column | Pre-fix target |
| --- | --- | --- |
| `sqcdp_problems` | `assigned_to` | `auth.users(id)` |
| `sqcdp_problems` | `reported_by` | `auth.users(id)` |
| `sqcdp_metrics` | `created_by` | `auth.users(id)` |
| `sqcdp_metrics` | `updated_by` | `auth.users(id)` |
| `production_board_posts` | `posted_by` | `auth.users(id)` |
| `production_board_post_acks` | `user_id` | `auth.users(id)` |
| `production_board_job_postings` | `posted_by` | `auth.users(id)` |

## Remediation

Migration **298** (`supabase/migrations/298_production_boards_user_profiles_fks.sql`) — drop each `auth.users` FK and re-add against `public.user_profiles(id)` with the same `ON DELETE` semantics. Ends with `NOTIFY pgrst, 'reload schema'` so PostgREST picks up the new relationships without a service restart.

**Why swap, not add a second FK:** a column with two FKs (one to `auth.users`, one to `user_profiles`) confuses PostgREST's auto-discovery — it would either return ambiguous-relationship hints or stay 400. A single FK to `user_profiles` is unambiguous and the link to `auth.users` is preserved transitively through `user_profiles.id_fkey`.

**Pre-flight orphan check** (run before the swap): zero rows had a value pointing to a non-existent `user_profiles.id` for any of the seven columns — confirming the safety of the swap because `user_profiles` is auto-populated by trigger for every `auth.users` insert.

## Lesson — Pattern for Future Tables

**When creating new public tables that need PostgREST embeds for user names, FK to `public.user_profiles(id)`, NOT `auth.users(id)`.** The `user_profiles` table is auto-populated by trigger so the FK still validates against every authenticated user, AND PostgREST can embed it via the standard `target:user_profiles!fk_name(full_name)` syntax.

If you find yourself writing `REFERENCES auth.users(id)` in a new migration that the frontend is going to embed, stop and:

1. Replace with `REFERENCES public.user_profiles(id) ON DELETE SET NULL` (or `CASCADE` for ack-style join tables).
2. Or, if you must keep the `auth.users` FK for some reason, ALSO maintain a parallel column pattern + CHECK + trigger — but that's almost never worth it.

The canonical 1-to-1 invariant `user_profiles.id REFERENCES auth.users(id) ON DELETE CASCADE` (defined in earlier migrations) is what makes this safe.

## Verification

Post-migration `pg_catalog` query confirmed all seven constraints now reference `user_profiles(id)`:

```sql
SELECT n.nspname || '.' || cl.relname AS table_name, conname AS constraint_name,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class cl ON cl.oid = c.conrelid
JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE c.contype = 'f' AND n.nspname = 'public'
  AND conname IN (
    'sqcdp_problems_assigned_to_fkey','sqcdp_problems_reported_by_fkey',
    'sqcdp_metrics_created_by_fkey','sqcdp_metrics_updated_by_fkey',
    'production_board_posts_posted_by_fkey',
    'production_board_post_acks_user_id_fkey',
    'production_board_job_postings_posted_by_fkey'
  );
```

Returned 7 rows, every `definition` ending in `REFERENCES user_profiles(id)`.

## Files Touched

- `supabase/migrations/298_production_boards_user_profiles_fks.sql` (new)

No frontend code changes required — `useSqcdpProblems`, `useBoardPosts`, and `useJobPostings` already use the correct PostgREST embed syntax; they were just waiting for the FK to be visible.

## Related

- [[ProductionBoards - Feature Module]]
- [[Implement-Production-Boards-Hourly-Grid]] § v11
- [[Sessions/2026-05-10]]
