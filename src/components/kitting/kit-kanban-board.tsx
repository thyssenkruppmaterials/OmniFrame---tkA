/**
 * Kit Kanban Board Component - DATABASE INTEGRATED
 * A drag-and-drop kanban board for managing kit assembly tasks
 * Connected to Supabase via KitKanbanService for real-time data
 * Uses Framer Motion with advanced spring physics for extremely fluid animations
 *
 * @component
 * Created: November 11, 2025
 * Updated: December 12, 2025 - Integrated with database and new card format
 */
import * as React from 'react'
import { useState, useCallback, useMemo, memo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  GripVertical,
  Calendar,
  User,
  Loader2,
  Package,
  Play,
  Eye,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  KitKanbanService,
  type KanbanColumn as DBColumn,
  type KitKanbanTask,
  type KanbanTask,
} from '@/lib/supabase/kit-kanban.service'
import { RRKittingDataService } from '@/lib/supabase/rr-kitting-data.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { KitBuildSheet } from '@/components/kitting/kit-build-sheet'
import { KitProductionTrackerDialog } from '@/components/kitting/kit-production-tracker'
import { StartKitConfirmDialog } from '@/components/kitting/start-kit-confirm-dialog'

// Internal types for the kanban board
interface KitTask {
  id: string
  title: string // "{Kit Serial Number} - {Kit PO Number}"
  description?: string
  priority: number // Numerical priority from kit build plan
  priorityLabel: string // "#1", "#2", etc.
  assignee?: {
    name: string
    avatar: string
  }
  lastTouchedByName?: string // Last person who worked on this kit
  dueDate?: string
  kitSerialNumber: string // PRIMARY KEY: Unique identifier for each kit build
  kitBuildNumber?: string // "Kit: {Kit Build #}"
  kitPoNumber?: string // Kit PO Number for display
  kitNumber?: string // Kit Number (can have duplicates across different kit builds)
  componentsTotal?: number // Total TO lines
  componentsCompleted?: number // Picked/Kitted TO lines (legacy)
  toLinesPicked?: number // Lines picked
  toLinesKitted?: number // Lines kitted
  currentStep?: string // 'planning', 'picking', 'kitting', 'inspection', 'on_dock', 'completed'
  hasBlackHat?: boolean
  blackHatNote?: string
}

// Production progress steps for the visual indicator
const PRODUCTION_STEPS = [
  { id: 'planning', label: 'Planning', shortLabel: 'Plan' },
  { id: 'picking', label: 'Picking', shortLabel: 'Pick' },
  { id: 'kitting', label: 'Kitting', shortLabel: 'Kit' },
  { id: 'inspection', label: 'Inspection', shortLabel: 'Insp' },
  { id: 'on_dock', label: 'On Dock', shortLabel: 'Dock' },
] as const

// Color scheme for each production step (matching kit-production-tracker.tsx)
const stepColorScheme: Record<
  string,
  {
    bg: string
    text: string
    progressBg: string
    label: string
  }
> = {
  planning: {
    bg: 'bg-purple-500',
    text: 'text-purple-600 dark:text-purple-400',
    progressBg: 'bg-purple-500',
    label: 'Planning',
  },
  picking: {
    bg: 'bg-indigo-500',
    text: 'text-indigo-600 dark:text-indigo-400',
    progressBg: 'bg-indigo-500',
    label: 'Picking',
  },
  kitting: {
    bg: 'bg-cyan-500',
    text: 'text-cyan-600 dark:text-cyan-400',
    progressBg: 'bg-cyan-500',
    label: 'Kitting',
  },
  inspection: {
    bg: 'bg-orange-500',
    text: 'text-orange-600 dark:text-orange-400',
    progressBg: 'bg-orange-500',
    label: 'Inspection',
  },
  on_dock: {
    bg: 'bg-green-500',
    text: 'text-green-600 dark:text-green-400',
    progressBg: 'bg-green-500',
    label: 'On Dock',
  },
}

// Get the index of the current step in the production flow
function getStepIndex(step: string | undefined): number {
  const idx = PRODUCTION_STEPS.findIndex((s) => s.id === step)
  return idx >= 0 ? idx : 0
}

// Get the progress values and label for the current step
function getStepProgress(task: KitTask): {
  completed: number
  total: number
  percentage: number
  label: string
  colors: (typeof stepColorScheme)[string]
} {
  const step = task.currentStep || 'planning'
  const colors = stepColorScheme[step] || stepColorScheme.planning
  const total = task.componentsTotal || 0

  // Calculate completed based on current step
  let completed = 0
  let label = colors.label

  switch (step) {
    case 'planning':
      // Planning has no line-level progress, show 0/0 or "Ready"
      completed = 0
      label = total > 0 ? 'Ready to Start' : 'No Lines'
      break
    case 'picking':
      completed = task.toLinesPicked || 0
      label = `Picking`
      break
    case 'kitting':
      completed = task.toLinesKitted || 0
      label = `Kitting`
      break
    case 'inspection':
      // Inspection verifies kitted items, use kitted count as base
      completed = task.toLinesKitted || 0
      label = `Inspection`
      break
    case 'on_dock':
    case 'completed':
      completed = total
      label = 'Complete'
      break
    default:
      completed = task.componentsCompleted || 0
  }

  const percentage = total > 0 ? (completed / total) * 100 : 0

  return { completed, total, percentage, label, colors }
}

