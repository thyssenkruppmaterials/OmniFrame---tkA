// Created and developed by Jai Singh
/**
 * Submission History Component
 * Modern timeline-style activity feed for recent submissions
 * Updated: February 8, 2026 - Complete redesign for enterprise experience
 */
import { motion, useReducedMotion } from 'framer-motion'
import {
  History,
  CheckCircle2,
  Clock,
  AlertCircle,
  ClipboardCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StandardWorkSubmission } from '@/hooks/use-standard-work'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

const STATUS_CONFIG: Record<
  string,
  { icon: React.ReactNode; bg: string; text: string; label: string }
> = {
  submitted: {
    icon: <CheckCircle2 className='h-4 w-4' />,
    bg: 'bg-green-500/10',
    text: 'text-green-600 dark:text-green-400',
    label: 'Submitted',
  },
  approved: {
    icon: <CheckCircle2 className='h-4 w-4' />,
    bg: 'bg-green-500/10',
    text: 'text-green-600 dark:text-green-400',
    label: 'Approved',
  },
  draft: {
    icon: <Clock className='h-4 w-4' />,
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-600 dark:text-yellow-400',
    label: 'Draft',
  },
  in_progress: {
    icon: <Clock className='h-4 w-4' />,
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-600 dark:text-yellow-400',
    label: 'In Progress',
  },
  rejected: {
    icon: <AlertCircle className='h-4 w-4' />,
    bg: 'bg-destructive/10',
    text: 'text-destructive',
    label: 'Rejected',
  },
}

const DEFAULT_STATUS = {
  icon: <Clock className='h-4 w-4' />,
  bg: 'bg-muted',
  text: 'text-muted-foreground',
  label: 'Unknown',
}

interface SubmissionHistoryProps {
  submissions: StandardWorkSubmission[]
  limit?: number
}

const userLocale =
  typeof navigator !== 'undefined' && navigator.language
    ? navigator.language
    : 'en-US'

export function SubmissionHistory({
  submissions,
  limit = 5,
}: SubmissionHistoryProps) {
  const reduce = useReducedMotion()
  const displaySubmissions = submissions.slice(0, limit)

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString(userLocale, {
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: reduce ? 0 : 0.2 }}
    >
      <Card className='overflow-hidden'>
        <CardHeader className='pb-4'>
          <div className='flex items-center gap-3'>
            <div className='bg-muted flex h-9 w-9 items-center justify-center rounded-lg'>
              <History className='text-muted-foreground h-5 w-5' />
            </div>
            <div>
              <CardTitle className='text-base'>Recent Activity</CardTitle>
              <CardDescription className='text-xs'>
                Today's submissions
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className='pt-0'>
          {displaySubmissions.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-10 text-center'>
              <div className='bg-muted mb-3 flex h-14 w-14 items-center justify-center rounded-2xl'>
                <ClipboardCheck className='text-muted-foreground/40 h-7 w-7' />
              </div>
              <p className='text-muted-foreground text-sm font-medium'>
                No submissions yet
              </p>
              <p className='text-muted-foreground/70 mt-0.5 text-xs'>
                Complete a checklist to see activity
              </p>
            </div>
          ) : (
            <ScrollArea className='max-h-[240px]'>
              <div className='space-y-1.5'>
                {displaySubmissions.map((submission, idx) => {
                  const config =
                    STATUS_CONFIG[submission.status] || DEFAULT_STATUS

                  return (
                    <div
                      key={submission.id}
                      className='hover:bg-accent/30 flex items-center gap-3 rounded-lg p-3 transition-colors'
                    >
                      {/* Status indicator */}
                      <div className='relative shrink-0'>
                        <div
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-lg',
                            config.bg,
                            config.text
                          )}
                        >
                          {config.icon}
                        </div>
                        {/* Timeline connector */}
                        {idx < displaySubmissions.length - 1 && (
                          <div className='bg-border absolute top-full left-1/2 h-3 w-px -translate-x-1/2' />
                        )}
                      </div>

                      {/* Content */}
                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-sm font-medium'>
                          {submission.template?.template_name ||
                            'Unknown Template'}
                        </p>
                        <p className='text-muted-foreground text-xs'>
                          {submission.submitted_at
                            ? `Completed at ${formatTime(submission.submitted_at)}`
                            : `${Math.round(submission.completion_percentage)}% complete`}
                        </p>
                      </div>

                      {/* Status badge */}
                      <Badge
                        variant='outline'
                        className={cn(
                          'h-5 shrink-0 text-[10px] capitalize',
                          config.text
                        )}
                      >
                        {config.label}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

export default SubmissionHistory

// Created and developed by Jai Singh
