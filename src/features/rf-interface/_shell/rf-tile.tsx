// Created and developed by Jai Singh
import { forwardRef, type ElementType, type ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'framer-motion'
import { cn } from '@/lib/utils'
import { fadeUp, tapScale } from './motion-variants'

export type RFTileAccent =
  | 'scan'
  | 'putaway'
  | 'pick'
  | 'kit'
  | 'count'
  | 'grs'
  | 'transfer'
  | 'productivity'
  | 'queue'
  | 'claim'
  | 'sap'

const accentMap: Record<
  RFTileAccent,
  { bg: string; ring: string; text: string; glow: string }
> = {
  scan: {
    bg: 'bg-rf-accent-scan/10',
    ring: 'ring-rf-accent-scan/30',
    text: 'text-rf-accent-scan',
    glow: 'bg-rf-accent-scan/20',
  },
  putaway: {
    bg: 'bg-rf-accent-putaway/10',
    ring: 'ring-rf-accent-putaway/30',
    text: 'text-rf-accent-putaway',
    glow: 'bg-rf-accent-putaway/20',
  },
  pick: {
    bg: 'bg-rf-accent-pick/10',
    ring: 'ring-rf-accent-pick/30',
    text: 'text-rf-accent-pick',
    glow: 'bg-rf-accent-pick/20',
  },
  kit: {
    bg: 'bg-rf-accent-kit/10',
    ring: 'ring-rf-accent-kit/30',
    text: 'text-rf-accent-kit',
    glow: 'bg-rf-accent-kit/20',
  },
  count: {
    bg: 'bg-rf-accent-count/10',
    ring: 'ring-rf-accent-count/30',
    text: 'text-rf-accent-count',
    glow: 'bg-rf-accent-count/20',
  },
  grs: {
    bg: 'bg-rf-accent-grs/10',
    ring: 'ring-rf-accent-grs/30',
    text: 'text-rf-accent-grs',
    glow: 'bg-rf-accent-grs/20',
  },
  transfer: {
    bg: 'bg-rf-accent-transfer/10',
    ring: 'ring-rf-accent-transfer/30',
    text: 'text-rf-accent-transfer',
    glow: 'bg-rf-accent-transfer/20',
  },
  productivity: {
    bg: 'bg-rf-accent-productivity/10',
    ring: 'ring-rf-accent-productivity/30',
    text: 'text-rf-accent-productivity',
    glow: 'bg-rf-accent-productivity/20',
  },
  queue: {
    bg: 'bg-rf-accent-queue/10',
    ring: 'ring-rf-accent-queue/30',
    text: 'text-rf-accent-queue',
    glow: 'bg-rf-accent-queue/20',
  },
  claim: {
    bg: 'bg-rf-accent-claim/10',
    ring: 'ring-rf-accent-claim/30',
    text: 'text-rf-accent-claim',
    glow: 'bg-rf-accent-claim/20',
  },
  sap: {
    bg: 'bg-rf-accent-sap/10',
    ring: 'ring-rf-accent-sap/30',
    text: 'text-rf-accent-sap',
    glow: 'bg-rf-accent-sap/20',
  },
}

interface RFTileProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  icon: ElementType<{ className?: string }>
  label: string
  description?: string
  accent: RFTileAccent
  badge?: ReactNode
  /** Forces a wider tile (col-span-2). */
  wide?: boolean
}

/**
 * The headline tile for the RF home grid — glass surface, accent
 * icon halo, badge slot, press-scale feedback. Stagger entrance is
 * controlled by the parent's `staggerContainer` variant.
 */
export const RFTile = forwardRef<HTMLButtonElement, RFTileProps>(
  (
    { icon: Icon, label, description, accent, badge, wide, className, ...rest },
    ref
  ) => {
    const a = accentMap[accent]
    return (
      <motion.button
        ref={ref}
        type='button'
        variants={fadeUp}
        whileTap={tapScale}
        className={cn(
          'glass-card group focus-visible:ring-ring relative flex h-28 flex-col items-start justify-between overflow-hidden rounded-2xl p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none',
          wide ? 'col-span-2' : '',
          className
        )}
        {...rest}
      >
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute -top-6 -right-6 h-24 w-24 rounded-full blur-2xl transition-opacity duration-500 group-hover:opacity-80',
            a.glow,
            'opacity-50'
          )}
        />

        <div className='flex w-full items-start justify-between'>
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl ring-1 backdrop-blur-md',
              a.bg,
              a.ring
            )}
          >
            <Icon className={cn('h-5 w-5', a.text)} />
          </div>
          {badge ? <div className='translate-y-0.5'>{badge}</div> : null}
        </div>

        <div className='relative z-10 flex w-full flex-col gap-0.5'>
          <span className='text-foreground text-[13px] leading-tight font-semibold tracking-tight'>
            {label}
          </span>
          {description ? (
            <span className='text-muted-foreground text-[11px] leading-tight'>
              {description}
            </span>
          ) : null}
        </div>
      </motion.button>
    )
  }
)
RFTile.displayName = 'RFTile'

// Created and developed by Jai Singh
