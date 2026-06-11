---
tags:
  - type/pattern
  - status/active
  - domain/frontend
created: 2026-04-12
---
# Dark Mode Opacity-Based Color Pattern

## Problem
Hard-coded light-mode Tailwind color classes (e.g., `bg-yellow-100 text-yellow-800`) look washed out or invisible in dark mode. Adding separate `dark:` overrides for every shade is verbose and error-prone.

## Solution
Use opacity-based color classes that automatically adapt to both modes:

```
// Status badge example
bg-amber-500/15 text-amber-700 border-amber-500/25
dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20
```

### Key Principles
1. **Background:** `bg-{color}-500/{opacity}` — use 10-15% in light, 5-10% in dark
2. **Text:** `text-{color}-700` light / `dark:text-{color}-400` dark
3. **Border:** `border-{color}-500/25` light / `dark:border-{color}-500/20` dark
4. **Card alerts:** `border-{color}-500/30 bg-{color}-500/5` for conditional card tinting
5. **Hover shadows:** `hover:shadow-{color}-500/10 dark:hover:shadow-{color}-500/5`

## Standard Tokens

| Element | Light | Dark |
|---------|-------|------|
| Card base | `border-border/50 bg-card/50 backdrop-blur-sm` | (same) |
| Icon container | `bg-slate-500/10` | `dark:bg-slate-400/10` |
| Metric pill bg | `bg-{color}-500/8` | `dark:bg-{color}-500/5` |
| Status badge bg | `bg-{color}-500/15` | `dark:bg-{color}-500/10` |
| Selected row | `bg-blue-500/5` | `dark:bg-blue-500/5` |
| Alternating row | `bg-muted/15` | (same) |
| Muted text label | `text-muted-foreground text-[11px]` | (same) |

## Where Used
- `manual-counts-search.tsx` — `getStatusColor()`, StatisticsCards, table rows
- `live-operator-status.tsx` — Card styling, worker rows

## Related
- [[ManualCountsSearch - Inventory Tab]]
- [[Redesign-Manual-Counts-Tab-UI]]
- [[ThemeSystem - Styling]]