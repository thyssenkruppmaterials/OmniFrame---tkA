---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-05-17
---

# Optional Kit Inspection Toggle

## Purpose / Context

For Kitting Apps tenants whose floor process doesn't include a separate
QA / Inspection step, the legacy three-stage `Build Kit → Inspection →
On Dock` workflow forced an inspector role they don't have. This
implementation adds an org-scoped **Require Kit Inspection** toggle to
the Kitting Apps Settings screen. When OFF, the Inspection stage is
bypassed entirely org-wide: completing a Build Kit jumps straight to
`On Dock`, the **Quality Check** kanban column is hidden, the RF
**Inspect Kit** tile is removed from the operator menu, and the
`KitProductionTracker` timeline omits the Inspection step.

Default is `kit_inspection_required = true` for every existing org —
behaviour is unchanged unless the toggle is explicitly flipped.

## Persistence Choice — Option B (new table)

The task brief offered three options:

- **A.** Add a new row to `kitting_dropdown_options` with
  `option_group = 'workflow_settings'`.
- **B.** New `kitting_workflow_settings` table (org_id PK + boolean
  columns).
- **C.** Reuse an existing `org_settings` / `feature_flags` table.

We chose **B**:

- **A** would require widening the `option_group` CHECK constraint on
  `kitting_dropdown_options` (still a migration), AND would shoehorn a
  boolean flag into a table whose model is a list of dropdown VALUES.
  Every consumer of `useKittingOptions` would have to filter the new
  group out, the seed RPC would need a new branch, and any future
  workflow flag would compound the awkwardness.
- **C** had no existing match. There is a `work_engine_settings` table
  per-org but it's specifically scoped to the work-engine feature flag
  layer (see `migrations/256` / `262`). No generic `org_settings` /
  `feature_flags` table exists today.
- **B** mirrors the `work_engine_settings` shape (one row per org,
  UPSERT by `organization_id` PK, boolean columns) and trivially
  extends to the obvious siblings the brief calls out — `require build
  sheet print`, `require photo on completion` — by adding columns on
  the same table instead of new tables per flag.

## Settings UX Placement

The Kitting Apps Settings tab has two sub-tabs (`KitBomSettings`):
`Definitions` and `Dropdowns`. Per the user's instruction (*"put it
in the drop-down section, and add a section at the very bottom for
enabling or disabling kit inspections"*), the new **Workflow
Settings** card sits at the bottom of the `Dropdowns` sub-tab
(`KittingOptionManager`), after the existing per-group dropdown
cards. A single shadcn `Switch` labelled **Require Kit Inspection**
flips the flag with optimistic toast feedback.

No new RBAC permission was introduced. The Settings tab is already
gated by the existing `kitting_apps` page-resource permission and the
`tab_definitions` row for `settings`. Anyone allowed onto the tab can
flip the toggle — same model as the existing dropdown management on
the same screen.

## Downstream Surfaces Gated

| Surface | Behaviour when flag is OFF | File |
|---|---|---|
| Build Kit completion (desktop + RF) | `completeKitBuild` UPDATE stamps `kit_build_status='kit_inspected'` plus the inspection AND on-dock columns in a single round-trip — kit jumps `in_progress → On Dock` | `src/lib/supabase/rr-kitting-data.service.ts` |
| `KitProductionTracker` timeline | Inspection stage filtered from the rendered `stages` array | `src/components/kitting/kit-production-tracker.tsx` |
| Kanban board | `Quality Check` column filtered out client-side (`column.name !== 'quality_check'`) | `src/components/kitting/kit-kanban-board.tsx` |
| RF kitting-apps menu | `Inspect Kit` tile gated on `kitInspectionRequired` | `src/features/rf-interface/rf-interface.tsx` |

### Why the timestamps are stamped on the bypass UPDATE

The production-tracker stage calculator reads raw timestamp columns
(`kit_inspection_completion_date_time`, `kit_ready_on_dock_date_time`)
to decide stage status. If the bypass only set `kit_build_status`, an
admin who later flipped the workflow flag back ON would see the
Inspection stage appear as `pending` for kits already on-dock — a
confusing audit-trail artefact. By stamping both columns on the
bypass UPDATE (same user / same `now()`), the historical record stays
coherent regardless of how the flag is flipped after the fact.

