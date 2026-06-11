// Created and developed by Jai Singh
/**
 * Review Templates Component
 * HR Employee Reviews - Template management with cards, detail view, and creation
 */
import { useState } from 'react'
import { format } from 'date-fns'
import {
  IconCalendarEvent,
  IconCategory,
  IconClipboardList,
  IconClock,
  IconEdit,
  IconEye,
  IconFileDescription,
  IconPlus,
  IconScale,
  IconTemplate,
} from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ReviewTemplate {
  id: string
  name: string
  description: string
  type: 'Annual' | 'Quarterly' | '90-Day' | 'Self Assessment'
  categories: TemplateCategory[]
  totalCategories: number
  lastModified: Date
  isActive: boolean
  createdBy: string
}

interface TemplateCategory {
  name: string
  weight: number
  description: string
  ratingCriteria: string[]
}

// ── Mock Data ──────────────────────────────────────────────────────────────────

const mockTemplates: ReviewTemplate[] = [
  {
    id: '1',
    name: 'Annual Performance Review',
    description:
      'Comprehensive annual evaluation covering all performance dimensions for full-time employees. Includes goal setting for the upcoming year.',
    type: 'Annual',
    totalCategories: 5,
    lastModified: new Date('2026-01-15'),
    isActive: true,
    createdBy: 'HR Admin',
    categories: [
      {
        name: 'Job Knowledge',
        weight: 25,
        description:
          'Demonstrates understanding and proficiency in role responsibilities',
        ratingCriteria: [
          'Technical expertise in domain',
          'Stays current with industry trends',
          'Applies knowledge effectively',
          'Shares knowledge with others',
        ],
      },
      {
        name: 'Communication',
        weight: 20,
        description: 'Effectiveness in verbal and written communication',
        ratingCriteria: [
          'Clarity in written communication',
          'Active listening skills',
          'Presentation effectiveness',
          'Cross-team communication',
        ],
      },
      {
        name: 'Teamwork & Collaboration',
        weight: 20,
        description: 'Ability to work effectively with others across teams',
        ratingCriteria: [
          'Cooperates with team members',
          'Supports team goals',
          'Resolves conflicts constructively',
          'Mentors junior members',
        ],
      },
      {
        name: 'Initiative & Innovation',
        weight: 15,
        description:
          'Proactively identifies opportunities and drives improvements',
        ratingCriteria: [
          'Proposes new ideas',
          'Takes ownership of projects',
          'Drives process improvements',
          'Adapts to change positively',
        ],
      },
      {
        name: 'Quality of Work',
        weight: 20,
        description: 'Consistency and accuracy of work output',
        ratingCriteria: [
          'Attention to detail',
          'Meets quality standards',
          'Reliable deliverables',
          'Continuous improvement mindset',
        ],
      },
    ],
  },
  {
    id: '2',
    name: 'Quarterly Check-in',
    description:
      'Lightweight quarterly review focused on goal progress and immediate feedback. Designed for regular performance conversations.',
    type: 'Quarterly',
    totalCategories: 3,
    lastModified: new Date('2026-02-01'),
    isActive: true,
    createdBy: 'HR Admin',
    categories: [
      {
        name: 'Goal Progress',
        weight: 40,
        description: 'Progress toward quarterly and annual goals',
        ratingCriteria: [
          'On track with quarterly goals',
          'Making progress on annual objectives',
          'Adjusting priorities as needed',
        ],
      },
      {
        name: 'Core Competencies',
        weight: 35,
        description: 'Key skills and behaviors for the role',
        ratingCriteria: [
          'Role-specific skills',
          'Problem-solving ability',
          'Time management',
        ],
      },
      {
        name: 'Development Focus',
        weight: 25,
        description: 'Growth areas and professional development',
        ratingCriteria: [
          'Learning new skills',
          'Applying feedback',
          'Career progression',
        ],
      },
    ],
  },
  {
    id: '3',
    name: '90-Day Probationary Review',
    description:
      'New hire evaluation at the 90-day mark to assess role fit, cultural alignment, and performance trajectory. Critical for onboarding success.',
    type: '90-Day',
    totalCategories: 4,
    lastModified: new Date('2025-11-20'),
    isActive: true,
    createdBy: 'HR Admin',
    categories: [
      {
        name: 'Role Competency',
        weight: 30,
        description: 'Ability to perform core job functions',
        ratingCriteria: [
          'Understanding of role requirements',
          'Technical skill demonstration',
          'Task completion quality',
          'Learning pace',
        ],
      },
      {
        name: 'Cultural Fit',
        weight: 25,
        description: 'Alignment with company values and culture',
        ratingCriteria: [
          'Embraces company values',
          'Team integration',
          'Professional conduct',
        ],
      },
      {
        name: 'Communication & Collaboration',
        weight: 25,
        description: 'Ability to communicate and work with the team',
        ratingCriteria: [
          'Asks appropriate questions',
          'Communicates progress clearly',
          'Collaborates effectively',
        ],
      },
      {
        name: 'Potential & Growth',
        weight: 20,
        description: 'Demonstrated potential for growth in the role',
        ratingCriteria: [
          'Eagerness to learn',
          'Receptive to feedback',
          'Initiative in role',
        ],
      },
    ],
  },
  {
    id: '4',
    name: 'Self Assessment',
    description:
      'Employee self-evaluation template for reflecting on personal performance, achievements, and growth areas before formal review meetings.',
    type: 'Self Assessment',
    totalCategories: 4,
    lastModified: new Date('2026-01-05'),
    isActive: true,
    createdBy: 'HR Admin',
    categories: [
      {
        name: 'Achievements & Accomplishments',
        weight: 30,
        description: 'Key accomplishments during the review period',
        ratingCriteria: [
          'Goals met or exceeded',
          'Projects delivered',
          'Impact on team/organization',
          'Awards or recognition received',
        ],
      },
      {
        name: 'Skills & Development',
        weight: 25,
        description: 'Skills developed and training completed',
        ratingCriteria: [
          'New skills acquired',
          'Training/certifications completed',
          'Knowledge sharing',
        ],
      },
      {
        name: 'Challenges & Growth Areas',
        weight: 25,
        description: 'Challenges faced and areas for improvement',
        ratingCriteria: [
          'Obstacles encountered',
          'How challenges were addressed',
          'Areas needing improvement',
        ],
      },
      {
        name: 'Future Goals',
        weight: 20,
        description: 'Goals and aspirations for the next period',
        ratingCriteria: [
          'Professional development goals',
          'Career aspirations',
          'Desired projects or responsibilities',
        ],
      },
    ],
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function getTemplateTypeColor(type: ReviewTemplate['type']) {
  switch (type) {
    case 'Annual':
      return {
        bg: 'bg-purple-500/10',
        text: 'text-purple-600 dark:text-purple-400',
        border: 'border-purple-500/20',
        accent: '#8b5cf6',
      }
    case 'Quarterly':
      return {
        bg: 'bg-cyan-500/10',
        text: 'text-cyan-600 dark:text-cyan-400',
        border: 'border-cyan-500/20',
        accent: '#06b6d4',
      }
    case '90-Day':
      return {
        bg: 'bg-orange-500/10',
        text: 'text-orange-600 dark:text-orange-400',
        border: 'border-orange-500/20',
        accent: '#f97316',
      }
    case 'Self Assessment':
      return {
        bg: 'bg-green-500/10',
        text: 'text-green-600 dark:text-green-400',
        border: 'border-green-500/20',
        accent: '#22c55e',
      }
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

function ReviewTemplates() {
  const [templates] = useState<ReviewTemplate[]>(mockTemplates)
  const [selectedTemplate, setSelectedTemplate] =
    useState<ReviewTemplate | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')
  const [newTemplateDesc, setNewTemplateDesc] = useState('')

  const handleViewTemplate = (template: ReviewTemplate) => {
    setSelectedTemplate(template)
    setDetailOpen(true)
  }

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <div className='bg-primary/10 flex h-9 w-9 items-center justify-center rounded-lg'>
            <IconTemplate className='text-primary h-5 w-5' />
          </div>
          <div>
            <h3 className='text-base font-semibold'>Review Templates</h3>
            <p className='text-muted-foreground text-xs'>
              {templates.length} templates available
            </p>
          </div>
        </div>
        <Button className='h-9 gap-1.5' onClick={() => setCreateOpen(true)}>
          <IconPlus className='h-4 w-4' />
          Create New Template
        </Button>
      </div>

      {/* Template Cards Grid */}
      <div className='grid gap-4 md:grid-cols-2'>
        {templates.map((template) => {
          const colors = getTemplateTypeColor(template.type)
          return (
            <Card
              key={template.id}
              className='group relative overflow-hidden transition-all duration-200 hover:shadow-md'
            >
              {/* Color accent */}
              <div className='h-1' style={{ backgroundColor: colors.accent }} />

              <CardHeader className='pb-3'>
                <div className='flex items-start justify-between'>
                  <div className='flex items-start gap-3'>
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${colors.bg}`}
                    >
                      <IconClipboardList className={`h-5 w-5 ${colors.text}`} />
                    </div>
                    <div className='min-w-0'>
                      <CardTitle className='text-sm font-semibold'>
                        {template.name}
                      </CardTitle>
                      <div className='mt-1 flex items-center gap-1.5'>
                        <Badge
                          variant='outline'
                          className={`h-5 text-[10px] ${colors.bg} ${colors.text} ${colors.border}`}
                        >
                          {template.type}
                        </Badge>
                        {template.isActive && (
                          <Badge
                            variant='outline'
                            className='h-5 border-green-500/20 bg-green-500/10 text-[10px] text-green-600 dark:text-green-400'
                          >
                            Active
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <CardDescription className='mt-2 line-clamp-2 text-xs'>
                  {template.description}
                </CardDescription>
              </CardHeader>

              <CardContent className='space-y-4 pt-0'>
                {/* Meta info */}
                <div className='text-muted-foreground flex items-center gap-4 text-xs'>
                  <span className='flex items-center gap-1'>
                    <IconCategory className='h-3 w-3' />
                    {template.totalCategories} categories
                  </span>
                  <span className='flex items-center gap-1'>
                    <IconClock className='h-3 w-3' />
                    Modified {format(template.lastModified, 'MMM d, yyyy')}
                  </span>
                </div>

                {/* Category weight preview */}
                <div className='space-y-1.5'>
                  {template.categories.slice(0, 3).map((cat) => (
                    <div key={cat.name} className='flex items-center gap-2'>
                      <span className='text-muted-foreground w-28 truncate text-[10px]'>
                        {cat.name}
                      </span>
                      <Progress value={cat.weight} className='h-1 flex-1' />
                      <span className='text-muted-foreground w-8 text-right text-[10px] font-medium'>
                        {cat.weight}%
                      </span>
                    </div>
                  ))}
                  {template.categories.length > 3 && (
                    <p className='text-muted-foreground/60 text-[10px]'>
                      +{template.categories.length - 3} more
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className='flex gap-2 pt-1'>
                  <Button
                    variant='outline'
                    size='sm'
                    className='h-8 flex-1 gap-1.5 text-xs'
                    onClick={() => handleViewTemplate(template)}
                  >
                    <IconEye className='h-3.5 w-3.5' />
                    View Details
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    className='h-8 w-8 p-0'
                    title='Edit template'
                  >
                    <IconEdit className='h-3.5 w-3.5' />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Template Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className='max-h-[90vh] max-w-2xl overflow-y-auto'>
          {selectedTemplate && (
            <>
              <DialogHeader>
                <DialogTitle className='flex items-center gap-2'>
                  <IconFileDescription className='h-5 w-5' />
                  {selectedTemplate.name}
                </DialogTitle>
                <DialogDescription>
                  {selectedTemplate.description}
                </DialogDescription>
              </DialogHeader>

              <div className='space-y-6 py-2'>
                {/* Template Info */}
                <div className='text-muted-foreground flex items-center gap-4 text-sm'>
                  <span className='flex items-center gap-1.5'>
                    <IconCalendarEvent className='h-4 w-4' />
                    {selectedTemplate.type}
                  </span>
                  <Separator orientation='vertical' className='h-4' />
                  <span className='flex items-center gap-1.5'>
                    <IconCategory className='h-4 w-4' />
                    {selectedTemplate.totalCategories} categories
                  </span>
                  <Separator orientation='vertical' className='h-4' />
                  <span>Created by {selectedTemplate.createdBy}</span>
                </div>

                <Separator />

                {/* Categories with Weights */}
                <div className='space-y-4'>
                  <h4 className='flex items-center gap-2 text-sm font-semibold'>
                    <IconScale className='h-4 w-4' />
                    Categories & Weights
                  </h4>
                  {selectedTemplate.categories.map((category, idx) => (
                    <div key={idx} className='space-y-3 rounded-lg border p-4'>
                      <div className='flex items-center justify-between'>
                        <div>
                          <span className='text-sm font-medium'>
                            {category.name}
                          </span>
                          <p className='text-muted-foreground mt-0.5 text-xs'>
                            {category.description}
                          </p>
                        </div>
                        <div className='flex items-center gap-2'>
                          <Progress
                            value={category.weight}
                            className='h-2 w-16'
                          />
                          <Badge
                            variant='outline'
                            className='text-xs font-semibold'
                          >
                            {category.weight}%
                          </Badge>
                        </div>
                      </div>

                      {category.ratingCriteria.length > 0 && (
                        <div className='space-y-1'>
                          <p className='text-muted-foreground text-[10px] font-medium tracking-wider uppercase'>
                            Rating Criteria
                          </p>
                          <ul className='grid grid-cols-2 gap-1'>
                            {category.ratingCriteria.map((criteria, cIdx) => (
                              <li
                                key={cIdx}
                                className='text-muted-foreground flex items-center gap-1.5 text-xs'
                              >
                                <div className='bg-muted-foreground/40 h-1 w-1 shrink-0 rounded-full' />
                                {criteria}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Weight Validation */}
                <div className='bg-muted/50 text-muted-foreground rounded-lg p-3 text-xs'>
                  <strong>Total Weight:</strong>{' '}
                  {selectedTemplate.categories.reduce(
                    (sum, c) => sum + c.weight,
                    0
                  )}
                  %
                  {selectedTemplate.categories.reduce(
                    (sum, c) => sum + c.weight,
                    0
                  ) === 100 ? (
                    <span className='ml-2 text-green-600 dark:text-green-400'>
                      &#10003; Valid
                    </span>
                  ) : (
                    <span className='ml-2 text-red-600 dark:text-red-400'>
                      &#10007; Must equal 100%
                    </span>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant='outline' onClick={() => setDetailOpen(false)}>
                  Close
                </Button>
                <Button className='gap-1.5'>
                  <IconEdit className='h-4 w-4' />
                  Edit Template
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Template Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <IconPlus className='h-5 w-5' />
              Create New Template
            </DialogTitle>
            <DialogDescription>
              Create a new review template. You can add categories and configure
              weights after creation.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-4 py-2'>
            <div className='space-y-2'>
              <Label htmlFor='template-name'>Template Name *</Label>
              <Input
                id='template-name'
                placeholder='e.g., Leadership 360 Review'
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='template-desc'>Description</Label>
              <Textarea
                id='template-desc'
                placeholder='Describe the purpose and scope of this review template...'
                value={newTemplateDesc}
                onChange={(e) => setNewTemplateDesc(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant='outline' onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newTemplateName.trim()}
              onClick={() => {
                setCreateOpen(false)
                setNewTemplateName('')
                setNewTemplateDesc('')
              }}
            >
              Create Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ReviewTemplates

// Created and developed by Jai Singh
