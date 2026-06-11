---
tags: [type/decision, status/active, domain/database, domain/frontend]
created: 2026-04-19
---
# ADR: Convert `count_type` From Enum To Free-Form TEXT

## Purpose / Context
Pre-migration, both `cycle_count_workflow_configs.count_type` and `rr_cyclecount_data.count_type` used the Postgres enum `count_type_enum` with 10 hardcoded members. Admins had no way to define new count types without a DB migration to extend the enum. Operators complained that creating custom workflows (e.g. "Daily Bin Sweep", "Cold Storage Audit") required a code deploy.

## Decision
Migration 217 drops `count_type_enum` and retypes both columns as `TEXT`, guarded by a `CHECK` constraint that enforces a slug shape (`^[a-z0-9][a-z0-9_]{0,62}[a-z0-9]$`). `cycle_count_workflow_configs` remains the source of truth for valid count types per organization (enforced by its `UNIQUE(organization_id, count_type)`).

The SQL helper `get_count_type_display_name` was rewritten to resolve labels dynamically: workflow config first, then built-in defaults, then a prettified version of the slug. Frontend label resolution mirrors this via `resolveCountTypeLabel()`.

## Alternatives Considered
1. **Keep the enum, add a function that calls `ALTER TYPE ADD VALUE` at runtime.** Rejected — requires elevated DB privileges from the API, can't run inside a transaction, and the new value only becomes visible after the current transaction commits. Fragile.
2. **Keep the enum and pre-seed many placeholder values.** Rejected — still requires DB migrations for every new type and leaves dead enum members behind.
3. **Free-form TEXT with `CHECK` slug validation (chosen).** Simple, flexible, validated at write time, and no privilege escalation needed.

## Implementation
- Migration: `supabase/migrations/217_convert_count_type_to_text.sql`.
- Hook: `src/hooks/use-count-type-options.ts`.
- UI: "+ New" button + dialog in `src/components/count-settings.tsx` (see [[Add-New-Count-Workflow-Button]]).
- Consumers now read the merged list from `useCountTypeOptions()`.

## Consequences
- Admins can now create, rename, and disable custom count workflows with no code changes.
- `count_type_enum` is gone; any code that imported it via `Database['public']['Enums']['count_type_enum']` was updated to `string`.
- The `get_count_type_display_name` function now depends on `cycle_count_workflow_configs` — a stable reference, but worth remembering during future table renames.
- Running Supabase `generate_typescript_types` against this repo would wipe manually curated type aliases and unmask unrelated PostgREST errors. Use surgical edits instead.

## Related
- [[Add-New-Count-Workflow-Button]]
- [[Configuration Services - Supabase Service]]
