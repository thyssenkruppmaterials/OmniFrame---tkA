---
tags: [type/debug, status/active, domain/database, domain/frontend]
created: 2026-05-10
---
# Fix — `sqcdp_metric_history.source` Missing Column

## Symptom

Production console error every 60 s (the SQCDP history poll cadence) once the v10 editor dialog mounts:

```
GET /rest/v1/sqcdp_metric_history?select=id,metric_id,recorded_at,value,source&...
  400 (Bad Request)

{
  message: "column sqcdp_metric_history.source does not exist",
  hint:    "Could not find the 'source' column of 'sqcdp_metric_history' in the schema cache"
}
```

Blast radius — the SQCDP history editor was completely broken (every poll 400'd, no rows ever rendered, the "Generate sample data" button was dead because its bulk INSERT also wrote `source`). Originated from [[Implement-Production-Boards-Hourly-Grid]] § v10.

## Root Cause

Migration 295 created `sqcdp_metric_history` without a `source` column:

```sql
CREATE TABLE IF NOT EXISTS sqcdp_metric_history (
  id              BIGSERIAL PRIMARY KEY,
  metric_id       UUID NOT NULL REFERENCES sqcdp_metrics(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  value           NUMERIC NOT NULL,
  note            TEXT
);
```

But the v10 implementation log explicitly described `source = 'manual' | 'sample'` semantics, and the v10 worker (`useSqcdpMetricHistory`) shipped reading + writing `source` on every CRUD path:

- `select('id, metric_id, recorded_at, value, source')` — every poll.
- `insert({ ..., source: input.source ?? 'manual' })` — `createPoint`.
- `insert({ ..., source: i.source ?? 'sample' })` — `bulkInsertPoints` (Generate sample data).
- `update({ source: input.source })` — `updatePoint`.

Net: spec → worker drift. The v10 hand-off documented the column as part of the contract; the migration body didn't include it. No test caught it because the unit tests mock `supabase` without round-tripping through PostgREST's schema cache.

## Remediation

Migration **299** (`supabase/migrations/299_sqcdp_metric_history_source.sql`) — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS source text`. Free-form `text`, not enum, so future provenance labels (`imported`, `csv`, `auto`, ...) don't require another migration. Nullable because existing rows have no source and the hook tolerates `null` (see `mapPoint(raw): { ..., source: raw.source ?? null }`). Ends with `NOTIFY pgrst, 'reload schema'` so PostgREST picks up the new column without a service restart.

No backfill — the table had only sparse manual entries from initial QA usage; existing rows live as `NULL` (interpreted as "unknown source"). New writes from the editor land with `'manual'` or `'sample'` per the worker's defaults.

No frontend code changes — the worker was already correct; it was waiting for the column to exist.

## Lesson — Pattern for Future Worker Hand-offs

**When a worker spec lists columns that the migration body skips, audit the live schema BEFORE the dependent FE worker is wired up.** A 30-second `\d+ table_name` against the live DB after migration apply would have caught this; the implementation note and the migration are two separate artefacts and they can drift silently.

Concrete checklist for any new worker that touches a fresh table:

1. After applying the migration, run `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '<table>'` and diff against the worker's `select(...)` + `insert({...})` callsites.
2. Add a smoke integration test (in `tests/integration/`) that round-trips one INSERT + SELECT against the real Supabase target. Mocked unit tests can't catch column drift because they don't hit PostgREST.
3. If the worker depends on a column for a NON-NULL semantics (provenance label, audit field), make the column `NOT NULL` in the migration and write a default — the type system can't compensate at runtime.

This is sibling guidance to [[Fix-Sqcdp-Problems-PostgREST-Embed]]: that one was about a relationship being invisible to PostgREST; this one is about a column being absent from the table entirely. Both classes of bug surface as 400 on the very first poll once the dependent FE lands.

## Verification

Post-migration schema query:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sqcdp_metric_history'
ORDER BY ordinal_position;
-- id              bigint                       NO
-- metric_id       uuid                         NO
-- organization_id uuid                         NO
-- recorded_at     timestamp with time zone     NO
-- value           numeric                      NO
-- note            text                         YES
-- source          text                         YES   ← new
```

The exact failing browser query now succeeds:

```sql
SELECT id, metric_id, recorded_at, value, source
FROM sqcdp_metric_history
WHERE metric_id = '06a78428-0e6a-4fde-8783-4f7fbe8ede69'
  AND recorded_at >= '2025-11-11T17:59:35.777Z'::timestamptz
ORDER BY recorded_at ASC LIMIT 5;
-- 1 row, source = NULL (existing pre-migration row).
```

## Files Touched

- `supabase/migrations/299_sqcdp_metric_history_source.sql` (new)

No frontend code changes — the v10 worker was already wired for the column.

## Related Drift Audit (negative — no further fixes)

While in the schema, also confirmed against the v6/v9/v10 spec:

- `sqcdp_metrics` — all columns present (`id, organization_id, category, title, subtitle, value_format, current_value, target_value, unit, trend_period, color_hex, accent_hex, is_visible, display_order, notes, created_by, updated_by, created_at, updated_at, chart_type, show_markers`). Spec mentioned `last_data_at` but no FE callsite reads it (`rg last_data_at` → 0 results), so it's a doc-only artefact, not real drift.
- `sqcdp_problems` — all columns present (`id, organization_id, category, title, description, severity, status, reported_by, assigned_to, reported_at, due_at, resolved_at, notes, created_at, updated_at`).

Migration 299 is therefore tightly scoped to the one column the FE actually reads.

## Related

- [[Fix-Sqcdp-Problems-PostgREST-Embed]] — sibling Production Boards triage from the same day.
- [[Implement-Production-Boards-Hourly-Grid]] § v10 (where the worker landed) and § v11.1 (this fix).
- [[ProductionBoards - Feature Module]]
- [[Sessions/2026-05-10]]