Same reasoning for the `kit_inspection_by_user` column: the bypass
fills it with the build operator's `auth.uid()`. The audit trail thus
reads "<operator> auto-passed inspection" rather than "NULL".

## Backward Compatibility

- **Default = TRUE.** A row is auto-INSERTed on first UPSERT; orgs
  that never touch the toggle never get a row, and the service falls
  back to the in-memory default `{ kit_inspection_required: true }`
  shape.
- **In-flight kits at the moment of the flip are left as-is.** A kit
  already in `kit_built` status (Inspection stage pending) when an
  admin disables inspection won't be auto-advanced — it'll just sit
  in Quality Check column (which is no longer shown) until an
  operator manually drags it. Documented as conservative; if floor
  ops push back we can add a one-shot "Skip Inspection" affordance
  on the Kit Production Tracker dialog later. The reverse direction
  (flag flipped back ON while a kit is mid-bypass) is fully safe —
  the timestamps stamped on the bypass mean the production tracker
  reads stage = completed for the on-dock step.
- **Service signature kept additive.** `completeKitBuild(kitPo,
  serial, options?)` — the third arg is optional; legacy callers and
  the unit tests for the multi-kit-per-PO scoping fix
  ([[Fix-Build-Kit-Completion-Multi-Kit-PO]]) are byte-identical when
  `options` is omitted. The hook input shape gained an optional
  `skipInspection` field for the same reason.
- **No new Supabase Realtime channels.** The flag is fetched via a
  TanStack Query hook (`useKittingWorkflowSettings`, 5 min
  `staleTime`) and invalidated on the mutation that flips it.
  Honours `Master Rule workspace rule` Realtime Policy.

## Files Touched

### Database

- **`supabase/migrations/308_kitting_workflow_settings.sql` (NEW)** —
  Creates the `kitting_workflow_settings` table
  (`organization_id` PK, `kit_inspection_required` BOOL DEFAULT
  TRUE, `updated_by`, `created_at`, `updated_at`), org-scoped RLS
  policies for SELECT/INSERT/UPDATE, and the
  `update_kitting_workflow_settings_updated_at` trigger. Applied to
  `wncpqxwmbxjgxvrpcake` via Supabase MCP `apply_migration`; schema
  verified via `information_schema.columns`.

### Service / Hooks

- **`src/lib/supabase/kitting-workflow-settings.service.ts` (NEW)** —
  Singleton with `getSettings(orgId)` (returns the in-memory default
  on missing row) and `updateSettings(orgId, { kit_inspection_required })`
  (UPSERT keyed on `organization_id`, fills `updated_by` from
  `supabase.auth.getUser()`).
- **`src/hooks/use-kitting-workflow-settings.ts` (NEW)** —
  `useKittingWorkflowSettings()` exposes
  `{ kitInspectionRequired, setKitInspectionRequired*, isLoading,
  isUpdating, settings }` over a TanStack `useQuery` cached for 5
  min. `useKitInspectionRequired()` is a thin convenience wrapper
  for read-only consumers (kanban filter, RF tile, production
  tracker stages). Both default `true` while loading or when the
  profile context is not yet available — fail-open on legacy
  behaviour.
- **`src/lib/supabase/rr-kitting-data.service.ts`** —
  `completeKitBuild` gained an optional third arg
  `options?: { skipInspection?: boolean }`. When `skipInspection ===
  true`, the UPDATE payload also stamps `kit_inspection_by_user`,
  `kit_inspection_completion_date_time`, `kit_ready_on_dock_by_user`,
  and `kit_ready_on_dock_date_time` (all to the build operator and
  `now()`); status flips to `kit_inspected` instead of `kit_built`.
  The serial-scoped WHERE clause from
  [[Fix-Build-Kit-Completion-Multi-Kit-PO]] is preserved verbatim.
  Return shape gained an optional `skippedInspection: boolean` field
  so the toast can read "on dock — inspection bypassed".
