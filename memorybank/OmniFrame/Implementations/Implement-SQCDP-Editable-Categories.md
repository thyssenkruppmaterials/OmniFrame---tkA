---
tags: [type/implementation, status/active, domain/frontend, domain/database]
created: 2026-05-17
---

# Implement SQCDP Editable Categories

## Purpose / Context

Curators previously had to live with the 9 hardcoded SQCDP categories baked in by [[Components/ProductionBoards - Feature Module]] / migration 295. The user request (2026-05-17): *"Please add the ability to make changes to this by adding categories and removing categories."*

This slice replaces the global `sqcdp_category` Postgres ENUM with a per-org `production_board_sqcdp_categories` table, ships a `<SqcdpCategoryManagerDialog>` curator surface, upgrades the metric editor's Category field to a search-as-you-type combobox, and makes the SQCDP grid dynamic (variable primary / secondary card counts — the prior 5+3 hardcoded layout is retired).

Full schema decision log lives in [[Decisions/ADR-SQCDP-Category-Schema]]; the dynamic-grid variant is documented in [[Patterns/TV-Viewport-Fit-Grid]] § Dynamic counts.

## Schema migration

`supabase/migrations/306_production_boards_sqcdp_categories.sql`:

1. **`production_board_sqcdp_categories` table** with `(organization_id, slug)` unique key, slug-format CHECK (`^[a-z0-9_]+$`, 1–64 chars), color-format CHECK (`#RRGGBB`), tier CHECK (`primary` / `secondary`), `is_builtin` / `is_hidden` flags, partial index on `(organization_id, tier, display_order) WHERE is_hidden = FALSE`, full index on `(organization_id, tier, display_order)`.
2. **RLS** policies mirroring `sqcdp_metrics` exactly: select scoped to caller's org; mutate gated on `has_permission('production_boards', 'edit')`.
3. **Seed** the 9 canonical builtins for every existing org (`safety` / `quality` / `cost` / `delivery` / `production` / `maintenance` / `shipping` / `big_idea` / `announcement`) with `is_builtin = TRUE`. Idempotent via the unique `(organization_id, slug)` constraint.
4. **`AFTER INSERT ON organizations` trigger** that auto-seeds the same 9 rows for any future org. Trigger function is `SECURITY DEFINER` (so the trigger fires regardless of the inserting user's RLS context); `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` makes the function callable only by the trigger — silences advisor `0028_anon_security_definer_function_executable`.
5. **`sqcdp_metrics.category` + `sqcdp_problems.category` converted from `sqcdp_category` ENUM → TEXT** via `ALTER COLUMN ... TYPE TEXT USING category::text`. The 9 enum values are slug-identical to the seeded builtins so the cast lands on a valid FK target for every existing row. The enum itself is then `DROP TYPE IF EXISTS sqcdp_category`.
6. **Composite FKs** `(organization_id, category) → production_board_sqcdp_categories(organization_id, slug)` on both metrics + problems, `ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED`. RESTRICT surfaces a friendly error in the manager UI when a curator tries to delete a category that's still referenced; DEFERRABLE leaves room for a future "rename slug + cascade in same tx" workflow.
7. **`updated_at` trigger** with `SET search_path = public, pg_temp` (silences advisor `0011_function_search_path_mutable`).
8. `NOTIFY pgrst, 'reload schema';` so PostgREST picks up the new column types without a service restart.

## Frontend module map

All new files live under `src/features/shift-productivity/production-boards/boards/sqcdp/`.

### Added

- `lib/category-icons.ts` — curated allowlist of ~43 Tabler icons (the 9 builtin icons + ~34 extras across safety / quality / cost / delivery / production / maintenance / shipping / ideas / culture). Includes `SQCDP_CATEGORY_ICONS` (string → component map), `SQCDP_CATEGORY_ICON_OPTIONS` (picker layout), and a `resolveCategoryIcon(name)` helper that falls back to `IconCircleDashed` for unknown names with a one-time `logger.warn` per name.
- `lib/grid-sizing.ts` — pure helpers for the dynamic grid layout. Exports `GRID_COLS_CLASS` (1–6), `FLEX_WEIGHT_CLASS` (1–8), and `resolveGridSizing(primaryCount, secondaryCount)`. Static maps so the Tailwind v4 JIT can see every emitted utility (`flex-${n}` template literals are invisible to the compiler, see [[Patterns/Per-Field-Style-Overrides]] for the canonical rationale).
- `hooks/use-sqcdp-categories.ts` — TanStack Query hook against `production_board_sqcdp_categories`. CRUD: list, create, update, hide-via-update, delete (with FK-violation translation), reorder (fan-out updates), reset-to-builtins (UPSERT all 9 seed rows). Polls at 60s; mutations invalidate `['sqcdp-categories', orgId]` on settle.
- `hooks/use-sqcdp-categories-context.ts` — the React context type + `useSqcdpCategoriesContext()` consumer hook. Lives in its own `.ts` file so the provider's `.tsx` only exports the React component (keeps `react-refresh/only-export-components` happy).
- `components/sqcdp-categories-provider.tsx` — mounts the `<SqcdpCategoryManagerDialog>` once at the board root and exposes `openManager(...)` / `closeManager()` so any descendant (including the editor's combobox) can open the manager pre-filled in either list or create mode.
- `components/sqcdp-category-manager-dialog.tsx` — the curator surface. Renders both tier sections grouped by Primary / Secondary; each row is `@dnd-kit/sortable` with a drag handle, color swatch, icon, label, slug, In-use / Builtin / Hidden badges, and a per-row dropdown menu (Edit | Hide/Unhide | Delete — disabled on builtins with explanatory copy). Inline create / edit form with label → slug auto-derive, icon picker (curated grid), `<ColorPickerInput>` with the 12-color SQCDP palette, tier `<ToggleGroup>`, and proactive duplicate-slug guard. Footer Reset-to-defaults affordance UPSERTs the canonical 9 builtin shapes (re-applies label / icon / color / tier / order; clears `is_hidden`).
- `components/sqcdp-category-icon-picker.tsx` — 6× grid picker over `SQCDP_CATEGORY_ICON_OPTIONS`. Active tile uses the curator's chosen color as a backdrop so the picker shows what the rendered icon will look like on the card header.
- `components/sqcdp-category-combobox.tsx` — search-as-you-type combobox on top of `cmdk`. Groups by Primary / Secondary / Hidden; sticky footer commands for `New category…` and `Manage categories…` that route into the manager dialog.
- `lib/categories.test.ts` — rewritten + extended (18 tests). Covers builtin shape, dynamic `getCategory` / `getCategoryOrThrow`, hidden-category fallback, slug normalisation, visible filters.
- `lib/category-icons.test.ts` — 5 tests. Allowlist parity, label non-empty, builtin resolution, fallback for unknown / null / empty.
- `lib/grid-sizing.test.ts` — 6 tests. 5+4 canonical mapping, max clamps, zero-tier hides row, 1.5× primary multiplier, every emitted class is a real Tailwind token.
- `hooks/use-sqcdp-categories.test.tsx` — 6 tests. Read mapping, create payload + auto display_order, partial update, FK-violation translation, reorder fan-out, reset-to-builtins UPSERT shape.
- `components/sqcdp-category-manager-dialog.test.tsx` — 6 smoke tests. Renders both sections, builtin badges, initialMode=create, label → slug auto-derive, create payload shape, duplicate-slug error.

### Modified

- `lib/categories.ts` — fully rewritten around dynamic `BUILTIN_CATEGORY_SEED` constant + helpers. `SqcdpCategoryId` loosened to `string`; `BuiltinSqcdpCategoryId` retained as the literal union for the 9 canonical entries. `getCategory(id, list)` and `defaultColorFor(id, list)` now take the resolved list as input and fall through to the builtin seed for the canonical 9 even when the list is empty.
- `hooks/use-sqcdp-metrics.ts` — `defaultColorFor` callsite now reads the org's category list from the TanStack Query cache (`queryClient.getQueryData(['sqcdp-categories', orgId])`) with `BUILTIN_CATEGORIES` as the empty-cache fallback.
- `hooks/use-sqcdp-problems.ts` — type-only loosening (the existing `SqcdpCategoryId = string` propagates through the import).
- `components/sqcdp-card.tsx` — reads the resolved category from a prop (`categoryOverride`) or the categories context, falls back gracefully to the builtin seed; renders a degraded "Unknown category &lt;slug&gt;" placeholder when nothing matches.
- `components/sqcdp-grid.tsx` — retires the hardcoded 5+3 layout. Iterates over `visiblePrimaryCategories` / `visibleSecondaryCategories` from the categories context; uses `resolveGridSizing` from `lib/grid-sizing.ts` to map count → grid-cols + flex-weight class. Hidden tiers don't render an empty stripe.
- `components/sqcdp-card.tsx` (skeleton mirror in `sqcdp-board.tsx`) — the `<SqcdpGridSkeleton>` now mirrors the dynamic counts via the same `resolveGridSizing` helper.
- `components/sqcdp-chart.tsx` — `defaultColorFor` callsite reads from the categories context instead of the constant.
- `components/sqcdp-problems-table.tsx` — `getCategory(p.category, categories)` from context; renders a degraded badge for unknown / hidden categories so problems referencing hidden categories still render readably.
- `components/sqcdp-editor-dialog.tsx` — metric editor + problem editor's Category fields swap from `<Select>` over the 9 enum values to `<SqcdpCategoryCombobox>`. zod schemas loosen `category` to `z.string().regex(/^[a-z0-9_]+$/)`. `defaultColorFor` callsites thread the categories context. `BUILTIN_SQCDP_CATEGORY_IDS` (replaces the dropped `SQCDP_CATEGORIES` import).
- `sqcdp-board.tsx` — wraps the body in `<SqcdpCategoriesProvider>`. Adds a "Manage categories" button to the header (visible when `canEdit && editMode`). The skeleton consumes the dynamic categories list and uses `resolveGridSizing`.

## Decisions worth re-reading

- **Backfill strategy.** Migration seeds all orgs unconditionally (matching `production_boards`'s posture from migration 295) PLUS an `AFTER INSERT ON organizations` trigger so future tenants are auto-seeded. The brief suggested seeding only orgs with existing metrics; rejected because a not-yet-seeded org would fail FK on first metric creation. See [[Decisions/ADR-SQCDP-Category-Schema]] § Rejected alternatives § 4.
- **Builtins can be hidden, not deleted.** The S-Q-C-D-P muscle memory matters — hide-only preserves discoverability. The DB doesn't enforce this; the manager UI surfaces a Hide affordance instead of Delete on rows where `isBuiltin`.
- **Per-field icon color is a static-class carveout NOT a free-form hex.** The icon allowlist is intentionally bounded so the Tailwind JIT bundle only ships the icons the curator can actually pick. Free-form icon names would inflate the bundle by importing the entire `@tabler/icons-react` ESM tree.
- **No new Realtime channels.** Honoured `realtime-policy.mdc`. Polling at 60s + on-success invalidation is the right shape for a list that mutates rarely; multi-curator concurrent editing converges within one polling interval.

## Verification

- `pnpm vitest run src/features/shift-productivity/production-boards/boards/sqcdp/` — 13 files, **149 tests** all green (was 113 before; +36 new tests across categories / category-icons / grid-sizing / use-sqcdp-categories / manager-dialog).
- `pnpm vitest run src/features/shift-productivity/production-boards/` — 24 files, **281 tests** all green (post-composer + adjacent boards unaffected).
- `pnpm tsc -b --noEmit` — clean.
- `pnpm eslint src/features/shift-productivity/production-boards/boards/sqcdp/` — clean (zero new warnings; the repo-wide lint ratchet baseline is pre-existing on `main`'s working tree from a parallel session, not a regression introduced here).
- `pnpm build` — clean. Bundle size on `feature-shift-productivity` chunk: ~470 kB minified (no measurable jump from this slice; the icon allowlist's curated set keeps bundle growth bounded).
- Migration applied to dev project `wncpqxwmbxjgxvrpcake` via Supabase MCP `apply_migration`. Advisors clean for the 3 functions / 1 table / 2 policies introduced (no new ERROR-level lints; the `function_search_path_mutable` + `anon_security_definer_function_executable` warnings flagged on first apply were patched in the same migration body).
- Verified via `SELECT` round-trip: builtins seeded for the org (`c9d89a74`), enum dropped (`SELECT 1 FROM pg_type WHERE typname='sqcdp_category'` returns no rows), category columns are now `text`.

## Canonical handles (if you want to tweak further)

- **Add a new icon to the picker** → append the import + the `SQCDP_CATEGORY_ICONS` map entry + the `SQCDP_CATEGORY_ICON_OPTIONS` row in `lib/category-icons.ts`. The `category-icons.test.ts` parity test guards against drift.
- **Change a builtin's default color** → update both `BUILTIN_CATEGORY_SEED` in `lib/categories.ts` AND the migration's `INSERT` + trigger function values. Run `resetToBuiltins` (the manager footer's "Reset to defaults") to retro-apply on existing orgs. The `categories.test.ts` shape tests will catch un-paired drift.
- **Add a third tier (e.g. `tertiary`)** → (a) extend the table's tier CHECK constraint, (b) add `visibleTertiaryCategories` to `lib/categories.ts`, (c) extend `lib/grid-sizing.ts` with a third tier weight (currently primaries get 1.5×, secondaries 1× — pick a multiplier), (d) extend `<SqcdpGrid>` + `<SqcdpGridSkeleton>` + the `Section` rendering in the manager dialog.
- **Tighten the column / flex clamp ceilings** → `SQCDP_GRID_MAX_COLS` (default 6) and `SQCDP_GRID_MAX_FLEX` (default 8) in `lib/grid-sizing.ts`. Bumping above 6 columns will start crowding cards on a 1080p TV — raise both the grid clamp AND the card density tokens (`DENSITY.tv.primary` font sizes etc.) in tandem.
- **Lock slug renames for non-referenced custom categories too** → the manager's `slugLocked={!!editingRowId && referencedSlugs.has(slug)}` decides; broaden to `slugLocked={!!editingRowId}` if you want slugs to be fully immutable.
- **Tighten the duplicate-slug error to a Form-level field error** — currently surfaces inline at the form footer; the `setSubmitError` plumbing is intentionally simple, swap to react-hook-form errors when you want the slug field's input to redden.

## Related

- [[Decisions/ADR-SQCDP-Category-Schema]] — the schema-decision log, including rejected alternatives.
- [[Patterns/TV-Viewport-Fit-Grid]] — extended with the dynamic-counts variant.
- [[Patterns/Editable-Board-Dialogs]] — the host pattern; the manager dialog is a sibling adopter of the v12 / v12.3 / v14 recipe.
- [[Patterns/Per-Field-Style-Overrides]] — the static-class-map convention reused by `lib/grid-sizing.ts` and the icon allowlist.
- [[Implementations/Implement-SQCDP-Editor-Fine-Grained-Controls]] — the v14 editor this work extends; the combobox replaces v14's fixed-list `<Select>` in the Basics tab.
- [[Implementations/Implement-SQCDP-TV-Viewport-Fit]] — the TV layout pass this work integrates with; the dynamic counts coexist with the existing flex-weight chain.
- [[Components/ProductionBoards - Feature Module]] — the feature module the categories live in.
- `supabase/migrations/306_production_boards_sqcdp_categories.sql` — the canonical SQL.



## Follow-up: RLS / `has_permission` fix (2026-05-18)

Migration 306's RLS posture on `production_board_sqcdp_categories` mirrored `sqcdp_metrics` exactly (org-scoped SELECT, `production_boards:edit`-gated mutate). The shape was correct; the bug was one layer below — the `public.has_permission(text, text)` function itself was joining `role_permissions` on the **legacy `user_role` enum** column instead of `role_id`, which caused a subset of `tka_supervisors` users to fail every mutate (UPDATE returning zero rows → PostgREST `PGRST116` / `"Cannot coerce the result to a single JSON object"`) despite the JS gate (`useCanEditBoards` → `authService.checkPermission`) opening the editor for them. The migration 306 / category-table surface area made it routine to hit the editor's Save button, so the latent bug surfaced in earnest the day after this slice landed.

Fixed in `supabase/migrations/308_fix_has_permission_role_id.sql`: rewrites `has_permission(text, text)` to JOIN through `user_profiles.role_id → role_permissions.role_id`, mirroring `authService.checkPermission` exactly. The single-function patch automatically corrects every RLS policy that already references the function — including the new `production_board_sqcdp_categories_mutate` policy from this slice — without any policy-body edits.

The matching client-side defensive change (`use-sqcdp-metrics.ts` — `.single() → .maybeSingle()` + permission-flavoured error copy) lands in the same patch so a future RLS misalignment can't resurface the raw PGRST116 string.

See [[Fix-SQCDP-Metric-Update-RLS-Coerce-Error]] for the full diagnosis (four-phase walk through the policy graph, four-persona repro table before+after, advisor results) and the regression test that pins the friendly-error contract.
