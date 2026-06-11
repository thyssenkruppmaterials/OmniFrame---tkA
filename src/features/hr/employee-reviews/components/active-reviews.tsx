// Created and developed by Jai Singh
/**
 * Active Reviews Component
 * HR Employee Reviews - Active review management with filters, table, and detail dialog
 */
import { useState } from 'react'
import { format } from 'date-fns'
import {
  IconArrowRight,
  IconClipboardCheck,
  IconEye,
  IconFilter,
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
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ActiveReview {
  id: string
  employeeName: string
  employeeRole: string
  department: string
  reviewerName: string
  reviewType: 'Annual' | 'Quarterly' | '90-Day' | 'Self Assessment'
  status: 'Draft' | 'In Progress'
  dueDate: Date
  progress: number
  categories: ReviewCategory[]
  strengths: string
  areasForImprovement: string
  goals: string
}

interface ReviewCategory {
  name: string
  rating: number
  weight: number
  comments: string
}

// ── Mock Data ──────────────────────────────────────────────────────────────────

const mockActiveReviews: ActiveReview[] = [
  {
    id: '1',
    employeeName: 'Sarah Johnson',
    employeeRole: 'Senior Engineer',
    department: 'Engineering',
    reviewerName: 'Michael Chen',
    reviewType: 'Annual',
    status: 'In Progress',
    dueDate: new Date('2026-02-28'),
    progress: 65,
    categories: [
      {
        name: 'Job Knowledge',
        rating: 4,
        weight: 25,
        comments: 'Excellent technical depth and breadth.',
      },
      {
        name: 'Communication',
        rating: 4,
        weight: 20,
        comments: 'Communicates clearly in meetings and documentation.',
      },
      {
        name: 'Teamwork',
        rating: 5,
        weight: 20,
        comments: 'Outstanding team player, mentors junior members.',
      },
      {
        name: 'Initiative',
        rating: 3,
        weight: 15,
        comments: 'Good initiative, room for more proactive proposals.',
      },
      {
        name: 'Quality of Work',
        rating: 4,
        weight: 20,
        comments: 'Consistently delivers high-quality code.',
      },
    ],
    strengths:
      'Deep technical expertise in distributed systems. Excellent mentor to junior engineers. Consistently delivers reliable, well-tested code.',
    areasForImprovement:
      'Could take more initiative in proposing architectural improvements. Should consider presenting at team tech talks more frequently.',
    goals:
      'Lead the migration of the payment service to microservices architecture. Mentor at least 2 junior engineers through the quarter.',
  },
  {
    id: '2',
    employeeName: 'David Martinez',
    employeeRole: 'Product Manager',
    department: 'Product',
    reviewerName: 'Lisa Wang',
    reviewType: 'Quarterly',
    status: 'Draft',
    dueDate: new Date('2026-03-15'),
    progress: 20,
    categories: [
      { name: 'Strategic Thinking', rating: 0, weight: 25, comments: '' },
      { name: 'Stakeholder Management', rating: 0, weight: 20, comments: '' },
      {
        name: 'Execution',
        rating: 3,
        weight: 25,
        comments: 'On track with deliverables.',
      },
      { name: 'Communication', rating: 0, weight: 15, comments: '' },
      { name: 'Leadership', rating: 0, weight: 15, comments: '' },
    ],
    strengths: '',
    areasForImprovement: '',
    goals: '',
  },
  {
    id: '3',
    employeeName: 'Emily Roberts',
    employeeRole: 'UX Designer',
    department: 'Design',
    reviewerName: 'James Wilson',
    reviewType: '90-Day',
    status: 'In Progress',
    dueDate: new Date('2026-02-20'),
    progress: 80,
    categories: [
      {
        name: 'Design Skills',
        rating: 5,
        weight: 30,
        comments: 'Exceptional visual and interaction design.',
      },
      {
        name: 'User Research',
        rating: 4,
        weight: 25,
        comments: 'Thorough research practices.',
      },
      {
        name: 'Collaboration',
        rating: 4,
        weight: 20,
        comments: 'Works well with engineering and product.',
      },
      {
        name: 'Communication',
        rating: 4,
        weight: 15,
        comments: 'Presents design rationale clearly.',
      },
      {
        name: 'Adaptability',
        rating: 5,
        weight: 10,
        comments: 'Quick to adapt to new tools and processes.',
      },
    ],
    strengths:
      'Exceptional design sensibility and attention to detail. Quickly ramped up on the design system and contributed meaningful improvements.',
    areasForImprovement:
      'Could improve time estimation for complex design projects. Should explore more quantitative user research methods.',
    goals:
      'Complete the checkout redesign project. Establish a user testing cadence with at least 2 sessions per sprint.',
  },
  {
    id: '4',
    employeeName: 'Alex Thompson',
    employeeRole: 'DevOps Engineer',
    department: 'Engineering',
    reviewerName: 'Michael Chen',
    reviewType: 'Annual',
    status: 'Draft',
    dueDate: new Date('2026-03-10'),
    progress: 10,
    categories: [
      { name: 'Technical Skills', rating: 0, weight: 25, comments: '' },
      { name: 'Problem Solving', rating: 0, weight: 25, comments: '' },
      { name: 'Reliability', rating: 0, weight: 20, comments: '' },
      { name: 'Communication', rating: 0, weight: 15, comments: '' },
      { name: 'Innovation', rating: 0, weight: 15, comments: '' },
    ],
    strengths: '',
    areasForImprovement: '',
    goals: '',
  },
  {
    id: '5',
    employeeName: 'Maria Garcia',
    employeeRole: 'QA Lead',
    department: 'Engineering',
    reviewerName: 'Lisa Wang',
    reviewType: 'Quarterly',
    status: 'In Progress',
    dueDate: new Date('2026-02-25'),
    progress: 45,
    categories: [
      {
        name: 'Testing Expertise',
        rating: 4,
        weight: 30,
        comments: 'Strong testing methodology.',
      },
      {
        name: 'Leadership',
        rating: 3,
        weight: 25,
        comments: 'Growing into the lead role well.',
      },
      { name: 'Communication', rating: 4, weight: 20, comments: '' },
      { name: 'Process Improvement', rating: 0, weight: 15, comments: '' },
      { name: 'Technical Growth', rating: 0, weight: 10, comments: '' },
    ],
    strengths:
      'Strong attention to detail and thorough test coverage approach.',
    areasForImprovement: '',
    goals: '',
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function getStatusBadge(status: ActiveReview['status']) {
  switch (status) {
    case 'Draft':
      return 'bg-muted text-muted-foreground'
    case 'In Progress':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
  }
}

function getReviewTypeBadge(type: ActiveReview['reviewType']) {
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

function InteractiveStarRating({
  rating,
  onChange,
  readonly = false,
}: {
  rating: number
  onChange?: (rating: number) => void
  readonly?: boolean
}) {
  return (
    <div className='flex items-center gap-0.5'>
      {Array.from({ length: 5 }, (_, i) => {
        const filled = i < rating
        return (
          <button
            key={i}
            type='button'
            disabled={readonly}
            onClick={() => onChange?.(i + 1)}
            className={`${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'} transition-transform`}
          >
            {filled ? (
              <IconStarFilled className='h-5 w-5 text-amber-500' />
            ) : (
              <IconStar className='text-muted-foreground/30 h-5 w-5' />
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

function ActiveReviews() {
  const [reviews] = useState<ActiveReview[]>(mockActiveReviews)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [reviewerFilter, setReviewerFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedReview, setSelectedReview] = useState<ActiveReview | null>(
    null
  )
  const [detailOpen, setDetailOpen] = useState(false)

  // Get unique reviewers
  const reviewers = [...new Set(reviews.map((r) => r.reviewerName))].sort()

  // Filter reviews
  const filteredReviews = reviews.filter((review) => {
    if (statusFilter !== 'all' && review.status !== statusFilter) return false
    if (reviewerFilter !== 'all' && review.reviewerName !== reviewerFilter)
      return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      return (
        review.employeeName.toLowerCase().includes(q) ||
        review.department.toLowerCase().includes(q) ||
        review.employeeRole.toLowerCase().includes(q)
      )
    }
    return true
  })

  const handleViewDetails = (review: ActiveReview) => {
    setSelectedReview(review)
    setDetailOpen(true)
  }

  return (
    <div className='space-y-6'>
      {/* Filter Bar */}
      <Card>
        <CardContent className='p-4'>
          <div className='flex flex-wrap items-center gap-3'>
            <div className='text-muted-foreground flex items-center gap-2 text-sm'>
              <IconFilter className='h-4 w-4' />
              <span className='font-medium'>Filters</span>
            </div>

            <Separator orientation='vertical' className='h-6' />

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className='h-9 w-[150px]'>
                <SelectValue placeholder='Status' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All Statuses</SelectItem>
                <SelectItem value='Draft'>Draft</SelectItem>
                <SelectItem value='In Progress'>In Progress</SelectItem>
              </SelectContent>
            </Select>

            <Select value={reviewerFilter} onValueChange={setReviewerFilter}>
              <SelectTrigger className='h-9 w-[170px]'>
                <SelectValue placeholder='Reviewer' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All Reviewers</SelectItem>
                {reviewers.map((reviewer) => (
                  <SelectItem key={reviewer} value={reviewer}>
                    {reviewer}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className='relative min-w-[200px] flex-1'>
              <IconSearch className='text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2' />
              <Input
                placeholder='Search by employee, department...'
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

            <div className='text-muted-foreground text-xs'>
              {filteredReviews.length} review
              {filteredReviews.length !== 1 ? 's' : ''}
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
                <TableHead className='text-xs'>Status</TableHead>
                <TableHead className='text-xs'>Due Date</TableHead>
                <TableHead className='w-32 text-xs'>Progress</TableHead>
                <TableHead className='text-right text-xs'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReviews.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className='text-muted-foreground py-8 text-center'
                  >
                    No active reviews match the current filters.
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
                    <TableCell>
                      <Badge
                        variant='outline'
                        className={`h-5 gap-1 text-[10px] ${getStatusBadge(review.status)}`}
                      >
                        <div
                          className={`h-1.5 w-1.5 rounded-full ${review.status === 'In Progress' ? 'bg-blue-500' : 'bg-gray-400'}`}
                        />
                        {review.status}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-sm'>
                      {format(review.dueDate, 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        <Progress
                          value={review.progress}
                          className='h-1.5 flex-1'
                        />
                        <span className='text-muted-foreground w-8 text-right text-[10px] font-medium'>
                          {review.progress}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className='text-right'>
                      <div className='flex items-center justify-end gap-1'>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-7 gap-1 text-xs'
                          onClick={() => handleViewDetails(review)}
                        >
                          {review.status === 'Draft' ? (
                            <>
                              <IconArrowRight className='h-3.5 w-3.5' />
                              Continue
                            </>
                          ) : (
                            <>
                              <IconEye className='h-3.5 w-3.5' />
                              View
                            </>
                          )}
                        </Button>
                      </div>
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
                  <IconClipboardCheck className='h-5 w-5' />
                  {selectedReview.reviewType} Review —{' '}
                  {selectedReview.employeeName}
                </DialogTitle>
                <DialogDescription>
                  Reviewer: {selectedReview.reviewerName} &middot; Due:{' '}
                  {format(selectedReview.dueDate, 'MMMM d, yyyy')}
                </DialogDescription>
              </DialogHeader>

              <div className='space-y-6 py-2'>
                {/* Progress */}
                <div className='space-y-2'>
                  <div className='flex items-center justify-between text-sm'>
                    <span className='text-muted-foreground'>
                      Overall Progress
                    </span>
                    <span className='font-semibold'>
                      {selectedReview.progress}%
                    </span>
                  </div>
                  <Progress value={selectedReview.progress} className='h-2' />
                </div>

                <Separator />

                {/* Rating Categories */}
                <div className='space-y-4'>
                  <h4 className='text-sm font-semibold'>
                    Performance Categories
                  </h4>
                  {selectedReview.categories.map((category, idx) => (
                    <div key={idx} className='space-y-2 rounded-lg border p-3'>
                      <div className='flex items-center justify-between'>
                        <div>
                          <span className='text-sm font-medium'>
                            {category.name}
                          </span>
                          <span className='text-muted-foreground ml-2 text-xs'>
                            ({category.weight}%)
                          </span>
                        </div>
                        <InteractiveStarRating
                          rating={category.rating}
                          readonly
                        />
                      </div>
                      {category.comments && (
                        <p className='text-muted-foreground text-xs'>
                          {category.comments}
                        </p>
                      )}
                      {!category.comments && category.rating === 0 && (
                        <p className='text-muted-foreground/50 text-xs italic'>
                          Not yet rated
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                <Separator />

                {/* Strengths */}
                <div className='space-y-2'>
                  <Label className='text-sm font-semibold'>Key Strengths</Label>
                  <Textarea
                    value={selectedReview.strengths}
                    readOnly
                    placeholder='No strengths documented yet...'
                    rows={3}
                    className='resize-none text-sm'
                  />
                </div>

                {/* Areas for Improvement */}
                <div className='space-y-2'>
                  <Label className='text-sm font-semibold'>
                    Areas for Improvement
                  </Label>
                  <Textarea
                    value={selectedReview.areasForImprovement}
                    readOnly
                    placeholder='No areas for improvement documented yet...'
                    rows={3}
                    className='resize-none text-sm'
                  />
                </div>

                {/* Goals */}
                <div className='space-y-2'>
                  <Label className='text-sm font-semibold'>
                    Goals & Objectives
                  </Label>
                  <Textarea
                    value={selectedReview.goals}
                    readOnly
                    placeholder='No goals set yet...'
                    rows={3}
                    className='resize-none text-sm'
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant='outline' onClick={() => setDetailOpen(false)}>
                  Close
                </Button>
                <Button className='gap-1.5'>
                  <IconClipboardCheck className='h-4 w-4' />
                  {selectedReview.status === 'Draft'
                    ? 'Start Review'
                    : 'Continue Review'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ActiveReviews

// Created and developed by Jai Singh
