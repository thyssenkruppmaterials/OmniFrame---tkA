/**
 * RF Cycle Count OUT Form Component
 * Form for handling pushed cycle counts in RF interface
 * Receives work pushed by supervisors and provides workflow to complete counts
 */
import { useCallback, useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Loader2,
  MapPin,
  Package,
  Play,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { workServiceClient } from '@/lib/work-service/client'
import type {
  CycleCountPriority,
  CycleCountTask,
} from '@/lib/work-service/types'
import { usePushedWork } from '@/hooks/use-pushed-work'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface RFCycleCountOutFormProps {
  onBack: () => void
}

type WorkflowStep = 'list' | 'confirm' | 'scan-location' | 'count' | 'complete'

// Quantity Keypad Component for large touch targets
const QuantityKeypad = ({
  value,
  onChange,
  label = 'Counted Quantity',
}: {
  value: number
  onChange: (value: number) => void
  label?: string
}) => {
  const handleKeypadClick = (key: string) => {
    if (key === 'clear') {
      onChange(0)
    } else if (key === 'backspace') {
      const newValue = Math.floor(value / 10)
      onChange(newValue)
    } else {
      const digit = parseInt(key)
      const newValue = value * 10 + digit
      // Limit to reasonable quantities (max 99999)
      if (newValue <= 99999) {
        onChange(newValue)
      }
    }
  }

  return (
    <div className='space-y-4'>
      <div className='bg-muted/30 border-muted-foreground/30 rounded-lg border-2 border-dashed p-6 text-center'>
        <div className='text-primary mb-2 font-mono text-5xl font-bold'>
          {value}
        </div>
        <div className='text-muted-foreground text-sm'>{label}</div>
      </div>

      <div className='grid grid-cols-3 gap-2'>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <Button
            key={num}
            type='button'
            variant='outline'
            className='hover:bg-primary hover:text-primary-foreground h-14 text-xl font-semibold'
            onClick={() => handleKeypadClick(num.toString())}
          >
            {num}
          </Button>
        ))}
        <Button
          type='button'
          variant='outline'
          className='hover:bg-destructive hover:text-destructive-foreground h-14 text-sm font-medium'
          onClick={() => handleKeypadClick('clear')}
        >
          Clear
        </Button>
        <Button
          type='button'
          variant='outline'
          className='hover:bg-primary hover:text-primary-foreground h-14 text-xl font-semibold'
          onClick={() => handleKeypadClick('0')}
        >
          0
        </Button>
        <Button
          type='button'
          variant='outline'
          className='hover:bg-secondary hover:text-secondary-foreground h-14 text-lg font-medium'
          onClick={() => handleKeypadClick('backspace')}
        >
          ←
        </Button>
      </div>
    </div>
  )
}

