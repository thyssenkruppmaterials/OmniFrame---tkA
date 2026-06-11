---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-05-20
---
# Configurable Deliver-To-Plant Locations

## Purpose / Context

The **Add Kit Build Plan** dialog (`src/components/ui/add-kit-build-plan-dialog.tsx`) renders a required `Deliver To Plant` `<Select>` whose options were a hardcoded 8-entry `PLANT_LOCATIONS` constant. Every facility change — a new plant, a renamed shipping dock, a retired warehouse — required a code push + redeploy, even though the field is pure org-scoped configuration that floor leads should own.

This implementation lifts the list onto `kitting_workflow_settings` (the existing per-org settings table) so the dropdown is operator-editable from **Settings → Workflow Settings → Deliver To Plant Locations** — a sibling section to the existing **Non-Warehouse Bin Patterns** section.

Default seeds the exact 8 values that used to be hardcoded so existing org behaviour is preserved verbatim until a floor lead decides to customise the list.

## Architecture

```
AddKitBuildPlanDialog                  KittingOptionManager (Settings UI)
  │                                       │
  │  useDeliverToPlantLocations()         │  setDeliverToPlantLocationsAsync(next)
  │                                       │
  └──────────────────┬───────────────────────────────┘
                          │
                          v
              useKittingWorkflowSettings()  (TanStack Query, 5‑minute staleTime)
                          │
                          v
              kittingWorkflowSettingsService.upsert(…)
                          │
                          v
              public.kitting_workflow_settings.deliver_to_plant_locations TEXT[]
              (migration 324)
```

The consumer surface uses the same template as the existing `useNonWarehouseBinPatterns()` convenience hook — a thin wrapper that pulls one slice of the shared settings query so the dialog doesn't have to know about the broader settings shape.

## Files

### Database

- **`supabase/migrations/324_kitting_workflow_settings_deliver_to_plant_locations.sql` (NEW)** —
  `ALTER TABLE kitting_workflow_settings ADD COLUMN deliver_to_plant_locations TEXT[] NOT NULL DEFAULT ARRAY[...8 plants...]`. Comment documents the operator-edit contract and the legacy hardcoded source.
  Applied to `wncpqxwmbxjgxvrpcake` via Supabase MCP `apply_migration`; column verified via `information_schema.columns` — `ARRAY`, `NOT NULL`, default contains the 8 expected entries.

### Pure helper

- **`src/lib/kitting/plant-locations.ts` (NEW)** —
  - `DEFAULT_PLANT_LOCATIONS` — readonly array of the 8 seed values, used by both the SQL default and the service-layer `DEFAULT_SETTINGS` constant so the two sources of truth stay aligned.
  - `normalizePlantLocations(locations)` — trim, drop blanks, dedupe **case-insensitively while preserving first-seen casing**, preserve insertion order. Critically does NOT uppercase (unlike `normaliseBinPatterns`) because plant labels are user-facing strings, not match patterns.
  - `withCurrentPlantOption(locations, currentValue?)` — returns `locations` with `currentValue` appended if it's truthy and not already present (case-insensitive). Used by the dialog so a saved kit whose `deliver_to_plant` value has since been removed from the configured list still shows the value in its `<Select>` trigger.

  **Tested** in `src/lib/kitting/__tests__/plant-locations.test.ts` — **11/11 pass** covering trim, blank-drop, case-insensitive dedupe with first-seen casing preservation, insertion-order preservation, empty input, non-string defence, no-uppercase guarantee, and the `withCurrentPlantOption` empty / present / append branches.

### Service / Hook

- **`src/lib/supabase/kitting-workflow-settings.service.ts`** —
  - `KittingWorkflowSettings` interface gains `deliver_to_plant_locations: string[]`.
  - `KittingWorkflowSettingsUpdate` adds the field to the UPSERT-permitted set.
  - `DEFAULT_SETTINGS` seeds the field from `DEFAULT_PLANT_LOCATIONS` so an org that has never written the row sees the same 8 entries via the in-memory fallback shape.

- **`src/hooks/use-kitting-workflow-settings.ts`** —
  - Main hook exposes `deliverToPlantLocations` (string[]) + `setDeliverToPlantLocations` / `setDeliverToPlantLocationsAsync` mutators.
  - New `useDeliverToPlantLocations()` convenience hook for read-only consumers (currently just the dialog).

### UI — Dialog

- **`src/components/ui/add-kit-build-plan-dialog.tsx`** —
  - Removed the hardcoded `PLANT_LOCATIONS` constant.
  - Added `import { useDeliverToPlantLocations } from '@/hooks/use-kitting-workflow-settings'` and `import { withCurrentPlantOption } from '@/lib/kitting/plant-locations'`.
  - Inside the component: `const configuredPlantLocations = useDeliverToPlantLocations()` + `const plantLocationOptions = withCurrentPlantOption(configuredPlantLocations, formData.deliverToPlant)` so legacy saved values render naturally.
  - The `<Select>` maps `plantLocationOptions` instead of the deleted constant.
  - Empty-list state: when `plantLocationOptions.length === 0`, the Select is disabled, placeholder reads `No plants configured — add some in Settings`, and a `<FieldDescription>` points the operator at the new Settings sub-section.

