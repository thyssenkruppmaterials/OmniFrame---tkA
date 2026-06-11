---
tags: [type/decision, status/active, domain/database, domain/frontend]
created: 2026-05-17
---

# ADR — SQCDP category schema (per-org table vs enum)

## Context

Since the v1 production-boards landing (migration 295), SQCDP categories were modelled as a Postgres `sqcdp_category` ENUM with 9 hardcoded values (`safety`, `quality`, `cost`, `delivery`, `production`, `maintenance`, `shipping`, `big_idea`, `announcement`). The enum sat behind both `sqcdp_metrics.category` and `sqcdp_problems.category`.

The v14 editor pass ([[Implement-SQCDP-Editor-Fine-Grained-Controls]]) gave curators rich per-metric controls but kept the category list locked. Curator request (2026-05-17): *"Please add the ability to make changes to this by adding categories and removing categories."*

## Decision

Replace the global enum with a per-org `production_board_sqcdp_categories` table. Curators (with `production_boards:edit`) can add custom categories, hide builtins, reorder either tier (primary / secondary), edit label / icon / color, and delete custom rows once nothing references them.

Key schema choices baked into [[Implementations/Implement-SQCDP-Editable-Categories]] / migration `306_production_boards_sqcdp_categories.sql`:

- **Per-org rows**, not global rows. Different shop floors want different scorecards (pharma → Compliance + Audits; logistics → On-Time + Damages). One global table forces the whole org tree to share — exactly the opposite of what curators are asking for.
- **`is_builtin BOOLEAN`** marks the 9 canonical SQCDP entries. They cannot be hard-deleted (the manager UI swaps Delete → Hide for builtins) so the muscle-memory of "S-Q-C-D-P" survives even if a curator wants to hide e.g. Big Idea on a specific tenant.
- **`is_hidden BOOLEAN`** carries the soft-delete semantics for builtins AND the "this isn't relevant on this floor" signal for customs.
- **Tier as a TEXT CHECK constraint**, not a dedicated enum. Adding the `tier` column as an enum would re-introduce the same migration pain we're escaping with this very change — three values (`primary` / `secondary` / future `tertiary`) is fine to gate at the row level.
- **Slug shape enforced via CHECK** (`^[a-z0-9_]+$` / 1..64 chars) so the FK from `sqcdp_metrics.category` lands on predictable values; the runtime `slugifyCategoryLabel` helper produces this format.
- **`sqcdp_metrics.category` + `sqcdp_problems.category` converted from `sqcdp_category` ENUM → TEXT** + composite FK `(organization_id, category) → production_board_sqcdp_categories(organization_id, slug)`. The 9 enum values are exact slug matches for the seeded builtins, so the cast `category::text` lands on a valid FK target for every existing row. FKs are `DEFERRABLE INITIALLY DEFERRED` so a future "rename a category slug" workflow can update the categories row + the referencing rows in the same transaction.
- **Backfill all existing orgs at migration time** plus an **`AFTER INSERT ON organizations` trigger** that auto-seeds the 9 builtins for any new tenant. Without the trigger, a freshly provisioned tenant would fail FK on first metric creation. Hardened with `SECURITY DEFINER + REVOKE EXECUTE FROM PUBLIC` so only the trigger can invoke the seeder (silences advisor `0028_anon_security_definer_function_executable`).
- **`ON DELETE RESTRICT` on the FK**. Deleting a category that has metrics or problems referencing it surfaces a friendly error in the manager UI; the curator must move or delete the references first (or just hide the category). The frontend pre-flight checks the metrics + problems list and disables Delete with explanatory copy when references exist; the FK is the canonical safety net.
- **No new Realtime channel**. Honoured `realtime-policy.mdc` — mutations invalidate the org's `['sqcdp-categories', orgId]` query key on settle; the read query polls at 60s for multi-curator concurrent editing. The category list mutates rarely so polling is plenty.

## Rejected alternatives

