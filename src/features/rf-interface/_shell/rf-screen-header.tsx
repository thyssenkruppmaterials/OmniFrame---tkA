// Created and developed by Jai Singh
import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface RFScreenHeaderProps {
  title: string
  subtitle?: string
  onBack?: () => void
  /** Optional right-side slot (action button, refresh, etc). */
  right?: ReactNode
  className?: string
}

/**
 * Standard header for RF sub-screens. Provides a back button, centered
 * title, and an optional right slot — with a soft gradient underline
 * that ties every screen into the cinematic shell.
 */
export function RFScreenHeader({
  title,
  subtitle,
  onBack,
  right,
  className,
}: RFScreenHeaderProps) {
  return (
    <div className={cn('relative flex flex-col gap-2 pb-2', className)}>
      <div className='flex items-center gap-2'>
        {onBack ? (
          <Button
            variant='ghost'
            size='sm'
            onClick={onBack}
            className='h-9 w-9 shrink-0 rounded-full p-0'
            aria-label='Back'
          >
            <ChevronLeft className='h-4 w-4' />
          </Button>
        ) : (
          <div className='h-9 w-9 shrink-0' />
        )}
        <div className='min-w-0 flex-1 text-center'>
          <h2 className='truncate text-sm font-semibold tracking-tight'>
            {title}
          </h2>
          {subtitle ? (
            <p className='text-muted-foreground truncate text-[11px]'>
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className='flex h-9 w-9 shrink-0 items-center justify-end'>
          {right}
        </div>
      </div>
      <div className='via-border/80 h-px w-full bg-gradient-to-r from-transparent to-transparent' />
    </div>
  )
}

// Created and developed by Jai Singh