- **`src/hooks/use-build-kit.ts`** — `completeKitMutation` accepts
  `{ kitPoNumber, kitSerialNumber?, skipInspection? }` (string
  legacy form preserved). Forwards `skipInspection` to the service
  only when truthy. Toast appends "(on dock — inspection bypassed)"
  when the service reports `skippedInspection: true`.

### UI Surfaces

- **`src/components/kitting/kitting-option-manager.tsx`** — Reads
  `useKittingWorkflowSettings`. Renders a new **Workflow Settings**
  Card at the bottom of the Dropdowns view, with a `ClipboardCheck`
  accent + a single Switch labelled **Require Kit Inspection** and
  helper copy explaining the operator-visible effect.
- **`src/components/kitting/build-kit-form.tsx`** (desktop) +
  **`src/components/ui/rf-build-kit-form.tsx`** (mobile RF) — Both
  call `useKitInspectionRequired()` and pass
  `skipInspection: !kitInspectionRequired` to `completeKitAsync`.
  The optimistic `kitData.status` set after success now reads from
  `result.skippedInspection` so the post-completion screen shows the
  correct status.
- **`src/components/kitting/kit-production-tracker.tsx`** — Reads
  `useKitInspectionRequired()` and filters the `stages.map(...)`
  render to drop the `inspection` step when the flag is off.
- **`src/components/kitting/kit-kanban-board.tsx`** — Reads
  `useKitInspectionRequired()` and filters the column `.map(...)`
  to drop the `quality_check` column when the flag is off. Cards
  that the operator manually placed in Quality Check before the
  flip remain there (they just won't be shown on the board until
  the flag is re-enabled — sub-bullet documented as
  conservative-by-design above).
- **`src/features/rf-interface/rf-interface.tsx`** — The
  `kitting-apps` view conditionally renders the `Inspect Kit`
  `QuickActionButton` only when `kitInspectionRequired === true`.
  Build Kit + Kit Picking tiles are unchanged.

### Tests

- **`src/lib/supabase/__tests__/kit-serial-scoping.test.ts`** — New
  `describe('completeKitBuild — skipInspection bypass mode')` block
  with two tests:
  - `jumps the kit straight to On Dock when skipInspection is true`
    — asserts the UPDATE payload contains `kit_build_status =
    'kit_inspected'`, both inspection columns, both on-dock
    columns, and that the multi-kit-per-PO serial scoping is
    preserved.
  - `legacy path (no options) still moves the kit only to kit_built
    — inspection columns untouched` — pins the back-compat shape so
    the bypass logic can never silently bleed into the legacy
    path.
  Both pass alongside the 8 pre-existing `kit-serial-scoping`
  tests; the unrelated `createKitBuildPlan kanban link stamp`
  date-bomb (hardcoded `KIT-20260512-006`) failure is documented in
  [[RF-Build-Kit-By-Serial-Number]] § Validation as out-of-scope.

## Validation Log

- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm exec eslint <touched non-ui files>` — clean. (`src/components/ui/`
  is project-ignored by ESLint config — existing convention from
  [[Kit-BOM-Chains-Expedites-And-INCORA-Component]].)
- `pnpm vitest run src/lib/supabase/__tests__/kit-serial-scoping.test.ts`
  — **16 of 17 passing**. My 2 new tests pass; the 14 pre-existing
  tests still pass. The 1 remaining failure is the same
  `createKitBuildPlan kanban link stamp` pre-existing date-bomb
  noted in [[RF-Build-Kit-By-Serial-Number]].
- `pnpm build` — succeeds.
  - `feature-rf-interface` chunk: **523.83 KB → 526.07 KB (+2.24 KB)**,
    well under the +5 KB allowance from the task brief.
  - `kit-bom-settings` chunk: 42.59 KB (was ~38 KB) — settings
    surface is lazy-loaded so this is off the RF hot path.
  - `kit-kanban-board` chunk: 42.72 KB (~+0.5 KB).
  - Pre-existing oversize chunks (`warehouse-location-map`,
    `feature-admin`, `feature-rf-interface` itself) flagged by the
    bundle gate are unchanged in nature — explicitly out-of-scope
    per the task brief.
- **Migration applied** to `wncpqxwmbxjgxvrpcake` via Supabase MCP
  `apply_migration`. Schema verified by
  `SELECT column_name, data_type, is_nullable, column_default FROM
  information_schema.columns WHERE table_name = 'kitting_workflow_settings'`
  — returned 5 columns matching the migration:
  `organization_id` (uuid, NOT NULL), `kit_inspection_required`
  (boolean, NOT NULL, DEFAULT true), `updated_by` (uuid, nullable),
  `created_at` (timestamptz, NOT NULL, DEFAULT now()), `updated_at`
  (timestamptz, NOT NULL, DEFAULT now()).

## Future Work

- **Dashboard counters.** A search for `Inspection` counters across
  the production-boards / dashboard surface returned no hits today
  — there is no inspection-specific counter to hide. If one is
  added later it should also gate on `useKitInspectionRequired()`.
- **Sibling flags.** `require_build_sheet_print`,
  `require_photo_on_completion`, etc. → add as additional boolean
  columns on `kitting_workflow_settings` and a matching field on
  the `Workflow Settings` card.
- **In-flight kit affordance.** If floor ops push back on
  inflight kits stuck in Quality Check after a flag flip, surface a
  one-shot "Skip Inspection" button on the Kit Production Tracker
  dialog. Service method already exists
  (`completeKitInspection` flips status → `kit_inspected`); a thin
  wrapper that also stamps on-dock would close the loop.

## Related

- [[Kitting System - Feature Module]] — parent module overview.
- [[KittingServices - Supabase Service]] — service-layer catalogue;
  the new `kitting_workflow_settings` table + service should be
  added there.
- [[RF-Build-Kit-By-Serial-Number]] — the RF Build Kit form change
  this implementation extends. Same `feature-rf-interface` chunk
  baseline.
- [[Fix-Build-Kit-Completion-Multi-Kit-PO]] — the multi-kit-per-PO
  serial-scoping fix that ships in the same UPDATE statement as
  the new bypass behaviour. Tests preserved verbatim alongside
  the new ones.
- [[Kit-Serial-Scoping]] — the per-serial convention every kit
  mutation now follows.
- [[Edit-Ship-Short-Post-Creation-Flow]] /
  [[Authorized-Ship-Short-Negates-Black-Hat]] — same-domain
  Kitting Apps work shipped earlier this week.


## Follow-up correction (2026-05-17 night) — on-dock decoupled

The skip-inspection branch in `completeKitBuild` originally
co-stamped `kit_ready_on_dock_*` alongside the inspection columns
so the kit jumped `in_progress → On Dock` in a single UPDATE. That
landed a few hours before the new RF Dock Staging flow shipped —
and it conflicted with the new flow because kits would arrive at
the dock-staging tile already carrying an on-dock timestamp and
be rejected with `already staged`.

The correction — captured in [[RF-Dock-Staging-Flow]] — removes
`kit_ready_on_dock_by_user` / `kit_ready_on_dock_date_time` from
the `skipInspection` UPDATE payload. Inspection columns + status
flip stay verbatim. The on-dock stamp (and the new
`kit_dock_location` column) is now ALWAYS captured by
`stageKitToDock`, called from the RF Dock Staging form, in BOTH
inspection-on and inspection-off modes.

Net effect for inspection-off orgs:

- Kit moves `in_progress → kit_inspected` on Build-Kit completion
 (status, inspection columns stamped — unchanged).
- Operator then walks the kit to the dock and runs the new RF
 Dock Staging tile, scanning the dock barcode. That stamps
 `kit_ready_on_dock_*` + `kit_dock_location` (NEW).
- Production tracker sees the same stage progression as
 inspection-on orgs, just with the Inspection step auto-stamped
 instead of operator-driven.

The regression tests in this slice's § Tests block —
`completeKitBuild — skipInspection bypass mode` — were flipped
to assert the on-dock columns are now `undefined` on the bypass
UPDATE. The original assertions (`expect(payload.kit_ready_on_dock_*).toBeDefined()`)
were wrong _after_ this correction; the corrected expectations are
the canonical shape going forward.

See [[RF-Dock-Staging-Flow]] § *Correction to `completeKitBuild`'s
skip-inspection branch* for the full rationale and the
backward-compat note for kits already on dock from the old path.