1. **Add an `'X'::sqcdp_category, 'Y'::sqcdp_category, ...` extension to the existing enum.** PostgreSQL allows `ALTER TYPE ... ADD VALUE` but new values can never be removed without dropping + recreating the type, and ordering / per-org membership / per-org colors / per-org tier are all unrepresentable on an enum. Curators would still need to wait on a migration for every "can we add Compliance to our scorecard" request.

2. **Drop the FK entirely; loosen `category` to free-form TEXT and let RLS / app-layer validation handle integrity.** Rejected — without referential integrity, hidden / renamed / mistyped categories silently turn metrics into orphans. The composite-FK pattern matches every other org-scoped table in the schema (`shift_assignments → shift_positions`, `kit_kanban_tasks → kit_kanban_columns`, etc.).

3. **Keep the enum + add a `production_board_sqcdp_categories` overlay table holding only the per-org metadata (label, icon, color, hidden, order).** This was the early sketch but it forces every read to JOIN the overlay and creates an invariant the schema can't enforce: "the overlay row's slug must match an enum value". Single source of truth (the table) is simpler.

4. **Seed only orgs that already have `sqcdp_metrics` rows.** This was suggested in the brief to avoid "seeding every org in the DB". Rejected because (a) the table is org-scoped + the FK requires a target before any new metric can be created, so a not-yet-seeded org would silently fail metric creation; (b) `production_boards` itself is already seeded for every org by migration 295 — the category seed should match that posture; (c) the per-org row count is small (9 × N) so the storage cost is negligible.

5. **Hard-delete builtins but require a confirm dialog with "Are you SURE".** Rejected because muscle-memory matters — even on a floor where Big Idea isn't actively curated, the scorecard's "S-Q-C-D-P" mnemonic shouldn't be partially erasable. Hide-only on builtins lets curators tune visibility without losing the option to bring it back later.

## Backwards compatibility

- Every existing `sqcdp_metrics` / `sqcdp_problems` row's `category` value continues to resolve. The migration's seed re-creates each builtin slug for every org before the column type is loosened, so the cast `enum → text` lands on a valid FK target.
- Frontend `getCategory(id, list)` falls back to the builtin seed when a slug isn't in the passed list, so any rare race where the UI renders before the categories query resolves still paints the canonical 9 categories rather than a degraded "unknown category" placeholder.
- `BUILTIN_CATEGORY_SEED` in `lib/categories.ts` is the runtime mirror of the migration's seed. A unit test in `categories.test.ts` enforces shape parity (9 entries, primaries first, valid hex colors).

## Operational impact

- Pre-existing metrics: zero migration drift (the 9 enum values are slug-identical to the seed). Pre-existing problem rows: same.
- New custom categories: created via the `<SqcdpCategoryManagerDialog>` (gated by `production_boards:edit`). Mutations issue 1 round-trip per CRUD op; reorders fan out N updates (one per moved row, capped at the tier's row count, typically ≤ 12).
- TV grid: hard-coded 5+3 layout retired. Both row counts are now dynamic (1..6 columns per tier, clamped) with primary tier flex weight ~1.5× secondary's. See [[Patterns/TV-Viewport-Fit-Grid]] § Dynamic counts.
- Polling: read query at 60s `staleTime` + 60s `refetchInterval`. Stays under the workspace's no-new-Realtime ceiling.

## Related

- [[Implementations/Implement-SQCDP-Editable-Categories]] — full implementation log + file inventory.
- [[Patterns/TV-Viewport-Fit-Grid]] — extended with the dynamic-count variant.
- [[Implementations/Implement-SQCDP-Editor-Fine-Grained-Controls]] — the v14 editor this work extends.
- [[Components/ProductionBoards - Feature Module]] — the feature module surface.
- [[Decisions/ADR-Board-Posts-Schema-Extension]] — sibling decision (post composer schema extension) from the same day.
- `supabase/migrations/306_production_boards_sqcdp_categories.sql` — the canonical SQL.
