---
tags: [type/implementation, status/active, domain/frontend, domain/database]
created: 2026-04-19
---
# Add New Count Workflow Button

## Purpose / Context
The Count Workflow Settings panel (`src/components/count-settings.tsx`) previously only let managers edit the seeded workflow configs; there was no way to create configs for count types that had no row yet. A "New" button was added to the left sidebar so managers can spin up a new workflow for any unconfigured count type.

## Details

### Key Constraint
`cycle_count_workflow_configs.count_type` is typed as the Postgres enum `count_type_enum` (migration `068_add_count_type_enum.sql`). That means "new workflow" cannot mean an arbitrary string — it must be one of the 10 enum values:
- `part_verification`, `quantity_check`, `re_count`, `second_count`, `third_count`, `999_count`, `empty_location_check`, `cycle_count`, `physical_count`, `spot_count`.

Adding a truly new count type requires a DB migration to extend the enum; the UI surfaces only enum values that do not yet have a config row for the current org (`UNIQUE(organization_id, count_type)` on `cycle_count_workflow_configs`).

### Implementation
- Added `COUNT_TYPE_OPTIONS` constant mirroring the enum values + their display names/descriptions from `get_count_type_display_name()`.
- Added `buildDefaultSteps()` that returns a valid starter workflow (`confirm` → `location_scan` → `quantity_entry`) so the new config passes `validateSteps` immediately.
- Added a compact `+ New` button next to the search input in the sidebar. Disabled (with tooltip) when all enum values are already configured.
- Added a Radix Dialog with:
  - `Select` listing available count types (filtered via `availableCountTypeOptions` memo).
  - Pre-filled display name + description (auto-updates when count type changes).
  - Summary of starter steps so the user understands what will be created.
- `handleCreateWorkflow` calls the existing `upsertConfig` mutation from `useWorkflowConfigs`, then selects the new config and seeds the editor state locally (no wait for refetch round trip).

### Files Touched
- `src/components/count-settings.tsx` — new constants, state, handlers, sidebar button, dialog.

### Backend
No service or migration changes required. `WorkflowConfigService.upsertConfig` already handles inserts via `upsert({ onConflict: 'organization_id,count_type' })`.

## Related
- [[Configuration Services - Supabase Service]]
- [[CustomHooks - React Hooks]]


## 2026-04-19 Follow-up — fully dynamic count types

Extended beyond the original enum-constrained picker so admins can now define arbitrary count workflow slugs.

### Migration 217 — `217_convert_count_type_to_text.sql`
- Dropped `count_type_enum` and converted `rr_cyclecount_data.count_type` + `cycle_count_workflow_configs.count_type` to `TEXT`.
- Recreated `get_count_type_display_name(TEXT)` with `SET search_path = public, pg_temp` (Supabase advisor requirement). Looks up `cycle_count_workflow_configs` first, falls back to the 10 built-in labels, then prettifies the slug.
- Added CHECK constraint `chk_count_type_slug` enforcing `^[a-z0-9][a-z0-9_]{0,62}[a-z0-9]$` (or a single char `^[a-z0-9]$`).
- Backfilled `999_count` and `part_verification` for any organization missing them.
- Applied to Supabase project `wncpqxwmbxjgxvrpcake` via `apply_migration` MCP tool.

### Shared hook — `src/hooks/use-count-type-options.ts`
- `useCountTypeOptions()` merges live org workflow configs with `BUILT_IN_COUNT_TYPE_OPTIONS` so every picker stays in sync with what admins create.
- `resolveCountTypeLabel(slug, options?)` for label lookups anywhere.

### Dialog in `count-settings.tsx`
- Free-form slug input plus preset chips for built-in types not yet configured.
- Auto-slugifies from Display Name until the user edits the slug manually (`newCountTypeTouched`).
- Live validation against `COUNT_TYPE_SLUG_REGEX` and uniqueness against existing configs.

### Consumers updated
- `src/components/manual-counts-search.tsx` — removed local `COUNT_TYPE_OPTIONS`, added `useCountTypeOptions()` in both the main component and the `EditCountModal`. Replaced `.find()` label lookups with `resolveCountTypeLabel`.
- `src/components/add-counts-from-lx03-modal.tsx` — switched to the hook.
- `src/lib/supabase/cycle-count.service.ts` — dropped `as Database['public']['Enums']['count_type_enum']` casts.
- `src/lib/supabase/database.types.ts` — hand-maintained; removed the enum entry + switched table columns to `string`.

### Gotchas
- Running `generate_typescript_types` on Supabase rewrites the whole file and drops the project's custom convenience type aliases at the bottom (e.g. `UserProfile`, `Permission`, `PutbackTicket`). It also unmasks PostgREST relation-resolution errors in `kit-*.service.ts`. Preferred approach: surgical edits to the hand-maintained file rather than full regeneration.
