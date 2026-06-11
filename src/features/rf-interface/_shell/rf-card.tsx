// Created and developed by Jai Singh
import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface RFCardProps extends HTMLAttributes<HTMLDivElement> {
  /** When `glow` is set, paints a soft accent halo behind the card. */
  glow?: 'primary' | 'destructive' | 'subtle' | 'none'
  /** Visual density. */
  variant?: 'default' | 'strong' | 'light'
}

/**
 * Glassmorphic card that uses the project's existing `glass*` utility
 * classes so it inherits light/dark/custom palette swapping for free.
 *
 * Subtler than the default shadcn `Card` and is the building block
 * for the cinematic RF shell.
 */
export const RFCard = forwardRef<HTMLDivElement, RFCardProps>(
  (
    { className, children, glow = 'none', variant = 'default', ...rest },
    ref
  ) => {
    const glassClass =
      variant === 'strong'
        ? 'glass-strong'
        : variant === 'light'
          ? 'glass-light'
          : 'glass'

    return (
      <div ref={ref} className={cn('relative isolate', className)} {...rest}>
        {glow !== 'none' ? (
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute -inset-3 -z-10 rounded-[calc(var(--radius)+12px)] opacity-60 blur-2xl',
              glow === 'primary' && 'bg-primary/15',
              glow === 'destructive' && 'bg-destructive/20',
              glow === 'subtle' && 'bg-foreground/5'
            )}
          />
        ) : null}
        <div
          className={cn(glassClass, 'rounded-[calc(var(--radius)+4px)] p-4')}
        >
          {children}
        </div>
      </div>
    )
  }
)
RFCard.displayName = 'RFCard'

// Created and developed by Jai Singh