interface KanbanColumn {
  id: string
  name: string // The column name like 'planning', 'in_progress'
  title: string
  color: string
  tasks: KitTask[]
}

// Advanced spring animation configuration for ultra-smooth motion
const springTransition = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
  mass: 0.8,
}

// Priority badge color based on priority number
function getPriorityColor(priority: number): string {
  if (priority === 1) return 'bg-red-500/10 text-red-500 border-red-500/20'
  if (priority === 2)
    return 'bg-orange-500/10 text-orange-500 border-orange-500/20'
  if (priority === 3)
    return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
  if (priority <= 5) return 'bg-blue-500/10 text-blue-500 border-blue-500/20'
  return 'bg-gray-500/10 text-gray-500 border-gray-500/20'
}

// Draggable Task Card Component - MEMOIZED for performance
interface DraggableTaskProps {
  task: KitTask
  columnId: string
  columnName: string // The column name like 'planning', 'in_progress', etc.
  index: number
  onDragStart: (
    e: React.DragEvent,
    task: KitTask,
    columnId: string,
    index: number
  ) => void
  onDragEnd: () => void
  onStartKit: (taskId: string) => void
  onQuickView: (kitSerialNumber: string, kitPoNumber: string) => void
  isDragging: boolean
  isStartingKit: boolean
}

