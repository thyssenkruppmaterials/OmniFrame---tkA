---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-05-17
---

# RF Dock Staging Flow

## Purpose / Context

New RF flow that moves the **on-dock stamp** out of `completeKitBuild`
into a dedicated, scan-driven workflow on the Kitting Apps RF menu.
Before this change the only path that wrote `kit_ready_on_dock_*`
was the `skipInspection` branch in
[[Optional-Kit-Inspection-Toggle]]'s `completeKitBuild` UPDATE — that
put inspection-on orgs in the perpetually-empty state (no on-dock
timestamps were ever stamped) and inspection-off orgs lost the
ability to capture **which** dock the kit was placed on.

With this slice every kit — regardless of inspection mode — passes
through the same RF Dock Staging step:

1. Operator scans **Kit Serial / PO** on the new tile.
2. Service verifies the kit is dock-ready (predicate splits on the
 org's `kit_inspection_required` flag — see [[#Dock-ready predicate]]
 below).
3. Operator scans the **dock barcode** (or taps a configured dock
 location for damaged barcodes).
4. Service UPDATEs the row, scoped by `kit_serial_number` PK.

## Operator-visible flow (end-to-end)

| Step | Heading | Behaviour |
|---|---|---|
| `kit_scan` | **Scan Kit Serial Number** | Smart-detects `KIT-…` (serial path) vs. legacy PO via the shared `isPotentialKitSerialNumber` helper. Same UX language as the [[RF-Build-Kit-By-Serial-Number]] / [[RF-Kit-Pick-By-Serial-Number]] siblings. |
| `kit_select` | **Select a Kit** | Disambiguation picker only when a PO covers more than one dock-ready kit (mirrors the picking flow's `kit_select`). |
| `kit_summary` | **Kit Ready to Stage** | Big mono kit-serial label as the hero. Vertical-stack details: PO, Kit Number, Engine Program, Deliver-To Plant, status. |
| `dock_scan` | **Scan Dock Location** | `ScannerInput` for the dock barcode + a 2-column **Tap to select** grid below (sourced from `useKittingOptions().activeOptionsByGroup.dock_location`). Unknown scans rejected with a friendly toast. |
| `confirm` | **Confirm Staging** | Single big `Stage to Dock — <DOCK>` primary button. Single tap (no press-and-hold) — the dock barcode scan is already the deliberate-confirmation safeguard. |

On success the form resets to `kit_scan` for the next kit (loop UX —
the same operator typically stages multiple kits in a row).

## Dock-ready predicate

The predicate splits on the org's `kit_inspection_required`
workflow flag:

- **Inspection ON** → kit must carry
 `kit_inspection_completion_date_time` (an inspector signed it off
 via the existing RF Inspect Kit form or the kanban Quality Check
 column).
- **Inspection OFF** → kit must have *build complete* — every TO
 line carries `kit_to_line_kitted_date_time`. The skip-inspection
 branch in `completeKitBuild` ALSO stamps
 `kit_inspection_completion_date_time` on the same UPDATE
 (preserved from [[Optional-Kit-Inspection-Toggle]] so the
 production-tracker stage calculator stays coherent if an admin
 later flips the workflow flag back on), so the predicate accepts
 either signal.

In **both** modes the kit must NOT already carry
`kit_ready_on_dock_date_time`. Re-staging is rejected with
`Kit <serial> is already staged at <dock>` (the previously-stamped
`kit_dock_location` is interpolated into the toast for operator
hand-off).

## Correction to `completeKitBuild`'s skip-inspection branch

[[Optional-Kit-Inspection-Toggle]] originally co-stamped
`kit_ready_on_dock_*` alongside the inspection columns when
`skipInspection: true` so the kit jumped `in_progress → On Dock` in
a single UPDATE. That conflicts with the new Dock Staging step — a
kit would arrive at the dock-staging tile already carrying an
on-dock timestamp and the new flow would reject it with
`already staged`.

This implementation **removes** the on-dock stamp from
`completeKitBuild`'s `skipInspection` branch. The new payload writes
only:

```ts
{
 kit_build_status: 'kit_inspected',
 kit_inspection_by_user: userId,
 kit_inspection_completion_date_time: nowIso,
 updated_at: nowIso,
}
```

`kit_ready_on_dock_*` and the new `kit_dock_location` are now
ALWAYS the responsibility of `stageKitToDock` (called from the
RF Dock Staging form). The skip-inspection branch still bypasses
the Inspection workflow step, but the kit now correctly
transitions through the same dock-staging step inspection-on kits
go through.

### Backward-compat for kits already on dock

Kits that landed on `kit_ready_on_dock_date_time` via the old
skip-inspection path BEFORE this change keep their existing
`kit_ready_on_dock_*` values and have `kit_dock_location = NULL`
(the new column is nullable, no backfill). The dock-staging tile
rejects them with `already staged on the dock` (no location
appendix) so an operator who scans them at the dock gets a clear
message rather than a silent re-stamp. New kits flow through the
correct path.

## Persistence

### (A) Dock locations — `kitting_dropdown_options.option_group = 'dock_location'`

Reuses the existing `kitting_dropdown_options` flexible KV table.
The `option_group` CHECK constraint was extended to allow
`'dock_location'` alongside the existing five groups
(`engine_program`, `kit_type`, `kit_container_type`,
`bom_line_container_type`, `charge_code`). The
`KittingOptionsService` and `useKittingOptions` hook required only
the TypeScript type extension + the new `KITTING_OPTION_GROUPS`
entry — every CRUD operation already handles arbitrary groups
over that schema.

The `KittingOptionManager` settings card auto-renders the new
**Dock Locations** group once the type widens, so curators can
add / edit / hide / reorder dock barcodes alongside engine
programs with no per-group UI work. Two sensible defaults
(`DOCK-1`, `DOCK-2`) are seeded via the existing
`seed_kitting_dropdown_options(p_organization_id)` RPC for
newly-onboarded orgs and re-seeded for every existing org via the
migration's trailing per-org loop.

The dock-staging form validates the scanned input against the
active option set (`is_active = true`) case-insensitively and
rejects unknown scans with a friendly toast pointing operators at
the settings screen.

### (B) `RR_Kitting_DATA.kit_dock_location TEXT NULL`

New nullable column. Only populated by `stageKitToDock`. Lookups
are exclusively by `kit_serial_number` (PK), so no index is
needed.

## Service layer

### `RRKittingDataService.verifyKitForDockStaging(input)`

```ts
input: {
 kitSerialNumber?: string | null
 kitPoNumber?: string | null
 kitInspectionRequired: boolean
}
→ Promise<{
 success: boolean
 error?: string
 kitData?: { kitPoNumber, kitSerialNumber, kitBuildNumber, kitNumber,
 engineProgram, deliverToPlant, dueDate, status,
 kitDockLocation }
 kits?: Array<{ kit_serial_number, kit_number,
 kit_build_status, kit_build_number }>
}>
```

Mirrors the picking/build entry-point shape: when a PO covers
more than one dock-ready kit and no serial was supplied, returns
a `kits[]` payload so the caller renders a picker. Otherwise
resolves to a single serial and runs the dock-ready predicate.

### `RRKittingDataService.stageKitToDock(serial, dockLocation)`

Single-kit-scoped UPDATE — the WHERE clause is
`kit_serial_number = :serial` only. **No** `kit_po_number`
filter — that would be the
[[Fix-Build-Kit-Completion-Multi-Kit-PO]] regression class.
Stamps:

- `kit_ready_on_dock_by_user = auth.uid()`
- `kit_ready_on_dock_date_time = NOW()`
- `kit_dock_location = <scanned>`
- `updated_at = NOW()`

Returns `{ success: true }` or a typed error.

## Hook + Form

- **`src/hooks/use-dock-staging.ts`** (NEW) — TanStack Query
 wrapper exposing `verifyKit{Async,…}` + `stageKit{Async,…}`.
 Invalidates `['kit-kanban']` + `['kitting-data']` on stage
 success so any open production-board surface picks up the new
 on-dock state on the next refresh tick. Honours the
 [[Realtime-Policy]] — no Supabase Realtime channel.
- **`src/components/ui/rf-dock-staging-form.tsx`** (NEW) — 5-step
 form modelled on `rf-build-kit-form.tsx` (scan → kit-summary →
 dock-scan → confirm) plus the picking-form's `kit_select`
 disambiguation when a PO covers multiple dock-ready kits. Uses
 the same `framer-motion` slide-in transitions, `ScannerInput`
 primitive, and `Card` shell as the sibling RF flows.

## RF Interface wiring

- New `'dock-staging'` view key added to the `currentView`
 switch in `src/features/rf-interface/rf-interface.tsx`.
- New **Dock Staging** tile on the **Kitting Apps** menu —
 `Truck` icon, `success` (green) variant border accent. The tile
 is **always visible** (no `kitInspectionRequired` gate, unlike
 the **Inspect Kit** tile) because dock staging is needed in both
 inspection-on and inspection-off paths.
- The `currentTask` / heartbeat plumbing in `RFInterface` is
 cycle-count specific (`taskType: 'cycle_count'` is hardcoded in
 the `useWorkerHeartbeat` call at the top of the file) — no new
 heartbeat label was added because dock staging is a fast,
 bounded action (one kit, one stamp, one button) and doesn't
 carry a long-running task identity. If the team later wants
 granular per-step RF telemetry on dock staging, the existing
 `useRfPresenceActivity` hook already broadcasts `currentView`
 which now includes `'dock-staging'`, so supervisor presence
 panels see the operator's screen with no further work.

## Files touched

### Database

- **`supabase/migrations/309_add_kit_dock_location.sql`** (NEW)
 - Adds `RR_Kitting_DATA.kit_dock_location TEXT NULL`.
 - Drops + re-adds the `kitting_dropdown_options.option_group`
 CHECK constraint to include `'dock_location'`.
 - Replaces `seed_kitting_dropdown_options` with a version that
 seeds two default dock locations (`DOCK-1`, `DOCK-2`).
 - Trailing per-org loop re-seeds the new defaults for every
 existing org.

### Service / Hooks

- **`src/lib/supabase/rr-kitting-data.service.ts`**
 - `RRKittingDataRecord` interface gained
 `kit_dock_location?: string | null`.
 - **NEW** `static async verifyKitForDockStaging(input)` — the
 predicate-checking entry point.
 - **NEW** `static async stageKitToDock(serial, dockLocation)`
 — the serial-scoped UPDATE.
 - **CORRECTION** to the `skipInspection` branch in
 `completeKitBuild`: removed the
 `kit_ready_on_dock_by_user` / `kit_ready_on_dock_date_time`
 columns from the UPDATE payload. Inspection columns + status
 flip preserved verbatim. Log line updated from
 `inspection bypassed → on dock` to
 `inspection bypassed; awaiting RF Dock Staging`.
- **`src/lib/supabase/kitting-options.service.ts`**
 - `KittingOptionGroup` type gained `'dock_location'`.
 - `KITTING_OPTION_GROUPS` array gained the matching descriptor
 entry.
- **`src/hooks/use-dock-staging.ts`** (NEW) — TanStack Query
 wrapper described above.

### UI

- **`src/components/ui/rf-dock-staging-form.tsx`** (NEW) — the
 5-step RF form. ~470 LOC, project-ignored by ESLint per the
 existing `src/components/ui/` convention.
- **`src/features/rf-interface/rf-interface.tsx`** — new tile +
 new view branch + `RFDockStagingForm` import. The `Truck`
 icon was already imported by the file (used by the SAP MIGO
 tile) so no new icon import was needed.

### Tests

- **`src/lib/supabase/__tests__/kit-serial-scoping.test.ts`**
 - `completeKitBuild — skipInspection bypass mode > stamps inspection columns and lands at kit_inspected — but does NOT stamp on-dock` —
 test from [[Optional-Kit-Inspection-Toggle]] flipped to assert
 `payload.kit_ready_on_dock_*` are `undefined`, not strings.
 - `legacy path (no options)` — extended to also assert
 `kit_dock_location` is undefined.
 - **NEW** `verifyKitForDockStaging — inspection-required path`
 describe block (3 tests): accepts inspection-complete
 not-on-dock, rejects inspection-incomplete, rejects already-on-dock
 with friendly location.
 - **NEW** `verifyKitForDockStaging — inspection-bypassed path`
 describe block (2 tests): accepts build-complete, rejects
 unkitted-line.
 - **NEW** `stageKitToDock` describe block (3 tests): asserts
 the UPDATE filters by `kit_serial_number` only (regression
 guard for the multi-kit-per-PO bug class), rejects empty
 dock location, rejects empty serial.

## Validation

- `pnpm exec tsc -b --noEmit` — clean (one round-trip after
 adding `as unknown` casts on the two new typed projections,
 same convention as the existing service code).
- `pnpm exec eslint src/lib/supabase/rr-kitting-data.service.ts
 src/lib/supabase/kitting-options.service.ts
 src/hooks/use-dock-staging.ts
 src/lib/supabase/__tests__/kit-serial-scoping.test.ts
 src/features/rf-interface/rf-interface.tsx` — clean.
 `src/components/ui/` is project-ignored by the ESLint config.
- `pnpm vitest run
 src/lib/supabase/__tests__/kit-serial-scoping.test.ts` —
 **24 of 25 passing**. My 8 new tests pass; the 2 corrected
 `skipInspection` tests pass; the 14 pre-existing tests still
 pass. The 1 remaining failure is the same
 `createKitBuildPlan kanban link stamp` **pre-existing date-bomb**
 carried in [[RF-Build-Kit-By-Serial-Number]] §
 Validation — hardcoded `KIT-20260512-006` vs today's
 `KIT-20260518-001`. Out-of-scope; independently reproducible
 on `git stash`'d main.
- `pnpm build` — succeeds. `feature-rf-interface` chunk:
 **526.07 KB → 533.97 KB (+7.90 KB)** (gzip 124.59 KB). The
 new flow is slightly larger than the +3 KB the brief
 estimated for a single new form because it carries five
 distinct steps (vs. the build-kit form's three) plus the
 disambiguation picker and the tap-to-select fallback grid.
 Still inside the same out-of-scope bucket the
 bundle-budget gate flagged for [[Optional-Kit-Inspection-Toggle]]
 — `feature-rf-interface` was already over 500 KB before this
 change and the brief explicitly scopes the chunk-trim
 follow-up out of this slice.
- **Migration applied** to `wncpqxwmbxjgxvrpcake` via Supabase
 MCP `apply_migration`. Schema verified by
 `SELECT column_name, data_type, is_nullable FROM
 information_schema.columns WHERE table_name='RR_Kitting_DATA'
 AND column_name='kit_dock_location'` —
 `text` / `YES`. Constraint verified via
 `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE
 conname='kitting_dropdown_options_option_group_check'` —
 returns the 6-value `IN (…, 'dock_location')` form.
 Default seed verified via
 `SELECT option_value FROM kitting_dropdown_options WHERE
 option_group='dock_location' LIMIT 10` — returns
 `DOCK-1`, `DOCK-2`.

## Backward compatibility

- Pre-existing kits sitting on
 `kit_ready_on_dock_date_time IS NOT NULL` retain their state.
 `kit_dock_location` is `NULL` for every legacy row; only kits
 staged via the new RF flow carry a location.
- The `verifyKitForBuild` / `verifyKitForBuildBySerialNumber`
 / `verifyKitForPicking` / `completeKitBuild` /
 `markLineAsKitted` / `unmarkLineAsKitted` paths are
 untouched (apart from the deliberate one-line on-dock
 removal documented above).
- No new Supabase Realtime channels — honours the
 [[Realtime-Policy]].
- Every new UPDATE scopes by `kit_serial_number`; no
 PO-only writes were introduced.
- The `KittingOptionManager` settings UI and the
 `useKittingOptions` consumers (e.g.
 `add-kit-build-plan-dialog.tsx`) accept the new
 `dock_location` group with no per-callsite changes —
 the existing consumers all `Object.values(optionsByGroup)`
 or pick groups by name.

## Future work

- **Bundle trim.** `feature-rf-interface` is now 533.97 KB.
 A natural follow-up is to split the kitting-app forms
 (`rf-build-kit-form` / `rf-inspect-kit-form` /
 `rf-kitting-picking-form` / `rf-dock-staging-form`) into a
 lazy-loaded sub-chunk via `React.lazy` since each is only
 entered from a tile click on the kitting-apps menu. Single
 PR, no behaviour change. Out-of-scope for this slice.
- **Per-step RF telemetry.** Today the `useWorkerHeartbeat`
 call at `RFInterface` top-level is hardcoded to
 `taskType: 'cycle_count'`. A separate slice could refactor
 that into a stack-based per-view task-type so dock
 staging (and every other RF flow) shows up in the
 team-performance Activity Gantt with the right colour.
 See [[Fix-Worker-Heartbeats-Stale-Task-Type]] for the
 broader root-cause walkthrough.
- **`kit_dock_location` analytics.** Once a few weeks of
 staging data accumulate, surface a heatmap on the
 production-boards "Outbound" surface so supervisors can
 see which docks are bottlenecking. No schema change
 needed — column is queryable by dock_location today.

## Related

- [[Optional-Kit-Inspection-Toggle]] — the slice this
 implementation **corrects** (on-dock stamp moved out of
 `completeKitBuild`'s skip-inspection branch into the new
 RF flow). See § Correction above for details.
- [[RF-Build-Kit-By-Serial-Number]] — sibling RF flow on the
 same chunk. The dock-staging form's `kit_scan` step uses
 the same smart-detect helper (`isPotentialKitSerialNumber`)
 and copy framing.
- [[RF-Kit-Pick-By-Serial-Number]] — sibling. The
 disambiguation `kit_select` step is modelled on this form's
 picker.
- [[Fix-Build-Kit-Completion-Multi-Kit-PO]] — the
 multi-kit-per-PO scoping fix whose invariant
 (`stageKitToDock` UPDATEs scope by `kit_serial_number`,
 not by `kit_po_number`) is preserved verbatim and
 explicitly covered by a new regression test.
- [[Kitting System - Feature Module]] — parent module overview.
- [[KittingServices - Supabase Service]] — service-layer
 catalogue; the new `verifyKitForDockStaging` and
 `stageKitToDock` methods + the new
 `kit_dock_location` column should be added there.
- [[RF Interface - Feature Module]] — where the new tile and
 view live.
- [[Kit-Serial-Scoping]] — the per-serial convention every
 kit mutation now follows; the new flow is one more callsite.
- [[Realtime-Policy]] — no new channels were introduced.
