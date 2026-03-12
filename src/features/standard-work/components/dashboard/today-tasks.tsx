/**
 * Today Tasks Section Component
 * Modern enterprise-grade task list with priority grouping and status indicators
 * Updated: February 8, 2026 - Complete redesign for enterprise experience
 */
import { useMemo } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ClipboardCheck,
  CalendarClock,
  FileText,
  Play,
  PlayCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  ScheduledTask,
  StandardWorkSubmission,
} from '@/hooks/use-standard-work'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

interface TaskCardProps {
  task: ScheduledTask
  submission?: StandardWorkSubmission
  onStart: () => void
  onContinue: () => void
}

function TaskCard({ task, submission, onStart, onContinue }: TaskCardProps) {
  const isInProgress = submission && submission.status !== 'submitted'
  const isCompleted = task.is_completed

  return (
    <div
      className={cn(
        'group relative flex items-center gap-4 rounded-xl border p-4 transition-all duration-200',
        isCompleted
          ? 'border-green-500/20 bg-green-500/5 dark:bg-green-500/5'
          : task.is_overdue
            ? 'bg-destructive/5 border-destructive/20 hover:border-destructive/40'
            : 'bg-card hover:bg-accent/50 border-border hover:border-primary/30'
      )}
    >
      {/* Status indicator dot */}
      <div
        className={cn(
          'h-2.5 w-2.5 shrink-0 rounded-full ring-4',
          isCompleted
            ? 'bg-green-500 ring-green-500/20'
            : task.is_overdue
              ? 'bg-destructive ring-destructive/20 animate-pulse'
              : isInProgress
                ? 'bg-yellow-500 ring-yellow-500/20'
                : 'bg-muted-foreground/30 ring-muted/50'
        )}
      />

      {/* Color-coded template icon */}
      <div
        className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg'
        style={{ backgroundColor: `${task.color}15` }}
      >
        <ClipboardCheck className='h-5 w-5' style={{ color: task.color }} />
      </div>

      {/* Content */}
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <h4
            className={cn(
              'truncate text-sm font-semibold',
              isCompleted && 'text-muted-foreground line-through'
            )}
          >
            {task.template_name}
          </h4>
          {task.is_overdue && !isCompleted && (
            <Badge
              variant='destructive'
              className='h-5 gap-0.5 px-1.5 text-[10px]'
            >
              <AlertTriangle className='h-3 w-3' />
              Overdue
            </Badge>
          )}
        </div>

        <div className='mt-1 flex items-center gap-3'>
          {task.working_area_name && (
            <span className='text-muted-foreground max-w-[120px] truncate text-xs'>
              {task.working_area_name}
            </span>
          )}
          <span className='text-muted-foreground flex items-center gap-1 text-xs'>
            <FileText className='h-3 w-3' />
            {task.items_count} items
          </span>
          <span className='text-muted-foreground flex items-center gap-1 text-xs'>
            <Clock className='h-3 w-3' />~{task.estimated_duration_minutes}m
          </span>
        </div>

        {/* Progress bar for in-progress */}
        {isInProgress && (
          <div className='mt-2 flex items-center gap-2'>
            <Progress
              value={task.completion_percentage}
              className='h-1.5 flex-1'
            />
            <span className='text-muted-foreground text-xs font-medium'>
              {Math.round(task.completion_percentage)}%
            </span>
          </div>
        )}
      </div>

      {/* Action */}
      <div className='shrink-0'>
        {isCompleted ? (
          <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10'>
            <CheckCircle2 className='h-5 w-5 text-green-500' />
          </div>
        ) : isInProgress ? (
          <Button
            size='sm'
            onClick={onContinue}
            className='h-9 gap-1.5 rounded-lg'
          >
            <PlayCircle className='h-4 w-4' />
            Continue
          </Button>
        ) : (
          <Button
            size='sm'
            variant='outline'
            onClick={onStart}
            className='group-hover:bg-primary group-hover:text-primary-foreground h-9 gap-1.5 rounded-lg transition-colors'
          >
            <Play className='h-3.5 w-3.5' />
            Start
          </Button>
        )}
      </div>
    </div>
  )
}

interface TodayTasksSectionProps {
  tasks: {
    overdue: ScheduledTask[]
    dueSoon: ScheduledTask[]
    upcoming: ScheduledTask[]
    completed: ScheduledTask[]
  }
  todaySubmissions: StandardWorkSubmission[]
  onStartChecklist: (templateId: string) => void
  onContinueChecklist: (submissionId: string) => void
}

