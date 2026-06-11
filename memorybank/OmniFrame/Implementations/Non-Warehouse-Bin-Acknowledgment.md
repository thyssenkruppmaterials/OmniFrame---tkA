---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-05-18
---

# Non-Warehouse Bin Acknowledgment

## Purpose / Context

Operators import Transfer Orders into a kit build plan via two paths:

1. **Add Kit Build Plan dialog** (`src/components/ui/add-kit-build-plan-dialog.tsx`)
   — clipboard paste of Excel rows when the kit is first created.
2. **Append TOs to Kit** (`src/components/kitting-data-manager.tsx
   handleAppendTOs`) — clipboard paste later when extra TOs land.

Some TO rows reference a `sourceStorageBin` like `112NEEDBIN`,
`R0NEEDBIN`, etc. — these bins live at the plant, not inside our
physical warehouse, so RF Picking on our floor cannot ever satisfy
them. The operator owns running those materials down on the plant
side. Before this change there was no automatic surface for it — the
kit silently shipped into Planning, picking blocked on those rows,
and the team-lead found out in person.

This implementation flags every imported TO row whose source bin
matches an org-configurable substring list and demands an explicit
acknowledgement before the kit can be created (or appended to). The
pattern list is managed via a new section in the existing
**Workflow Settings** card on the Kitting Apps Settings tab so the
floor can add additional plant-side bin markers without a code push.

## Architecture

```
AddKitBuildPlanDialog (form)         KittingDataManager.handleAppendTOs (action)
  └─ detectNonWarehouseBins             └─ detectNonWarehouseBins
        \                                       \
         \  hasMatches?                          \  hasMatches?
          v  Yes                                  v  Yes
        <NonWarehouseBinNotice>                <NonWarehouseBinConfirmDialog>
        (inline; submit gated on ack)         (modal; Acknowledge / Cancel)
                |                                       |
                +------- on confirm/submit -------------+
                                     |
                                     v
                  onSubmit / runAppendTOs (existing service paths)

Patterns sourced from `kitting_workflow_settings.non_warehouse_bin_patterns`
(migration 314, TEXT[] column, DEFAULT '{NEEDBIN}') via
`useNonWarehouseBinPatterns()` and edited from Settings → Workflow Settings
via `setNonWarehouseBinPatternsAsync` on the hook.
```

## Files

### Database

- **`supabase/migrations/314_kitting_workflow_settings_non_warehouse_bins.sql` (NEW)** —
  Adds `non_warehouse_bin_patterns TEXT[] NOT NULL DEFAULT ARRAY['NEEDBIN']::TEXT[]`
  to `kitting_workflow_settings`. Sibling pattern to migrations 308 +
  312 (one table, more columns) per the design note in
  [[Optional-Kit-Inspection-Toggle]] § Persistence Choice.
  Applied to `wncpqxwmbxjgxvrpcake` via Supabase MCP; column verified
  via `information_schema.columns`.

### Service / Hook

- **`src/lib/supabase/kitting-workflow-settings.service.ts`** —
  `KittingWorkflowSettings` interface gains `non_warehouse_bin_patterns: string[]`;
  `KITTING_WORKFLOW_DEFAULTS` seeds `['NEEDBIN']`;
  `KittingWorkflowSettingsUpdate` now permits the patterns field on
  the UPSERT.
- **`src/hooks/use-kitting-workflow-settings.ts`** — exposes
  `nonWarehouseBinPatterns` on the main hook + sync/async setters
  (`setNonWarehouseBinPatterns`, `setNonWarehouseBinPatternsAsync`).
  New convenience hook `useNonWarehouseBinPatterns()` for the import
  surfaces that only need to read.

### Pure helper

- **`src/lib/kitting/non-warehouse-bins.ts` (NEW)** —
  - `detectNonWarehouseBins(records, patterns)` returns
    `{ matches, patternsTriggered, binsTriggered, hasMatches }`.
    Substring match, case-insensitive, whitespace-trimmed on both
    sides; reports the *first* pattern that hit per record so the UI
    can render the trigger (`"matched: NEEDBIN"`). Pure function — no
    side effects, no exceptions on normal input.
  - `normaliseBinPatterns(patterns)` canonicalises an operator-edited
    list (trim, uppercase, drop blanks, dedupe, preserve first-seen
    order). Used by the Settings UI before writing back to
    `kitting_workflow_settings`.

  **Tested** in `src/lib/kitting/__tests__/non-warehouse-bins.test.ts`
  — 10 cases covering empty inputs, case-insensitive match, first-
  match wins, blank-pattern stripping, empty source-bin guard,
  dedup, and the canonicalisation helper.

