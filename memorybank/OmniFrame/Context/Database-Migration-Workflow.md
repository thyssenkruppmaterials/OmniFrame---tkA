---
tags: [type/context, status/active, domain/database]
created: 2026-05-10
---
# Database Migration Workflow

Per user directive 2026-05-10, **all Supabase migrations on this project are applied via the Supabase MCP** (`project-0-OneBoxFullStack-supabase` server, `apply_migration` tool). Local-only `supabase` CLI is acceptable for development against a local stack; production / shared-environment migrations go through MCP.

## Why

MCP gives a uniform path with structured pre/post verification (`list_migrations`, `execute_sql`, `get_advisors`, `get_logs`) and records every apply in `supabase_migrations.schema_migrations` against the live project (`wncpqxwmbxjgxvrpcake`). The CLI does the same thing for local stacks but does not have the same surface for advisor / log inspection of the live project.

## Tooling

- **Server**: `project-0-OneBoxFullStack-supabase`
- **Apply tool**: `apply_migration` — takes `name` (snake_case) and `query` (the SQL content). Records the migration in `supabase_migrations.schema_migrations`. Use this for any DDL or seed migration.
- **Verification tools** (read-only):
  - `list_migrations` — confirm pre-/post-state of the migration ledger.
  - `list_tables` — confirm target tables exist (and whether RLS is enabled).
  - `execute_sql` — targeted read queries to confirm row presence / shape. Do **not** use this for DDL — that's what `apply_migration` is for.
  - `get_advisors` (security + performance) — flag any new lints introduced by the migration.
  - `get_logs` (postgres) — confirm no errors fired during apply.

## Standard sequence

1. **Read** the migration file (`supabase/migrations/NNN_*.sql`) to understand what tables / rows / functions it touches.
2. **Pre-state check** (in parallel where possible):
   - `list_migrations` — confirm the migration name is NOT already in the ledger.
   - `list_tables` — confirm target tables exist with the expected shape.
   - `execute_sql` — confirm target rows are absent / pre-conditions are met.
3. **Apply** via `apply_migration`. One call. If it fails, capture the error verbatim and inspect (FK violations, missing prerequisite rows, unique-constraint hits, etc.) — do **not** retry blindly.
4. **Post-state check** (in parallel):
   - `list_migrations` — confirm the new entry is now last.
   - `execute_sql` — confirm seeded rows / DDL outcomes match expectation.
   - `get_advisors` (security + performance) — note any lints that newly reference the touched tables.
   - `get_logs` (postgres) — confirm no errors at apply time.
5. **Vault**: append a section to today's `Sessions/YYYY-MM-DD.md`; update / cross-link relevant Implementation / Debug / Decision notes; mark any related follow-ups as done.

## When NOT to use MCP

- Local Supabase development (`supabase start`) — use the local CLI for iteration.
- Schema-introspection-only queries (no writes) — `execute_sql` (read-only) is fine.
- Edge-function deployment — that's `deploy_edge_function`, not `apply_migration`.

## Idempotency

Migrations should be written so a re-apply is safe (`ON CONFLICT DO UPDATE`, `IF NOT EXISTS`, `CREATE OR REPLACE`, etc.). If pre-state check shows the migration appears partially applied (some rows / DDL present, others not), STOP and report rather than try to patch up the partial state — the SQL needs review first.

## Reference applies (post-policy)

- 2026-05-10 — `294_seed_work_queue_management_tab` (Work Queue Management tab seed). Closes follow-up #1 in [[Implement-Work-Queue-Management-Tab]]. Detailed apply log in [[Sessions/2026-05-10]].
- 2026-05-10 (earlier same day) — `292_add_production_boards_navigation` + `293_production_boards_role_backfill` were both applied via the same MCP path during [[Fix-Production-Boards-403]]; they predate this canonical note but follow the same workflow.

## Related
- [[Migration-History]] — what migrations exist (the ledger).
- [[Supabase-Configuration]] — Supabase project / RLS / client setup.
- [[Implement-Work-Queue-Management-Tab]] — first apply under the explicit policy.
- [[Fix-Production-Boards-403]] — same-day prior applies via the same workflow.
