// Created and developed by Jai Singh
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { fadeUpFast } from './motion-variants'

interface HeroStat {
  label: string
  value: ReactNode
  hint?: string
}

interface RFHeroProps {
  greeting: string
  caption: string
  stats?: HeroStat[]
  /** Right-side status pill (e.g. Online / Offline / Hot Truck). */
  status?: ReactNode
  className?: string
}

/**
 * Top-of-home greeting + live stats strip. Sits above the bento tile
 * grid and uses the strongest glass surface so it reads as the focal
 * point of the screen.
 */
export function RFHero({
  greeting,
  caption,
  stats,
  status,
  className,
}: RFHeroProps) {
  return (
    <motion.div
      variants={fadeUpFast}
      className={cn(
        'glass-strong relative isolate overflow-hidden rounded-[calc(var(--radius)+6px)] p-4',
        className
      )}
    >
      <div
        aria-hidden
        className='from-primary/20 pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-gradient-to-br to-transparent blur-2xl'
      />

      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 flex-1'>
          <h1 className='from-foreground to-foreground/70 bg-gradient-to-br bg-clip-text text-lg leading-tight font-semibold tracking-tight text-transparent'>
            {greeting}
          </h1>
          <p className='text-muted-foreground mt-0.5 text-[11px] leading-tight'>
            {caption}
          </p>
        </div>
        {status ? <div className='shrink-0'>{status}</div> : null}
      </div>

      {stats && stats.length > 0 ? (
        <div className='mt-3 grid grid-cols-3 gap-2'>
          {stats.map((s, i) => (
            <div
              key={i}
              className='glass-light flex flex-col items-start gap-0.5 rounded-xl px-2.5 py-2'
            >
              <span className='text-muted-foreground text-[9px] leading-none tracking-[0.08em] uppercase'>
                {s.label}
              </span>
              <span className='text-foreground text-base leading-none font-semibold tabular-nums'>
                {s.value}
              </span>
              {s.hint ? (
                <span className='text-muted-foreground/80 text-[9px] leading-none'>
                  {s.hint}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </motion.div>
  )
}

interface RFStatusPillProps {
  /** Visual variant; the dot pulses on `online`. */
  status: 'online' | 'idle' | 'offline'
  label: string
}

export function RFStatusPill({ status, label }: RFStatusPillProps) {
  const dot =
    status === 'online'
      ? 'bg-emerald-500'
      : status === 'idle'
        ? 'bg-amber-500'
        : 'bg-muted-foreground'
  return (
    <div className='glass-light text-foreground/80 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium'>
      <span className='relative inline-flex h-2 w-2'>
        {status === 'online' ? (
          <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60' />
        ) : null}
        <span
          className={cn('relative inline-flex h-2 w-2 rounded-full', dot)}
        />
      </span>
      {label}
    </div>
  )
}

// Created and developed by Jai Singh
