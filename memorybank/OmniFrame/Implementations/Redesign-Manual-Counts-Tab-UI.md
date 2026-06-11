---
tags:
  - type/implementation
  - status/active
  - domain/frontend
created: 2026-04-12
---
# Redesign Manual Counts Tab UI

## Purpose
Comprehensive visual redesign of the Manual Counts tab in the Inventory Management page to improve visual hierarchy, dark mode consistency, and information density.

## Files Modified
- `src/components/manual-counts-search.tsx` — Statistics cards, table header/toolbar, data rows, filter row, pagination, loading/error states, status color mapping
- `src/components/live-operator-status.tsx` — Operator panel layout, empty state, worker rows, connection indicator

## Key Design Decisions

### 1. Statistics Cards Redesign
- **Before:** Separator-divided metrics within each card, `bg-linear-to-br` gradients, `text-3xl` values with `Separator orientation='vertical'`
- **After:** 3-column grid with rounded-lg pill backgrounds per metric (`bg-{color}-500/8`), `text-2xl` values, hover gradient overlays with `group-hover:opacity-100`, icon containers with `rounded-md bg-slate-500/10`
- **Accuracy card:** Added progress bars (`h-1.5 rounded-full`) beneath percentage values with color-coded fills
- **Alert badges:** Replaced `Badge` components with lightweight `<span>` pills using `rounded-full bg-{color}-500/15 text-[10px]`

### 2. Status Color System
- **Before:** Hard-coded light-mode colors (`bg-yellow-100 text-yellow-800 border-yellow-300`)
- **After:** Opacity-based dual-mode system: `bg-{color}-500/15 text-{color}-700 border-{color}-500/25 dark:bg-{color}-500/10 dark:text-{color}-400 dark:border-{color}-500/20`
- Covers all 7 statuses: pending, in_progress, completed, variance_review, approved, cancelled, recount

### 3. Table Improvements
- Column headers: uppercase `text-[11px] tracking-wider` with `bg-muted/40`
- Filter row: `h-7` inputs with `bg-background/50 border-border/30 text-[11px]`
- Data rows: reduced padding (`py-2.5`), subtle alternating with `bg-muted/15`, selection via `bg-blue-500/5`
- Variance values: inline `<span>` pills instead of bordered `Badge` components
- Assigned user: smaller avatars (h-5 w-5) with blue-tinted backgrounds
- Row action button: opacity-based visibility (`opacity-60 hover:opacity-100`)

### 4. Toolbar Compaction
- Reduced search input height to `h-9` with `bg-muted/30 rounded-lg`
- Buttons reduced to `h-8 text-xs rounded-lg`
- Operator toggle uses ghost variant with conditional `bg-blue-500/10`
- Removed vertical `Separator` divider, replaced with `w-px bg-border/50`

### 5. Pagination Refinement
- Switched from `variant='outline'` to `variant='ghost'` buttons
- Compact size: `h-7 w-7 text-xs`
- Simplified info text: "1 - 25 of 977" format

### 6. Active Operators Panel
- Empty state: horizontal flex layout with dashed border instead of tall centered layout
- Worker rows: avatar circle with status dot overlay (bottom-right positioned)
- Live indicator: CSS ping animation with `animate-ping` on outer ring
- Reduced overall vertical padding

### 7. Loading & Error States
- Simplified: removed outer ring animation, just `Loader2 animate-spin`
- Reduced padding from `py-16` to `py-14`
- Smaller text sizing throughout

## Design Patterns Established
- Opacity-based color system for dark mode: `bg-{color}-500/{opacity}` + `dark:bg-{color}-500/{lower-opacity}`
- Icon containers: `flex h-{size} w-{size} items-center justify-center rounded-md bg-slate-500/10`
- Label typography: `text-[11px] font-medium tracking-wider uppercase text-muted-foreground`
- Card base: `border-border/50 bg-card/50 backdrop-blur-sm`
- Conditional alert styling on cards: `border-{color}-500/30 bg-{color}-500/5`

## Related
- [[ManualCountsSearch - Inventory Tab]]
- [[LiveOperatorStatus - Real-Time Panel]]