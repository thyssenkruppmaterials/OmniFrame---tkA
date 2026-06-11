// Created and developed by Jai Singh
/**
 * Standard Work Settings Component
 * Enterprise-grade template management with visual builder and scheduling
 * Updated: February 8, 2026 - Complete UI redesign for modern enterprise experience
 */
import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  FileText,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  Search,
  Target,
  TrendingUp,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, getLocalDateString } from '@/lib/utils'
import { useLaborManagement } from '@/hooks/use-labor-management'
import {
  useStandardWork,
  type StandardWorkTemplate,
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
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { AssignmentPanel } from './assignment-panel'
import { SchedulingPanel } from './scheduling-panel'
import { TemplateBuilder } from './template-builder'
import { TemplateCard } from './templates/template-card'
import { TemplateListRow } from './templates/template-list-row'

const frequencyOptions = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'shift_start', label: 'Shift Start' },
  { value: 'shift_end', label: 'Shift End' },
  { value: 'as_needed', label: 'As Needed' },
]

const statusOptions = [
  {
    value: 'draft',
    label: 'Draft',
    color: 'bg-muted-foreground/60',
    text: 'text-muted-foreground',
  },
  {
    value: 'active',
    label: 'Active',
    color: 'bg-green-500',
    text: 'text-green-600 dark:text-green-400',
  },
  {
    value: 'archived',
    label: 'Archived',
    color: 'bg-yellow-500',
    text: 'text-yellow-600 dark:text-yellow-400',
  },
]

const colorOptions = [
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#6366f1',
  '#f43f5e',
  '#84cc16',
]

