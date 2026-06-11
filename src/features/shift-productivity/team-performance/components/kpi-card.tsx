// Created and developed by Jai Singh
/**
 * KPI Card Component
 * Animated metric card for team performance dashboard
 * Created: December 20, 2025
 */
import { useEffect } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface KPICardProps {
  title: string
  value: number
  previousValue?: number
  unit?: string
  icon?: LucideIcon
  iconClassName?: string
  description?: string
  trend?: {
    value: number
    direction: 'up' | 'down' | 'neutral'
  }
  color?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary'
  animate?: boolean
  className?: string
  compact?: boolean
}

// Animated Number Component
function AnimatedNumber({
  value,
  duration = 1.5,
}: {
  value: number
  duration?: number
}) {
  const count = useMotionValue(0)
  const rounded = useTransform(count, (latest) => Math.round(latest))

  useEffect(() => {
    const controls = animate(count, value, {
      duration,
      ease: 'easeOut',
    })
    return controls.stop
  }, [value, count, duration])

  return <motion.span>{rounded}</motion.span>
}

export function KPICard({
  title,
  value,
  previousValue,
  unit,
  icon: Icon,
  iconClassName,
  description,
  trend,
  color = 'default',
  animate: shouldAnimate = true,
  className,
  compact = false,
}: KPICardProps) {
  // Calculate trend if previousValue is provided
  const calculatedTrend =
    trend ||
    (previousValue !== undefined
      ? ({
          value:
            previousValue !== 0
              ? Math.round(((value - previousValue) / previousValue) * 100)
              : 0,
          direction:
            value > previousValue
              ? 'up'
              : value < previousValue
                ? 'down'
                : 'neutral',
        } as const)
      : undefined)

  const colorClasses = {
    default: 'border-border bg-card',
    success:
      'border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-900/20',
    warning:
      'border-yellow-200 bg-yellow-50/50 dark:border-yellow-800 dark:bg-yellow-900/20',
    danger:
      'border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/20',
    info: 'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/20',
    primary: 'border-primary/20 bg-primary/5',
  }

  const iconColorClasses = {
    default: 'text-muted-foreground',
    success: 'text-green-600 dark:text-green-400',
    warning: 'text-yellow-600 dark:text-yellow-400',
    danger: 'text-red-600 dark:text-red-400',
    info: 'text-blue-600 dark:text-blue-400',
    primary: 'text-primary',
  }

  const TrendIcon =
    calculatedTrend?.direction === 'up'
      ? TrendingUp
      : calculatedTrend?.direction === 'down'
        ? TrendingDown
        : Minus

  const trendColorClass =
    calculatedTrend?.direction === 'up'
      ? 'text-green-600 dark:text-green-400'
      : calculatedTrend?.direction === 'down'
        ? 'text-red-600 dark:text-red-400'
        : 'text-muted-foreground'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      whileHover={{ scale: 1.02, transition: { duration: 0.2 } }}
    >
      <Card
        className={cn(
          'transition-all duration-300 hover:shadow-lg',
          colorClasses[color],
          className
        )}
      >
        <CardHeader className={cn('pb-2', compact && 'p-4 pb-1')}>
          <div className='flex items-center justify-between'>
            <CardTitle
              className={cn(
                'text-muted-foreground font-medium',
                compact ? 'text-xs' : 'text-sm'
              )}
            >
              {title}
            </CardTitle>
            {Icon && (
              <Icon
                className={cn(
                  compact ? 'h-4 w-4' : 'h-5 w-5',
                  iconColorClasses[color],
                  iconClassName
                )}
              />
            )}
          </div>
        </CardHeader>
        <CardContent className={compact ? 'p-4 pt-0' : 'pt-0'}>
          <div className='flex items-end justify-between gap-2'>
            <div>
              <div
                className={cn(
                  'font-bold tracking-tight',
                  compact ? 'text-2xl' : 'text-3xl'
                )}
              >
                {shouldAnimate ? <AnimatedNumber value={value} /> : value}
                {unit && (
                  <span className='text-muted-foreground ml-1 text-lg font-normal'>
                    {unit}
                  </span>
                )}
              </div>
              {description && (
                <p className='text-muted-foreground mt-1 text-xs'>
                  {description}
                </p>
              )}
            </div>
            {calculatedTrend && (
              <div className={cn('flex items-center gap-1', trendColorClass)}>
                <TrendIcon className='h-4 w-4' />
                <span className='text-xs font-medium'>
                  {calculatedTrend.value > 0 ? '+' : ''}
                  {calculatedTrend.value}%
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// Compact Stats Row for inline display
interface StatsRowProps {
  stats: Array<{
    label: string
    value: number
    color?: KPICardProps['color']
  }>
}

export function StatsRow({ stats }: StatsRowProps) {
  return (
    <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
      {stats.map((stat, index) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: index * 0.1 }}
          className='text-center'
        >
          <p className='text-2xl font-bold'>
            <AnimatedNumber value={stat.value} />
          </p>
          <p className='text-muted-foreground text-xs'>{stat.label}</p>
        </motion.div>
      ))}
    </div>
  )
}

// Pulse indicator for active status
interface PulseIndicatorProps {
  active?: boolean
  color?: 'green' | 'yellow' | 'red' | 'blue'
  size?: 'sm' | 'md' | 'lg'
}

export function PulseIndicator({
  active = true,
  color = 'green',
  size = 'md',
}: PulseIndicatorProps) {
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4',
  }

  const colorClasses = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
    blue: 'bg-blue-500',
  }

  return (
    <div
      className={cn(
        'rounded-full',
        sizeClasses[size],
        colorClasses[color],
        active && 'animate-pulse'
      )}
    />
  )
}

// Created and developed by Jai Singh
