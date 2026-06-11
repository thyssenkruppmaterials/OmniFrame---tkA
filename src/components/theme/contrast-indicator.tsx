// Created and developed by Jai Singh
import { Check, AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getWCAGContrastRatio,
  getWCAGLevel,
  validateHex,
} from '@/lib/utils/color-conversion'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface ContrastIndicatorProps {
  foreground: string
  background: string
  className?: string
}

export function ContrastIndicator({
  foreground,
  background,
  className,
}: ContrastIndicatorProps) {
  const validFg = validateHex(foreground)
  const validBg = validateHex(background)

  if (!validFg || !validBg) return null

  const ratio = getWCAGContrastRatio(validFg, validBg)
  const level = getWCAGLevel(validFg, validBg)
  const ratioDisplay = ratio.toFixed(1)

  const config = {
    AAA: {
      icon: Check,
      label: 'AAA',
      variant: 'default' as const,
      className: 'bg-green-600 hover:bg-green-600 text-white',
      tooltip: `Excellent contrast (${ratioDisplay}:1) — meets WCAG AAA`,
    },
    AA: {
      icon: Check,
      label: 'AA',
      variant: 'default' as const,
      className: 'bg-green-500 hover:bg-green-500 text-white',
      tooltip: `Good contrast (${ratioDisplay}:1) — meets WCAG AA`,
    },
    'AA-large': {
      icon: AlertTriangle,
      label: 'AA*',
      variant: 'secondary' as const,
      className: 'bg-amber-500 hover:bg-amber-500 text-white',
      tooltip: `Limited contrast (${ratioDisplay}:1) — only meets AA for large text (18pt+)`,
    },
    fail: {
      icon: X,
      label: 'Fail',
      variant: 'destructive' as const,
      className: '',
      tooltip: `Poor contrast (${ratioDisplay}:1) — does not meet WCAG standards`,
    },
  }[level]

  const Icon = config.icon

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={config.variant}
            className={cn(
              'h-5 gap-0.5 px-1.5 py-0 text-[10px]',
              config.className,
              className
            )}
          >
            <Icon className='h-2.5 w-2.5' />
            {config.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className='text-xs'>{config.tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Created and developed by Jai Singh