const DraggableTask = memo<DraggableTaskProps>(
  ({
    task,
    columnId,
    columnName,
    index,
    onDragStart,
    onDragEnd,
    onStartKit,
    onQuickView,
    isDragging,
    isStartingKit,
  }) => {
    // Memoize step-specific progress calculation - depends on specific progress fields
    const stepProgress = useMemo(() => {
      return getStepProgress(task)
    }, [task])

    // Optimized drag start handler
    const handleDragStart = useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        onDragStart(e, task, columnId, index)
      },
      [onDragStart, task, columnId, index]
    )

    // Handle Start Kit button click
    const handleStartKit = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation() // Prevent drag from starting
        onStartKit(task.id)
      },
      [onStartKit, task.id]
    )

    // Handle Quick View button click
    const handleQuickView = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation() // Prevent drag from starting
        if (task.kitSerialNumber) {
          onQuickView(task.kitSerialNumber, task.kitPoNumber || '') // Pass kit_serial_number as unique identifier
        }
      },
      [onQuickView, task.kitSerialNumber, task.kitPoNumber]
    )

    // Show Start Kit button only in Planning column
    const showStartKitButton = columnName === 'planning'

    return (
      <div
        draggable
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
        className={cn(
          'group cursor-grab transition-shadow active:cursor-grabbing',
          !isDragging && 'hover:shadow-lg'
        )}
      >
        <motion.div
          layout={!isDragging}
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{
            opacity: isDragging ? 0.5 : 1,
            scale: isDragging ? 0.98 : 1,
            y: 0,
          }}
          exit={{
            opacity: 0,
            scale: 0.9,
            transition: { duration: 0.2 },
          }}
          transition={isDragging ? { duration: 0 } : springTransition}
          whileHover={
            !isDragging
              ? {
                  scale: 1.02,
                  transition: { duration: 0.15 },
                }
              : {}
          }
        >
          <Card className='border-border'>
            <CardContent className='p-4'>
              {/* Header: Title and Priority Badge */}
              <div className='mb-3 flex items-start justify-between gap-2'>
                <div className='flex min-w-0 flex-1 items-center gap-2'>
                  <GripVertical className='text-muted-foreground h-4 w-4 flex-shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100' />
                  <h4 className='text-foreground truncate text-sm font-medium'>
                    {task.title}
                  </h4>
                </div>
                {/* Priority Badge - Shows priority number */}
                <Badge
                  variant='outline'
                  className={cn(
                    'flex-shrink-0 font-mono text-xs tabular-nums',
                    getPriorityColor(task.priority)
                  )}
                >
                  {task.priorityLabel}
                </Badge>
              </div>

              {task.description && (
                <p className='text-muted-foreground mb-3 line-clamp-2 text-xs'>
                  {task.description}
                </p>
              )}

              {/* Black Hat Flag */}
              {task.hasBlackHat && (
                <div className='mb-2 flex items-center gap-1.5 rounded bg-gray-900/10 px-2 py-1 text-xs font-medium text-gray-900 dark:bg-gray-100/10 dark:text-gray-100'>
                  <span className='inline-block h-2.5 w-2.5 rounded-full bg-gray-900 dark:bg-gray-200' />
                  Black Hat — Picking Blocked
                </div>
              )}

              {/* Kit Build Number */}
              {task.kitBuildNumber && (
                <div className='text-muted-foreground mb-2 flex items-center gap-1 text-xs'>
                  <Package className='h-3 w-3' />
                  Kit:{' '}
                  <span className='text-foreground font-medium'>
                    {task.kitBuildNumber}
                  </span>
                </div>
              )}

              {/* Production Progress Indicator */}
              <div className='mb-3'>
                <div className='flex items-center gap-0.5'>
                  {PRODUCTION_STEPS.map((step, idx) => {
                    const currentStepIdx = getStepIndex(task.currentStep)
                    const isActive = idx === currentStepIdx
                    const isCompleted = idx < currentStepIdx

                    return (
                      <div key={step.id} className='flex flex-1 items-center'>
                        <div
                          className={cn(
                            'h-1.5 flex-1 rounded-full transition-colors',
                            isActive
                              ? 'bg-primary'
                              : isCompleted
                                ? 'bg-primary/60'
                                : 'bg-muted'
                          )}
                        />
                      </div>
                    )
                  })}
                </div>
                <div className='mt-1 flex justify-between'>
                  {PRODUCTION_STEPS.map((step, idx) => {
                    const currentStepIdx = getStepIndex(task.currentStep)
                    const isActive = idx === currentStepIdx

                    return (
                      <span
                        key={step.id}
                        className={cn(
                          'text-[9px] font-medium',
                          isActive ? 'text-primary' : 'text-muted-foreground/60'
                        )}
                      >
                        {step.shortLabel}
                      </span>
                    )
                  })}
                </div>
              </div>

              {/* Step-specific progress bar - shows current step's progress */}
              <div className='mb-3'>
                <div className='mb-1 flex items-center justify-between text-xs'>
                  <span className={cn('font-medium', stepProgress.colors.text)}>
                    {stepProgress.label}
                  </span>
                  {task.currentStep !== 'planning' &&
                    stepProgress.total > 0 && (
                      <span className='text-muted-foreground'>
                        {stepProgress.completed}/{stepProgress.total}
                      </span>
                    )}
                </div>
                {/* Only show progress bar if there are TO lines */}
                {stepProgress.total > 0 ? (
                  <>
                    <div className='bg-secondary h-2 w-full overflow-hidden rounded-full'>
                      <motion.div
                        className={cn('h-full', stepProgress.colors.progressBg)}
                        initial={{ width: 0 }}
                        animate={{ width: `${stepProgress.percentage}%` }}
                        transition={{
                          type: 'spring',
                          stiffness: 300,
                          damping: 25,
                        }}
                      />
                    </div>
                    {/* Show percentage for non-planning steps with progress */}
                    {task.currentStep !== 'planning' &&
                      stepProgress.percentage > 0 && (
                        <p className='text-muted-foreground mt-0.5 text-[10px]'>
                          {Math.round(stepProgress.percentage)}% complete
                        </p>
                      )}
                  </>
                ) : (
                  <p className='text-muted-foreground text-[10px] italic'>
                    No TO lines imported
                  </p>
                )}
              </div>

              {/* Footer: Assignee/Last Touched By and Due Date */}
              <div className='text-muted-foreground flex items-center justify-between text-xs'>
                {task.assignee ? (
                  <div className='flex min-w-0 items-center gap-2'>
                    <Avatar className='h-6 w-6 flex-shrink-0'>
                      <AvatarImage
                        src={task.assignee.avatar}
                        alt={task.assignee.name}
                      />
                      <AvatarFallback>
                        <User className='h-3 w-3' />
                      </AvatarFallback>
                    </Avatar>
                    <span className='truncate'>{task.assignee.name}</span>
                  </div>
                ) : task.lastTouchedByName ? (
                  <div className='flex min-w-0 items-center gap-2'>
                    <Avatar className='h-6 w-6 flex-shrink-0 opacity-60'>
                      <AvatarImage
                        src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(task.lastTouchedByName)}`}
                        alt={task.lastTouchedByName}
                      />
                      <AvatarFallback>
                        <User className='h-3 w-3' />
                      </AvatarFallback>
                    </Avatar>
                    <span className='text-muted-foreground/80 truncate'>
                      Last: {task.lastTouchedByName}
                    </span>
                  </div>
                ) : (
                  <div className='text-muted-foreground/60 flex items-center gap-2'>
                    <User className='h-4 w-4' />
                    <span>No activity yet</span>
                  </div>
                )}
                {task.dueDate && (
                  <div className='flex flex-shrink-0 items-center gap-1'>
                    <Calendar className='h-3 w-3' />
                    <span>{task.dueDate}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className='border-border mt-3 flex gap-2 border-t pt-3'>
                {/* Quick View Button - Always shown */}
                <Button
                  size='sm'
                  variant='outline'
                  className='flex-1 gap-2'
                  onClick={handleQuickView}
                  disabled={!task.kitPoNumber}
                >
                  <Eye className='h-4 w-4' />
                  Quick View
                </Button>

                {/* Start Kit Button - Only shown in Planning column */}
                {showStartKitButton && (
                  <Button
                    size='sm'
                    className='flex-1 gap-2'
                    onClick={handleStartKit}
                    disabled={isStartingKit}
                  >
                    {isStartingKit ? (
                      <>
                        <Loader2 className='h-4 w-4 animate-spin' />
                        Starting...
                      </>
                    ) : (
                      <>
                        <Play className='h-4 w-4' />
                        Start Kit
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Custom comparison for optimal re-render prevention
    return (
      prevProps.task.id === nextProps.task.id &&
      prevProps.isDragging === nextProps.isDragging &&
      prevProps.isStartingKit === nextProps.isStartingKit &&
      prevProps.columnName === nextProps.columnName &&
      prevProps.task.componentsTotal === nextProps.task.componentsTotal &&
      prevProps.task.componentsCompleted ===
        nextProps.task.componentsCompleted &&
      prevProps.task.toLinesPicked === nextProps.task.toLinesPicked &&
      prevProps.task.toLinesKitted === nextProps.task.toLinesKitted &&
      prevProps.task.title === nextProps.task.title &&
      prevProps.task.priority === nextProps.task.priority &&
      prevProps.task.currentStep === nextProps.task.currentStep &&
      prevProps.task.lastTouchedByName === nextProps.task.lastTouchedByName &&
      prevProps.task.hasBlackHat === nextProps.task.hasBlackHat
    )
  }
)

// Droppable Column Component - MEMOIZED for performance
interface DroppableColumnProps {
  column: KanbanColumn
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, columnId: string) => void
  onDragStart: (
    e: React.DragEvent,
    task: KitTask,
    columnId: string,
    index: number
  ) => void
  onDragEnd: () => void
  onStartKit: (taskId: string) => void
  onQuickView: (kitSerialNumber: string, kitPoNumber: string) => void
  draggingTask: { task: KitTask; columnId: string; index: number } | null
  startingKitId: string | null
}

const DroppableColumn = memo<DroppableColumnProps>(
  ({
    column,
    onDragOver,
    onDrop,
    onDragStart,
    onDragEnd,
    onStartKit,
    onQuickView,
    draggingTask,
    startingKitId,
  }) => {
    const [isOver, setIsOver] = useState(false)

    // Memoize drag handlers for performance
    const handleDragOver = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault()
        setIsOver(true)
        onDragOver(e)
      },
      [onDragOver]
    )

    const handleDragLeave = useCallback(() => {
      setIsOver(false)
    }, [])

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        setIsOver(false)
        onDrop(e, column.id)
      },
      [onDrop, column.id]
    )

    return (
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{
          opacity: 1,
          x: 0,
        }}
        transition={springTransition}
        className='flex h-full flex-col'
      >
        <div className='mb-4 flex items-center justify-between px-1'>
          <div className='flex items-center gap-2'>
            <motion.div
              className='h-3 w-3 rounded-full'
              style={{ backgroundColor: column.color }}
              whileHover={{ scale: 1.2 }}
              transition={{ type: 'spring', stiffness: 400 }}
            />
            <h3 className='text-foreground text-sm font-semibold'>
              {column.title}
            </h3>
            <motion.div
              key={`count-${column.tasks.length}`}
              initial={{ scale: 1.2 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            >
              <Badge variant='secondary' className='text-xs'>
                {column.tasks.length}
              </Badge>
            </motion.div>
          </div>
        </div>

        <motion.div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          animate={{
            borderColor: isOver ? 'var(--primary)' : 'var(--border)',
            backgroundColor: isOver
              ? 'color-mix(in oklch, var(--primary) 5%, transparent)'
              : 'color-mix(in oklch, var(--secondary) 20%, transparent)',
          }}
          transition={{
            duration: 0.15,
            ease: 'easeInOut',
          }}
          className='min-h-[200px] flex-1 space-y-3 rounded-lg border-2 border-dashed p-3'
        >
          <AnimatePresence mode='popLayout' initial={false}>
            {column.tasks.map((task, index) => (
              <DraggableTask
                key={task.id}
                task={task}
                columnId={column.id}
                columnName={column.name}
                index={index}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onStartKit={onStartKit}
                onQuickView={onQuickView}
                isDragging={
                  draggingTask?.task.id === task.id &&
                  draggingTask?.columnId === column.id
                }
                isStartingKit={startingKitId === task.id}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    )
  },
  (prevProps, nextProps) => {
    // Optimized comparison to prevent unnecessary re-renders
    return (
      prevProps.column.id === nextProps.column.id &&
      prevProps.column.tasks.length === nextProps.column.tasks.length &&
      prevProps.draggingTask?.task.id === nextProps.draggingTask?.task.id &&
      prevProps.draggingTask?.columnId === nextProps.draggingTask?.columnId &&
      prevProps.startingKitId === nextProps.startingKitId
    )
  }
)

// Transform database task to internal format
function transformTask(dbTask: KitKanbanTask): KitTask {
  return {
    id: dbTask.id,
    title: dbTask.title, // Already formatted as "{Kit Serial Number} - {Kit PO Number}"
    description: dbTask.description,
    priority: dbTask.priority,
    priorityLabel: dbTask.priorityLabel,
    kitSerialNumber: dbTask.kitSerialNumber, // PRIMARY KEY: Unique identifier for each kit build
    kitBuildNumber: dbTask.kitBuildNumber,
    kitPoNumber: dbTask.kitPoNumber, // For display
    kitNumber: dbTask.kitNumber, // Kit Number (can have duplicates across different kit builds)
    componentsTotal: dbTask.componentsTotal,
    componentsCompleted: dbTask.componentsCompleted,
    toLinesPicked: dbTask.toLinesPicked,
    toLinesKitted: dbTask.toLinesKitted,
    currentStep: dbTask.currentStep,
    assignee: dbTask.assignee,
    lastTouchedByName: dbTask.lastTouchedByName,
    dueDate: dbTask.dueDate,
    hasBlackHat: dbTask.hasBlackHat,
    blackHatNote: dbTask.blackHatNote,
  }
}

// Transform raw database record to KitTask for real-time updates
function transformRawDbTask(dbRecord: KanbanTask): KitTask {
  // Calculate completed components based on current step
  let componentsCompleted = 0
  if (
    dbRecord.current_step === 'kitting' ||
    dbRecord.current_step === 'inspection' ||
    dbRecord.current_step === 'on_dock' ||
    dbRecord.current_step === 'completed'
  ) {
    componentsCompleted = dbRecord.to_lines_kitted
  } else if (dbRecord.current_step === 'picking') {
    componentsCompleted = dbRecord.to_lines_picked
  }

  const lastTouchedByName =
    dbRecord.current_worker_name || dbRecord.last_touched_by_name || undefined

  return {
    id: dbRecord.id,
    title: `${dbRecord.kit_serial_number || 'N/A'} - ${dbRecord.kit_po_number || 'N/A'}`,
    description: dbRecord.task_description || undefined,
    priority: dbRecord.priority,
    priorityLabel: `#${dbRecord.priority}`,
    kitSerialNumber: dbRecord.kit_serial_number || '', // PRIMARY KEY: Unique identifier for each kit build
    kitBuildNumber: dbRecord.kit_build_number || 'N/A',
    kitPoNumber: dbRecord.kit_po_number || '',
    kitNumber: dbRecord.kit_number || undefined, // Kit Number (can have duplicates across different kit builds)
    componentsTotal: dbRecord.total_to_lines,
    componentsCompleted,
    toLinesPicked: dbRecord.to_lines_picked,
    toLinesKitted: dbRecord.to_lines_kitted,
    currentStep: dbRecord.current_step || 'planning',
    assignee: dbRecord.current_worker_name
      ? {
          name: dbRecord.current_worker_name,
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(dbRecord.current_worker_name)}`,
        }
      : undefined,
    lastTouchedByName,
    dueDate: dbRecord.due_date
      ? formatDateForTask(dbRecord.due_date)
      : undefined,
  }
}

// Format date helper for real-time transform
function formatDateForTask(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Default columns if none exist in database
const defaultColumns: KanbanColumn[] = [
  {
    id: 'planning',
    name: 'planning',
    title: 'Planning',
    color: '#6B7280',
    tasks: [],
  },
  {
    id: 'in_progress',
    name: 'in_progress',
    title: 'In Progress',
    color: '#F59E0B',
    tasks: [],
  },
  {
    id: 'quality_check',
    name: 'quality_check',
    title: 'Quality Check',
    color: '#3B82F6',
    tasks: [],
  },
  {
    id: 'completed',
    name: 'completed',
    title: 'Completed',
    color: '#10B981',
    tasks: [],
  },
]

// Main Kanban Board Component - OPTIMIZED with useCallback and useMemo
export const KitKanbanBoard: React.FC = () => {
  const [columns, setColumns] = useState<KanbanColumn[]>(defaultColumns)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startingKitId, setStartingKitId] = useState<string | null>(null)

  // Quick View Dialog State
  const [selectedKitSerialNumber, setSelectedKitSerialNumber] = useState<
    string | null
  >(null) // PRIMARY KEY for unique kit identification
  const [selectedKitPoNumber, setSelectedKitPoNumber] = useState<string | null>(
    null
  ) // For display purposes
  const [isAuditTrailOpen, setIsAuditTrailOpen] = useState(false)

  // Start Kit Confirmation Dialog State
  const [isStartKitDialogOpen, setIsStartKitDialogOpen] = useState(false)
  const [pendingStartKitTaskId, setPendingStartKitTaskId] = useState<
    string | null
  >(null)
  const [pendingStartKitPoNumber, setPendingStartKitPoNumber] = useState<
    string | null
  >(null)

  // Kit Build Sheet Dialog State (shown after confirmation)
  const [isKitBuildSheetOpen, setIsKitBuildSheetOpen] = useState(false)
  const [buildSheetKitPoNumber, setBuildSheetKitPoNumber] = useState<
    string | null
  >(null)

  // Sync missing cards state
  const [isSyncingCards, setIsSyncingCards] = useState(false)

  const [draggingTask, setDraggingTask] = useState<{
    task: KitTask
    columnId: string
    index: number
  } | null>(null)

  // Fetch data from database
  const fetchData = useCallback(async (syncInProgress: boolean = false) => {
    try {
      setLoading(true)
      setError(null)

      // Fetch columns from database
      const dbColumns = await KitKanbanService.getColumns()

      // Fetch tasks grouped by column
      const tasksByColumn = await KitKanbanService.getTasksByColumn()

      if (dbColumns.length > 0) {
        // Use database columns
        const transformedColumns: KanbanColumn[] = dbColumns.map(
          (col: DBColumn) => ({
            id: col.id,
            name: col.column_name, // Store the column name for identifying 'planning' column
            title: col.column_display_name,
            color: col.column_color,
            tasks: (tasksByColumn.get(col.id) || []).map(transformTask),
          })
        )
        setColumns(transformedColumns)
      } else {
        // Use default columns with any existing tasks
        const transformedColumns: KanbanColumn[] = defaultColumns.map(
          (col) => ({
            ...col,
            tasks: [],
          })
        )
        setColumns(transformedColumns)
      }

      // Sync in-progress tasks to ensure data is fresh from RR_Kitting_DATA
      // This runs in background after initial load - real-time subscription picks up changes
      if (syncInProgress) {
        KitKanbanService.syncAllInProgressTasks()
          .then((result) => {
            logger.log(
              `🔄 KitKanbanBoard: Background sync complete - ${result.synced} tasks synced`
            )
          })
          .catch((err) => {
            logger.warn('Background sync failed:', err)
          })
      }
    } catch (err) {
      logger.error('Error fetching kanban data:', err)
      setError('Failed to load kanban board data')
    } finally {
      setLoading(false)
    }
  }, [])

  // Apply incremental update for INSERT events
  const handleTaskInsert = useCallback((newRecord: KanbanTask) => {
    const newTask = transformRawDbTask(newRecord)
    setColumns((prev) =>
      prev.map((col) => {
        if (col.id === newRecord.column_id) {
          // Check if task already exists (avoid duplicates)
          if (col.tasks.some((t) => t.id === newTask.id)) {
            return col
          }
          return { ...col, tasks: [...col.tasks, newTask] }
        }
        return col
      })
    )
  }, [])

  // Apply incremental update for UPDATE events
  const handleTaskUpdate = useCallback(
    (newRecord: KanbanTask, oldRecord: KanbanTask | null) => {
      const updatedTask = transformRawDbTask(newRecord)

      setColumns((prev) => {
        // Check if task moved to a different column
        const oldColumnId = oldRecord?.column_id
        const newColumnId = newRecord.column_id
        const taskMoved = oldColumnId && oldColumnId !== newColumnId

        return prev.map((col) => {
          if (taskMoved) {
            // Remove from old column
            if (col.id === oldColumnId) {
              return {
                ...col,
                tasks: col.tasks.filter((t) => t.id !== newRecord.id),
              }
            }
            // Add to new column
            if (col.id === newColumnId) {
              // Check if already exists (from optimistic update)
              if (col.tasks.some((t) => t.id === updatedTask.id)) {
                return {
                  ...col,
                  tasks: col.tasks.map((t) =>
                    t.id === updatedTask.id ? updatedTask : t
                  ),
                }
              }
              return { ...col, tasks: [...col.tasks, updatedTask] }
            }
          } else if (col.id === newColumnId) {
            // Update in place
            return {
              ...col,
              tasks: col.tasks.map((t) =>
                t.id === updatedTask.id ? updatedTask : t
              ),
            }
          }
          return col
        })
      })
    },
    []
  )

  // Apply incremental update for DELETE events
  const handleTaskDelete = useCallback((oldRecord: KanbanTask) => {
    setColumns((prev) =>
      prev.map((col) => ({
        ...col,
        tasks: col.tasks.filter((t) => t.id !== oldRecord.id),
      }))
    )
  }, [])

  // Initial fetch and real-time subscription with delta updates
  useEffect(() => {
    // On initial load, trigger background sync to reconcile any stale data
    // from tasks that were worked on before the sync mechanism was implemented
    fetchData(true)

    // Subscribe to real-time changes with incremental updates
    // This is much faster than refetching all data on every change
    const subscription = KitKanbanService.subscribeToChanges((payload) => {
      const { eventType, new: newRecord, old: oldRecord } = payload

      switch (eventType) {
        case 'INSERT':
          if (newRecord) {
            handleTaskInsert(newRecord)
          }
          break
        case 'UPDATE':
          if (newRecord) {
            handleTaskUpdate(newRecord, oldRecord)
          }
          break
        case 'DELETE':
          if (oldRecord) {
            handleTaskDelete(oldRecord)
          }
          break
        default:
          // Fallback to full refetch for unknown events
          fetchData()
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [fetchData, handleTaskInsert, handleTaskUpdate, handleTaskDelete])

  // Memoized handlers for optimal performance
  const handleDragStart = useCallback(
    (e: React.DragEvent, task: KitTask, columnId: string, index: number) => {
      setDraggingTask({ task, columnId, index })
      e.dataTransfer.effectAllowed = 'move'
    },
    []
  )

  const handleDragEnd = useCallback(() => {
    setDraggingTask(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetColumnId: string) => {
      e.preventDefault()
      if (!draggingTask) return

      const { task, columnId: sourceColumnId } = draggingTask

      if (sourceColumnId === targetColumnId) {
        setDraggingTask(null)
        return
      }

      // Optimistic update
      setColumns((prevColumns) => {
        const newColumns = prevColumns.map((col) => {
          if (col.id === sourceColumnId) {
            return {
              ...col,
              tasks: col.tasks.filter((t) => t.id !== task.id),
            }
          }
          if (col.id === targetColumnId) {
            return {
              ...col,
              tasks: [...col.tasks, task],
            }
          }
          return col
        })
        return newColumns
      })

      // Persist to database
      const result = await KitKanbanService.moveTask(task.id, targetColumnId, 0)
      if (!result.success) {
        // Revert on error
        fetchData()
      }

      setDraggingTask(null)
    },
    [draggingTask, fetchData]
  )

  // Handle Start Kit button click - Opens confirmation dialog first
  const handleStartKit = useCallback(
    (taskId: string) => {
      // Find the task to get the kit PO number
      let kitPoNumber: string | null = null
      for (const column of columns) {
        const task = column.tasks.find((t) => t.id === taskId)
        if (task) {
          kitPoNumber = task.kitPoNumber || null
          break
        }
      }

      // Open the confirmation dialog
      setPendingStartKitTaskId(taskId)
      setPendingStartKitPoNumber(kitPoNumber)
      setIsStartKitDialogOpen(true)
    },
    [columns]
  )

  // Silent refresh that doesn't show loading state (for background updates)
  const silentRefresh = useCallback(async () => {
    try {
      // Fetch columns from database
      const dbColumns = await KitKanbanService.getColumns()

      // Fetch tasks grouped by column
      const tasksByColumn = await KitKanbanService.getTasksByColumn()

      if (dbColumns.length > 0) {
        // Use database columns
        const transformedColumns: KanbanColumn[] = dbColumns.map(
          (col: DBColumn) => ({
            id: col.id,
            name: col.column_name,
            title: col.column_display_name,
            color: col.column_color,
            tasks: (tasksByColumn.get(col.id) || []).map(transformTask),
          })
        )
        setColumns(transformedColumns)
      }
    } catch (err) {
      logger.error('Silent refresh error:', err)
    }
  }, [])

  // Handle confirmed start kit action (called after user confirms in dialog)
  const handleConfirmStartKit = useCallback(async () => {
    if (!pendingStartKitTaskId || !pendingStartKitPoNumber) return

    setStartingKitId(pendingStartKitTaskId)

    try {
      // STEP 1: Immediately close confirmation dialog and open build sheet for smooth UX
      setIsStartKitDialogOpen(false)
      setBuildSheetKitPoNumber(pendingStartKitPoNumber)
      setIsKitBuildSheetOpen(true)

      // STEP 2: Optimistically move the task to "In Progress" column locally
      setColumns((prevColumns) => {
        const planningColumn = prevColumns.find(
          (col) => col.name === 'planning'
        )
        const inProgressColumn = prevColumns.find(
          (col) => col.name === 'in_progress'
        )

        if (!planningColumn || !inProgressColumn) return prevColumns

        const taskToMove = planningColumn.tasks.find(
          (t) => t.id === pendingStartKitTaskId
        )
        if (!taskToMove) return prevColumns

        return prevColumns.map((col) => {
          if (col.id === planningColumn.id) {
            return {
              ...col,
              tasks: col.tasks.filter((t) => t.id !== pendingStartKitTaskId),
            }
          }
          if (col.id === inProgressColumn.id) {
            return { ...col, tasks: [taskToMove, ...col.tasks] }
          }
          return col
        })
      })

      // STEP 3: Start the kit in the background (already showing build sheet)
      const result = await KitKanbanService.startKit(pendingStartKitTaskId)

      if (!result.success) {
        logger.error('Failed to start kit:', result.error)
        // Silently refresh to restore correct state on error
        await silentRefresh()
        return
      }

      // STEP 4: Update the kit build status to "printed" in RR_Kitting_DATA
      if (result.kitPoNumber) {
        const statusResult = await RRKittingDataService.markKitAsPrinted(
          result.kitPoNumber
        )
        if (!statusResult.success) {
          logger.error('Failed to update kit status:', statusResult.error)
        }
      }

      // STEP 5: Silently refresh to sync with database (no loading spinner)
      await silentRefresh()
    } catch (err) {
      logger.error('Error starting kit:', err)
      // Silently refresh to restore correct state on error
      await silentRefresh()
    } finally {
      setStartingKitId(null)
    }
  }, [pendingStartKitTaskId, pendingStartKitPoNumber, silentRefresh])

  // Handle closing the start kit dialog
  const handleStartKitDialogClose = useCallback((open: boolean) => {
    if (!open) {
      setPendingStartKitTaskId(null)
      setPendingStartKitPoNumber(null)
    }
    setIsStartKitDialogOpen(open)
  }, [])

  // Handle Quick View button click - opens the Kit Build Audit Trail dialog
  const handleQuickView = useCallback(
    (kitSerialNumber: string, kitPoNumber: string) => {
      setSelectedKitSerialNumber(kitSerialNumber) // Use kit_serial_number as unique identifier
      setSelectedKitPoNumber(kitPoNumber) // For display purposes
      setIsAuditTrailOpen(true)
    },
    []
  )

  // Handle sync missing cards - creates kanban tasks for existing kit build plans
  const handleSyncMissingCards = useCallback(async () => {
    setIsSyncingCards(true)
    try {
      const result = await KitKanbanService.createMissingKanbanTasks()

      if (result.success) {
        if (result.created > 0) {
          toast.success(
            `Created ${result.created} kanban card${result.created === 1 ? '' : 's'}`,
            {
              description:
                result.skipped > 0
                  ? `${result.skipped} kit${result.skipped === 1 ? '' : 's'} already had cards.`
                  : undefined,
            }
          )
          // Refresh the board to show new cards
          fetchData(false)
        } else if (result.skipped > 0) {
          toast.info('All kit build plans already have kanban cards', {
            description: `${result.skipped} card${result.skipped === 1 ? '' : 's'} found.`,
          })
        } else {
          toast.info('No kit build plans found to sync')
        }

        if (result.errors.length > 0) {
          toast.warning(
            `${result.errors.length} error${result.errors.length === 1 ? '' : 's'} during sync`,
            {
              description: result.errors[0],
            }
          )
        }
      } else {
        toast.error('Failed to sync kanban cards', {
          description: result.errors[0] || 'Unknown error',
        })
      }
    } catch (err) {
      logger.error('Error syncing missing cards:', err)
      toast.error('Error syncing kanban cards')
    } finally {
      setIsSyncingCards(false)
    }
  }, [fetchData])

  // Loading state
  if (loading) {
    return (
      <div className='bg-background flex h-full w-full items-center justify-center'>
        <div className='flex flex-col items-center gap-4'>
          <Loader2 className='text-primary h-8 w-8 animate-spin' />
          <p className='text-muted-foreground'>Loading Kit Assembly Board...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className='bg-background flex h-full w-full items-center justify-center'>
        <div className='text-center'>
          <p className='text-destructive mb-2'>{error}</p>
          <button
            onClick={() => fetchData(true)}
            className='text-primary hover:underline'
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className='bg-background h-full w-full overflow-x-auto'>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{
          opacity: 1,
          y: 0,
        }}
        transition={springTransition}
        className='mb-6'
      >
        <div className='flex items-start justify-between gap-4'>
          <div>
            <h3 className='text-foreground mb-2 text-2xl font-bold'>
              Kit Assembly Board
            </h3>
            <p className='text-muted-foreground'>
              Drag and drop kit tasks between columns to update their status.
              Cards are automatically created when a Kit Build Plan is added.
            </p>
          </div>
          <Button
            variant='outline'
            size='sm'
            onClick={handleSyncMissingCards}
            disabled={isSyncingCards}
            className='shrink-0'
          >
            {isSyncingCards ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className='mr-2 h-4 w-4' />
                Sync Missing Cards
              </>
            )}
          </Button>
        </div>
      </motion.div>

      <div className='grid min-w-max grid-cols-1 gap-6 pb-6 md:grid-cols-2 lg:grid-cols-4'>
        {columns.map((column) => (
          <DroppableColumn
            key={column.id}
            column={column}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onStartKit={handleStartKit}
            onQuickView={handleQuickView}
            draggingTask={draggingTask}
            startingKitId={startingKitId}
          />
        ))}
      </div>

      {/* Kit Build Audit Trail Dialog */}
      <KitProductionTrackerDialog
        open={isAuditTrailOpen}
        onOpenChange={setIsAuditTrailOpen}
        kitSerialNumber={selectedKitSerialNumber}
        kitPoNumber={selectedKitPoNumber}
      />

      {/* Start Kit Confirmation Dialog */}
      <StartKitConfirmDialog
        open={isStartKitDialogOpen}
        onOpenChange={handleStartKitDialogClose}
        taskId={pendingStartKitTaskId || ''}
        kitPoNumber={pendingStartKitPoNumber}
        onConfirm={handleConfirmStartKit}
        onCancel={() => handleStartKitDialogClose(false)}
      />

      {/* Kit Build Sheet Dialog */}
      <KitBuildSheet
        open={isKitBuildSheetOpen}
        onOpenChange={setIsKitBuildSheetOpen}
        kitPoNumber={buildSheetKitPoNumber}
      />
    </div>
  )
}