// Template Form Dialog
function TemplateFormDialog({
  open,
  onOpenChange,
  template,
  onSave,
  isSaving,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  template?: StandardWorkTemplate | null
  onSave: (data: Partial<StandardWorkTemplate>) => void
  isSaving: boolean
}) {
  const { workingAreas } = useLaborManagement()
  const [formData, setFormData] = useState<Partial<StandardWorkTemplate>>({
    template_name: '',
    template_code: '',
    description: '',
    working_area_id: '',
    frequency: 'daily',
    estimated_duration_minutes: 15,
    status: 'draft',
    instructions: '',
    color: '#3b82f6',
  })

  useEffect(() => {
    if (template) {
      setFormData({
        template_name: template.template_name,
        template_code: template.template_code || '',
        description: template.description || '',
        working_area_id: template.working_area_id || '',
        frequency: template.frequency,
        estimated_duration_minutes: template.estimated_duration_minutes,
        status: template.status,
        instructions: template.instructions || '',
        color: template.color,
      })
    } else {
      setFormData({
        template_name: '',
        template_code: '',
        description: '',
        working_area_id: '',
        frequency: 'daily',
        estimated_duration_minutes: 15,
        status: 'draft',
        instructions: '',
        color: '#3b82f6',
      })
    }
  }, [template, open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.template_name?.trim()) {
      toast.error('Template name is required')
      return
    }
    onSave(formData)
  }

  const activeAreas = workingAreas.filter((a) => a.is_active)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-2xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>
            {template ? 'Edit Template' : 'Create New Template'}
          </DialogTitle>
          <DialogDescription>
            {template
              ? 'Update the template configuration and settings.'
              : 'Create a new standard work checklist template.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-6'>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='template_name'>Template Name *</Label>
              <Input
                id='template_name'
                value={formData.template_name}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    template_name: e.target.value,
                  }))
                }
                placeholder='e.g., Morning Safety Checklist'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='template_code'>Template Code</Label>
              <Input
                id='template_code'
                value={formData.template_code}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    template_code: e.target.value,
                  }))
                }
                placeholder='e.g., MSC-001'
              />
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='description'>Description</Label>
            <Textarea
              id='description'
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              placeholder='Describe the purpose of this checklist...'
              rows={3}
            />
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='working_area_id'>Working Area</Label>
              <Select
                value={formData.working_area_id || 'none'}
                onValueChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    working_area_id: value === 'none' ? '' : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder='Select an area...' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='none'>
                    All Areas (No specific area)
                  </SelectItem>
                  {activeAreas.map((area) => (
                    <SelectItem key={area.id} value={area.id}>
                      {area.area_name} ({area.area_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='frequency'>Frequency</Label>
              <Select
                value={formData.frequency}
                onValueChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    frequency: value as StandardWorkTemplate['frequency'],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {frequencyOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='estimated_duration_minutes'>
                Estimated Duration (minutes)
              </Label>
              <Input
                id='estimated_duration_minutes'
                type='number'
                min={1}
                max={480}
                value={formData.estimated_duration_minutes}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    estimated_duration_minutes: parseInt(e.target.value) || 15,
                  }))
                }
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='status'>Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    status: value as StandardWorkTemplate['status'],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className='flex items-center gap-2'>
                        <div
                          className={cn('h-2 w-2 rounded-full', opt.color)}
                        />
                        {opt.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='space-y-2'>
            <Label id='color-label'>Color</Label>
            <div
              role='radiogroup'
              aria-labelledby='color-label'
              className='flex flex-wrap gap-2'
            >
              {colorOptions.map((color) => {
                const isSelected = formData.color === color
                return (
                  <button
                    key={color}
                    type='button'
                    role='radio'
                    aria-checked={isSelected}
                    aria-label={`Color ${color}`}
                    className={cn(
                      'focus-visible:ring-ring h-8 w-8 rounded-lg border-2 transition-all hover:scale-110 focus-visible:ring-2 focus-visible:ring-offset-2',
                      isSelected
                        ? 'border-foreground ring-foreground/20 scale-110 ring-2'
                        : 'border-transparent'
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setFormData((prev) => ({ ...prev, color }))}
                  />
                )
              })}
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='instructions'>Instructions</Label>
            <Textarea
              id='instructions'
              value={formData.instructions}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  instructions: e.target.value,
                }))
              }
              placeholder='Instructions shown to users when completing this checklist...'
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type='submit' disabled={isSaving}>
              {isSaving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              {template ? 'Save Changes' : 'Create Template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Main Settings Component
export default function StandardWorkSettings() {
  const {
    templates,
    templatesLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
    isCreatingTemplate,
    isUpdatingTemplate,
    statistics,
    userDailyCompletion,
  } = useStandardWork()
  const { workingAreas } = useLaborManagement()

  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] =
    useState<StandardWorkTemplate | null>(null)
  const [builderTemplate, setBuilderTemplate] =
    useState<StandardWorkTemplate | null>(null)
  const [schedulingTemplate, setSchedulingTemplate] =
    useState<StandardWorkTemplate | null>(null)
  const [assignmentTemplate, setAssignmentTemplate] =
    useState<StandardWorkTemplate | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('templates')
  // View preference persisted across reloads. Default to grid; switch to
  // list once the user has more than ~12 templates.
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    if (typeof window === 'undefined') return 'grid'
    const stored = window.localStorage.getItem('sw-templates-view')
    return stored === 'list' ? 'list' : 'grid'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('sw-templates-view', viewMode)
  }, [viewMode])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'draft' | 'archived'
  >('all')

  const handleCreateTemplate = () => {
    setEditingTemplate(null)
    setTemplateDialogOpen(true)
  }

  const handleEditTemplate = (template: StandardWorkTemplate) => {
    setEditingTemplate(template)
    setTemplateDialogOpen(true)
  }

  const handleSaveTemplate = async (data: Partial<StandardWorkTemplate>) => {
    if (editingTemplate) {
      await updateTemplate({ id: editingTemplate.id, updates: data })
    } else {
      await createTemplate(data)
    }
    setTemplateDialogOpen(false)
    setEditingTemplate(null)
  }

  const handleDuplicateTemplate = async (template: StandardWorkTemplate) => {
    await duplicateTemplate({
      templateId: template.id,
      newName: `${template.template_name} (Copy)`,
    })
  }

  const handleDeleteTemplate = async (templateId: string) => {
    await deleteTemplate(templateId)
    setDeleteConfirmId(null)
  }

  const handleOpenBuilder = (template: StandardWorkTemplate) => {
    setBuilderTemplate(template)
  }

  const handleOpenScheduling = (template: StandardWorkTemplate) => {
    setSchedulingTemplate(template)
  }

  const handleOpenAssignment = (template: StandardWorkTemplate) => {
    setAssignmentTemplate(template)
  }

  // ----- Derivations (must run on every render before any early return so
  // the hook order stays stable across the dashboard / builder / loading paths). -----
  const activeCount = templates.filter((t) => t.status === 'active').length
  const draftCount = templates.filter((t) => t.status === 'draft').length
  const archivedCount = templates.filter((t) => t.status === 'archived').length

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return templates.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (!q) return true
      const haystack = [
        t.template_name,
        t.template_code ?? '',
        t.description ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [templates, search, statusFilter])

  // Template Builder View
  if (builderTemplate) {
    return (
      <TemplateBuilder
        template={builderTemplate}
        onClose={() => setBuilderTemplate(null)}
      />
    )
  }

  if (templatesLoading) {
    return (
      <div className='space-y-6'>
        <div className='flex justify-between'>
          <Skeleton className='h-10 w-48' />
          <Skeleton className='h-10 w-32' />
        </div>
        <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className='h-56 rounded-xl' />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className='flex flex-wrap items-center justify-between gap-4'>
          <TabsList className='bg-muted'>
            <TabsTrigger value='templates' className='gap-1.5'>
              <LayoutGrid className='h-3.5 w-3.5' />
              Templates
            </TabsTrigger>
            <TabsTrigger value='analytics' className='gap-1.5'>
              <BarChart3 className='h-3.5 w-3.5' />
              Analytics
            </TabsTrigger>
          </TabsList>
          {activeTab === 'templates' && (
            <Button onClick={handleCreateTemplate} className='h-9 gap-2'>
              <Plus className='h-4 w-4' />
              New Template
            </Button>
          )}
        </div>

        <TabsContent value='templates' className='mt-6'>
          {/* Toolbar: counts + filters + search + view toggle */}
          {templates.length > 0 && (
            <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
              <div className='text-muted-foreground flex flex-wrap items-center gap-2 text-sm'>
                <button
                  type='button'
                  onClick={() => setStatusFilter('all')}
                  className={cn(
                    'rounded-md px-2 py-0.5 transition-colors',
                    statusFilter === 'all'
                      ? 'bg-muted text-foreground font-medium'
                      : 'hover:bg-muted/60'
                  )}
                  aria-pressed={statusFilter === 'all'}
                >
                  {templates.length} total
                </button>
                <Separator orientation='vertical' className='h-4' />
                <button
                  type='button'
                  onClick={() =>
                    setStatusFilter(
                      statusFilter === 'active' ? 'all' : 'active'
                    )
                  }
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors',
                    statusFilter === 'active'
                      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                      : 'hover:bg-muted/60'
                  )}
                  aria-pressed={statusFilter === 'active'}
                >
                  <div className='h-2 w-2 rounded-full bg-green-500' />
                  {activeCount} active
                </button>
                <Separator orientation='vertical' className='h-4' />
                <button
                  type='button'
                  onClick={() =>
                    setStatusFilter(statusFilter === 'draft' ? 'all' : 'draft')
                  }
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors',
                    statusFilter === 'draft'
                      ? 'bg-muted text-foreground font-medium'
                      : 'hover:bg-muted/60'
                  )}
                  aria-pressed={statusFilter === 'draft'}
                >
                  <div className='bg-muted-foreground/60 h-2 w-2 rounded-full' />
                  {draftCount} draft
                </button>
                {archivedCount > 0 && (
                  <>
                    <Separator orientation='vertical' className='h-4' />
                    <button
                      type='button'
                      onClick={() =>
                        setStatusFilter(
                          statusFilter === 'archived' ? 'all' : 'archived'
                        )
                      }
                      className={cn(
                        'flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors',
                        statusFilter === 'archived'
                          ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                          : 'hover:bg-muted/60'
                      )}
                      aria-pressed={statusFilter === 'archived'}
                    >
                      <div className='h-2 w-2 rounded-full bg-yellow-500' />
                      {archivedCount} archived
                    </button>
                  </>
                )}
              </div>

              <div className='flex items-center gap-2'>
                <div className='relative'>
                  <Search
                    className='text-muted-foreground/60 absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2'
                    aria-hidden='true'
                  />
                  <Input
                    type='search'
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder='Search templates…'
                    aria-label='Search templates by name, code, or description'
                    className='h-8 w-[200px] pl-8 text-sm md:w-[260px]'
                  />
                  {search && (
                    <button
                      type='button'
                      onClick={() => setSearch('')}
                      aria-label='Clear search'
                      className='text-muted-foreground/60 hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2'
                    >
                      <X className='h-3.5 w-3.5' aria-hidden='true' />
                    </button>
                  )}
                </div>
                <div
                  className='bg-muted flex items-center gap-0.5 rounded-md p-0.5'
                  role='group'
                  aria-label='View mode'
                >
                  <Button
                    variant='ghost'
                    size='icon'
                    className={cn(
                      'h-7 w-7',
                      viewMode === 'grid' &&
                        'bg-background text-foreground shadow-sm'
                    )}
                    onClick={() => setViewMode('grid')}
                    aria-pressed={viewMode === 'grid'}
                    aria-label='Grid view'
                    title='Grid view'
                  >
                    <LayoutGrid className='h-3.5 w-3.5' aria-hidden='true' />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon'
                    className={cn(
                      'h-7 w-7',
                      viewMode === 'list' &&
                        'bg-background text-foreground shadow-sm'
                    )}
                    onClick={() => setViewMode('list')}
                    aria-pressed={viewMode === 'list'}
                    aria-label='List view'
                    title='List view'
                  >
                    <List className='h-3.5 w-3.5' aria-hidden='true' />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {templates.length === 0 ? (
            <Card className='border-dashed'>
              <CardContent className='flex flex-col items-center justify-center py-16 text-center'>
                <div className='bg-muted mb-4 flex h-16 w-16 items-center justify-center rounded-2xl'>
                  <FileText className='text-muted-foreground/40 h-8 w-8' />
                </div>
                <h3 className='text-lg font-semibold'>No Templates Yet</h3>
                <p className='text-muted-foreground mt-1 mb-6 max-w-sm text-sm'>
                  Create your first standard work checklist template to
                  establish operational consistency.
                </p>
                <Button onClick={handleCreateTemplate} className='gap-2'>
                  <Plus className='h-4 w-4' />
                  Create Template
                </Button>
              </CardContent>
            </Card>
          ) : filteredTemplates.length === 0 ? (
            <Card className='border-dashed'>
              <CardContent className='flex flex-col items-center justify-center py-12 text-center'>
                <div className='bg-muted mb-3 flex h-12 w-12 items-center justify-center rounded-xl'>
                  <Search
                    className='text-muted-foreground/40 h-6 w-6'
                    aria-hidden='true'
                  />
                </div>
                <p className='text-sm font-medium'>No templates match</p>
                <p className='text-muted-foreground mt-0.5 max-w-xs text-xs'>
                  Try clearing the search or filters above.
                </p>
                {(search || statusFilter !== 'all') && (
                  <Button
                    size='sm'
                    variant='outline'
                    className='mt-4 h-8'
                    onClick={() => {
                      setSearch('')
                      setStatusFilter('all')
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : viewMode === 'grid' ? (
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'>
              {filteredTemplates.map((template, idx) => {
                const area = workingAreas.find(
                  (a) => a.id === template.working_area_id
                )
                return (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    areaName={area?.area_name}
                    index={idx}
                    onOpenBuilder={() => handleOpenBuilder(template)}
                    onOpenAssignment={() => handleOpenAssignment(template)}
                    onOpenScheduling={() => handleOpenScheduling(template)}
                    onEdit={() => handleEditTemplate(template)}
                    onDuplicate={() => handleDuplicateTemplate(template)}
                    onArchive={() => setDeleteConfirmId(template.id)}
                  />
                )
              })}
            </div>
          ) : (
            <Card className='overflow-hidden p-0'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='text-xs'>Template</TableHead>
                    <TableHead className='text-xs'>Status</TableHead>
                    <TableHead className='text-xs'>Frequency</TableHead>
                    <TableHead className='text-center text-xs'>Items</TableHead>
                    <TableHead className='text-center text-xs'>
                      Duration
                    </TableHead>
                    <TableHead className='text-xs'>Working Area</TableHead>
                    <TableHead className='w-[180px] text-right text-xs'>
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTemplates.map((template) => {
                    const area = workingAreas.find(
                      (a) => a.id === template.working_area_id
                    )
                    return (
                      <TemplateListRow
                        key={template.id}
                        template={template}
                        areaName={area?.area_name}
                        onOpenBuilder={() => handleOpenBuilder(template)}
                        onOpenAssignment={() => handleOpenAssignment(template)}
                        onOpenScheduling={() => handleOpenScheduling(template)}
                        onEdit={() => handleEditTemplate(template)}
                        onDuplicate={() => handleDuplicateTemplate(template)}
                        onArchive={() => setDeleteConfirmId(template.id)}
                      />
                    )
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value='analytics' className='mt-6 space-y-6'>
          {/* KPI Cards */}
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            <Card>
              <CardContent className='p-5'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                      Total Templates
                    </p>
                    <p className='mt-1 text-2xl font-bold'>
                      {statistics?.total_templates || 0}
                    </p>
                  </div>
                  <div className='bg-primary/10 flex h-10 w-10 items-center justify-center rounded-xl'>
                    <FileText className='text-primary h-5 w-5' />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className='p-5'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                      Active
                    </p>
                    <p className='mt-1 text-2xl font-bold text-green-600 dark:text-green-400'>
                      {statistics?.active_templates || 0}
                    </p>
                  </div>
                  <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/10'>
                    <CheckCircle2 className='h-5 w-5 text-green-500' />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className='p-5'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                      Submissions
                    </p>
                    <p className='mt-1 text-2xl font-bold'>
                      {statistics?.total_submissions || 0}
                    </p>
                    <p className='text-muted-foreground text-xs'>
                      last 30 days
                    </p>
                  </div>
                  <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10'>
                    <Target className='h-5 w-5 text-blue-500' />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className='p-5'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                      Completion Rate
                    </p>
                    <p className='mt-1 text-2xl font-bold'>
                      {statistics?.avg_completion_rate || 0}%
                    </p>
                  </div>
                  <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10'>
                    <TrendingUp className='h-5 w-5 text-orange-500' />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* User Completion Tracking */}
          {statistics?.user_completion &&
            statistics.user_completion.length > 0 && (
              <Card>
                <CardHeader className='pb-4'>
                  <div className='flex items-center gap-3'>
                    <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10'>
                      <Users className='h-5 w-5 text-violet-500' />
                    </div>
                    <div>
                      <CardTitle className='text-base'>
                        User Completion
                      </CardTitle>
                      <CardDescription className='text-xs'>
                        Assigned users and their completion status (last 30
                        days)
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className='pt-0'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='text-xs'>User</TableHead>
                        <TableHead className='text-xs'>
                          Position / Area
                        </TableHead>
                        <TableHead className='text-center text-xs'>
                          Assigned
                        </TableHead>
                        <TableHead className='text-center text-xs'>
                          Completed
                        </TableHead>
                        <TableHead className='text-center text-xs'>
                          On-Time
                        </TableHead>
                        <TableHead className='w-28 text-xs'>Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statistics.user_completion.map((user) => {
                        const completionRate =
                          user.total_assigned > 0
                            ? Math.round(
                                (user.completed /
                                  Math.max(
                                    user.total_submissions,
                                    user.total_assigned
                                  )) *
                                  100
                              )
                            : 0
                        const onTimeRate =
                          user.completed > 0
                            ? Math.round(
                                (user.on_time_count / user.completed) * 100
                              )
                            : 0
                        return (
                          <TableRow key={user.user_id}>
                            <TableCell>
                              <div className='flex items-center gap-2.5'>
                                {user.avatar_url ? (
                                  <img
                                    src={user.avatar_url}
                                    alt=''
                                    className='h-7 w-7 rounded-full'
                                  />
                                ) : (
                                  <div className='bg-primary/10 text-primary flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold'>
                                    {user.full_name
                                      ?.split(' ')
                                      .map((n) => n[0])
                                      .join('')
                                      .slice(0, 2)
                                      .toUpperCase() || '?'}
                                  </div>
                                )}
                                <div className='min-w-0'>
                                  <p className='truncate text-sm font-medium'>
                                    {user.full_name}
                                  </p>
                                  <p className='text-muted-foreground truncate text-[10px]'>
                                    {user.email}
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className='text-muted-foreground text-xs'>
                                {user.position_title && (
                                  <p className='truncate'>
                                    {user.position_title}
                                  </p>
                                )}
                                {user.working_area_name && (
                                  <p className='truncate text-[10px]'>
                                    {user.working_area_name}
                                  </p>
                                )}
                                {!user.position_title &&
                                  !user.working_area_name && (
                                    <span className='text-muted-foreground/50'>
                                      --
                                    </span>
                                  )}
                              </div>
                            </TableCell>
                            <TableCell className='text-center text-sm font-medium'>
                              {user.total_assigned}
                            </TableCell>
                            <TableCell className='text-center'>
                              <span
                                className={cn(
                                  'text-sm font-semibold',
                                  user.completed > 0
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-muted-foreground'
                                )}
                              >
                                {user.completed}
                              </span>
                              {user.in_progress > 0 && (
                                <span className='ml-1 text-[10px] text-yellow-600 dark:text-yellow-400'>
                                  +{user.in_progress}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className='text-center'>
                              <Badge
                                variant='outline'
                                className={cn(
                                  'h-5 text-[10px]',
                                  onTimeRate >= 90
                                    ? 'border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-400'
                                    : onTimeRate >= 70
                                      ? 'border-yellow-500/20 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                                      : user.completed > 0
                                        ? 'bg-destructive/10 text-destructive border-destructive/20'
                                        : ''
                                )}
                              >
                                {user.completed > 0 ? `${onTimeRate}%` : '--'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className='flex items-center gap-2'>
                                <Progress
                                  value={completionRate}
                                  className='h-1.5 flex-1'
                                />
                                <span className='text-muted-foreground w-8 text-right text-[10px] font-medium'>
                                  {completionRate}%
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

          {/* Daily Completion Tracker (Date Table) */}
          {userDailyCompletion && userDailyCompletion.length > 0 && (
            <Card>
              <CardHeader className='pb-4'>
                <div className='flex items-center gap-3'>
                  <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10'>
                    <CalendarDays className='h-5 w-5 text-blue-500' />
                  </div>
                  <div>
                    <CardTitle className='text-base'>
                      Daily Completion Tracker
                    </CardTitle>
                    <CardDescription className='text-xs'>
                      User completion by day for the last 30 days
                    </CardDescription>
                  </div>
                </div>
                {/* Legend */}
                <div className='text-muted-foreground mt-3 flex items-center gap-4 text-[10px]'>
                  <div className='flex items-center gap-1.5'>
                    <div className='h-3 w-3 rounded-sm bg-green-500' />
                    Completed
                  </div>
                  <div className='flex items-center gap-1.5'>
                    <div className='h-3 w-3 rounded-sm bg-yellow-500' />
                    In Progress
                  </div>
                  <div className='flex items-center gap-1.5'>
                    <div className='bg-muted h-3 w-3 rounded-sm' />
                    No Activity
                  </div>
                </div>
              </CardHeader>
              <CardContent className='pt-0'>
                <ScrollArea className='w-full'>
                  <div className='min-w-[800px]'>
                    <TooltipProvider delayDuration={100}>
                      <table className='w-full border-collapse'>
                        <thead>
                          <tr>
                            <th className='text-muted-foreground bg-card sticky left-0 z-10 min-w-[160px] pr-4 pb-2 text-left text-xs font-medium'>
                              User
                            </th>
                            {(() => {
                              const dates: string[] = []
                              for (let i = 29; i >= 0; i--) {
                                const d = new Date()
                                d.setDate(d.getDate() - i)
                                dates.push(getLocalDateString(d))
                              }
                              return dates.map((date) => {
                                const d = new Date(date + 'T00:00:00')
                                const dayNum = d.getDate()
                                const isToday = date === getLocalDateString()
                                const isWeekend =
                                  d.getDay() === 0 || d.getDay() === 6
                                return (
                                  <th
                                    key={date}
                                    className={cn(
                                      'px-0.5 pb-2 text-center',
                                      isToday && 'bg-primary/5 rounded-t-md',
                                      isWeekend && 'opacity-50'
                                    )}
                                  >
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className='flex cursor-default flex-col items-center'>
                                          <span className='text-muted-foreground/70 text-[9px]'>
                                            {d.toLocaleDateString('en-US', {
                                              weekday: 'narrow',
                                            })}
                                          </span>
                                          <span
                                            className={cn(
                                              'text-[10px] font-medium',
                                              isToday
                                                ? 'text-primary font-bold'
                                                : 'text-muted-foreground'
                                            )}
                                          >
                                            {dayNum}
                                          </span>
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        side='top'
                                        className='text-xs'
                                      >
                                        {d.toLocaleDateString('en-US', {
                                          weekday: 'long',
                                          month: 'short',
                                          day: 'numeric',
                                        })}
                                      </TooltipContent>
                                    </Tooltip>
                                  </th>
                                )
                              })
                            })()}
                          </tr>
                        </thead>
                        <tbody>
                          {userDailyCompletion.map((user) => (
                            <tr key={user.user_id} className='group'>
                              <td className='bg-card sticky left-0 z-10 py-1.5 pr-4'>
                                <div className='flex items-center gap-2'>
                                  {user.avatar_url ? (
                                    <img
                                      src={user.avatar_url}
                                      alt=''
                                      className='h-6 w-6 shrink-0 rounded-full'
                                    />
                                  ) : (
                                    <div className='bg-primary/10 text-primary flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold'>
                                      {user.full_name
                                        ?.split(' ')
                                        .map((n: string) => n[0])
                                        .join('')
                                        .slice(0, 2)
                                        .toUpperCase() || '?'}
                                    </div>
                                  )}
                                  <div className='min-w-0'>
                                    <p className='max-w-[120px] truncate text-xs font-medium'>
                                      {user.full_name}
                                    </p>
                                    {user.position_title && (
                                      <p className='text-muted-foreground max-w-[120px] truncate text-[9px]'>
                                        {user.position_title}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </td>
                              {(() => {
                                const dates: string[] = []
                                for (let i = 29; i >= 0; i--) {
                                  const d = new Date()
                                  d.setDate(d.getDate() - i)
                                  dates.push(getLocalDateString(d))
                                }
                                return dates.map((date) => {
                                  const dayData = user.daily_data?.find(
                                    (dd: { date: string }) =>
                                      dd.date.startsWith(date)
                                  )
                                  const completed = dayData?.completed || 0
                                  const inProgress = dayData?.in_progress || 0
                                  const isToday = date === getLocalDateString()
                                  const d = new Date(date + 'T00:00:00')
                                  const isWeekend =
                                    d.getDay() === 0 || d.getDay() === 6

                                  let cellColor = 'bg-muted/40'
                                  let textColor = ''
                                  if (completed > 0) {
                                    cellColor =
                                      completed >= 3
                                        ? 'bg-green-600'
                                        : completed >= 2
                                          ? 'bg-green-500'
                                          : 'bg-green-400'
                                    textColor = 'text-white'
                                  } else if (inProgress > 0) {
                                    cellColor = 'bg-yellow-400'
                                    textColor = 'text-yellow-900'
                                  }

                                  return (
                                    <td
                                      key={date}
                                      className={cn(
                                        'px-0.5 py-1.5',
                                        isToday && 'bg-primary/5'
                                      )}
                                    >
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div
                                            className={cn(
                                              'flex h-6 w-full min-w-[20px] cursor-default items-center justify-center rounded-sm text-[9px] font-semibold transition-all',
                                              cellColor,
                                              textColor,
                                              isWeekend &&
                                                completed === 0 &&
                                                inProgress === 0 &&
                                                'opacity-30',
                                              'hover:ring-primary/30 hover:ring-2'
                                            )}
                                          >
                                            {completed > 0
                                              ? completed
                                              : inProgress > 0
                                                ? '~'
                                                : ''}
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent
                                          side='top'
                                          className='text-xs'
                                        >
                                          <p className='font-medium'>
                                            {user.full_name}
                                          </p>
                                          <p className='text-muted-foreground'>
                                            {d.toLocaleDateString('en-US', {
                                              weekday: 'short',
                                              month: 'short',
                                              day: 'numeric',
                                            })}
                                          </p>
                                          {completed > 0 && (
                                            <p className='text-green-500'>
                                              {completed} completed
                                            </p>
                                          )}
                                          {inProgress > 0 && (
                                            <p className='text-yellow-500'>
                                              {inProgress} in progress
                                            </p>
                                          )}
                                          {completed === 0 &&
                                            inProgress === 0 && (
                                              <p className='text-muted-foreground'>
                                                No activity
                                              </p>
                                            )}
                                        </TooltipContent>
                                      </Tooltip>
                                    </td>
                                  )
                                })
                              })()}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TooltipProvider>
                  </div>
                  <ScrollBar orientation='horizontal' />
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Submissions by Area */}
          {statistics?.submissions_by_area &&
            statistics.submissions_by_area.length > 0 && (
              <Card>
                <CardHeader className='pb-4'>
                  <div className='flex items-center gap-3'>
                    <div className='bg-muted flex h-9 w-9 items-center justify-center rounded-lg'>
                      <BarChart3 className='text-muted-foreground h-5 w-5' />
                    </div>
                    <div>
                      <CardTitle className='text-base'>
                        Submissions by Working Area
                      </CardTitle>
                      <CardDescription className='text-xs'>
                        Last 30 days breakdown
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className='pt-0'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='text-xs'>Working Area</TableHead>
                        <TableHead className='text-right text-xs'>
                          Submissions
                        </TableHead>
                        <TableHead className='w-32 text-xs'>
                          Distribution
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statistics.submissions_by_area.map((area) => {
                        const maxCount = Math.max(
                          ...statistics.submissions_by_area.map(
                            (a) => a.submission_count
                          )
                        )
                        const pct =
                          maxCount > 0
                            ? (area.submission_count / maxCount) * 100
                            : 0
                        return (
                          <TableRow key={area.area_id}>
                            <TableCell className='text-sm font-medium'>
                              {area.area_name}
                            </TableCell>
                            <TableCell className='text-right text-sm font-semibold'>
                              {area.submission_count}
                            </TableCell>
                            <TableCell>
                              <Progress value={pct} className='h-1.5' />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
        </TabsContent>
      </Tabs>

      {/* Template Dialog */}
      <TemplateFormDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        template={editingTemplate}
        onSave={handleSaveTemplate}
        isSaving={isCreatingTemplate || isUpdatingTemplate}
      />

      {/* Scheduling Panel */}
      {schedulingTemplate && (
        <SchedulingPanel
          template={schedulingTemplate}
          open={!!schedulingTemplate}
          onOpenChange={(open) => !open && setSchedulingTemplate(null)}
        />
      )}

      {/* Assignment Panel */}
      {assignmentTemplate && (
        <AssignmentPanel
          template={assignmentTemplate}
          open={!!assignmentTemplate}
          onOpenChange={(open) => !open && setAssignmentTemplate(null)}
        />
      )}

      {/* Delete Confirmation */}
      <Dialog
        open={!!deleteConfirmId}
        onOpenChange={() => setDeleteConfirmId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Template</DialogTitle>
            <DialogDescription>
              Are you sure you want to archive this template? It will no longer
              be available for new checklists but existing submissions will be
              preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() =>
                deleteConfirmId && handleDeleteTemplate(deleteConfirmId)
              }
            >
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Created and developed by Jai Singh
