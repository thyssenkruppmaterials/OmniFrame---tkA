---
tags: [type/implementation, status/active, domain/frontend, domain/backend]
created: 2026-05-17
---

# RF Build Kit by Serial Number — Parity with RF Kit Picking

## Purpose / Context

Direct sibling of [[RF-Kit-Pick-By-Serial-Number]] (shipped earlier
today) but for the **RF Build Kit** flow. Before this change the
RF Build Kit scan step accepted only a `kit_po_number`; an operator
holding a freshly-printed kit label with the `KIT-YYYYMMDD-NNN`
serial had to mentally translate it to the parent PO before they
could start building. The same operator on the picking side could
already scan their serial directly (today's earlier ship), so the
two RF flows behaved inconsistently for the same identifier on the
same label.

The `kit_serial_number` is the **globally unique PK** on
`RR_Kitting_DATA` (format `KIT-YYYYMMDD-NNN`, per
[[Kit-Serial-Scoping]]). Adding a serial-keyed entry point lets the
operator drop straight into building without giving up the legacy
PO scan path, and keeps the smart-detect API symmetric with the
picking flow.

## Behaviour Change

| Scenario | Before | After |
|---|---|---|
| Scan a `KIT-…` serial | `Kit PO Number not found` (service queried by PO only). | Drops straight into `kit_materials`. |
| Scan a PO covering 1 kit | Auto-resolved → `kit_materials`. | Unchanged. |
| Scan a PO covering 2+ kits (legacy) | Loaded all rows across all kits — pre-existing aggregation behaviour. | Unchanged on the PO path. The serial path naturally loads only the chosen kit's rows. |
| Empty / whitespace input | Toast `Please enter a Kit PO Number`. | Toast `Please enter a Kit Serial Number or PO`. |

The post-load state machine (`kit_scan` → `kit_materials` → `complete`)
is untouched. No step keys were renamed (telemetry coupling per the
task brief).

## Smart-Detect

Reuses the exact same `isPotentialKitSerialNumber` helper exported by
`src/lib/supabase/rf-kitting-picking.service.ts` so both RF flows
share one source of truth for serial-vs-PO classification: trimmed,
uppercased, `startsWith('KIT-')`. The hyphen is required — legacy
`KIT12345`-style PO labels continue to route through the PO path
(`isPotentialKitPoNumber` matches both `KIT-` and bare `KIT`).

See the [[RF-Kit-Pick-By-Serial-Number]] rationale section for the
full no-false-positive argument against SAP PO patterns, delivery
number shapes, and legacy `KIT` labels.

## Files Touched

### `src/lib/supabase/rr-kitting-data.service.ts`

- **New public static method** `verifyKitForBuildBySerialNumber(kitSerialNumber)`.
  Direct PK lookup (`.eq('kit_serial_number', serial)`), shares the
  shared assembly helper with the legacy PO path so status sanity
  check, user-name decoration, and TO-line mapping are byte-identical
  once rows are loaded. Trims whitespace; surfaces `Kit serial …
  required` on empty input and `Kit serial … not found` on unknown
  serial.
- **Refactor** — extracted the existing post-fetch body of
  `verifyKitForBuild` into a new private helper
  `assembleBuildKitPayload(records)`. Single source of truth so the
  PO-path and serial-path behave identically once rows are loaded.
- **New static helper** `buildKitToLineFromRecord(record, userNameMap)`
  for the per-row → public TO-line shape mapping (called from inside
  the shared assembly).
- **Preserved verbatim:** the public `verifyKitForBuild(kitPoNumber)`
  signature, its query shape (`.eq('kit_po_number', kitPoNumber.trim())
  .order('created_at')`), its error message text (`Kit PO Number not
  found`), and every downstream Build Kit method
  (`startKitBuild`, `kitMaterial`, `markLineAsKitted`,
  `unmarkLineAsKitted`, `completeKitBuild`). The serial entry point is
  purely additive on the load path.

### `src/hooks/use-build-kit.ts`

- **New mutation** `verifyKitBySerialMutation` wired to the new
  service method. Returns the same `{ exists, kitData?, error? }`
  shape as `verifyKitMutation` so the form can swap one for the
  other based on smart-detect.
- **Three new exports** on the hook surface:
  `verifyKitBySerial`, `verifyKitBySerialAsync`, `isVerifyingKitBySerial`.
  Names mirror the existing `verifyKit{Async,…}` triplet.
- The existing `verifyKitMutation` gained a doc-comment pointer to
  the new sibling so future readers route `KIT-…` scans correctly.

### `src/components/ui/rf-build-kit-form.tsx`

- **Smart-detect at scan time** inside `handleKitPoValidation`. If
  the scanned value passes `isPotentialKitSerialNumber`, route to
  `verifyKitBySerialAsync`; otherwise route to `verifyKitAsync` (the
  legacy PO path). Both paths land on `kit_materials`. The
  downstream `startBuildAsync(loadedKit.kitPoNumber)` call always
  uses the PO surfaced on the loaded `kitData` payload — so a serial
  scan still triggers the right `startKitBuild` mutation on the same
  PO row that the operator would have scanned directly.
- **Scan-step copy** updated to mirror the picking flow:
  - Heading: `Scan Kit PO Number` → `Scan Kit Serial Number`
  - Sub-copy: `Enter or scan the Kit PO number to start building`
    → `Scan the kit serial number (KIT-…) to drop straight into
    building. Legacy Kit PO numbers are still accepted.`
  - Label: `Kit PO Number` → `Kit Serial Number or PO`
  - Placeholder: `Scan or enter Kit PO number` → `Scan KIT-YYYYMMDD-NNN
    or Kit PO`
- **`kitPoNumber` state variable kept** for backward compatibility
  (no rename) — it now holds either identifier shape. The trimmed
  value is fed to the right service method by smart-detect.
- **Loading / disabled guards** extended to also account for the new
  `isVerifyingKitBySerial` pending flag so the input + button +
  spinner show the same state whichever verify path is in flight.
- **Empty-input toast** copy changed from `Please enter a Kit PO
  Number` to `Please enter a Kit Serial Number or PO` so the message
  matches the new label.

### `src/lib/supabase/__tests__/kit-serial-scoping.test.ts`

- **Three new tests** under a new `verifyKitForBuildBySerialNumber`
  describe block, mirroring the sibling-shipped-today picking suite:
  - `loads the kit directly by serial number without any PO meta
    lookup` — verifies the only RR_Kitting_DATA select is keyed on
    `kit_serial_number`, never on `kit_po_number`.
  - `returns an exists:false error when the serial is unknown` —
    guards against accidentally surfacing a stale aggregated payload
    on the serial path.
  - `trims whitespace and rejects empty input gracefully` — input
    validation guardrail; asserts zero DB reads for empty input.

## Backward Compatibility

- The public `verifyKitForBuild(kitPoNumber)` signature and behaviour
  are unchanged. The two existing callers — the `verifyKitMutation`
  in `use-build-kit.ts` and the production-boards-side
  `RRKittingDataService.verifyKitForBuild` direct callsites — keep
  working.
- The `RFBuildKitFormProps` shape is untouched (no `initialKitPoNumber`
  prop today, unlike the picking sibling which gained one). If a
  prefill prop is added later, the same smart-detect inside
  `handleKitPoValidation` will route it correctly.
- The downstream Build Kit mutations (`startKitBuild`, `kitMaterial`,
  `completeKitBuild`, `markLineAsKitted`, `unmarkLineAsKitted`) are
  **still PO-keyed** today. Scanning a serial works because the
  loaded `kitData.kitPoNumber` resolves to that kit's PO, and from
  there the existing PO-keyed mutations operate exactly as they did
  before. For single-kit POs this is byte-identical to the legacy
  path. For multi-kit POs the mutations would still operate across
  every kit sharing the PO — but this is the pre-existing Build Kit
  behaviour and the task brief explicitly scopes "only the entry
  point changes". See [[Kit-Serial-Scoping]] for the broader
  serial-keying convention and the picking-side completion of it.
- No new Supabase Realtime channels — honours the
  `Master Rule workspace rule` Realtime Policy.

## Validation

- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm exec eslint src/lib/supabase/rr-kitting-data.service.ts
  src/hooks/use-build-kit.ts
  src/lib/supabase/__tests__/kit-serial-scoping.test.ts` — clean.
  `src/components/ui/` is project-ignored by ESLint config (existing
  convention).
- `pnpm vitest run src/lib/supabase/__tests__/kit-serial-scoping.test.ts`
  — **11 of 12 passing**. My 3 new tests pass; the 8 pre-existing
  tests (5 picking + 2 addFlagBySerialNumber + 1 syncKitProgressFromSerial)
  still pass. The 1 remaining failure is the same
  `createKitBuildPlan kanban link stamp` **pre-existing date-bomb**
  noted in [[RF-Kit-Pick-By-Serial-Number]] § Validation: the test
  hardcodes `KIT-20260512-006` but `generateKitSerialNumber()`
  derives the serial from `new Date()` so today it returns
  `KIT-20260518-001` (UTC-rounded). Independently reproducible on
  `git stash`'d main; out of scope for this UX work.
- `pnpm build` — succeeds. Bundle budget delta:
  `feature-rf-interface` chunk went from **520.88 KB → 522.64 KB
  (+1.76 KB)**. Well within the user-task-brief budget allowance of
  +5 KB on top of the [[RF-Kit-Floor-Pick-Visual-Confirm]] baseline.
  Pre-existing oversized chunks (`warehouse-location-map` at
  1523.44 KB, `feature-admin` at 1013.81 KB) are explicitly
  out-of-scope per the task brief.

## Edge Cases

- **Operator scans a serial that doesn't exist.** Service returns
  `{ exists: false, error: 'Kit serial KIT-XXX not found' }`.
  `verifyKitBySerialMutation.onSuccess` shows the error toast; the
  form stays on `kit_scan` and re-focuses the input.
- **Operator scans a serial in a non-buildable status (e.g.
  `kit_built`, `inspected`).** Same shared status sanity check as the
  legacy PO path — `Kit is in "kit_built" status and cannot be built`.
- **Operator types `kit-…` (lowercase).** `isPotentialKitSerialNumber`
  uppercases before comparison; the form also auto-uppercases the
  input. Routes to the serial path regardless.
- **Operator types `KIT12345` (legacy PO label, no hyphen).**
  `isPotentialKitSerialNumber` rejects (hyphen required), so the
  scan routes through the PO path. `isPotentialKitPoNumber` matches
  the `KIT` prefix and the existing PO query handles it.
- **Whitespace from scanner.** Trimmed inside the service's
  `verifyKitForBuildBySerialNumber` before the DB read; the form
  trims again before calling smart-detect for double safety.
- **Authentication race.** Same `isAuthenticated && !isAuthLoading`
  gate as the legacy path — no behaviour change.

## Open Follow-Ups

- ~~The Build Kit downstream mutations (`startKitBuild`, `kitMaterial`,
  `completeKitBuild`, `markLineAsKitted`, `unmarkLineAsKitted`) are
  still PO-keyed…~~ **CLOSED 2026-05-17 evening** by
  [[Fix-Build-Kit-Completion-Multi-Kit-PO]]. The exact risk this
  follow-up flagged — a multi-kit PO blocking completion of one kit
  because the sibling kit's unkitted rows aggregate into the
  PO-keyed pre-check — bit the floor a few hours after this note
  landed (PO `2010102616` covering `KIT-20260515-001` fully kitted
  + `KIT-20260515-002` unstarted). Fix is additive: `completeKitBuild`
  / `startKitBuild` / `kitMaterial` gained an optional
  `kitSerialNumber` parameter that scopes every query to a single
  kit when supplied. The RF form and the legacy desktop form both
  now always pass it. `markLineAsKitted` / `unmarkLineAsKitted`
  remain line-id-keyed (inherently safe) but route their kanban
  sync through `syncKitProgressFromSerial`. See the Debug note for
  the full root-cause walk-through, regression tests, and
  validation log.
- The date-bomb test (`createKitBuildPlan kanban link stamp`) still
  needs a one-line dynamic-prefix fix. Same out-of-scope note as the
  sibling implementation log.

## Related

- [[RF-Kit-Pick-By-Serial-Number]] — direct sibling shipped earlier
  today; this is the Build Kit equivalent of that picking-side
  change.
- [[Kitting System - Feature Module]] — parent module overview.
- [[RF Interface - Feature Module]] — where `RFBuildKitForm` lives.
- [[KittingServices - Supabase Service]] — service-layer surface
  catalog; the new `verifyKitForBuildBySerialNumber` should be added
  there as well.
- [[Kit-Serial-Scoping]] — the per-kit-serial convention this builds
  on top of and which the Build Kit downstream mutations have not
  yet been converted to.
- [[Fix-Kit-Build-Cross-Linked-Parts]] — the 2026-05-12 cross-link
  fix that made serial-keyed lookups safe across sibling kits on the
  picking side; the Build Kit side carries the open follow-up.
- [[RF-Kit-Floor-Pick-Visual-Confirm]] — same-day-earlier sibling on
  the picking form; established the baseline `feature-rf-interface`
  chunk size that this change adds to.
- [[Authorized-Ship-Short-Negates-Black-Hat]] /
  [[Edit-Ship-Short-Post-Creation-Flow]] — yesterday's same-domain
  ship-short work that this change shares the kitting service file
  with.
