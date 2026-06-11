---
tags: [type/implementation, status/active, domain/frontend, domain/backend, kitting]
created: 2026-06-04
---

# Build Sheet — Authorized Ship Short Section

## Purpose / Context

Request: on the printable **Kit Build Sheet** (`KitBuildSheet`), under the
**Transport Initials** signature block, add a section listing the kit's
authorized ship shorts — the **part numbers** and the **person who
authorized** each.

## Key finding — authorizer was never stored

Migration 101 documents the `RR_Kitting_DATA.authorized_ship_short_items`
JSONB format as `{lineNumber, partNumber, description, authorizedBy}`, but the
app only ever wrote `{lineNumber, partNumber, description}` — `authorizedBy`
was never populated. The authorizer only existed in the `kit_notes`
audit-trail system events (free-text, not per-part). So this change starts
stamping `authorizedBy` at write time and reads it through to the sheet.

## Changes (`rr-kitting-data.service.ts`)

- New private `getCurrentUserDisplayName()` (full_name → first/last → email
  local-part) — resolves the signed-in operator's display name.
- `createKitBuildPlan` — stamps `authorizedBy = creator name` on any
  ship-short items entered at creation (preserves an explicit value if
  passed).
- `updateAuthorizedShipShortItems` (the single authorize path used by the
  **Black Hat panel** and the **Edit Ship Short dialog**) — now selects the
  existing `authorized_ship_short_items`, builds a `partNumber → authorizedBy`
  map, and stamps each saved item: **preserve** the prior authorizer for
  parts already on the list (don't reattribute someone else's
  authorization), **stamp the current operator** for newly-added parts.
- Widened the ship-short item types on `CreateKitBuildPlanInput` and both
  `getKitBuildPlanDetails*` return types + read casts to include
  `authorizedBy?: string | null`. (The grid `KitGridRecord` was left as-is
  — the grid Ship Short column shows part numbers only.)

## Changes (`kit-build-sheet.tsx`)

- `AuthorizedShipShortItem` gained `authorizedBy?: string | null` (flows in
  via the existing `details.authorizedShipShortItems` passthrough).
- New **Authorized Ship Short** section rendered in the left column directly
  under Transport Initials, shown only when the kit has ≥1 ship-short part.
  Two columns: **Part Number** (+ description) and **Authorized By**
  (falls back to `—` for legacy items with no stored authorizer).
- **Print fidelity:** borders + the black header bar use **inline styles**
  (not Tailwind classes), because `handlePrint` copies `innerHTML` into a
  window that only ships a hardcoded utility-class subset (no `border-r` /
  `border-t` / `bg-black`). Same technique as the TO barcodes.

## Limitation

Ship shorts authorized **before** this change have no stored authorizer and
render `—`. Re-saving via the Edit Ship Short dialog or Black Hat panel (or
any new authorization) stamps the current operator going forward. No
retroactive backfill (the authorizer isn't reliably recoverable per-part from
the free-text `kit_notes` events).

## Verification

`tsc -b` clean; ESLint clean (the lone `flex-shrink-0` warning is the
pre-existing colour sidebar). FE + service only — no schema change (the JSONB
column already supported `authorizedBy`). Dev server HMR-applied.

## Related
- [[Authorized-Ship-Short-Negates-Black-Hat]]
- [[Black-Hat-Ship-Short-Authorization-Panel]]
- [[Edit-Ship-Short-Post-Creation-Flow]]
- [[Scannable-TO-Barcodes-On-Build-Sheet]] — sibling build-sheet/print-fidelity work