export function TodayTasksSection({
  tasks,
  todaySubmissions,
  onStartChecklist,
  onContinueChecklist,
}: TodayTasksSectionProps) {
  const totalTasks =
    tasks.overdue.length +
    tasks.dueSoon.length +
    tasks.upcoming.length +
    tasks.completed.length
  const hasNoTasks = totalTasks === 0
  const completionPct =
    totalTasks > 0 ? Math.round((tasks.completed.length / totalTasks) * 100) : 0

  // Memoize submission lookup for performance
  const submissionMap = useMemo(() => {
    const map = new Map<string, StandardWorkSubmission>()
    todaySubmissions.forEach((s) => {
      if (s.status !== 'submitted') {
        map.set(s.template_id, s)
      }
    })
    return map
  }, [todaySubmissions])

  const findSubmission = (templateId: string) => submissionMap.get(templateId)

  const renderTaskGroup = (
    groupTasks: ScheduledTask[],
    label: string,
    icon: React.ReactNode,
    colorClass: string
  ) => {
    if (groupTasks.length === 0) return null

    return (
      <div className='space-y-2'>
        <div className='flex items-center gap-2 px-1'>
          <div className={cn('flex items-center gap-1.5', colorClass)}>
            {icon}
            <span className='text-xs font-semibold tracking-wider uppercase'>
              {label}
            </span>
          </div>
          <Badge
            variant='outline'
            className={cn('h-5 text-[10px]', colorClass)}
          >
            {groupTasks.length}
          </Badge>
        </div>
        <div className='space-y-2'>
          {groupTasks.map((task) => (
            <TaskCard
              key={`${label}-${task.template_id}`}
              task={task}
              submission={findSubmission(task.template_id)}
              onStart={() => onStartChecklist(task.template_id)}
              onContinue={() => {
                const sub = findSubmission(task.template_id)
                if (sub) onContinueChecklist(sub.id)
              }}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <Card className='overflow-hidden'>
      <CardHeader className='pb-4'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <div className='bg-primary/10 flex h-9 w-9 items-center justify-center rounded-lg'>
              <CalendarClock className='text-primary h-5 w-5' />
            </div>
            <div>
              <CardTitle className='text-base'>Today's Tasks</CardTitle>
              <CardDescription className='text-xs'>
                {tasks.completed.length} of {totalTasks} completed
              </CardDescription>
            </div>
          </div>
          {totalTasks > 0 && (
            <div className='flex items-center gap-2'>
              <span className='text-sm font-bold'>{completionPct}%</span>
              <div className='w-16'>
                <Progress value={completionPct} className='h-2' />
              </div>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className='pt-0'>
        {hasNoTasks ? (
          <div className='flex flex-col items-center justify-center py-12 text-center'>
            <div className='mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-green-500/10'>
              <CheckCircle2 className='h-8 w-8 text-green-500' />
            </div>
            <p className='text-sm font-semibold'>All caught up!</p>
            <p className='text-muted-foreground mt-1 max-w-[200px] text-xs'>
              No tasks scheduled for today. Check upcoming tasks below.
            </p>
          </div>
        ) : (
          <ScrollArea className='-mr-3 max-h-[480px] pr-3'>
            <div className='space-y-5'>
              {renderTaskGroup(
                tasks.overdue,
                'Overdue',
                <AlertTriangle className='h-3.5 w-3.5' />,
                'text-destructive'
              )}
              {renderTaskGroup(
                tasks.dueSoon,
                'Due Soon',
                <Clock className='h-3.5 w-3.5' />,
                'text-yellow-600 dark:text-yellow-500'
              )}
              {renderTaskGroup(
                tasks.upcoming,
                'Upcoming',
                <ArrowRight className='h-3.5 w-3.5' />,
                'text-muted-foreground'
              )}

              {/* Separator before completed */}
              {tasks.completed.length > 0 &&
                (tasks.overdue.length > 0 ||
                  tasks.dueSoon.length > 0 ||
                  tasks.upcoming.length > 0) && <Separator />}

              {renderTaskGroup(
                tasks.completed,
                'Completed',
                <CheckCircle2 className='h-3.5 w-3.5' />,
                'text-green-600 dark:text-green-500'
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

export default TodayTasksSection
