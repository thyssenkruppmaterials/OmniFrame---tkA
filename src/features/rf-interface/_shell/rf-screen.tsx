// Created and developed by Jai Singh
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface RFScreenProps {
  children: ReactNode
  className?: string
  /** When true, fills the dock-safe content area without internal scroll.
   *  Otherwise the screen scrolls within itself. */
  noScroll?: boolean
}

/**
 * Inner screen wrapper used by every RF view. Lives inside the page
 * shell and is responsible for vertical layout + scroll behaviour
 * within a single view.
 */
export function RFScreen({
  children,
  className,
  noScroll = false,
}: RFScreenProps) {
  return (
    <div
      className={cn(
        'flex w-full flex-1 flex-col gap-3',
        noScroll ? 'overflow-hidden' : '',
        className
      )}
    >
      {children}
    </div>
  )
}

// Created and developed by Jai Singh
