---
tags: [type/debug, status/active, domain/database, domain/frontend]
created: 2026-05-19
---
# Fix Outbound Import ON CONFLICT Constraint Mismatch

## Purpose / Context

User reported "Import failed: there is no unique or exclusion constraint matching the ON CONFLICT specification" from the Outbound Data Manager's **Import from File** (clipboard TSV/CSV) path. Every clipboard import was 100% broken in production.

Root cause was a regression introduced in [[Apply-Performance-Review-Fixes-2026-05-19]]: the `bulkInsertOutboundData` upsert references plain columns in `onConflict`, but the only unique constraint covering those columns was an **expression index** (from `supabase/migrations/047_fix_outbound_duplicates.sql`) using `COALESCE(col, '')` wrappers. PostgreSQL's `ON CONFLICT (cols)` cannot match expression indexes — only constraints/indexes on those EXACT plain columns.

Fleet-Agent / LT22 path was unaffected because it writes to a different staging table (`sap_outbound_to_imports`).

## Details

### Failing code path

`src/lib/supabase/outbound-to-data.service.ts` (`bulkInsertOutboundData`):

```ts
await supabase
  .from('outbound_to_data')
  .upsert(insertData, {
    onConflict:
      'organization_id,delivery,transfer_order_number,material,batch,source_storage_bin',
    ignoreDuplicates: true,
  })
  .select()
```

PostgREST translates this to:

```sql
INSERT INTO outbound_to_data (...)
VALUES (...)
ON CONFLICT (organization_id, delivery, transfer_order_number, material, batch, source_storage_bin)
DO NOTHING
RETURNING *;
```

### What was actually in the DB

`pg_indexes` showed only ONE unique index covering the conflict target:

```sql
CREATE UNIQUE INDEX idx_outbound_to_data_unique_record
ON public.outbound_to_data
USING btree (
  organization_id,
  COALESCE(delivery, ''::varchar),
  COALESCE(transfer_order_number, ''::varchar),
  COALESCE(material, ''::varchar),
  COALESCE(batch, ''::varchar),
  COALESCE(source_storage_bin, ''::varchar)
);
```

`ON CONFLICT (col_list)` does NOT match this — the indexed expressions aren't the bare column references. Hence the "no unique or exclusion constraint matching" error every single time.

### Fix — Migration 320

[[supabase/migrations/320_outbound_to_data_unique_plain_columns.sql]]:

1. Safety dedupe (`ROW_NUMBER() OVER (PARTITION BY ...)` keeping `created_at DESC NULLS LAST, id DESC`).
2. `DROP INDEX idx_outbound_to_data_unique_record` (the COALESCE expression index).
3. `ALTER TABLE outbound_to_data ADD CONSTRAINT outbound_to_data_unique_record UNIQUE NULLS NOT DISTINCT (organization_id, delivery, transfer_order_number, material, batch, source_storage_bin)`.

`UNIQUE NULLS NOT DISTINCT` (PostgreSQL 15+) treats two NULLs as equal for uniqueness purposes — same semantic the COALESCE-to-empty-string index was emulating, AND it works with `ON CONFLICT (cols)`.

Behavioral edge case: the previous index treated `NULL` and `''` as the same value; the new constraint treats them as different. The transform layer (`transformRowToDatabase`) already coerces empty strings to NULL before insert, so production data never has `''` in these columns — dedupe behavior stays equivalent in practice.

### Verification

Post-migration smoke test (DO block running an `INSERT ... ON CONFLICT (cols) DO NOTHING` with a `WHERE false` guard) parsed successfully. Pre-migration, the same statement would have raised the "no unique or exclusion constraint matching" error.

```sql
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.outbound_to_data'::regclass AND contype = 'u';
```

Returns:
- `outbound_to_data_unique_record` → `UNIQUE NULLS NOT DISTINCT (organization_id, delivery, transfer_order_number, material, batch, source_storage_bin)`
- `outbound_to_data_transfer_order_number_material_batch_sourc_key` → `UNIQUE (transfer_order_number, material, batch, source_storage_bin)` (unchanged, but see Follow-ups below).

### Frontend code update

Replaced the misleading comment in `bulkInsertOutboundData` (which claimed PostgREST emits `ON CONFLICT (idx_outbound_to_data_unique_record)` — it doesn't, it emits a plain column list) with an accurate description pointing at migration 320 and this debug note.

## Follow-ups

- **`outbound_to_data_transfer_order_number_material_batch_sourc_key`** is a UNIQUE constraint on `(transfer_order_number, material, batch, source_storage_bin)` WITHOUT `organization_id`. That's a cross-tenant uniqueness constraint — two orgs cannot have the same TO/material/batch/bin combination. Likely a multi-tenant bug, but out of scope for this fix. File an ADR before removing.
- **PostgREST `onConflict` should ideally reference a constraint NAME, not a column list**, but supabase-js v2 doesn't expose that surface. Keep the plain-column form synced with the constraint columns whenever either changes.

## Related
- [[Apply-Performance-Review-Fixes-2026-05-19]] — introduced the upsert that exposed this bug
- [[Performance-Review-2026-05-19-Production-Slowness]] — original perf review
- [[Implement-Fleet-Aware-SmartImportButton]] — the unrelated agent path that wasn't affected
- [[_Index/Debug]]
