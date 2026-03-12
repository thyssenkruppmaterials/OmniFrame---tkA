/**
 * Reviews Dashboard Component
 * HR Employee Reviews - Overview dashboard with metrics, cycle progress, and upcoming reviews
 */
import { useState } from 'react'
import { format } from 'date-fns'
import {
  IconCalendarDue,
  IconChartBar,
  IconChecks,
  IconClockHour4,
  IconStar,
  IconStarFilled,
  IconAlertTriangle,
  IconUser,
} from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'

// ── Types ──────────────────────────────────────────────────────────────────────

interface DashboardMetric {
  label: string
  value: number | string
  description: string
  icon: React.ReactNode
  color: string
  bgColor: string
}

interface ReviewCycle {
  name: string
  startDate: Date
  endDate: Date
  totalReviews: number
  completedReviews: number
}

interface UpcomingReview {
  id: string
  employeeName: string
  employeeRole: string
  reviewType: 'Annual' | 'Quarterly' | '90-Day' | 'Self Assessment'
  dueDate: Date
  reviewerName: string
  status: 'Scheduled' | 'Overdue' | 'Due Soon'
}

// ── Mock Data ──────────────────────────────────────────────────────────────────

const mockMetrics: DashboardMetric[] = [
  {
    label: 'Pending Reviews',
    value: 12,
    description: 'Awaiting completion',
    icon: <IconClockHour4 className='h-5 w-5' />,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-500/10',
  },
  {
    label: 'Completed This Quarter',
    value: 34,
    description: 'Q1 2026 progress',
    icon: <IconChecks className='h-5 w-5' />,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-500/10',
  },
  {
    label: 'Average Rating',
    value: '4.2',
    description: 'Across all reviews',
    icon: <IconStarFilled className='h-5 w-5' />,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-500/10',
  },
  {
    label: 'Overdue Reviews',
    value: 3,
    description: 'Past due date',
    icon: <IconAlertTriangle className='h-5 w-5' />,
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-500/10',
  },
]

const mockCycle: ReviewCycle = {
  name: 'Q1 2026 Performance Reviews',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-03-31'),
  totalReviews: 48,
  completedReviews: 34,
}

