// Created and developed by Jai Singh
import React, { useId, useMemo } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

type IconComponentType = React.ElementType<{ className?: string }>

export interface RFDockItem {
  label: string
  icon: IconComponentType
  action?: () => void
}

interface RFDockProps {
  items: RFDockItem[]
  activeIndex: number
  onActiveIndexChange?: (index: number) => void
}

/**
 * Floating glass dock used as the persistent bottom nav for the RF
 * interface. The active item is highlighted by a single `motion.div`
 * (`layoutId`) that slides between siblings, giving a smooth cinema-
 * style cursor handoff. Safe-area aware on iOS.
 */
export function RFDock({
  items,
  activeIndex,
  onActiveIndexChange,
}: RFDockProps) {
  const layoutId = useId()
  const safeItems = useMemo(() => items.slice(0, 6), [items])

  return (
    <nav
      className='fixed left-1/2 z-50 -translate-x-1/2'
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
      }}
      aria-label='RF navigation'
    >
      <div className='glass-strong relative flex items-center gap-1 rounded-2xl p-1.5'>
        {safeItems.map((item, index) => {
          const isActive = index === activeIndex
          const Icon = item.icon
          return (
            <button
              key={item.label}
              type='button'
              onClick={() => {
                onActiveIndexChange?.(index)
                item.action?.()
              }}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex h-14 min-w-14 flex-col items-center justify-center gap-0.5 rounded-xl px-2 transition-transform duration-150 active:scale-95',
                isActive ? '' : 'hover:bg-foreground/5'
              )}
            >
              {isActive ? (
                <motion.span
                  layoutId={`rf-dock-active-${layoutId}`}
                  aria-hidden
                  className='bg-primary shadow-primary/30 absolute inset-0 -z-10 rounded-xl shadow-lg'
                  transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                />
              ) : null}
              <Icon
                className={cn(
                  'h-5 w-5 transition-colors',
                  isActive ? 'text-primary-foreground' : 'text-muted-foreground'
                )}
              />
              <span
                className={cn(
                  'text-[10px] leading-none font-medium tracking-tight transition-colors',
                  isActive ? 'text-primary-foreground' : 'text-muted-foreground'
                )}
              >
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

// Created and developed by Jai Singh
