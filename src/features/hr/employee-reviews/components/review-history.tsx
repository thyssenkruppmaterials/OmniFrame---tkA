/**
 * Review History Component
 * HR Employee Reviews - Completed reviews archive with search, date filter, and detail view
 */
import { useState } from 'react'
import { format } from 'date-fns'
import {
  IconCalendarStats,
  IconEye,
  IconFileDescription,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconUser,
  IconX,
} from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ── Types ──────────────────────────────────────────────────────────────────────

interface CompletedReview {
  id: string
  employeeName: string
  employeeRole: string
  department: string
  reviewerName: string
  reviewType: 'Annual' | 'Quarterly' | '90-Day' | 'Self Assessment'
  period: string
  overallRating: number
  status: 'Completed' | 'Acknowledged'
  completedDate: Date
  categories: ReviewCategoryResult[]
  strengths: string
  areasForImprovement: string
  goals: string
  employeeComments: string
}

interface ReviewCategoryResult {
  name: string
  rating: number
  weight: number
  comments: string
}

// ── Mock Data ──────────────────────────────────────────────────────────────────

const mockCompletedReviews: CompletedReview[] = [
  {
    id: '1',
    employeeName: 'Sarah Johnson',
    employeeRole: 'Senior Engineer',
    department: 'Engineering',
    reviewerName: 'Michael Chen',
    reviewType: 'Annual',
    period: 'FY 2025',
    overallRating: 4,
    status: 'Acknowledged',
    completedDate: new Date('2025-12-20'),
    categories: [
      {
        name: 'Job Knowledge',
        rating: 5,
        weight: 25,
        comments: 'Exceptional technical expertise.',
      },
      {
        name: 'Communication',
        rating: 4,
        weight: 20,
        comments: 'Clear and effective communicator.',
      },
      {
        name: 'Teamwork',
        rating: 4,
        weight: 20,
        comments: 'Strong collaborative skills.',
      },
      {
        name: 'Initiative',
        rating: 3,
        weight: 15,
        comments: 'Takes on new challenges willingly.',
      },
      {
        name: 'Quality of Work',
        rating: 4,
        weight: 20,
        comments: 'Consistently delivers quality output.',
      },
    ],
    strengths:
      'Exceptional technical depth. Led the migration project successfully. Mentored 3 junior engineers.',
    areasForImprovement:
      'Could improve public speaking skills for tech talks. Should delegate more to grow team capabilities.',
    goals:
      'Lead a cross-team initiative. Present at an external conference. Grow the infra team by 2 engineers.',
    employeeComments:
      'I appreciate the constructive feedback and agree with the assessment. Looking forward to working on the cross-team initiative.',
  },
  {
    id: '2',
    employeeName: 'David Martinez',
    employeeRole: 'Product Manager',
    department: 'Product',
    reviewerName: 'Lisa Wang',
    reviewType: 'Quarterly',
    period: 'Q4 2025',
    overallRating: 4,
    status: 'Acknowledged',
    completedDate: new Date('2026-01-10'),
    categories: [
      {
        name: 'Strategic Thinking',
        rating: 4,
        weight: 25,
        comments: 'Strong product vision alignment.',
      },
      {
        name: 'Stakeholder Management',
        rating: 5,
        weight: 20,
        comments: 'Excellent stakeholder communication.',
      },
      {
        name: 'Execution',
        rating: 4,
        weight: 25,
        comments: 'Delivered on key milestones.',
      },
      {
        name: 'Communication',
        rating: 4,
        weight: 15,
        comments: 'Clear roadmap presentations.',
      },
      {
        name: 'Leadership',
        rating: 3,
        weight: 15,
        comments: 'Growing leadership presence.',
      },
    ],
    strengths:
      'Strong product sense and data-driven decision making. Excellent stakeholder relationships.',
    areasForImprovement:
      'Should focus on developing leadership skills for team growth. More emphasis on competitive analysis.',
    goals: 'Launch the enterprise feature set. Improve NPS score by 10 points.',
    employeeComments:
      'Great quarter overall. I want to focus more on leadership development next quarter.',
  },
  {
    id: '3',
    employeeName: 'Jennifer Lee',
    employeeRole: 'Marketing Specialist',
    department: 'Marketing',
    reviewerName: 'Robert Kim',
    reviewType: 'Annual',
    period: 'FY 2025',
    overallRating: 5,
    status: 'Completed',
    completedDate: new Date('2025-12-18'),
    categories: [
      {
        name: 'Creativity',
        rating: 5,
        weight: 25,
        comments: 'Outstanding creative campaigns.',
      },
      {
        name: 'Analytical Skills',
        rating: 5,
        weight: 20,
        comments: 'Data-driven marketing approach.',
      },
      {
        name: 'Project Management',
        rating: 4,
        weight: 20,
        comments: 'Well-organized campaign execution.',
      },
      {
        name: 'Communication',
        rating: 5,
        weight: 20,
        comments: 'Compelling storytelling abilities.',
      },
      {
        name: 'Initiative',
        rating: 5,
        weight: 15,
        comments: 'Proactively identifies opportunities.',
      },
    ],
    strengths:
      'Exceptional creativity and campaign execution. Drove 40% increase in lead generation. Pioneered social media strategy.',
    areasForImprovement:
      'Could mentor others to spread campaign knowledge. Consider exploring new marketing channels.',
    goals:
      'Lead brand refresh initiative. Establish a content marketing program. Train 2 team members on campaign analytics.',
    employeeComments: '',
  },
  {
    id: '4',
    employeeName: 'Alex Thompson',
    employeeRole: 'DevOps Engineer',
    department: 'Engineering',
    reviewerName: 'Michael Chen',
    reviewType: '90-Day',
    period: 'Probation',
    overallRating: 3,
    status: 'Acknowledged',
    completedDate: new Date('2025-11-15'),
    categories: [
      {
        name: 'Technical Skills',
        rating: 4,
        weight: 25,
        comments: 'Strong Kubernetes and CI/CD knowledge.',
      },
      {
        name: 'Problem Solving',
        rating: 3,
        weight: 25,
        comments: 'Good troubleshooting, improving root cause analysis.',
      },
      {
        name: 'Reliability',
        rating: 3,
        weight: 20,
        comments: 'Meets expectations, still ramping up.',
      },
      {
        name: 'Communication',
        rating: 3,
        weight: 15,
        comments: 'Clear in written docs, improving verbal.',
      },
      {
        name: 'Innovation',
        rating: 2,
        weight: 15,
        comments: 'Should suggest more improvements.',
      },
    ],
    strengths:
      'Strong foundational skills in cloud infrastructure. Quick learner with Kubernetes ecosystem.',
    areasForImprovement:
      'Needs to improve incident response communication. Should propose infrastructure improvements more proactively.',
    goals:
      'Achieve on-call certification. Automate 3 manual deployment processes. Reduce deployment failure rate by 20%.',
    employeeComments:
      'Thank you for the feedback. I will focus on improving my incident response skills.',
  },
  {
    id: '5',
    employeeName: 'Maria Garcia',
    employeeRole: 'QA Lead',
    department: 'Engineering',
    reviewerName: 'Lisa Wang',
    reviewType: 'Quarterly',
    period: 'Q3 2025',
    overallRating: 4,
    status: 'Completed',
    completedDate: new Date('2025-10-05'),
    categories: [
      {
        name: 'Testing Expertise',
        rating: 5,
        weight: 30,
        comments: 'Industry-leading testing practices.',
      },
      {
        name: 'Leadership',
        rating: 4,
        weight: 25,
        comments: 'Strong team leadership.',
      },
      {
        name: 'Communication',
        rating: 4,
        weight: 20,
        comments: 'Clear bug reports and status updates.',
      },
      {
        name: 'Process Improvement',
        rating: 3,
        weight: 15,
        comments: 'Good CI improvements.',
      },
      {
        name: 'Technical Growth',
        rating: 4,
        weight: 10,
        comments: 'Learning automation frameworks.',
      },
    ],
    strengths:
      'Excellent test coverage strategy. Reduced production bugs by 35%. Mentored 2 junior QA engineers.',
    areasForImprovement:
      'Should explore more performance testing. Could improve test automation pipeline speed.',
    goals:
      'Implement automated performance testing suite. Achieve 90% automated test coverage. Hire and onboard 1 QA engineer.',
    employeeComments:
      'Glad to see the team improvements recognized. Will focus on performance testing next quarter.',
  },
  {
    id: '6',
    employeeName: 'Chris Anderson',
    employeeRole: 'Frontend Developer',
    department: 'Engineering',
    reviewerName: 'James Wilson',
    reviewType: 'Annual',
    period: 'FY 2025',
    overallRating: 4,
    status: 'Acknowledged',
    completedDate: new Date('2025-12-22'),
    categories: [
      {
        name: 'Technical Skills',
        rating: 4,
        weight: 25,
        comments: 'Strong React and TypeScript skills.',
      },
      {
        name: 'UI/UX Sensibility',
        rating: 5,
        weight: 20,
        comments: 'Excellent eye for design details.',
      },
      {
        name: 'Performance',
        rating: 4,
        weight: 20,
        comments: 'Optimized key pages significantly.',
      },
      {
        name: 'Collaboration',
        rating: 4,
        weight: 20,
        comments: 'Works well with design and backend.',
      },
      {
        name: 'Documentation',
        rating: 3,
        weight: 15,
        comments: 'Good but could be more thorough.',
      },
    ],
    strengths:
      'Exceptional frontend craftsmanship. Led design system adoption. Reduced page load times by 40%.',
    areasForImprovement:
      'Should improve documentation practices. Could take on more backend tasks for full-stack growth.',
    goals:
      'Complete design system v2. Improve Lighthouse scores to 95+. Lead the accessibility audit initiative.',
    employeeComments:
      'Thanks for the thorough review. Excited about the design system v2 project.',
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className='flex items-center gap-0.5'>
      {Array.from({ length: 5 }, (_, i) =>
        i < rating ? (
          <IconStarFilled key={i} className='h-3.5 w-3.5 text-amber-500' />
        ) : (
          <IconStar key={i} className='text-muted-foreground/30 h-3.5 w-3.5' />
        )
      )}
    </div>
  )
}

