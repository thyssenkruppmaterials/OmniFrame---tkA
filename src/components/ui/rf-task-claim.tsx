// Created and developed by Jai Singh
/**
 * RF Task Claim Component
 * Mobile-optimized interface for claiming available work queue tasks in RF interface
 * Allows workers to browse and claim tasks from the available task pool
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckSquare,
  Clock,
  Filter,
  Loader2,
  MapPin,
  Package,
  Search,
  Square,
  Star,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { RFScreenHeader } from '@/features/rf-interface/_shell'

// Temporary stub services until types are resolved
const simpleWorkQueueService = {
  getAvailableTasks: async () => ({ data: [], error: null }),
  claimTasks: async (_request: any) => ({ data: [], error: null }),
  getNextTask: async () => ({ data: null, error: 'No tasks available' }),
  startTask: async (_id: string) => ({ error: null }),
  releaseTask: async (_id: string, _reason: string) => ({ error: null }),
  getUserTasks: async () => ({ data: [], error: null }),
}

const simpleWorkerManagementService = {
  getWorkerCapacity: async () => ({
    data: {
      current_assigned: 0,
      max_concurrent: 3,
      can_accept_more: true,
      preferred_zones: [],
    },
    error: null,
  }),
}

// ============================================================================
// INTERFACES AND TYPES
// ============================================================================

interface RFTaskClaimProps {
  onBack?: () => void
  onTasksClaimed?: (tasks: any[]) => void
}

interface TaskFilters {
  task_types: string[]
  zones: string[]
  max_priority: number
  min_priority: number
  search_term: string
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const RFTaskClaim: React.FC<RFTaskClaimProps> = ({
  onBack,
  onTasksClaimed,
}) => {
  const [availableTasks, setAvailableTasks] = useState<any[]>([])
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())
  const [workerCapacity, setWorkerCapacity] = useState<any | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isClaiming, setIsClaiming] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const [filters, setFilters] = useState<TaskFilters>({
    task_types: [],
    zones: [],
    max_priority: 100,
    min_priority: 0,
    search_term: '',
  })

  const { authState } = useUnifiedAuth()
  const { user } = authState

  // ========================================================================
  // DATA LOADING
  // ========================================================================

  const loadAvailableTasks = useCallback(async () => {
    if (!user) return

    try {
      setIsLoading(true)

      // Load available tasks and worker capacity
      const [tasksResult, capacityResult] = await Promise.all([
        simpleWorkQueueService.getAvailableTasks(),
        simpleWorkerManagementService.getWorkerCapacity(),
      ])

      if (tasksResult.error) {
        logger.error('Error loading available tasks:', tasksResult.error)
        toast.error(`Failed to load available tasks: ${tasksResult.error}`)
        return
      }

      let tasks = tasksResult.data || []

      // Apply search filter
      if (filters.search_term.trim()) {
        const searchLower = filters.search_term.toLowerCase()
        tasks = tasks.filter(
          (task: any) =>
            task.title.toLowerCase().includes(searchLower) ||
            task.description?.toLowerCase().includes(searchLower) ||
            task.material_number?.toLowerCase().includes(searchLower) ||
            task.location?.toLowerCase().includes(searchLower)
        )
      }

      setAvailableTasks(tasks)
      setWorkerCapacity(capacityResult.data)

      // Clear selections that are no longer available
      const availableTaskIds = new Set(tasks.map((t: any) => t.id))
      setSelectedTaskIds(
        (prev) => new Set([...prev].filter((id) => availableTaskIds.has(id)))
      )
    } catch (error: unknown) {
      logger.error('Error loading available tasks:', error)
      toast.error(
        `Failed to load tasks: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setIsLoading(false)
    }
  }, [user, filters])

  // Load data on mount and filter changes
  useEffect(() => {
    loadAvailableTasks()
  }, [loadAvailableTasks])

  // ========================================================================
  // TASK SELECTION
  // ========================================================================

  const toggleTaskSelection = (taskId: string) => {
    const newSelected = new Set(selectedTaskIds)
    if (newSelected.has(taskId)) {
      newSelected.delete(taskId)
    } else {
      // Check capacity limit
      const maxSelectable = Math.max(
        0,
        (workerCapacity?.max_concurrent_tasks || 3) -
          (workerCapacity?.current_tasks || 0)
      )
      if (newSelected.size >= maxSelectable) {
        toast.warning(
          `Cannot select more than ${maxSelectable} tasks due to capacity limit`
        )
        return
      }
      newSelected.add(taskId)
    }
    setSelectedTaskIds(newSelected)
  }

  const selectAllVisible = () => {
    const maxSelectable = Math.max(
      0,
      (workerCapacity?.max_concurrent_tasks || 3) -
        (workerCapacity?.current_tasks || 0)
    )
    const visibleTaskIds = availableTasks
      .slice(0, maxSelectable)
      .map((t) => t.id)
    setSelectedTaskIds(new Set([...selectedTaskIds, ...visibleTaskIds]))
  }

  const clearSelection = () => {
    setSelectedTaskIds(new Set())
  }

  // ========================================================================
  // TASK CLAIMING
  // ========================================================================

  const handleClaimTasks = async () => {
    if (selectedTaskIds.size === 0 || !user) return

    setIsClaiming(true)
    try {
      const claimRequest = {
        task_ids: Array.from(selectedTaskIds),
        notes: 'Claimed via RF interface',
      }

      const { data: claimedTasks, error } =
        await simpleWorkQueueService.claimTasks(claimRequest)

      if (error) {
        toast.error(`Failed to claim tasks: ${error}`)
        return
      }

      const claimedCount = claimedTasks?.length || 0
      toast.success(
        `Successfully claimed ${claimedCount} task${claimedCount === 1 ? '' : 's'}`
      )

      // Clear selection and refresh data
      setSelectedTaskIds(new Set())
      await loadAvailableTasks()

      // Notify parent component
      if (onTasksClaimed && claimedTasks) {
        onTasksClaimed(claimedTasks)
      }
    } catch (error: unknown) {
      logger.error('Error claiming tasks:', error)
      toast.error(
        `Failed to claim tasks: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setIsClaiming(false)
    }
  }

  // ========================================================================
  // UTILITY FUNCTIONS
  // ========================================================================

  const getPriorityColor = (priority: number) => {
    if (priority >= 80)
      return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100'
    if (priority >= 50)
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-100'
    return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-100'
  }

  const formatTimeAgo = (dateString: string) => {
    const now = new Date()
    const date = new Date(dateString)
    const diffMinutes = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60)
    )

    if (diffMinutes < 1) return 'Just now'
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }

  const canSelectMore = () => {
    const maxSelectable = Math.max(
      0,
      (workerCapacity?.max_concurrent_tasks || 3) -
        (workerCapacity?.current_tasks || 0)
    )
    return selectedTaskIds.size < maxSelectable
  }

  // ========================================================================
  // TASK CARD COMPONENT
  // ========================================================================

  const TaskCard: React.FC<{ task: any }> = ({ task }) => {
    const isSelected = selectedTaskIds.has(task.id)
    const canSelect = canSelectMore() || isSelected

    return (
      <Card
        className={`mb-3 cursor-pointer transition-all ${
          isSelected
            ? 'bg-blue-50 ring-2 ring-blue-500 dark:bg-blue-900/20'
            : canSelect
              ? 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
              : 'cursor-not-allowed opacity-50'
        }`}
        onClick={() => canSelect && toggleTaskSelection(task.id)}
      >
        <CardContent className='p-4'>
          <div className='flex items-start space-x-3'>
            <div className='flex-shrink-0 pt-1'>
              <Checkbox
                checked={isSelected}
                disabled={!canSelect}
                onChange={() => {}} // Handled by card click
                className='h-4 w-4'
              />
            </div>

            <div className='min-w-0 flex-1'>
              <div className='mb-2 flex items-start justify-between'>
                <div className='min-w-0 flex-1'>
                  <h4 className='truncate text-sm font-medium'>{task.title}</h4>
                  {task.description && (
                    <p className='text-muted-foreground mt-1 truncate text-xs'>
                      {task.description}
                    </p>
                  )}
                </div>
                <div className='ml-2 flex items-center space-x-2'>
                  <Badge
                    className={`text-xs ${getPriorityColor(task.priority)}`}
                  >
                    P{task.priority}
                  </Badge>
                  {task.priority >= 80 && (
                    <Star className='h-3 w-3 text-yellow-500' />
                  )}
                </div>
              </div>

              <div className='text-muted-foreground mb-2 flex items-center justify-between text-xs'>
                <div className='flex items-center space-x-3'>
                  <span className='font-medium capitalize'>
                    {task.task_type.replace('_', ' ')}
                  </span>
                  {task.zone && (
                    <div className='flex items-center space-x-1'>
                      <MapPin className='h-3 w-3' />
                      <span>{task.zone}</span>
                    </div>
                  )}
                  {task.estimated_duration_minutes && (
                    <div className='flex items-center space-x-1'>
                      <Clock className='h-3 w-3' />
                      <span>{task.estimated_duration_minutes}min</span>
                    </div>
                  )}
                </div>
                <span>{formatTimeAgo(task.created_at)}</span>
              </div>

              {task.material_number && (
                <div className='text-muted-foreground flex items-center text-xs'>
                  <Package className='mr-1 h-3 w-3' />
                  <span className='truncate'>
                    {task.material_number}
                    {task.quantity && task.unit_of_measure && (
                      <span>
                        {' '}
                        • {task.quantity} {task.unit_of_measure}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className='flex flex-1 flex-col space-y-4'>
      {/* Header */}
      <RFScreenHeader
        title='Claim Tasks'
        subtitle='Pick up tasks'
        onBack={onBack}
        right={
          <Button
            variant='outline'
            size='sm'
            onClick={() => setShowFilters(!showFilters)}
            className='h-9 w-9 shrink-0 p-0'
          >
            <Filter className='h-4 w-4' />
          </Button>
        }
      />

      {/* Capacity Status */}
      {workerCapacity && (
        <Card>
          <CardContent className='p-3'>
            <div className='flex items-center justify-between text-sm'>
              <div className='flex items-center space-x-2'>
                <Users className='h-4 w-4' />
                <span>Capacity:</span>
              </div>
              <div className='flex items-center space-x-2'>
                <span>
                  {workerCapacity.current_tasks}/
                  {workerCapacity.max_concurrent_tasks}
                </span>
                <Badge
                  variant={
                    workerCapacity.can_accept_more ? 'default' : 'secondary'
                  }
                >
                  {Math.max(
                    0,
                    workerCapacity.max_concurrent_tasks -
                      workerCapacity.current_tasks
                  )}{' '}
                  available
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <div className='relative'>
        <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
        <Input
          placeholder='Search tasks...'
          value={filters.search_term}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFilters((prev) => ({ ...prev, search_term: e.target.value }))
          }
          className='pl-9'
        />
      </div>

      {/* Selection Controls */}
      {availableTasks.length > 0 && (
        <div className='flex items-center justify-between'>
          <div className='flex items-center space-x-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={selectAllVisible}
              disabled={!canSelectMore()}
            >
              <CheckSquare className='mr-1 h-3 w-3' />
              Select All
            </Button>
            {selectedTaskIds.size > 0 && (
              <Button variant='outline' size='sm' onClick={clearSelection}>
                <Square className='mr-1 h-3 w-3' />
                Clear ({selectedTaskIds.size})
              </Button>
            )}
          </div>
          <span className='text-muted-foreground text-sm'>
            {availableTasks.length} available
          </span>
        </div>
      )}

      {/* Task List */}
      <div className='flex-1 overflow-y-auto'>
        {isLoading ? (
          <div className='flex items-center justify-center py-8'>
            <div className='text-center'>
              <Loader2 className='mx-auto mb-2 h-8 w-8 animate-spin' />
              <p className='text-muted-foreground text-sm'>
                Loading available tasks...
              </p>
            </div>
          </div>
        ) : availableTasks.length === 0 ? (
          <div className='py-8 text-center'>
            <AlertCircle className='text-muted-foreground mx-auto mb-4 h-12 w-12' />
            <h3 className='mb-2 text-sm font-semibold'>No Tasks Available</h3>
            <p className='text-muted-foreground text-xs'>
              No tasks match your current filters or all tasks are already
              assigned
            </p>
          </div>
        ) : (
          <div>
            {availableTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>

      {/* Claim Button */}
      {selectedTaskIds.size > 0 && (
        <div className='bg-background sticky bottom-0 border-t pt-4'>
          <Button
            onClick={handleClaimTasks}
            disabled={isClaiming || selectedTaskIds.size === 0}
            className='h-12 w-full'
          >
            {isClaiming ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <CheckSquare className='mr-2 h-4 w-4' />
            )}
            Claim {selectedTaskIds.size} Task
            {selectedTaskIds.size === 1 ? '' : 's'}
          </Button>
        </div>
      )}
    </div>
  )
}

export default RFTaskClaim

// Created and developed by Jai Singh