### UI

- **`src/components/kitting/non-warehouse-bin-notice.tsx` (NEW)** —
  Inline acknowledgement card. Renders affected TO rows grouped by
  source bin so a single noisy plant bin doesn't drown the operator
  in a flat list. Hosts the ack checkbox the parent uses to gate
  submit. Self-hides when `!detection.hasMatches`.

- **`src/components/kitting/non-warehouse-bin-confirm-dialog.tsx` (NEW)** —
  Modal wrapper around the inline notice for the Append flow (which
  doesn't have a form to host an inline card). Reseeds the ack to
  `false` every time the dialog opens — never pre-checked. Standard
  Confirm / Cancel buttons; `onConfirm` only fires when the ack is
  ticked.

- **`src/components/ui/add-kit-build-plan-dialog.tsx`** —
  - New `nonWarehouseBinDetection` memo + `nonWarehouseBinAck` state.
  - `<NonWarehouseBinNotice>` mounted right below the green
    "imported X TOs" banner so the flow goes
    `import → confirm count → review external-plant bins → ack`.
  - `handleSubmit` short-circuits with a toast error if matches exist
    and the ack is missing (defence in depth against keyboard
    bypass).
  - `isFormValid` extended with `(!hasMatches || ack)` so the Save
    button reflects the gate visually.
  - Reset on the close / submit reset paths so the next dialog open
    starts clean.

- **`src/components/kitting-data-manager.tsx`** —
  - Split the existing `handleAppendTOs` into:
    1. The original handler (clipboard → parse → resolve target
       serial), which now branches on detection — if there are
       matches, it stashes a `pendingAppend` state object instead of
       calling the service directly.
    2. A new `runAppendTOs(targetSerial, records)` helper that
       performs the actual `RRKittingDataService.appendTOsToKit`
       call + result toasts (extracted so the confirm dialog can
       trigger it on `onConfirm`).
  - Mounted `<NonWarehouseBinConfirmDialog>` at the bottom of the
    component tree, driven by `pendingAppend`.
  - Cancelling the dialog surfaces a warning toast so the operator
    knows the append was deliberately aborted.

- **`src/components/kitting/kitting-option-manager.tsx`** —
  New **Non-Warehouse Bin Patterns** sub-section in the existing
  Workflow Settings card, below the Black-Hat policy section. Renders
  the current patterns as amber-trim badges with per-pattern remove
  buttons + an Input + "Add Pattern" button. Operator typing is
  auto-uppercased; `Enter` submits; saves call
  `setNonWarehouseBinPatternsAsync(normalised)` so the stored list
  stays canonical regardless of how the operator types.

## Behaviour

- **No matches → invisible.** The notice / confirm dialog only
  surfaces when at least one imported TO row's source bin matches a
  configured pattern. Default org behaviour is unchanged from the
  operator's perspective unless a `NEEDBIN`-style row is imported.
- **Ack is per-submission.** Reseeded to `false` every dialog open
  and whenever the detection fingerprint changes (re-importing a
  different batch of TOs counts as a new acknowledgement, even if
  the operator had previously ticked the box for the earlier batch).
- **Kit creation itself proceeds normally.** TO rows persist with
  their original `sourceStorageBin` values; the ack is the *human*
  audit trail (operator confirmed they own running these down on the
  plant). The Kit Notes thread also captures the kit-create event so
  the chat thread shows who acked when (via the system-note
  machinery from [[Persist-Kit-Notes-Chat-Thread]]).
- **Patterns are substring, case-insensitive.** `NEEDBIN` matches
  `112NEEDBIN`, `R0NEEDBIN`, `needbin-spare`, etc. Operators can add
  more plant-specific markers (e.g. a bin prefix) without code
  changes.

## Edge cases handled

- **Empty pattern list.** Detection returns no matches; notice never
  renders. Settings UI shows a "No patterns configured — the
  acknowledgement card will never surface" hint.
- **Blank or whitespace-only patterns.** Stripped at detect-time and
  at canonicalisation time so a stray empty row in the Settings
  editor doesn't break matching.
- **Source bin missing.** Records with empty / undefined
  `sourceStorageBin` never match, regardless of pattern shape.
- **Duplicate patterns.** `normaliseBinPatterns` dedupes
  case-insensitively before persisting, so the operator can paste
  `'NEEDBIN, needbin'` into the input without ending up with a
  redundant row.
- **Dialog keyboard bypass.** `handleSubmit` re-checks
  `detection.hasMatches && !ack` and bails with a toast — defence in
  depth against an Enter-key submit while a non-Save element has
  focus.
- **Append → multiple kits for one PO.** The existing serial
  disambiguation prompt runs *before* the bin-detection branch so we
  never open the ack dialog for the wrong target kit.

## Validation

- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm exec eslint <touched files>` — clean.
- `pnpm exec vitest run src/lib/kitting/__tests__/non-warehouse-bins.test.ts` —
  **10/10 pass** (new tests for the pure helper).
- `pnpm exec vitest run src/lib/supabase/__tests__/kit-serial-scoping.test.ts` —
  **25/26 pass**; the lone failure is the pre-existing `KIT-20260512-006`
  date-bomb noted in [[Optional-Kit-Inspection-Toggle]].
- `pnpm build` — succeeds. Bundle delta minimal (settings + dialog
  surfaces are already in lazy-loaded chunks).
- **Migration applied** to `wncpqxwmbxjgxvrpcake` via Supabase MCP
  `apply_migration`. Column verified via
  `information_schema.columns`: `non_warehouse_bin_patterns` ARRAY,
  NOT NULL, DEFAULT `ARRAY['NEEDBIN'::text]`.

## Realtime policy compliance

No new `supabase.channel(...)` callsites — the patterns load through
the same TanStack Query cache used by every other field on
`kitting_workflow_settings` (5-minute `staleTime`), invalidated on
the mutation that updates them. Honours [[Master Rule]] § Realtime
Policy.

## Future work

- **Server-side check on `createKitBuildPlan` / `appendTOsToKit`.**
  Today the gate is UI-only — a determined client could call the
  service direct and skip the ack. Add a server-side stamp on the
  `RR_Kitting_DATA` row (`acknowledged_external_plant_bins: boolean`
  or a structured `external_plant_bin_acknowledgements` JSONB) so
  the audit trail captures the explicit ack regardless of which
  surface initiated the kit.
- **Per-pattern reason.** Some pattern markers might indicate the
  plant takes delivery (no operator action needed) vs the plant
  needs us to coordinate (operator must reach out). Expand the
  pattern shape to `{ pattern, requires_action, instructions }`.
- **Auto-attach a system note** to the new kit when matches were
  acknowledged, so the Kit Notes thread (see
  [[Persist-Kit-Notes-Chat-Thread]]) captures the list of plant bins
  the operator agreed to handle. Hook into
  `KittingDataManager.handleAddToKitBuildPlan` after a successful
  save.
- **RF surface.** RF Kit Picking already explains why a row is
  unpickable (Black Hat / missing material); add a dedicated
  "External Plant Bin — handled by operator" terminal screen when
  the row's source bin matches a pattern so floor operators don't
  call leads for status.

## Related

- [[Optional-Kit-Inspection-Toggle]] — sibling Workflow Setting +
  pattern for adding new boolean / scalar columns to
  `kitting_workflow_settings`. This implementation extends the same
  table.
- [[Black-Hat-Ship-Short-Authorization-Panel]] — adjacent slice in
  the same Workflow Settings card; both patterns live under one
  parent card with consistent typography / disabled-state cascading.
- [[Authorized-Ship-Short-Negates-Black-Hat]] /
  [[Edit-Ship-Short-Post-Creation-Flow]] — sibling kit-imports
  paths; same form (`AddKitBuildPlanDialog`) and same TO append
  flow are extended here.
- [[Persist-Kit-Notes-Chat-Thread]] — captures the audit-trail
  surface where a future "operator acknowledged external plant
  bins" system note should land.
- [[Kit-Serial-Scoping]] — the per-serial convention every kit
  mutation now follows; the append flow's serial disambiguation
  prompt is preserved verbatim.
- [[Kitting System - Feature Module]] — parent module overview.
- [[KittingServices - Supabase Service]] — service catalogue;
  `kitting_workflow_settings.non_warehouse_bin_patterns` should be
  added there.