### UI — Settings

- **`src/components/kitting/kitting-option-manager.tsx`** —
  - New `Deliver To Plant Locations` sub-section in the existing Workflow Settings card, placed directly under Non-Warehouse Bin Patterns. Same shape (badge grid + Input + Add button) but with sky-blue trim to visually differentiate from the amber Non-Warehouse Bin Patterns block.
  - Renders existing destinations as sky-trim outline `<Badge>`s with per-badge remove `×`. Each badge shows the verbatim label so operators see exactly what'll land on the kit row.
  - Input + `Add Destination` button below the badge grid. Submits on `Enter` or button click. **Does NOT auto-uppercase the input** (plant labels are mixed-case human strings).
  - All mutations route through `setDeliverToPlantLocationsAsync(normalizePlantLocations(next))` so the persisted list is always canonical.
  - Empty-state copy: `No plant destinations configured — the Add Kit Build Plan dialog's dropdown will be empty.`

## Behaviour

- **Read path**: `useDeliverToPlantLocations()` returns the persisted array, or `DEFAULT_PLANT_LOCATIONS` when no row exists yet (the service's `getSettings` returns a synthetic row with defaults rather than `null`, so consumers never see a missing list).
- **Write path**: the Settings UI normalises every mutation before writing — trims, drops blanks, dedupes case-insensitively while preserving the operator's first-seen casing, preserves insertion order.
- **Dialog defence**: `withCurrentPlantOption` ensures a saved-but-since-removed `deliver_to_plant` value is still visible in the dropdown trigger so editing an old kit doesn't render an empty `<Select>`. The legacy value is appended to the bottom of the option list and is selectable.
- **Empty-list UX**: dialog's Select disables itself + shows a help message; settings UI shows the dashed empty state until the operator adds the first destination.
- **Existing org behaviour is unchanged** until the operator touches the list — the SQL default and the in-memory `DEFAULT_SETTINGS` both seed the original 8 entries.

## Edge cases handled

- **Empty list**. Dialog's Select disabled + helpful message; new kits cannot be saved (the `deliverToPlant !== ''` validator still gates submit). Operator is funnelled to Settings.
- **Whitespace-only input** in Settings. `handleAddPlantLocation` short-circuits on empty trim.
- **Duplicate add attempts**. Settings UI checks case-insensitively and shows a toast `Plant destination already configured` without mutating.
- **Legacy `deliver_to_plant` no longer in the list**. `withCurrentPlantOption` keeps the value visible in the dropdown for the affected kit only.
- **Non-string array entries**. `normalizePlantLocations` defensively skips non-string values (paranoia against bad DB hand-edits).
- **Case variants**. Settings UI dedupes case-insensitively. `Plant A`, `plant a`, and `PLANT A` collapse to whichever was typed first.

## Validation

- `pnpm exec tsc -b --force` — clean.
- `pnpm exec eslint <touched files>` — clean (the one warning is the pre-existing ignore-pattern on `add-kit-build-plan-dialog.tsx`).
- `pnpm exec vitest run src/lib/kitting/` — **21/21 pass** (11 new plant-locations + 10 existing non-warehouse-bins).
- `pnpm exec prettier --write` applied to all touched files.
- **Migration applied** to `wncpqxwmbxjgxvrpcake` via Supabase MCP. Column verified via `information_schema.columns`: `deliver_to_plant_locations`, `ARRAY`, `NOT NULL`, default contains the 8 seed plants.
- Vite HMR updates succeed.

## Realtime policy compliance

No new `supabase.channel(...)` callsites. The list rides on the same TanStack Query cache as every other field on `kitting_workflow_settings` (5-minute staleTime), invalidated on the mutation that updates it. Honours [[Master Rule]] § Realtime Policy.

## Future work

- **Per-plant metadata** — the current shape is a flat `TEXT[]`. If we ever need address, default Black-Hat ownership, or SAP storage-location mappings per plant, migrate to a richer structure (JSONB array of objects or a sibling `kitting_plant_destinations` table).
- **Migrate existing `RR_Kitting_DATA.deliver_to_plant` values** — currently rows pre-dating this change carry whatever string the operator picked from the hardcoded list. Those values remain valid; no migration needed unless we later want strict FK semantics.
- **Surface the same list elsewhere** — the kitting kanban board's deliver-to-plant column filter could read from the same source to stay in sync.

## Related

- [[Non-Warehouse-Bin-Acknowledgment]] — sibling configurable list on `kitting_workflow_settings` and the canonical template this implementation followed (hook + service + Settings UI sub-section + pure normaliser + unit tests). The only deltas: this list is a user-facing label (no uppercase), and the dialog uses a `withCurrent…` helper instead of detection-on-import.
- [[Optional-Kit-Inspection-Toggle]] — first user of `kitting_workflow_settings`; established the per-org settings table pattern.
- [[Black-Hat-Ship-Short-Authorization-Panel]] — adjacent slice in the same Workflow Settings card; new section is placed beneath it.
- [[Kitting System - Feature Module]] — parent module overview.
