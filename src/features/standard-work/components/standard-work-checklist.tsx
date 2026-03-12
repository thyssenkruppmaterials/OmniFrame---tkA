/**
 * Standard Work Checklist Component
 * Enterprise-grade checklist completion interface with progress tracking
 * Updated: February 8, 2026 - Complete UI redesign for modern enterprise experience
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  FileText,
  Loader2,
  MapPin,
  Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import {
  useStandardWork,
  type StandardWorkItem,
  type StandardWorkResponse,
} from '@/hooks/use-standard-work'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { StandardWorkDashboard } from './dashboard'

// Checklist Item Component
function ChecklistItemRenderer({
  item,
  response,
  onResponseChange,
  disabled = false,
  index,
}: {
  item: StandardWorkItem
  response?: StandardWorkResponse
  onResponseChange: (
    itemId: string,
    value: Partial<StandardWorkResponse>
  ) => void
  disabled?: boolean
  index: number
}) {
  const handleCheckboxChange = (checked: boolean) => {
    onResponseChange(item.id, {
      is_checked: checked,
      response_value: checked ? 'true' : 'false',
    })
  }

  const handleTextChange = (value: string) => {
    onResponseChange(item.id, { response_value: value })
  }

  const handleNumberChange = (value: string) => {
    const numValue = parseFloat(value)
    onResponseChange(item.id, {
      response_value: value,
      numeric_value: isNaN(numValue) ? undefined : numValue,
    })
  }

  const handleSelectChange = (value: string) => {
    onResponseChange(item.id, { response_value: value })
  }

  const isCompleted =
    response?.is_checked ||
    (response?.response_value && response.response_value !== '')

  return (
    <div
      className={cn(
        'group relative rounded-xl border p-4 transition-all duration-200',
        isCompleted
          ? 'border-green-500/30 bg-green-500/5 dark:bg-green-500/5'
          : 'border-border hover:border-primary/30 hover:bg-accent/30',
        disabled && 'cursor-not-allowed opacity-60'
      )}
    >
      <div className='flex items-start gap-4'>
        {/* Step number / completion indicator */}
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold transition-all',
            isCompleted
              ? 'bg-green-500 text-white shadow-sm shadow-green-500/25'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {isCompleted ? (
            <Check className='h-4 w-4' strokeWidth={3} />
          ) : (
            index + 1
          )}
        </div>

        {/* Item Content */}
        <div className='min-w-0 flex-1 space-y-3'>
          <div className='flex items-start justify-between gap-2'>
            <div>
              <Label className='flex items-center gap-2 text-sm font-semibold'>
                {item.item_title}
                {item.is_required && (
                  <Badge
                    variant='outline'
                    className='text-destructive border-destructive/30 h-4 px-1 text-[10px]'
                  >
                    Required
                  </Badge>
                )}
              </Label>
              {item.item_description && (
                <p className='text-muted-foreground mt-1 text-xs leading-relaxed'>
                  {item.item_description}
                </p>
              )}
            </div>
            {item.help_text && (
              <Badge variant='secondary' className='shrink-0 text-[10px]'>
                {item.help_text}
              </Badge>
            )}
          </div>

          {/* Input based on type */}
          <div>
            {item.item_type === 'checkbox' && (
              <div className='bg-muted/30 flex items-center space-x-3 rounded-lg p-2.5'>
                <Checkbox
                  id={item.id}
                  checked={response?.is_checked || false}
                  onCheckedChange={handleCheckboxChange}
                  disabled={disabled}
                  className='h-5 w-5'
                />
                <Label
                  htmlFor={item.id}
                  className={cn(
                    'cursor-pointer text-sm select-none',
                    response?.is_checked && 'text-muted-foreground line-through'
                  )}
                >
                  Mark as completed
                </Label>
              </div>
            )}

            {item.item_type === 'text' && (
              <Textarea
                placeholder={item.placeholder || 'Enter your response...'}
                value={response?.response_value || ''}
                onChange={(e) => handleTextChange(e.target.value)}
                disabled={disabled}
                className='min-h-[80px] resize-none text-sm'
              />
            )}

            {item.item_type === 'number' && (
              <Input
                type='number'
                placeholder={item.placeholder || 'Enter a number...'}
                value={response?.response_value || ''}
                onChange={(e) => handleNumberChange(e.target.value)}
                disabled={disabled}
                min={item.validation_rules?.min as number | undefined}
                max={item.validation_rules?.max as number | undefined}
                className='max-w-[200px]'
              />
            )}

            {(item.item_type === 'select' ||
              item.item_type === 'multi_select') && (
              <Select
                value={response?.response_value || ''}
                onValueChange={handleSelectChange}
                disabled={disabled}
              >
                <SelectTrigger className='max-w-[320px]'>
                  <SelectValue
                    placeholder={item.placeholder || 'Select an option...'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {item.options?.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {item.item_type === 'date' && (
              <Input
                type='date'
                value={response?.date_value || ''}
                onChange={(e) =>
                  onResponseChange(item.id, {
                    date_value: e.target.value,
                    response_value: e.target.value,
                  })
                }
                disabled={disabled}
                className='max-w-[200px]'
              />
            )}

            {item.item_type === 'time' && (
              <Input
                type='time'
                value={response?.time_value || ''}
                onChange={(e) =>
                  onResponseChange(item.id, {
                    time_value: e.target.value,
                    response_value: e.target.value,
                  })
                }
                disabled={disabled}
                className='max-w-[160px]'
              />
            )}
          </div>

          {/* Item Notes */}
          {response?.item_notes && (
            <div className='text-muted-foreground bg-muted/50 flex items-start gap-2 rounded-lg p-2.5 text-xs'>
              <FileText className='mt-0.5 h-3 w-3 shrink-0' />
              {response.item_notes}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Active Submission View
function ActiveSubmissionView({
  submissionId,
  onComplete,
  onCancel,
}: {
  submissionId: string
  onComplete: () => void
  onCancel: () => void
}) {
  const {
    useSubmission,
    useSubmissionResponses,
    useTemplateItems,
    upsertResponse,
    submitChecklist,
    isSubmittingChecklist,
  } = useStandardWork()
  const { data: submission, isLoading: submissionLoading } =
    useSubmission(submissionId)
  const { data: responses = [], isLoading: responsesLoading } =
    useSubmissionResponses(submissionId)
  const { data: items = [], isLoading: itemsLoading } = useTemplateItems(
    submission?.template_id || ''
  )

  const [localResponses, setLocalResponses] = useState<
    Record<string, Partial<StandardWorkResponse>>
  >({})
  const [isSaving, setIsSaving] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({})
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  )
  const pendingSavesRef = useRef(0)

  // Initialize local responses from fetched data
  useEffect(() => {
    if (responses.length > 0) {
      const responseMap: Record<string, Partial<StandardWorkResponse>> = {}
      responses.forEach((r) => {
        responseMap[r.item_id] = r
      })
      setLocalResponses(responseMap)
    }
  }, [responses])

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = saveTimersRef.current
    return () => {
      Object.values(timers).forEach(clearTimeout)
    }
  }, [])

  // Debounced save function -- only fires after 600ms of inactivity per item
  const debouncedSave = useCallback(
    (itemId: string, fullResponse: Partial<StandardWorkResponse>) => {
      // Clear any existing timer for this item
      if (saveTimersRef.current[itemId]) {
        clearTimeout(saveTimersRef.current[itemId])
      }

      saveTimersRef.current[itemId] = setTimeout(async () => {
        delete saveTimersRef.current[itemId]
        pendingSavesRef.current++
        setIsSaving(true)
        try {
          await upsertResponse(fullResponse)
        } catch {
          // Error toast is handled by the mutation
        } finally {
          pendingSavesRef.current--
          if (pendingSavesRef.current === 0) {
            setIsSaving(false)
          }
        }
      }, 600)
    },
    [upsertResponse]
  )

  const handleResponseChange = useCallback(
    (itemId: string, value: Partial<StandardWorkResponse>) => {
      // 1. Update local state immediately for instant UI feedback (pure function)
      setLocalResponses((prev) => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          ...value,
          item_id: itemId,
          submission_id: submissionId,
        },
      }))

      // 2. Build the full response payload for saving
      const fullResponse = {
        ...localResponses[itemId],
        ...value,
        item_id: itemId,
        submission_id: submissionId,
      }

      // 3. Immediate save for single-action inputs, debounced for text/number
      const itemType = items.find((i) => i.id === itemId)?.item_type
      if (
        itemType === 'checkbox' ||
        itemType === 'select' ||
        itemType === 'multi_select'
      ) {
        // Single-action inputs: save immediately
        setIsSaving(true)
        pendingSavesRef.current++
        upsertResponse(fullResponse)
          .catch(() => {})
          .finally(() => {
            pendingSavesRef.current--
            if (pendingSavesRef.current === 0) setIsSaving(false)
          })
      } else {
        // Text, number, date, time: debounce
        debouncedSave(itemId, fullResponse)
      }
    },
    [submissionId, upsertResponse, debouncedSave, localResponses, items]
  )

  const handleSubmit = async () => {
    const requiredItems = items.filter((i) => i.is_required)
    const missingRequired = requiredItems.filter((item) => {
      const response = localResponses[item.id]
      if (!response) return true
      if (item.item_type === 'checkbox') return !response.is_checked
      return !response.response_value
    })

    if (missingRequired.length > 0) {
      toast.error(
        `Please complete all required items (${missingRequired.length} remaining)`
      )
      return
    }

    try {
      await submitChecklist(submissionId)
      onComplete()
    } catch (error) {
      logger.error('Submit error:', error)
    }
  }

  // Group items by section
  const groupedItems = useMemo(() => {
    const groups: Record<string, StandardWorkItem[]> = {}
    items.forEach((item) => {
      const section = item.section_name || 'General'
      if (!groups[section]) groups[section] = []
      groups[section].push(item)
    })
    return groups
  }, [items])

  const completedCount = Object.values(localResponses).filter((r) => {
    const item = items.find((i) => i.id === r.item_id)
    if (!item) return false
    if (item.item_type === 'checkbox') return r.is_checked
    return r.response_value && r.response_value !== ''
  }).length

  const progress = items.length > 0 ? (completedCount / items.length) * 100 : 0
  const isSubmitted = submission?.status === 'submitted'

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  const getSectionCompletion = (sectionItems: StandardWorkItem[]) => {
    const completed = sectionItems.filter((item) => {
      const response = localResponses[item.id]
      if (!response) return false
      if (item.item_type === 'checkbox') return response.is_checked
      return response.response_value && response.response_value !== ''
    }).length
    return { completed, total: sectionItems.length }
  }

  if (submissionLoading || responsesLoading || itemsLoading) {
    return (
      <div className='mx-auto max-w-4xl space-y-4'>
        <Skeleton className='h-10 w-48' />
        <Skeleton className='h-6 w-full' />
        <Skeleton className='h-40 w-full rounded-xl' />
        <Skeleton className='h-40 w-full rounded-xl' />
      </div>
    )
  }

  if (!submission) {
    return (
      <Alert variant='destructive' className='mx-auto max-w-4xl'>
        <AlertCircle className='h-4 w-4' />
        <AlertDescription>
          Submission not found. It may have been deleted.
        </AlertDescription>
      </Alert>
    )
  }

  // Track item indices across sections
  let globalIndex = 0

  return (
    <div className='mx-auto max-w-4xl space-y-6'>
      {/* Back navigation + Header */}
      <div className='flex items-center gap-3'>
        <Button
          variant='ghost'
          size='sm'
          onClick={onCancel}
          className='text-muted-foreground hover:text-foreground h-8 gap-1.5'
        >
          <ArrowLeft className='h-4 w-4' />
          Back to Dashboard
        </Button>
      </div>

      {/* Template header card */}
      <Card className='overflow-hidden'>
        <div className='from-primary/60 to-primary/20 h-1.5 bg-linear-to-r' />
        <CardContent className='p-6'>
          <div className='flex items-start justify-between gap-4'>
            <div className='flex items-start gap-4'>
              <div className='bg-primary/10 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl'>
                <ClipboardCheck className='text-primary h-6 w-6' />
              </div>
              <div>
                <h2 className='text-lg font-bold'>
                  {submission.template?.template_name}
                </h2>
                <div className='text-muted-foreground mt-1 flex items-center gap-3 text-sm'>
                  {submission.working_area?.area_name && (
                    <span className='flex items-center gap-1'>
                      <MapPin className='h-3.5 w-3.5' />
                      {submission.working_area.area_name}
                    </span>
                  )}
                  <span className='flex items-center gap-1'>
                    <Calendar className='h-3.5 w-3.5' />
                    {new Date(submission.shift_date).toLocaleDateString(
                      'en-US',
                      { weekday: 'short', month: 'short', day: 'numeric' }
                    )}
                  </span>
                </div>
              </div>
            </div>
            <Badge
              variant={isSubmitted ? 'default' : 'secondary'}
              className={cn(
                'capitalize',
                isSubmitted &&
                  'border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-400'
              )}
            >
              {submission.status}
            </Badge>
          </div>

          {/* Progress bar */}
          <div className='mt-5 space-y-2'>
            <div className='flex items-center justify-between text-sm'>
              <div className='flex items-center gap-2'>
                <span className='text-muted-foreground'>Progress</span>
                {isSaving && (
                  <span className='text-muted-foreground flex items-center gap-1 text-xs'>
                    <Loader2 className='h-3 w-3 animate-spin' />
                    Saving
                  </span>
                )}
              </div>
              <span className='font-semibold'>
                {completedCount} / {items.length}
                <span className='text-muted-foreground ml-1 font-normal'>
                  ({Math.round(progress)}%)
                </span>
              </span>
            </div>
            <Progress value={progress} className='h-2.5' />
          </div>
        </CardContent>
      </Card>

      {/* Instructions */}
      {submission.template?.instructions && (
        <Alert className='border-blue-500/20 bg-blue-500/5'>
          <FileText className='h-4 w-4 text-blue-500' />
          <AlertDescription className='text-sm'>
            {submission.template.instructions}
          </AlertDescription>
        </Alert>
      )}

      {/* Checklist Sections */}
      <div className='space-y-4'>
        {Object.entries(groupedItems).map(([section, sectionItems]) => {
          const { completed, total } = getSectionCompletion(sectionItems)
          const isCollapsed = collapsedSections[section]
          const sectionComplete = completed === total && total > 0
          const startIndex = globalIndex
          globalIndex += sectionItems.length

          return (
            <Card
              key={section}
              className={cn(
                'overflow-hidden',
                sectionComplete && 'border-green-500/20'
              )}
            >
              <CardHeader
                className='hover:bg-accent/30 cursor-pointer p-4 transition-colors select-none'
                onClick={() => toggleSection(section)}
              >
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-3'>
                    <ChevronDown
                      className={cn(
                        'text-muted-foreground h-4 w-4 transition-transform duration-200',
                        isCollapsed && '-rotate-90'
                      )}
                    />
                    <CardTitle className='text-muted-foreground text-sm font-semibold tracking-wider uppercase'>
                      {section}
                    </CardTitle>
                    <Badge
                      variant={sectionComplete ? 'default' : 'outline'}
                      className={cn(
                        'h-5 text-[10px]',
                        sectionComplete &&
                          'border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-400'
                      )}
                    >
                      {completed}/{total}
                    </Badge>
                  </div>
                  {sectionComplete && (
                    <CheckCircle2 className='h-4 w-4 text-green-500' />
                  )}
                </div>
              </CardHeader>

              {!isCollapsed && (
                <CardContent className='space-y-3 p-4 pt-0'>
                  {sectionItems.map((item, idx) => (
                    <ChecklistItemRenderer
                      key={item.id}
                      item={item}
                      response={localResponses[item.id] as StandardWorkResponse}
                      onResponseChange={handleResponseChange}
                      disabled={isSubmitted}
                      index={startIndex + idx}
                    />
                  ))}
                </CardContent>
              )}
            </Card>
          )
        })}
      </div>

      {/* Sticky Submit Bar */}
      {!isSubmitted && (
        <div className='bg-background/95 sticky bottom-0 -mx-6 mt-6 border-t px-6 py-4 backdrop-blur-sm'>
          <div className='mx-auto flex max-w-4xl items-center justify-between'>
            <div className='text-muted-foreground text-sm'>
              {completedCount === items.length ? (
                <span className='flex items-center gap-1.5 font-medium text-green-600 dark:text-green-400'>
                  <CheckCircle2 className='h-4 w-4' />
                  All items completed — ready to submit
                </span>
              ) : (
                <span>
                  {items.length - completedCount} item
                  {items.length - completedCount !== 1 ? 's' : ''} remaining
                </span>
              )}
            </div>
            <div className='flex items-center gap-3'>
              <Button variant='ghost' onClick={onCancel} className='h-9'>
                Save & Exit
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmittingChecklist}
                className='h-9 gap-2'
              >
                {isSubmittingChecklist ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <Send className='h-4 w-4' />
                )}
                Submit Checklist
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Main Checklist Component
export default function StandardWorkChecklist() {
  const { startSubmission } = useStandardWork()

  const [activeSubmissionId, setActiveSubmissionId] = useState<string | null>(
    null
  )

  const handleStartChecklist = async (templateId: string) => {
    try {
      const submission = await startSubmission({ templateId })
      setActiveSubmissionId(submission.id)
    } catch (error) {
      logger.error('Start checklist error:', error)
    }
  }

  const handleContinueChecklist = (submissionId: string) => {
    setActiveSubmissionId(submissionId)
  }

  const handleChecklistComplete = () => {
    setActiveSubmissionId(null)
    // Toast is handled by the submitChecklist mutation in use-standard-work.ts
  }

  const handleChecklistCancel = () => {
    setActiveSubmissionId(null)
  }

  // Active submission view
  if (activeSubmissionId) {
    return (
      <ActiveSubmissionView
        submissionId={activeSubmissionId}
        onComplete={handleChecklistComplete}
        onCancel={handleChecklistCancel}
      />
    )
  }

  // Dashboard view
  return (
    <StandardWorkDashboard
      onStartChecklist={handleStartChecklist}
      onContinueChecklist={handleContinueChecklist}
    />
  )
}
