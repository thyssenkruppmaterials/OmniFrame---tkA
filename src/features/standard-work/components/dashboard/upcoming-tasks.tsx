/**
 * Upcoming Tasks Section Component
 * Modern collapsible schedule view for future tasks
 * Updated: February 8, 2026 - Complete redesign for enterprise experience
 */
import { useState } from 'react'
import {
  CalendarRange,
  ChevronRight,
  Clock,
  FileText,
  ClipboardCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScheduledTask } from '@/hooks/use-standard-work'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'

interface UpcomingTasksSectionProps {
  upcomingTasks: Array<{ date: string; tasks: ScheduledTask[] }>
  isLoading?: boolean
}

export function UpcomingTasksSection({
  upcomingTasks,
  isLoading,
}: UpcomingTasksSectionProps) {
  const [openDates, setOpenDates] = useState<Record<string, boolean>>({})

  const toggleDate = (date: string) => {
    setOpenDates((prev) => ({
      ...prev,
      [date]: prev[date] === undefined ? false : !prev[date],
    }))
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    if (date.getTime() === tomorrow.getTime()) {
      return 'Tomorrow'
    }

    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' })
    const monthDay = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
    return `${dayName}, ${monthDay}`
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className='pb-4'>
          <Skeleton className='h-5 w-36' />
          <Skeleton className='mt-1 h-4 w-48' />
        </CardHeader>
        <CardContent className='space-y-3'>
          <Skeleton className='h-12 w-full rounded-lg' />
          <Skeleton className='h-12 w-full rounded-lg' />
        </CardContent>
      </Card>
    )
  }

  const totalUpcoming = upcomingTasks.reduce(
    (acc, day) => acc + day.tasks.length,
    0
  )

  return (
    <Card className='overflow-hidden'>
      <CardHeader className='pb-4'>
        <div className='flex items-center gap-3'>
          <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10'>
            <CalendarRange className='h-5 w-5 text-blue-500' />
          </div>
          <div>
            <CardTitle className='text-base'>Upcoming Schedule</CardTitle>
            <CardDescription className='text-xs'>
              {totalUpcoming} task{totalUpcoming !== 1 ? 's' : ''} in the next{' '}
              {upcomingTasks.length} day{upcomingTasks.length !== 1 ? 's' : ''}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className='pt-0'>
        {upcomingTasks.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-10 text-center'>
            <div className='bg-muted mb-3 flex h-14 w-14 items-center justify-center rounded-2xl'>
              <CalendarRange className='text-muted-foreground/40 h-7 w-7' />
            </div>
            <p className='text-muted-foreground text-sm font-medium'>
              No upcoming tasks
            </p>
            <p className='text-muted-foreground/70 mt-0.5 text-xs'>
              Schedule will appear here
            </p>
          </div>
        ) : (
          <div className='space-y-2'>
            {upcomingTasks.map(({ date, tasks }) => {
              const isOpen = openDates[date] !== false

              return (
                <Collapsible
                  key={date}
                  open={isOpen}
                  onOpenChange={() => toggleDate(date)}
                >
                  <CollapsibleTrigger className='hover:bg-accent/50 group flex w-full items-center justify-between rounded-lg border p-3 transition-colors'>
                    <div className='flex items-center gap-2.5'>
                      <ChevronRight
                        className={cn(
                          'text-muted-foreground h-4 w-4 transition-transform duration-200',
                          isOpen && 'rotate-90'
                        )}
                      />
                      <span className='text-sm font-medium'>
                        {formatDate(date)}
                      </span>
                    </div>
                    <Badge variant='secondary' className='text-xs font-medium'>
                      {tasks.length} task{tasks.length !== 1 ? 's' : ''}
                    </Badge>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className='border-muted ml-4 space-y-1.5 border-l-2 py-2 pl-4'>
                      {tasks.map((task) => (
                        <div
                          key={task.template_id}
                          className='hover:bg-accent/30 flex items-center gap-3 rounded-lg p-2.5 transition-colors'
                        >
                          <div
                            className='flex h-7 w-7 shrink-0 items-center justify-center rounded-md'
                            style={{ backgroundColor: `${task.color}12` }}
                          >
                            <ClipboardCheck
                              className='h-3.5 w-3.5'
                              style={{ color: task.color }}
                            />
                          </div>
                          <div className='min-w-0 flex-1'>
                            <p className='truncate text-sm font-medium'>
                              {task.template_name}
                            </p>
                            <div className='text-muted-foreground flex items-center gap-2 text-xs'>
                              <span className='flex items-center gap-0.5'>
                                <FileText className='h-3 w-3' />
                                {task.items_count}
                              </span>
                              {task.due_time && (
                                <span className='flex items-center gap-0.5'>
                                  <Clock className='h-3 w-3' />
                                  {task.due_time.slice(0, 5)}
                                </span>
                              )}
                            </div>
                          </div>
                          <Badge
                            variant='outline'
                            className='h-5 shrink-0 text-[10px] capitalize'
                          >
                            {task.frequency}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default UpcomingTasksSection
