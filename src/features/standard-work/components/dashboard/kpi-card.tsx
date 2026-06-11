// Created and developed by Jai Singh
/**
 * Standard Work KPI Card
 *
 * Inspired by the Team Performance KPICard pattern but tailored to Standard
 * Work: animated number, hover lift, optional tooltip explainer, optional
 * progress bar, configurable accent color, and a compact secondary line.
 */
import { useEffect } from 'react'
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  useReducedMotion,
} from 'framer-motion'
import { Info, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'streak'

const TONES: Record<
  Tone,
  { iconBg: string; iconText: string; valueText?: string }
> = {
  default: {
    iconBg: 'bg-primary/10',
    iconText: 'text-primary',
  },
  success: {
    iconBg: 'bg-green-500/10',
    iconText: 'text-green-600 dark:text-green-400',
  },
  warning: {
    iconBg: 'bg-yellow-500/10',
    iconText: 'text-yellow-600 dark:text-yellow-400',
  },
  danger: {
    iconBg: 'bg-destructive/10',
    iconText: 'text-destructive',
    valueText: 'text-destructive',
  },
  info: {
    iconBg: 'bg-blue-500/10',
    iconText: 'text-blue-600 dark:text-blue-400',
  },
  streak: {
    iconBg: 'bg-orange-500/10',
    iconText: 'text-orange-500',
  },
}

function AnimatedNumber({
  value,
  duration = 1.2,
}: {
  value: number
  duration?: number
}) {
  const reduce = useReducedMotion()
  const count = useMotionValue(reduce ? value : 0)
  const rounded = useTransform(count, (latest) => Math.round(latest))

  useEffect(() => {
    if (reduce) {
      count.set(value)
      return
    }
    const controls = animate(count, value, { duration, ease: 'easeOut' })
    return controls.stop
  }, [value, count, duration, reduce])

  return <motion.span>{rounded}</motion.span>
}

interface KPICardProps {
  title: string
  value: number
  unit?: string
  icon: LucideIcon
  tone?: Tone
  description?: string
  /** Optional explainer surfaced via Info tooltip next to the title. */
  explainer?: string
  /** Optional progress bar 0-100 rendered below the value. */
  progress?: number
  /** Stagger index for entrance animation. */
  index?: number
  className?: string
}

export function StandardWorkKPICard({
  title,
  value,
  unit,
  icon: Icon,
  tone = 'default',
  description,
  explainer,
  progress,
  index = 0,
  className,
}: KPICardProps) {
  const reduce = useReducedMotion()
  const palette = TONES[tone]

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: reduce ? 0 : index * 0.06 }}
      whileHover={reduce ? undefined : { y: -2 }}
    >
      <Card
        className={cn(
          'overflow-hidden transition-shadow duration-200 hover:shadow-md',
          className
        )}
      >
        <CardContent className='p-5'>
          <div className='flex items-start justify-between gap-3'>
            <div className='min-w-0'>
              <div className='flex items-center gap-1.5'>
                <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  {title}
                </p>
                {explainer && (
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type='button'
                          aria-label={`About ${title}`}
                          className='text-muted-foreground/50 hover:text-muted-foreground transition-colors'
                        >
                          <Info className='h-3 w-3' />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side='top' className='max-w-[220px]'>
                        <p className='text-xs leading-relaxed'>{explainer}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              <div className='mt-1 flex items-baseline gap-1'>
                <span
                  className={cn(
                    'text-2xl font-bold tracking-tight tabular-nums',
                    palette.valueText
                  )}
                >
                  <AnimatedNumber value={value} />
                  {unit && (
                    <span className='ml-0.5 text-base font-medium'>{unit}</span>
                  )}
                </span>
              </div>
              {description && (
                <p className='text-muted-foreground mt-0.5 text-xs'>
                  {description}
                </p>
              )}
            </div>
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                palette.iconBg
              )}
            >
              <Icon className={cn('h-5 w-5', palette.iconText)} />
            </div>
          </div>
          {progress !== undefined && (
            <Progress value={progress} className='mt-3 h-1.5' />
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

// Created and developed by Jai Singh
