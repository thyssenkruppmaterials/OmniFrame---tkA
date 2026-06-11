// Created and developed by Jai Singh
/**
 * BoardFilterChips — premium chip-strip primitive used by every secondary
 * board's filter row.
 *
 * v2 aesthetic overhaul (2026-05-17):
 *   - Replaces the per-board duplicated `FilterChips` local components.
 *   - Active chip paints with the board kind's gradient + soft glow.
 *   - Inactive chips render as glass pills with `backdrop-blur-sm`.
 *
 * Used by all four content boards (Announcements / HR News / Jobs /
 * Safety Alerts). Adopts the same vocabulary as `<BoardHeader>` so the
 * row reads as one continuous header chrome.
 */
import { cn } from '@/lib/utils'
import { accentFor, gradientCss } from './board-kind-accent'
import type { BentoBoardKind } from './card-variant'

export interface BoardFilterChipOption {
  id: string
  label: string
  count?: number
}

export interface BoardFilterChipsProps {
  boardKind: BentoBoardKind
  options: readonly BoardFilterChipOption[]
  active: string
  onChange: (id: string) => void
  className?: string
}

export function BoardFilterChips({
  boardKind,
  options,
  active,
  onChange,
  className,
}: BoardFilterChipsProps) {
  const accent = accentFor(boardKind)
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((o) => {
        const isActive = o.id === active
        return (
          <button
            key={o.id}
            type='button'
            onClick={() => onChange(o.id)}
            aria-pressed={isActive}
            className={cn(
              'group relative inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium tracking-[-0.005em] transition-all',
              isActive
                ? 'text-white shadow-md'
                : 'border-border/50 bg-card/60 text-muted-foreground hover:border-border hover:bg-card hover:text-foreground border backdrop-blur-sm'
            )}
            style={
              isActive
                ? {
                    background: gradientCss(boardKind, 110),
                    boxShadow: `0 6px 18px -6px ${accent.glowStrong}`,
                  }
                : undefined
            }
          >
            <span>{o.label}</span>
            {typeof o.count === 'number' && o.count > 0 && (
              <span
                className={cn(
                  'tabular-nums opacity-70',
                  isActive ? 'text-white/85' : 'text-muted-foreground/70'
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// Created and developed by Jai Singh
