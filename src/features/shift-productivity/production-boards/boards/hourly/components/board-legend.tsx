// Created and developed by Jai Singh
import { cn } from '@/lib/utils'

interface BoardLegendProps {
  density?: 'normal' | 'tv'
  className?: string
}

interface Swatch {
  label: string
  classes: string
}

const SWATCHES: Swatch[] = [
  { label: 'Above target', classes: 'bg-emerald-500' },
  { label: 'On target', classes: 'bg-emerald-500/70' },
  { label: 'Below target', classes: 'bg-emerald-500/40' },
  { label: 'No activity', classes: 'bg-muted/40' },
]

export function BoardLegend({
  density = 'normal',
  className,
}: BoardLegendProps) {
  const isTv = density === 'tv'
  return (
    <div
      className={cn(
        'text-muted-foreground flex flex-wrap items-center gap-4',
        isTv ? 'text-sm' : 'text-[10px]',
        className
      )}
    >
      {SWATCHES.map((s) => (
        <div key={s.label} className='flex items-center gap-1.5'>
          <div
            className={cn(
              'rounded-sm',
              isTv ? 'h-3 w-6' : 'h-3 w-3',
              s.classes
            )}
          />
          {s.label}
        </div>
      ))}
    </div>
  )
}

// Created and developed by Jai Singh
