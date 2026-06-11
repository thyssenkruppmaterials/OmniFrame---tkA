// Created and developed by Jai Singh
/**
 * Department Card Component
 * Expandable department/area performance card with associate list
 * Created: December 20, 2025
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronDown,
  ChevronUp,
  Users,
  Package,
  Truck,
  ClipboardCheck,
  MapPin,
  Scan,
  RotateCw,
  Clock,
  Zap,
  TrendingUp,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type {
  DepartmentPerformance,
  AreaPerformance,
} from '../types/team-performance.types'
import {
  getEfficiencyBadgeVariant,
  getEfficiencyColor,
} from '../types/team-performance.types'
import { AssociateList, AvatarGroup } from './associate-performance-row'

// Helper to format minutes as hours and minutes
function formatDuration(minutes: number): string {
  if (minutes === 0) return '0h'
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}m`
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

// Department icon mapping
const departmentIcons: Record<string, LucideIcon> = {
  Receiving: Scan,
  Picking: ClipboardCheck,
  Packing: Package,
  Shipping: Truck,
  Quality: ClipboardCheck,
  Returns: RotateCw,
  Inventory: MapPin,
  default: Users,
}

interface DepartmentCardProps {
  department: DepartmentPerformance
  expanded?: boolean
  onToggle?: () => void
  showAssociates?: boolean
  className?: string
}

export function DepartmentCard({
  department,
  expanded = false,
  onToggle,
  showAssociates = true,
  className,
}: DepartmentCardProps) {
  const [isExpanded, setIsExpanded] = useState(expanded)

  const Icon =
    departmentIcons[department.department] || departmentIcons['default']
  const badgeVariant = getEfficiencyBadgeVariant(department.efficiency)

  const completionPercent =
    department.totalTasks > 0
      ? Math.round((department.completedTasks / department.totalTasks) * 100)
      : 0

  const handleToggle = () => {
    setIsExpanded(!isExpanded)
    onToggle?.()
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      whileHover={{ scale: 1.01 }}
    >
      <Card
        className={cn('overflow-hidden transition-all duration-300', className)}
      >
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CardHeader className='pb-3'>
            <div className='flex items-center justify-between'>
              {/* Left: Icon and Title */}
              <div className='flex items-center gap-3'>
                <div
                  className='rounded-xl p-2.5'
                  style={{ backgroundColor: `${department.color}20` }}
                >
                  <Icon
                    className='h-5 w-5'
                    style={{ color: department.color }}
                  />
                </div>
                <div>
                  <CardTitle className='text-lg'>
                    {department.department}
                  </CardTitle>
                  <p className='text-muted-foreground text-sm'>
                    {department.totalAssociates} associates •{' '}
                    {department.activeAssociates} active
                  </p>
                </div>
              </div>

              {/* Right: Efficiency Badge and Toggle */}
              <div className='flex items-center gap-3'>
                <Badge variant={badgeVariant} className='px-3 py-1 text-sm'>
                  {department.efficiency}% efficiency
                </Badge>
                {showAssociates && (
                  <CollapsibleTrigger asChild>
                    <Button variant='ghost' size='sm' onClick={handleToggle}>
                      {isExpanded ? (
                        <ChevronUp className='h-4 w-4' />
                      ) : (
                        <ChevronDown className='h-4 w-4' />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className='space-y-4'>
            {/* Progress Bar */}
            <div>
              <div className='mb-2 flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>
                  Tasks Completed
                </span>
                <span className='text-sm font-medium'>
                  {department.completedTasks.toLocaleString()}/
                  {department.totalTasks.toLocaleString()}
                </span>
              </div>
              <div className='relative'>
                <Progress value={completionPercent} className='h-2' />
                <motion.div
                  className='absolute top-0 left-0 h-2 rounded-full'
                  style={{ backgroundColor: department.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${completionPercent}%` }}
                  transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
                />
              </div>
            </div>

            {/* Quick Stats Row */}
            <div className='grid grid-cols-3 gap-4 py-2'>
              <div className='text-center'>
                <p className='text-2xl font-bold'>
                  {department.totalAssociates}
                </p>
                <p className='text-muted-foreground text-xs'>Total</p>
              </div>
              <div className='text-center'>
                <p className='text-2xl font-bold text-green-600 dark:text-green-400'>
                  {department.activeAssociates}
                </p>
                <p className='text-muted-foreground text-xs'>Active</p>
              </div>
              <div className='text-center'>
                <p className='text-2xl font-bold'>
                  {department.completedTasks}
                </p>
                <p className='text-muted-foreground text-xs'>Tasks</p>
              </div>
            </div>

            {/* Avatar Preview (when collapsed) */}
            {!isExpanded &&
              showAssociates &&
              department.associates.length > 0 && (
                <div className='flex items-center justify-between border-t pt-2'>
                  <AvatarGroup
                    associates={department.associates}
                    max={6}
                    size='sm'
                  />
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={handleToggle}
                    className='text-xs'
                  >
                    View All
                  </Button>
                </div>
              )}

            {/* Expanded Associate List */}
            {showAssociates && (
              <CollapsibleContent>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                      className='border-t pt-4'
                    >
                      <AssociateList
                        associates={department.associates}
                        showArea={true}
                        showPosition={false}
                        compact={true}
                        maxHeight='300px'
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </CollapsibleContent>
            )}
          </CardContent>
        </Collapsible>
      </Card>
    </motion.div>
  )
}

// Area Card variant
interface AreaCardProps {
  area: AreaPerformance
  expanded?: boolean
  onToggle?: () => void
  showAssociates?: boolean
  className?: string
}

// Task metric configuration for dynamic display
const TASK_METRIC_CONFIG: {
  key: keyof AreaPerformance['taskMetrics']
  label: string
  shortLabel: string
  color: string
  bgColor: string
}[] = [
  {
    key: 'inbound_scans',
    label: 'Inbound Scans',
    shortLabel: 'Scans',
    color: 'text-sky-600 dark:text-sky-400',
    bgColor: 'bg-sky-500/10',
  },
  {
    key: 'put_aways',
    label: 'Put Aways',
    shortLabel: 'Putaway',
    color: 'text-violet-600 dark:text-violet-400',
    bgColor: 'bg-violet-500/10',
  },
  {
    key: 'picking',
    label: 'Picking',
    shortLabel: 'Picks',
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-500/10',
  },
  {
    key: 'packed',
    label: 'Packed',
    shortLabel: 'Pack',
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-500/10',
  },
  {
    key: 'shipped',
    label: 'Shipped',
    shortLabel: 'Ship',
    color: 'text-cyan-600 dark:text-cyan-400',
    bgColor: 'bg-cyan-500/10',
  },
  {
    key: 'final_packed',
    label: 'Final Pack',
    shortLabel: 'Final',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-500/10',
  },
  {
    key: 'putbacks',
    label: 'Putbacks',
    shortLabel: 'Putback',
    color: 'text-rose-600 dark:text-rose-400',
    bgColor: 'bg-rose-500/10',
  },
  {
    key: 'cycle_counts',
    label: 'Cycle Counts',
    shortLabel: 'Counts',
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-500/10',
  },
  // Kit workflow stages — migration 310
  {
    key: 'kit_picking',
    label: 'Kit Picking',
    shortLabel: 'Kit Pick',
    color: 'text-lime-600 dark:text-lime-400',
    bgColor: 'bg-lime-500/10',
  },
  {
    key: 'kit_building',
    label: 'Kit Building',
    shortLabel: 'Kit Build',
    color: 'text-teal-600 dark:text-teal-400',
    bgColor: 'bg-teal-500/10',
  },
  {
    key: 'kit_inspection',
    label: 'Kit Inspection',
    shortLabel: 'Kit Insp',
    color: 'text-fuchsia-600 dark:text-fuchsia-400',
    bgColor: 'bg-fuchsia-500/10',
  },
  {
    key: 'kit_dock_staging',
    label: 'Dock Staging',
    shortLabel: 'Dock',
    color: 'text-sky-600 dark:text-sky-400',
    bgColor: 'bg-sky-500/10',
  },
]

export function AreaCard({
  area,
  expanded = false,
  onToggle,
  showAssociates = true,
  className,
}: AreaCardProps) {
  const [isExpanded, setIsExpanded] = useState(expanded)

  const badgeVariant = getEfficiencyBadgeVariant(area.efficiency)
  const prodEfficiencyColor = getEfficiencyColor(area.productionEfficiency)
  const timeEfficiencyColor = getEfficiencyColor(area.timeEfficiency)

  // Filter to only show metrics with values > 0
  const activeMetrics = TASK_METRIC_CONFIG.filter(
    (metric) => area.taskMetrics && area.taskMetrics[metric.key] > 0
  )

  const handleToggle = () => {
    setIsExpanded(!isExpanded)
    onToggle?.()
  }

  return (
    <TooltipProvider>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        whileHover={{ scale: 1.01 }}
      >
        <Card
          className={cn(
            'overflow-hidden transition-all duration-300',
            className
          )}
        >
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CardHeader className='pb-3'>
              <div className='flex items-center justify-between'>
                {/* Left: Icon and Title */}
                <div className='flex items-center gap-3'>
                  <div
                    className='rounded-xl p-2.5'
                    style={{ backgroundColor: `${area.color}20` }}
                  >
                    <MapPin className='h-5 w-5' style={{ color: area.color }} />
                  </div>
                  <div>
                    <CardTitle className='text-lg'>{area.area_name}</CardTitle>
                    <div className='flex items-center gap-2'>
                      <Badge variant='outline' className='text-xs'>
                        {area.area_code}
                      </Badge>
                      <span className='text-muted-foreground text-sm'>
                        {area.totalAssociates} workers
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Production Efficiency and Toggle */}
                <div className='flex items-center gap-3'>
                  {area.utilizationPercent !== undefined && (
                    <Badge variant='secondary' className='text-xs'>
                      {area.utilizationPercent}% capacity
                    </Badge>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant={badgeVariant}
                        className='cursor-help px-3 py-1 text-sm'
                      >
                        {area.productionEfficiency}% prod
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className='font-medium'>Production Efficiency</p>
                      <p className='text-muted-foreground text-xs'>
                        Task efficiency × Time efficiency
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  {showAssociates && (
                    <CollapsibleTrigger asChild>
                      <Button variant='ghost' size='sm' onClick={handleToggle}>
                        {isExpanded ? (
                          <ChevronUp className='h-4 w-4' />
                        ) : (
                          <ChevronDown className='h-4 w-4' />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className='space-y-4'>
              {/* Time Tracking Row - 3 columns: Work, Break (Accounted), Idle */}
              <div className='bg-muted/50 grid grid-cols-3 gap-3 rounded-lg p-3'>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className='flex cursor-help items-center gap-2'>
                      <div className='rounded-md bg-emerald-500/10 p-1.5'>
                        <Clock className='h-4 w-4 text-emerald-500' />
                      </div>
                      <div>
                        <p className='text-lg font-bold text-emerald-600 dark:text-emerald-400'>
                          {formatDuration(area.totalWorkMinutes)}
                        </p>
                        <p className='text-muted-foreground text-[10px]'>
                          Work Time
                        </p>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className='font-medium'>Productive Work Time</p>
                    <p className='text-muted-foreground text-xs'>
                      Total time spent on tasks across all associates
                    </p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className='flex cursor-help items-center gap-2'>
                      <div className='rounded-md bg-yellow-500/10 p-1.5'>
                        <Clock className='h-4 w-4 text-yellow-500' />
                      </div>
                      <div>
                        <p className='text-lg font-bold text-yellow-600 dark:text-yellow-400'>
                          {formatDuration(area.totalBreakMinutes)}
                        </p>
                        <p className='text-muted-foreground text-[10px]'>
                          Break Time
                        </p>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className='font-medium'>Scheduled Break Time</p>
                    <p className='text-muted-foreground text-xs'>
                      Accounted time for scheduled breaks (not counted as idle)
                    </p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className='flex cursor-help items-center gap-2'>
                      <div className='rounded-md bg-gray-500/10 p-1.5'>
                        <Clock className='h-4 w-4 text-gray-500' />
                      </div>
                      <div>
                        <p className='text-lg font-bold text-gray-500'>
                          {formatDuration(area.totalIdleMinutes)}
                        </p>
                        <p className='text-muted-foreground text-[10px]'>
                          Idle Time
                        </p>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className='font-medium'>Unplanned Idle Time</p>
                    <p className='text-muted-foreground text-xs'>
                      Unaccounted time between tasks (excludes scheduled breaks)
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Efficiency Metrics Row */}
              <div className='grid grid-cols-5 gap-2'>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className='bg-muted/30 cursor-help rounded-lg p-2 text-center'>
                      <p className='text-lg font-bold text-green-600 dark:text-green-400'>
                        {area.activeAssociates}
                      </p>
                      <p className='text-muted-foreground text-[10px]'>
                        Active
                      </p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Currently active workers</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className='bg-muted/30 cursor-help rounded-lg p-2 text-center'>
                      <p className='text-lg font-bold'>{area.completedTasks}</p>
                      <p className='text-muted-foreground text-[10px]'>Tasks</p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Total tasks completed</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className='bg-muted/30 cursor-help rounded-lg p-2 text-center'>
                      <div className='flex items-center justify-center gap-1'>
                        <Zap className='h-3 w-3 text-blue-500' />
                        <p
                          className={cn(
                            'text-lg font-bold',
                            timeEfficiencyColor
                          )}
                        >
                          {area.timeEfficiency}%
                        </p>
                      </div>
                      <p className='text-muted-foreground text-[10px]'>
                        Time Eff.
                      </p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className='font-medium'>Time Efficiency</p>
                    <p className='text-muted-foreground text-xs'>
                      Work time ÷ (Work time + Idle time)
                    </p>
                    <p className='text-muted-foreground mt-1 text-xs'>
                      Note: Breaks are accounted time, not counted as idle
                    </p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className='cursor-help rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-2 text-center'>
                      <p
                        className={cn(
                          'text-lg font-bold text-yellow-600 dark:text-yellow-400'
                        )}
                      >
                        {area.accountedTimeEfficiency}%
                      </p>
                      <p className='text-muted-foreground text-[10px]'>
                        Accounted
                      </p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className='font-medium'>Accounted Time Efficiency</p>
                    <p className='text-muted-foreground text-xs'>
                      (Work + Breaks) ÷ Total time
                    </p>
                    <p className='mt-1 text-xs text-yellow-600 dark:text-yellow-400'>
                      Shows how well time is accounted for (includes scheduled
                      breaks)
                    </p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className='bg-muted/30 cursor-help rounded-lg p-2 text-center'>
                      <div className='flex items-center justify-center gap-1'>
                        <TrendingUp className='h-3 w-3 text-purple-500' />
                        <p
                          className={cn(
                            'text-lg font-bold',
                            prodEfficiencyColor
                          )}
                        >
                          {area.productionEfficiency}%
                        </p>
                      </div>
                      <p className='text-muted-foreground text-[10px]'>
                        Prod. Eff.
                      </p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className='font-medium'>Production Efficiency</p>
                    <p className='text-muted-foreground text-xs'>
                      Task efficiency ({area.efficiency}%) × Time efficiency (
                      {area.timeEfficiency}%)
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Aggregate Timeline Summary - Shows first/last activity for the area */}
              {area.aggregateTimeline &&
                area.aggregateTimeline.totalEvents > 0 && (
                  <div className='flex items-center justify-between rounded-lg border border-blue-200/50 bg-blue-50/50 p-2 text-xs dark:border-blue-800/50 dark:bg-blue-950/20'>
                    <div className='flex items-center gap-4'>
                      {area.aggregateTimeline.firstActivity && (
                        <span className='text-muted-foreground'>
                          <span className='font-medium text-blue-700 dark:text-blue-300'>
                            First:
                          </span>{' '}
                          {new Date(
                            area.aggregateTimeline.firstActivity
                          ).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                            timeZone: 'America/New_York',
                          })}
                        </span>
                      )}
                      {area.aggregateTimeline.lastActivity && (
                        <span className='text-muted-foreground'>
                          <span className='font-medium text-blue-700 dark:text-blue-300'>
                            Last:
                          </span>{' '}
                          {new Date(
                            area.aggregateTimeline.lastActivity
                          ).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                            timeZone: 'America/New_York',
                          })}
                        </span>
                      )}
                    </div>
                    <span className='font-medium text-blue-600 dark:text-blue-400'>
                      {area.aggregateTimeline.totalEvents.toLocaleString()}{' '}
                      events
                    </span>
                  </div>
                )}

              {/* Task Metrics - Only show metrics with values > 0 */}
              {activeMetrics.length > 0 && (
                <div className='space-y-2'>
                  <p className='text-muted-foreground text-xs font-medium'>
                    Task Breakdown
                  </p>
                  <div className='flex flex-wrap gap-2'>
                    {activeMetrics.map((metric) => (
                      <Tooltip key={metric.key}>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              'flex cursor-help items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors',
                              metric.bgColor,
                              'hover:opacity-80'
                            )}
                          >
                            <span
                              className={cn('text-sm font-bold', metric.color)}
                            >
                              {area.taskMetrics[metric.key].toLocaleString()}
                            </span>
                            <span className='text-muted-foreground text-xs'>
                              {metric.shortLabel}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {metric.label}:{' '}
                            {area.taskMetrics[metric.key].toLocaleString()}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              )}

              {/* Capacity Bar (if available) */}
              {area.capacity && (
                <div>
                  <div className='mb-2 flex items-center justify-between'>
                    <span className='text-muted-foreground text-sm'>
                      Capacity
                    </span>
                    <span className='text-sm font-medium'>
                      {area.totalAssociates}/{area.capacity} workers
                    </span>
                  </div>
                  <Progress
                    value={area.utilizationPercent || 0}
                    className='h-2'
                  />
                </div>
              )}

              {/* Associate List - With expandable rows showing Gantt timelines */}
              {showAssociates && (
                <CollapsibleContent>
                  <AnimatePresence>
                    {isExpanded && area.associates.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3 }}
                        className='space-y-2 border-t pt-4'
                      >
                        <p className='text-muted-foreground mb-2 text-xs'>
                          Click on associates to view their activity timeline
                          and task breakdown
                        </p>
                        <AssociateList
                          associates={area.associates}
                          showArea={false}
                          showPosition={true}
                          compact={false}
                          expandable={true}
                          maxHeight='500px'
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CollapsibleContent>
              )}
            </CardContent>
          </Collapsible>
        </Card>
      </motion.div>
    </TooltipProvider>
  )
}

// Grid layout for multiple department cards
interface DepartmentGridProps {
  departments: DepartmentPerformance[]
  columns?: 1 | 2 | 3
  showAssociates?: boolean
  className?: string
}

export function DepartmentGrid({
  departments,
  columns = 2,
  showAssociates = true,
  className,
}: DepartmentGridProps) {
  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 lg:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  }

  if (departments.length === 0) {
    return (
      <div className='text-muted-foreground py-12 text-center'>
        <Users className='mx-auto mb-4 h-12 w-12 opacity-50' />
        <p>No departments to display</p>
      </div>
    )
  }

  return (
    <motion.div
      className={cn('grid gap-6', gridCols[columns], className)}
      initial='hidden'
      animate='visible'
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: { staggerChildren: 0.1 },
        },
      }}
    >
      {departments.map((dept) => (
        <DepartmentCard
          key={dept.department}
          department={dept}
          showAssociates={showAssociates}
        />
      ))}
    </motion.div>
  )
}

// Grid layout for area cards
interface AreaGridProps {
  areas: AreaPerformance[]
  columns?: 1 | 2 | 3
  showAssociates?: boolean
  className?: string
}

export function AreaGrid({
  areas,
  columns = 2,
  showAssociates = true,
  className,
}: AreaGridProps) {
  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 lg:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  }

  if (areas.length === 0) {
    return (
      <div className='text-muted-foreground py-12 text-center'>
        <MapPin className='mx-auto mb-4 h-12 w-12 opacity-50' />
        <p>No working areas to display</p>
      </div>
    )
  }

  return (
    <motion.div
      className={cn('grid gap-6', gridCols[columns], className)}
      initial='hidden'
      animate='visible'
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: { staggerChildren: 0.1 },
        },
      }}
    >
      {areas.map((area) => (
        <AreaCard
          key={area.area_id}
          area={area}
          showAssociates={showAssociates}
        />
      ))}
    </motion.div>
  )
}

// Created and developed by Jai Singh