export function RFCycleCountOutForm({ onBack }: RFCycleCountOutFormProps) {
  const {
    pushedTasks,
    newPushAlert,
    clearAlert,
    acknowledgePush,
    isLoading,
    pushedCount,
    refreshPushed,
  } = usePushedWork()

  const [currentTask, setCurrentTask] = useState<CycleCountTask | null>(null)
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>('list')
  const [countedQuantity, setCountedQuantity] = useState<number>(0)
  const [isProcessing, setIsProcessing] = useState(false)

  // Handle new push alert - vibrate device
  useEffect(() => {
    if (newPushAlert) {
      // Vibrate if available (mobile devices)
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200])
      }
    }
  }, [newPushAlert])

  const handleStartTask = useCallback(
    async (task: CycleCountTask) => {
      setIsProcessing(true)
      try {
        // Acknowledge the push first
        acknowledgePush(task.id)

        // Start the task via work service
        await workServiceClient.startTask(task.id)

        setCurrentTask(task)
        setWorkflowStep('confirm')
        setCountedQuantity(0)

        toast.success(`Starting count: ${task.count_number}`)
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        toast.error(`Failed to start task: ${errorMessage}`)
      } finally {
        setIsProcessing(false)
      }
    },
    [acknowledgePush]
  )

  const handleCompleteTask = useCallback(async () => {
    if (!currentTask) return

    setIsProcessing(true)
    try {
      await workServiceClient.completeTask(currentTask.id, {
        counted_quantity: countedQuantity,
      })

      toast.success('Count completed!')
      setCurrentTask(null)
      setWorkflowStep('list')
      refreshPushed()
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      toast.error(`Failed to complete task: ${errorMessage}`)
    } finally {
      setIsProcessing(false)
    }
  }, [currentTask, countedQuantity, refreshPushed])

  const handleReleaseTask = useCallback(async () => {
    if (!currentTask) return

    setIsProcessing(true)
    try {
      await workServiceClient.releaseTask(currentTask.id)

      toast.info('Task released back to queue')
      setCurrentTask(null)
      setWorkflowStep('list')
      refreshPushed()
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      toast.error(`Failed to release task: ${errorMessage}`)
    } finally {
      setIsProcessing(false)
    }
  }, [currentTask, refreshPushed])

  const getPriorityVariant = (
    priority: CycleCountPriority
  ): 'default' | 'secondary' | 'destructive' => {
    switch (priority) {
      case 'critical':
        return 'destructive'
      case 'hot':
        return 'default'
      default:
        return 'secondary'
    }
  }

  // Render new push alert banner
  const PushAlertBanner = newPushAlert && (
    <Alert variant='destructive' className='mb-4 animate-pulse border-2'>
      <Bell className='h-4 w-4' />
      <AlertTitle className='font-semibold'>New Work Pushed!</AlertTitle>
      <AlertDescription className='mt-2 flex items-center justify-between'>
        <span className='text-sm'>
          {newPushAlert.material_number} at {newPushAlert.location}
        </span>
        <Button
          size='sm'
          variant='outline'
          className='bg-background text-foreground hover:bg-accent ml-2'
          onClick={() => {
            handleStartTask(newPushAlert)
            clearAlert()
          }}
        >
          Start Now
        </Button>
      </AlertDescription>
    </Alert>
  )

  // If working on a task, show workflow
  if (currentTask && workflowStep !== 'list') {
    return (
      <div className='bg-background flex h-full flex-col'>
        {/* Header */}
        <div className='bg-card flex items-center justify-between border-b p-4'>
          <Button
            variant='ghost'
            size='sm'
            onClick={handleReleaseTask}
            disabled={isProcessing}
            className='h-10'
          >
            <ArrowLeft className='mr-2 h-4 w-4' />
            Release
          </Button>
          <div className='text-center'>
            <p className='font-mono text-lg font-semibold'>
              {currentTask.count_number}
            </p>
            <Badge variant={getPriorityVariant(currentTask.priority)}>
              {currentTask.priority.toUpperCase()}
            </Badge>
          </div>
          <div className='w-20' /> {/* Spacer for balance */}
        </div>

        {/* Task Details */}
        <div className='bg-muted/50 border-b p-4'>
          <div className='grid grid-cols-2 gap-4 text-sm'>
            <div>
              <p className='text-muted-foreground text-xs'>Material</p>
              <p className='font-mono font-medium'>
                {currentTask.material_number}
              </p>
            </div>
            <div>
              <p className='text-muted-foreground text-xs'>Location</p>
              <p className='flex items-center gap-1 font-medium'>
                <MapPin className='h-3 w-3' />
                {currentTask.location}
              </p>
            </div>
            <div>
              <p className='text-muted-foreground text-xs'>System Qty</p>
              <p className='font-medium'>
                {currentTask.system_quantity} {currentTask.unit_of_measure}
              </p>
            </div>
            <div>
              <p className='text-muted-foreground text-xs'>Description</p>
              <p className='truncate font-medium'>
                {currentTask.material_description || '-'}
              </p>
            </div>
          </div>
        </div>

        {/* Count Entry */}
        <div className='flex flex-1 flex-col p-4'>
          <p className='mb-4 text-center text-lg font-medium'>
            Enter Counted Quantity
          </p>

          <QuantityKeypad
            value={countedQuantity}
            onChange={setCountedQuantity}
            label={`Counted Quantity (${currentTask.unit_of_measure})`}
          />

          <div className='mt-auto pt-4'>
            <Button
              size='lg'
              className='h-14 w-full text-lg'
              onClick={handleCompleteTask}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className='mr-2 h-5 w-5 animate-spin' />
                  Completing...
                </>
              ) : (
                'Complete Count'
              )}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Pushed work list view
  return (
    <div className='bg-background flex h-full flex-col'>
      {/* Header */}
      <div className='bg-card flex items-center justify-between border-b p-4'>
        <Button variant='ghost' size='sm' onClick={onBack} className='h-10'>
          <ArrowLeft className='mr-2 h-4 w-4' />
          Back
        </Button>
        <h1 className='text-lg font-semibold'>Cycle Count OUT</h1>
        <Badge
          variant={pushedCount > 0 ? 'destructive' : 'secondary'}
          className='min-w-8 justify-center'
        >
          {pushedCount}
        </Badge>
      </div>

      {/* Alert banner */}
      <div className='px-4 pt-4'>{PushAlertBanner}</div>

      {/* Task list */}
      <div className='flex-1 space-y-3 overflow-auto p-4'>
        {isLoading ? (
          <div className='text-muted-foreground py-8 text-center'>
            <Loader2 className='mx-auto mb-2 h-8 w-8 animate-spin' />
            Loading...
          </div>
        ) : pushedTasks.length === 0 ? (
          <div className='text-muted-foreground py-12 text-center'>
            <Package className='mx-auto mb-4 h-16 w-16 opacity-50' />
            <p className='font-medium'>No pushed work available</p>
            <p className='mt-2 text-sm'>
              Work will appear here when pushed by supervisor
            </p>
            <Button
              variant='outline'
              size='sm'
              className='mt-4'
              onClick={refreshPushed}
            >
              Refresh
            </Button>
          </div>
        ) : (
          pushedTasks.map((task) => (
            <Card
              key={task.id}
              className={cn(
                'hover:bg-accent cursor-pointer transition-all active:scale-[0.98]',
                task.priority === 'critical' &&
                  'border-2 border-red-500 shadow-md shadow-red-500/20'
              )}
              onClick={() => handleStartTask(task)}
            >
              <CardContent className='p-4'>
                <div className='flex items-start justify-between'>
                  <div className='flex-1 space-y-2'>
                    <div className='flex items-center gap-2'>
                      <Badge variant={getPriorityVariant(task.priority)}>
                        {task.priority.toUpperCase()}
                      </Badge>
                      {task.priority === 'critical' && (
                        <AlertTriangle className='h-4 w-4 text-red-500' />
                      )}
                    </div>
                    <p className='font-mono text-lg font-semibold'>
                      {task.count_number}
                    </p>
                    <p className='font-medium'>{task.material_number}</p>
                    <p className='text-muted-foreground flex items-center gap-1 text-sm'>
                      <MapPin className='h-3 w-3' />
                      {task.location}
                    </p>
                  </div>
                  <Button
                    size='default'
                    disabled={isProcessing}
                    className='h-12 px-4'
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStartTask(task)
                    }}
                  >
                    <Play className='mr-2 h-4 w-4' />
                    Start
                  </Button>
                </div>
                <p className='text-muted-foreground mt-3 border-t pt-2 text-xs'>
                  Pushed{' '}
                  {task.pushed_at
                    ? formatDistanceToNow(new Date(task.pushed_at), {
                        addSuffix: true,
                      })
                    : 'recently'}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}

export default RFCycleCountOutForm