function getReviewTypeBadge(type: CompletedReview['reviewType']) {
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

function getStatusBadge(status: CompletedReview['status']) {
  switch (status) {
    case 'Completed':
      return 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20'
    case 'Acknowledged':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

function ReviewHistory() {
  const [reviews] = useState<CompletedReview[]>(mockCompletedReviews)
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedReview, setSelectedReview] = useState<CompletedReview | null>(
    null
  )
  const [detailOpen, setDetailOpen] = useState(false)

  // Filter reviews
  const filteredReviews = reviews.filter((review) => {
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const matchesSearch =
        review.employeeName.toLowerCase().includes(q) ||
        review.department.toLowerCase().includes(q) ||
        review.reviewerName.toLowerCase().includes(q) ||
        review.employeeRole.toLowerCase().includes(q)
      if (!matchesSearch) return false
    }

    // Date range filter
    if (dateFrom) {
      const fromDate = new Date(dateFrom)
      if (review.completedDate < fromDate) return false
    }
    if (dateTo) {
      const toDate = new Date(dateTo)
      toDate.setHours(23, 59, 59, 999)
      if (review.completedDate > toDate) return false
    }

    return true
  })

  const handleViewReview = (review: CompletedReview) => {
    setSelectedReview(review)
    setDetailOpen(true)
  }

  const clearFilters = () => {
    setSearchQuery('')
    setDateFrom('')
    setDateTo('')
  }

  const hasFilters = searchQuery || dateFrom || dateTo

  return (
    <div className='space-y-6'>
      {/* Header & Filters */}
      <Card>
        <CardContent className='p-4'>
          <div className='flex flex-wrap items-end gap-3'>
            {/* Search */}
            <div className='min-w-[250px] flex-1'>
              <Label className='text-muted-foreground mb-1.5 block text-xs'>
                Search
              </Label>
              <div className='relative'>
                <IconSearch className='text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2' />
                <Input
                  placeholder='Search by employee name...'
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className='h-9 pl-9'
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className='absolute top-1/2 right-2.5 -translate-y-1/2'
                  >
                    <IconX className='text-muted-foreground hover:text-foreground h-3.5 w-3.5' />
                  </button>
                )}
              </div>
            </div>

            {/* Date From */}
            <div className='w-[160px]'>
              <Label className='text-muted-foreground mb-1.5 block text-xs'>
                From
              </Label>
              <Input
                type='date'
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className='h-9'
              />
            </div>

            {/* Date To */}
            <div className='w-[160px]'>
              <Label className='text-muted-foreground mb-1.5 block text-xs'>
                To
              </Label>
              <Input
                type='date'
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className='h-9'
              />
            </div>

            {hasFilters && (
              <Button
                variant='ghost'
                size='sm'
                className='h-9 text-xs'
                onClick={clearFilters}
              >
                <IconX className='mr-1 h-3.5 w-3.5' />
                Clear
              </Button>
            )}

            <div className='text-muted-foreground self-end pb-2 text-xs'>
              {filteredReviews.length} of {reviews.length} reviews
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reviews Table */}
      <Card>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='text-xs'>Employee</TableHead>
                <TableHead className='text-xs'>Reviewer</TableHead>
                <TableHead className='text-xs'>Type</TableHead>
                <TableHead className='text-xs'>Period</TableHead>
                <TableHead className='text-xs'>Overall Rating</TableHead>
                <TableHead className='text-xs'>Status</TableHead>
                <TableHead className='text-xs'>Completed</TableHead>
                <TableHead className='text-right text-xs'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReviews.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className='text-muted-foreground py-8 text-center'
                  >
                    No completed reviews match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredReviews.map((review) => (
                  <TableRow key={review.id} className='group'>
                    <TableCell>
                      <div className='flex items-center gap-2.5'>
                        <div className='bg-primary/10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full'>
                          <IconUser className='text-primary h-4 w-4' />
                        </div>
                        <div className='min-w-0'>
                          <p className='truncate text-sm font-medium'>
                            {review.employeeName}
                          </p>
                          <p className='text-muted-foreground truncate text-[10px]'>
                            {review.employeeRole} &middot; {review.department}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className='text-sm'>
                      {review.reviewerName}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant='outline'
                        className={`h-5 text-[10px] ${getReviewTypeBadge(review.reviewType)}`}
                      >
                        {review.reviewType}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-muted-foreground text-sm'>
                      {review.period}
                    </TableCell>
                    <TableCell>
                      <StarDisplay rating={review.overallRating} />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant='outline'
                        className={`h-5 text-[10px] ${getStatusBadge(review.status)}`}
                      >
                        {review.status}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-sm'>
                      {format(review.completedDate, 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell className='text-right'>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 gap-1 text-xs'
                        onClick={() => handleViewReview(review)}
                      >
                        <IconEye className='h-3.5 w-3.5' />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Review Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className='max-h-[90vh] max-w-3xl overflow-y-auto'>
          {selectedReview && (
            <>
              <DialogHeader>
                <DialogTitle className='flex items-center gap-2'>
                  <IconFileDescription className='h-5 w-5' />
                  {selectedReview.reviewType} Review —{' '}
                  {selectedReview.employeeName}
                </DialogTitle>
                <DialogDescription>
                  {selectedReview.period} &middot; Reviewed by{' '}
                  {selectedReview.reviewerName} &middot; Completed{' '}
                  {format(selectedReview.completedDate, 'MMMM d, yyyy')}
                </DialogDescription>
              </DialogHeader>

              <div className='space-y-6 py-2'>
                {/* Overall Rating */}
                <div className='bg-muted/30 flex items-center gap-4 rounded-lg border p-4'>
                  <div>
                    <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                      Overall Rating
                    </p>
                    <div className='mt-1 flex items-center gap-2'>
                      <StarDisplay rating={selectedReview.overallRating} />
                      <span className='text-lg font-bold'>
                        {selectedReview.overallRating}/5
                      </span>
                    </div>
                  </div>
                  <Separator orientation='vertical' className='h-10' />
                  <div>
                    <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                      Status
                    </p>
                    <Badge
                      variant='outline'
                      className={`mt-1 text-xs ${getStatusBadge(selectedReview.status)}`}
                    >
                      {selectedReview.status}
                    </Badge>
                  </div>
                </div>

                {/* Categories */}
                <div className='space-y-3'>
                  <h4 className='text-sm font-semibold'>
                    Performance Categories
                  </h4>
                  {selectedReview.categories.map((category, idx) => (
                    <div
                      key={idx}
                      className='flex items-start justify-between rounded-lg border p-3'
                    >
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>
                            {category.name}
                          </span>
                          <span className='text-muted-foreground text-[10px]'>
                            ({category.weight}%)
                          </span>
                        </div>
                        {category.comments && (
                          <p className='text-muted-foreground mt-1 text-xs'>
                            {category.comments}
                          </p>
                        )}
                      </div>
                      <StarDisplay rating={category.rating} />
                    </div>
                  ))}
                </div>

                <Separator />

                {/* Written Sections */}
                {selectedReview.strengths && (
                  <div className='space-y-1.5'>
                    <h4 className='text-sm font-semibold'>Key Strengths</h4>
                    <p className='text-muted-foreground text-sm'>
                      {selectedReview.strengths}
                    </p>
                  </div>
                )}

                {selectedReview.areasForImprovement && (
                  <div className='space-y-1.5'>
                    <h4 className='text-sm font-semibold'>
                      Areas for Improvement
                    </h4>
                    <p className='text-muted-foreground text-sm'>
                      {selectedReview.areasForImprovement}
                    </p>
                  </div>
                )}

                {selectedReview.goals && (
                  <div className='space-y-1.5'>
                    <h4 className='text-sm font-semibold'>
                      Goals & Objectives
                    </h4>
                    <p className='text-muted-foreground text-sm'>
                      {selectedReview.goals}
                    </p>
                  </div>
                )}

                {selectedReview.employeeComments && (
                  <>
                    <Separator />
                    <div className='space-y-1.5'>
                      <h4 className='flex items-center gap-2 text-sm font-semibold'>
                        <IconCalendarStats className='h-4 w-4' />
                        Employee Comments
                      </h4>
                      <p className='text-muted-foreground text-sm italic'>
                        &ldquo;{selectedReview.employeeComments}&rdquo;
                      </p>
                    </div>
                  </>
                )}
              </div>

              <DialogFooter>
                <Button variant='outline' onClick={() => setDetailOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ReviewHistory
