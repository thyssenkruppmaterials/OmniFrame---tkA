---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-17
---

# Implement SQCDP TV Viewport Fit

## Purpose / Context

The SQCDP TV-mode page did not size to the TV viewport. Two coupled symptoms:

1. **Dead space inside each card** — every primary card reserved `min-h-[16rem]` (256 px) on the big-number block and bottom-anchored the value inside it. At TV scale that meant ~half a card's worth of empty space appeared between the colored category header and the value ("848 Days" floated mid-card in Safety).
2. **Dead space below the grid** — the `<SqcdpGrid>` wrapper used `space-y-4 lg:space-y-6` with no `h-full` and no flex weights. The grids sized to their natural content height inside `<TvFrame>`'s `<main class="flex-1">`, leaving everything below the secondary row blank.

User complaint (2026-05-17):

> SQ CDP board. When displaying on a TV, the top of the container has tons of empty space when it goes down to about where it says 848 days for the safety record. How can we make this so all the containers size naturally with the size of the TV and it shows the entire SQ CDP page in a single snapshot on that TV?

## Details

The fix is the [[TV-Viewport-Fit-Grid]] recipe — three coordinated changes that establish an unbroken "fill the parent" chain from `<TvFrame>` down to the value bottom-anchor inside each card.

### Files changed

- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-grid.tsx`
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-card.tsx`
- `src/features/shift-productivity/production-boards/boards/sqcdp/sqcdp-board.tsx` (`SqcdpGridSkeleton` mirrors the grid)

### Change 1 — `<SqcdpGrid>` wrapper fills the viewport in TV mode

```diff
-<div className='space-y-4 lg:space-y-6'>
+<div className={cn(
+  isTv ? 'flex h-full flex-col gap-6' : 'space-y-4 lg:space-y-6'
+)}>
```

Normal (in-app) mode is unchanged — it stays inside the scrollable app shell and keeps the natural-height vertical rhythm.

### Change 2 — Tier rows share the vertical budget 5:3

```diff
 <motion.div  /* primary */
   className={cn(
     'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5',
     primaryGap,
+    isTv && 'min-h-0 flex-5 auto-rows-fr',
   )}
 >

 <div  /* secondary */
   className={cn(
     'grid grid-cols-2 lg:grid-cols-4',
     secondaryGap,
+    isTv && 'min-h-0 flex-3 auto-rows-fr',
   )}
 >
```

5:3 split because primary cards carry the chart strip (180 px) and need more vertical budget; secondary cards are meta-only. `min-h-0` lets each row shrink-fit the flex parent (the default `min-height: auto` would otherwise push past the viewport). `auto-rows-fr` makes the single grid row consume the row's allocated height, so cards stretch via the existing `h-full` chain on the motion wrapper + `<CardSurface>`.

### Change 3 — `<SqcdpCard>` drops the hard min-h reserve in TV mode

```diff
 // DENSITY.tv
 {
-  primaryReserve: 'min-h-[16rem] flex items-end',
+  primaryReserve: 'flex flex-1 items-end min-h-0',
-  subPrimaryReserve: 'min-h-[5.5rem] flex items-end',
+  subPrimaryReserve: 'flex flex-1 items-end min-h-0',
 }
```

The body wrapper around `value + subtitle + comparison` (and the stacked-mode wrapper around sub-metric blocks) also adopts `flex-1 min-h-0` in TV mode so the inner `flex-1` on the value reserve has space to grow into:

```diff
 <div
   className={cn(
     'flex flex-col gap-1',
+    density === 'tv' && 'min-h-0 flex-1',
   )}
 >
   <div className={cn(d.primary, d.primaryReserve, 'flex items-end gap-3')}>
     {value}
   </div>
   <div>{subtitle}</div>
   <div>{comparison}</div>
 </div>
```

Normal density keeps the `min-h-[9rem]` worst-case reserve on the primary block — in-page rendering doesn't have the viewport-filling row to lean on, so the explicit reserve still earns its keep for cross-card baseline alignment in the scrollable app shell.

### Change 4 — `SqcdpGridSkeleton` mirrors the same layout

The loading skeleton in `sqcdp-board.tsx` re-uses `<SqcdpCard>` to render empty placeholders. To keep the skeleton dimensions matching production the same wrapper + flex-weight + `auto-rows-fr` chain was applied to its TV branch.

## How the alignment still works without the reserve

The legacy `min-h-[16rem]` reserve existed to bottom-align values across the row so that "475" (1 line) and "848 Days" (2 lines) shared a baseline. The replacement gives the same property via a different mechanism:

- `auto-rows-fr` + the existing `h-full` chain → every card in a row is the **same stretched height**.
- Body wrapper `flex-1 min-h-0` → wrapper consumes the body's available space.
- Value `flex-1 items-end` → value bottom-anchors within that consumed space.

Result: every card in the row has its value at the same baseline because the wrappers themselves are the same height — not because of a hardcoded 16rem floor. Single-line values no longer float mid-card; they sit just above the subtitle/comparison row regardless of card height.

## Validation

- `pnpm vitest run src/features/shift-productivity/production-boards/boards/sqcdp/` — 9 files, 101 tests, all passing.
- `pnpm eslint` on the three changed files — clean (had to switch `flex-[5]`/`flex-[3]` to Tailwind v4's bare `flex-5`/`flex-3` to clear the warning).

## Related

- [[TV-Viewport-Fit-Grid]] — the pattern this implementation extracts.
- [[Elevated-KPI-Stat-Cards]] § Variant: Colored Header Scorecard — the SQCDP card shell, unchanged.
- [[Implement-Production-Boards-Hourly-Grid]] — sibling TV board that already fits naturally (different content shape, no comparable issue).
- [[Cinematic-Tab-Rotation]] — the alternative when a board genuinely can't fit a TV viewport even after this recipe.
