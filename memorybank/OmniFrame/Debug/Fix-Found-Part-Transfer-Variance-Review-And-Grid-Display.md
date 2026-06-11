---
title: Fix Found Part Transfer Variance Review + Grid From→To
date: 2026-04-19
tags: [cycle-count, found-part-transfer, variance-trigger, rr_cyclecount_data, manual-counts, ux-fix]
status: completed
---

# Fix: Found Part Transfer — Variance Review + Grid From→To

## Symptoms

1. Every completed **Found Part Transfer** count landed in the Manual Counts grid with status **Variance Review** — never **Completed** — even though the operator successfully moved parts from A → B and entered the final count at B.
2. The grid's Location column only showed one value per row, so there was no way to see the transfer (source → destination) at a glance.

## Root Cause (status)

The `BEFORE INSERT/UPDATE` trigger `auto_calculate_cycle_count_variance` (migration 215) computes `variance_quantity = counted_quantity − system_quantity` and, when the row is being flipped to `completed`, promotes status to `variance_review` if variance is non-zero.

For a transfer:
- `system_quantity` = expected qty at the **source** (A) before transfer
- `counted_quantity` = final count at the **destination** (B) after consolidation

Those are two different locations — the "variance" is not meaningful. The trigger was flagging every transfer with non-zero net as a variance review.

## Fix

### 1. Migration 224 — trigger exempts `found_part_transfer`

`supabase/migrations/224_exempt_found_part_transfer_from_variance_review.sql` rewrites `auto_calculate_cycle_count_variance` so that when `NEW.count_type = 'found_part_transfer'`:
- `variance_quantity` and `variance_percentage` are still computed (informational), BUT
- `requires_recount` is forced to `false`
- the `variance_review` promotion is skipped (early RETURN NEW)

All other count types keep the existing threshold-driven behavior from migration 215.

The migration also backfills existing transfer rows that were incorrectly promoted — flips `variance_review → completed` and clears `requires_recount`. Four existing rows were corrected.

### 2. Manual Counts grid — From→To display

`src/components/manual-counts-search.tsx`:
- **Location cell**: for `count_type === 'found_part_transfer'` rows, render `{location}  →  {transfer_destination_location}` with an `ArrowRight` icon and an emerald tint on the destination. Non-transfer rows keep the existing plain `{item.location}`.
- **Variance cell**: for transfer rows, render a greyed-out `n/a` with a tooltip explaining variance isn't applicable. Non-transfer rows keep the existing colored variance badge.
- **Location filter**: typing in the Location column filter now matches either the source `location` OR the `transfer_destination_location` on transfer rows.

## Files touched

- `supabase/migrations/224_exempt_found_part_transfer_from_variance_review.sql` (new)
- `src/components/manual-counts-search.tsx`

## Verification

- `npx tsc -b --noEmit` — clean
- ESLint on `manual-counts-search.tsx` — clean
- Supabase `apply_migration` — success; backfill updated 4 rows
- Post-migration sanity SQL: every `found_part_transfer` row now has `status = 'completed'`

Pre-existing test failures (`ConfirmDialog` double-message DOM, missing Supabase env vars in two spec files, zustand storage mock in rbac-hardening) are unrelated — my diff only touched `manual-counts-search.tsx`.

## Deployment notes

- Frontend-only deploy for the grid changes.
- Migration 224 already applied via Supabase MCP — no Rust or frontend restart needed for the trigger itself; it fires on next INSERT/UPDATE.
- Existing transfer rows have been backfilled in-place.