const mockUpcomingReviews: UpcomingReview[] = [
  {
    id: '1',
    employeeName: 'Sarah Johnson',
    employeeRole: 'Senior Engineer',
    reviewType: 'Annual',
    dueDate: new Date('2026-02-15'),
    reviewerName: 'Michael Chen',
    status: 'Due Soon',
  },
  {
    id: '2',
    employeeName: 'David Martinez',
    employeeRole: 'Product Manager',
    reviewType: 'Quarterly',
    dueDate: new Date('2026-02-18'),
    reviewerName: 'Lisa Wang',
    status: 'Scheduled',
  },
  {
    id: '3',
    employeeName: 'Emily Roberts',
    employeeRole: 'UX Designer',
    reviewType: '90-Day',
    dueDate: new Date('2026-02-10'),
    reviewerName: 'James Wilson',
    status: 'Overdue',
  },
  {
    id: '4',
    employeeName: 'Alex Thompson',
    employeeRole: 'DevOps Engineer',
    reviewType: 'Annual',
    dueDate: new Date('2026-02-22'),
    reviewerName: 'Michael Chen',
    status: 'Scheduled',
  },
  {
    id: '5',
    employeeName: 'Maria Garcia',
    employeeRole: 'QA Lead',
    reviewType: 'Quarterly',
    dueDate: new Date('2026-02-25'),
    reviewerName: 'Lisa Wang',
    status: 'Scheduled',
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function getStatusBadgeVariant(status: UpcomingReview['status']) {
  switch (status) {
    case 'Overdue':
      return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
    case 'Due Soon':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
    case 'Scheduled':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
  }
}

function getReviewTypeBadge(type: UpcomingReview['reviewType']) {
  switch (type) {
    case 'Annual':
      return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
    case 'Quarterly':
      return 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20'
    case '90-Day':
      return 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20'
    case 'Self Assessment':
      return 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20'
  }
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className='flex items-center gap-0.5'>
      {Array.from({ length: 5 }, (_, i) =>
        i < Math.floor(rating) ? (
          <IconStarFilled key={i} className='h-4 w-4 text-amber-500' />
        ) : (
          <IconStar key={i} className='text-muted-foreground/30 h-4 w-4' />
        )
      )}
      <span className='ml-1.5 text-sm font-semibold'>{rating}</span>
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

function ReviewsDashboard() {
  const [metrics] = useState<DashboardMetric[]>(mockMetrics)
  const [cycle] = useState<ReviewCycle>(mockCycle)
  const [upcomingReviews] = useState<UpcomingReview[]>(mockUpcomingReviews)

  const cycleProgress = Math.round(
    (cycle.completedReviews / cycle.totalReviews) * 100
  )

  return (
    <div className='space-y-6'>
      {/* Metric Cards */}
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardContent className='p-5'>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                    {metric.label}
                  </p>
                  <p className='mt-1 text-2xl font-bold'>{metric.value}</p>
                  <p className='text-muted-foreground mt-0.5 text-xs'>
                    {metric.description}
                  </p>
                </div>
                <div
                  className={`h-10 w-10 rounded-xl ${metric.bgColor} flex items-center justify-center ${metric.color}`}
                >
                  {metric.icon}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className='grid gap-6 lg:grid-cols-5'>
        {/* Review Cycle Progress */}
        <Card className='lg:col-span-2'>
          <CardHeader className='pb-4'>
            <div className='flex items-center gap-3'>
              <div className='bg-primary/10 flex h-9 w-9 items-center justify-center rounded-lg'>
                <IconChartBar className='text-primary h-5 w-5' />
              </div>
              <div>
                <CardTitle className='text-base'>
                  Review Cycle Progress
                </CardTitle>
                <CardDescription className='text-xs'>
                  {cycle.name}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className='space-y-4 pt-0'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between text-sm'>
                <span className='text-muted-foreground'>Completion</span>
                <span className='font-semibold'>{cycleProgress}%</span>
              </div>
              <Progress value={cycleProgress} className='h-2.5' />
            </div>

            <div className='grid grid-cols-2 gap-3 pt-2'>
              <div className='rounded-lg border p-3 text-center'>
                <p className='text-2xl font-bold text-green-600 dark:text-green-400'>
                  {cycle.completedReviews}
                </p>
                <p className='text-muted-foreground mt-0.5 text-[10px] tracking-wider uppercase'>
                  Completed
                </p>
              </div>
              <div className='rounded-lg border p-3 text-center'>
                <p className='text-2xl font-bold'>
                  {cycle.totalReviews - cycle.completedReviews}
                </p>
                <p className='text-muted-foreground mt-0.5 text-[10px] tracking-wider uppercase'>
                  Remaining
                </p>
              </div>
            </div>

            <Separator />

            <div className='text-muted-foreground flex items-center justify-between text-xs'>
              <span>Started: {format(cycle.startDate, 'MMM d, yyyy')}</span>
              <span>Ends: {format(cycle.endDate, 'MMM d, yyyy')}</span>
            </div>
          </CardContent>
        </Card>

        {/* Upcoming Reviews */}
        <Card className='lg:col-span-3'>
          <CardHeader className='pb-4'>
            <div className='flex items-center gap-3'>
              <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10'>
                <IconCalendarDue className='h-5 w-5 text-violet-500' />
              </div>
              <div>
                <CardTitle className='text-base'>Upcoming Reviews</CardTitle>
                <CardDescription className='text-xs'>
                  Next 5 scheduled reviews
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className='pt-0'>
            <div className='space-y-1'>
              {upcomingReviews.map((review, idx) => (
                <div key={review.id}>
                  <div className='hover:bg-muted/50 flex items-center gap-4 rounded-lg px-2 py-3 transition-colors'>
                    {/* Avatar */}
                    <div className='bg-primary/10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full'>
                      <IconUser className='text-primary h-4 w-4' />
                    </div>

                    {/* Employee Info */}
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-sm font-medium'>
                        {review.employeeName}
                      </p>
                      <p className='text-muted-foreground truncate text-xs'>
                        {review.employeeRole}
                      </p>
                    </div>

                    {/* Badges */}
                    <div className='hidden items-center gap-1.5 sm:flex'>
                      <Badge
                        variant='outline'
                        className={`h-5 text-[10px] ${getReviewTypeBadge(review.reviewType)}`}
                      >
                        {review.reviewType}
                      </Badge>
                      <Badge
                        variant='outline'
                        className={`h-5 text-[10px] ${getStatusBadgeVariant(review.status)}`}
                      >
                        {review.status}
                      </Badge>
                    </div>

                    {/* Due Date */}
                    <div className='shrink-0 text-right'>
                      <p className='text-xs font-medium'>
                        {format(review.dueDate, 'MMM d')}
                      </p>
                      <p className='text-muted-foreground text-[10px]'>
                        {review.reviewerName}
                      </p>
                    </div>
                  </div>
                  {idx < upcomingReviews.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Average Rating Display */}
      <Card>
        <CardContent className='p-5'>
          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <p className='text-muted-foreground text-sm font-medium'>
                Organization Average Rating
              </p>
              <StarRating rating={4.2} />
            </div>
            <div className='text-muted-foreground flex items-center gap-6 text-sm'>
              <div className='text-center'>
                <p className='text-foreground text-lg font-bold'>48</p>
                <p className='text-[10px] tracking-wider uppercase'>
                  Total Reviews
                </p>
              </div>
              <Separator orientation='vertical' className='h-8' />
              <div className='text-center'>
                <p className='text-foreground text-lg font-bold'>8</p>
                <p className='text-[10px] tracking-wider uppercase'>
                  Reviewers
                </p>
              </div>
              <Separator orientation='vertical' className='h-8' />
              <div className='text-center'>
                <p className='text-foreground text-lg font-bold'>6</p>
                <p className='text-[10px] tracking-wider uppercase'>
                  Departments
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default ReviewsDashboard
