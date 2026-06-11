// Created and developed by Jai Singh
/**
 * Top-level tab strip listing the six boards as inline segmented pills.
 *
 * v2 aesthetic overhaul (2026-05-17):
 *   - Container drops the heavy `bg-muted/40 p-1` wrapper and renders as
 *     an inline segmented control with a thin hairline underneath.
 *   - Tabs are smaller (h-9), tighter tracking, lower visual weight so
 *     they don't compete with the bento grid below.
 *   - Active tab paints with the board kind's accent gradient underline
 *     (a 2px hairline with kind-coloured glow), and a subtle accent text
 *     colour — same vocabulary used everywhere on the platform.
 *
 * (The 'hourly' and 'sqcdp' boards don't have a `BentoBoardKind`
 * accent — they fall back to a neutral indicator for those tabs.)
 */
import { cn } from '@/lib/utils'
import { BOARDS, type BoardSlug } from '../lib/boards'
import { accentFor } from './bento/board-kind-accent'
import type { BentoBoardKind } from './bento/card-variant'

interface BoardTabsProps {
  activeSlug: BoardSlug
  onChange: (slug: BoardSlug) => void
  /** TV mode bumps icon + text size for warehouse-distance readability. */
  density?: 'normal' | 'tv'
  className?: string
}

/**
 * Map the BOARDS registry slugs onto the four `BentoBoardKind` keys for
 * the per-tab accent. Hourly + SQCDP aren't bento boards, so they pick
 * a neutral indicator (sky for hourly, emerald for sqcdp — pulled from
 * the kind palette so the chrome stays inside the same vocabulary).
 */
const SLUG_TO_BENTO_KIND: Partial<Record<BoardSlug, BentoBoardKind>> = {
  announcements: 'announcement',
  hr_news: 'hr_news',
  jobs: 'job',
  safety_alerts: 'safety_alert',
}

export function BoardTabs({
  activeSlug,
  onChange,
  density = 'normal',
  className,
}: BoardTabsProps) {
  const isTv = density === 'tv'

  return (
    <nav
      aria-label='Production Boards'
      className={cn(
        'border-border/60 relative flex flex-wrap items-end gap-1 border-b',
        className
      )}
    >
      {BOARDS.map((b) => {
        const isActive = b.slug === activeSlug
        const Icon = b.Icon
        const bentoKind = SLUG_TO_BENTO_KIND[b.slug]
        const accent = bentoKind
          ? accentFor(bentoKind)
          : {
              midHex: '#10b981',
              tabUnderlineClass:
                'from-emerald-500/0 via-emerald-500/80 to-emerald-500/0',
            }
        return (
          <button
            key={b.slug}
            type='button'
            onClick={() => onChange(b.slug)}
            aria-pressed={isActive}
            className={cn(
              'group relative inline-flex items-center gap-2 rounded-t-md px-3.5 pt-1.5 pb-2.5 font-medium tracking-[-0.005em] transition-colors',
              isTv ? 'text-base' : 'text-sm',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon
              className={cn(
                isTv ? 'h-5 w-5' : 'h-4 w-4',
                isActive ? '' : 'opacity-70 group-hover:opacity-100'
              )}
              aria-hidden
            />
            <span>{b.title}</span>
            {isActive && (
              <>
                <span
                  aria-hidden
                  className='absolute inset-x-2 -bottom-px h-[2px] rounded-full'
                  style={{
                    background: `linear-gradient(90deg, ${accent.midHex}00, ${accent.midHex} 50%, ${accent.midHex}00)`,
                    boxShadow: `0 -2px 8px ${accent.midHex}55`,
                  }}
                />
              </>
            )}
          </button>
        )
      })}
    </nav>
  )
}

// Created and developed by Jai Singh
