// Created and developed by Jai Singh
/**
 * Standard Work Checklist
 *
 * Hosts the dashboard view and the active-submission runner. The runner
 * renders all item types (checkbox, text, number, select, multi_select,
 * date, time, photo, signature), respects `conditional_display` to hide
 * dependent items until their predicate is satisfied, flushes pending
 * debounced saves on exit, and exposes a polite aria-live region so screen
 * readers hear status changes ("Saving…" / "Saved" / "Submitted").
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
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { uploadStandardWorkAttachment } from '@/lib/supabase/standard-work-attachments.service'
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
import { MultiSelect } from '@/components/ui/multi-select'
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
import { PhotoCapture } from './runner/photo-capture'
import { SignaturePad } from './runner/signature-pad'

const userLocale =
  typeof navigator !== 'undefined' && navigator.language
    ? navigator.language
    : 'en-US'

// ---------- Conditional display helpers ----------

type ConditionOp =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'is_checked'
  | 'is_unchecked'

function evaluateCondition(
  op: ConditionOp | string,
  expected: string | undefined,
  response: Partial<StandardWorkResponse> | undefined
): boolean {
  if (!response) {
    // No response yet -> only the unchecked predicate can be satisfied.
    return op === 'is_unchecked'
  }
  switch (op) {
    case 'is_checked':
      return !!response.is_checked
    case 'is_unchecked':
      return !response.is_checked
    case 'not_equals':
      return (response.response_value ?? '') !== (expected ?? '')
    case 'contains':
      return (response.response_value ?? '').includes(expected ?? '')
    case 'equals':
    default:
      return (response.response_value ?? '') === (expected ?? '')
  }
}

function isItemVisible(
  item: StandardWorkItem,
  responses: Record<string, Partial<StandardWorkResponse>>
): boolean {
  if (!item.conditional_display) return true
  const { depends_on, condition, value } = item.conditional_display
  return evaluateCondition(condition, value, responses[depends_on])
}

// ---------- Multi-select serialization ----------

function parseMultiValue(raw?: string | null): string[] {
  if (!raw) return []
  // Stored as JSON array; gracefully handle legacy comma-separated strings.
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((v) => typeof v === 'string')
      : []
  } catch {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
}

function serializeMultiValue(values: string[]): string {
  return JSON.stringify(values)
}

// ---------- Item Renderer ----------

interface ChecklistItemRendererProps {
  item: StandardWorkItem
  response?: Partial<StandardWorkResponse>
  onResponseChange: (
    itemId: string,
    value: Partial<StandardWorkResponse>
  ) => void
  disabled?: boolean
  index: number
  organizationId: string
  submissionId: string
}

function ChecklistItemRenderer({
  item,
  response,
  onResponseChange,
  disabled = false,
  index,
  organizationId,
  submissionId,
}: ChecklistItemRendererProps) {
  const [uploading, setUploading] = useState(false)

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

  const handleMultiSelectChange = (values: string[]) => {
    onResponseChange(item.id, {
      response_value: serializeMultiValue(values),
    })
  }

  const handlePhotoCapture = async (file: File) => {
    setUploading(true)
    try {
      const result = await uploadStandardWorkAttachment({
        file,
        organizationId,
        submissionId,
        itemId: item.id,
        contentType: file.type,
      })
      if (!result.success || !result.publicUrl) {
        toast.error(
          `Couldn't upload photo: ${result.error?.message ?? 'unknown error'}`
        )
        return
      }
      onResponseChange(item.id, {
        file_url: result.publicUrl,
        response_value: result.publicUrl,
        file_metadata: {
          storage_path: result.storagePath,
          content_type: result.contentType,
          size: result.size,
          captured_at: new Date().toISOString(),
        },
      })
    } finally {
      setUploading(false)
    }
  }

  const handleSignatureCapture = async (blob: Blob) => {
    setUploading(true)
    try {
      const result = await uploadStandardWorkAttachment({
        file: blob,
        organizationId,
        submissionId,
        itemId: item.id,
        contentType: 'image/png',
        fileName: 'signature.png',
      })
      if (!result.success || !result.publicUrl) {
        toast.error(
          `Couldn't save signature: ${result.error?.message ?? 'unknown error'}`
        )
        return
      }
      onResponseChange(item.id, {
        file_url: result.publicUrl,
        response_value: result.publicUrl,
        is_checked: true,
        file_metadata: {
          storage_path: result.storagePath,
          content_type: 'image/png',
          size: result.size,
          captured_at: new Date().toISOString(),
        },
      })
      toast.success('Signature saved')
    } finally {
      setUploading(false)
    }
  }

  const isCompleted =
    response?.is_checked ||
    !!response?.file_url ||
    (response?.response_value !== undefined && response.response_value !== '')

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
            <Check className='h-4 w-4' strokeWidth={3} aria-label='Completed' />
          ) : (
            index + 1
          )}
        </div>

        <div className='min-w-0 flex-1 space-y-3'>
          <div className='flex items-start justify-between gap-2'>
            <div>
              <Label
                htmlFor={item.id}
                className='flex items-center gap-2 text-sm font-semibold'
              >
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

          <div>
            {item.item_type === 'checkbox' && (
              <div className='bg-muted/30 flex items-center space-x-3 rounded-lg p-2.5'>
                <Checkbox
                  id={item.id}
                  checked={response?.is_checked || false}
                  onCheckedChange={(checked) =>
                    handleCheckboxChange(checked === true)
                  }
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
                id={item.id}
                placeholder={item.placeholder || 'Enter your response...'}
                value={response?.response_value || ''}
                onChange={(e) => handleTextChange(e.target.value)}
                disabled={disabled}
                className='min-h-[80px] resize-none text-sm'
              />
            )}

            {item.item_type === 'number' && (
              <Input
                id={item.id}
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

            {item.item_type === 'select' && (
              <Select
                value={response?.response_value || ''}
                onValueChange={handleSelectChange}
                disabled={disabled}
              >
                <SelectTrigger
                  id={item.id}
                  className='max-w-[320px]'
                  aria-label={item.item_title}
                >
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

            {item.item_type === 'multi_select' && (
              <MultiSelect
                options={item.options ?? []}
                selected={parseMultiValue(response?.response_value)}
                onSelectionChange={handleMultiSelectChange}
                placeholder={item.placeholder || 'Select all that apply...'}
                disabled={disabled}
                className='max-w-[480px]'
              />
            )}

            {item.item_type === 'date' && (
              <Input
                id={item.id}
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
                id={item.id}
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

            {item.item_type === 'photo' && (
              <PhotoCapture
                existingUrl={response?.file_url ?? null}
                disabled={disabled}
                isSaving={uploading}
                onCapture={handlePhotoCapture}
                onRemove={async () => {
                  onResponseChange(item.id, {
                    file_url: undefined,
                    response_value: '',
                    file_metadata: {},
                  })
                }}
              />
            )}

            {item.item_type === 'signature' && (
              <SignaturePad
                existingUrl={response?.file_url ?? null}
                disabled={disabled}
                isSaving={uploading}
                onCapture={handleSignatureCapture}
              />
            )}
          </div>

          {response?.item_notes && (
            <div className='text-muted-foreground bg-muted/50 flex items-start gap-2 rounded-lg p-2.5 text-xs'>
              <FileText
                className='mt-0.5 h-3 w-3 shrink-0'
                aria-hidden='true'
              />
              {response.item_notes}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- Active Submission View ----------

interface ActiveSubmissionViewProps {
  submissionId: string
  onComplete: () => void
  onCancel: () => void
}

function ActiveSubmissionView({
  submissionId,
  onComplete,
  onCancel,
}: ActiveSubmissionViewProps) {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id ?? ''

  const {
    useSubmissionBundle,
    upsertResponse,
    submitChecklist,
    isSubmittingChecklist,
  } = useStandardWork()
  // One RPC instead of three parallel queries (submission + responses + items).
  // The bundle returns a hydrated submission (with template + area joined) and
  // an array of items already filtered to the ones present on the submission.
  const {
    data: bundle,
    isLoading: bundleLoading,
    isError: bundleError,
  } = useSubmissionBundle(submissionId)

  const submission = bundle?.submission
  const responses = useMemo(() => bundle?.responses ?? [], [bundle])
  const items = useMemo(() => bundle?.items ?? [], [bundle])

  const [localResponses, setLocalResponses] = useState<
    Record<string, Partial<StandardWorkResponse>>
  >({})
  const [isSaving, setIsSaving] = useState(false)
  const [statusAnnouncement, setStatusAnnouncement] = useState('')
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({})
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  )
  const pendingSavesRef = useRef(0)
  // Mirror localResponses in a ref so flush handlers can read the latest
  // state without listing it as a dependency (avoids stale closure issues
  // when the user closes the tab mid-edit).
  const localResponsesRef = useRef<
    Record<string, Partial<StandardWorkResponse>>
  >({})
  useEffect(() => {
    localResponsesRef.current = localResponses
  }, [localResponses])

  // Seed local state from server only on the first time responses arrive --
  // re-runs when the server refetches would otherwise stomp in-flight edits.
  const seededRef = useRef(false)
  useEffect(() => {
    if (!seededRef.current && responses.length > 0) {
      const responseMap: Record<string, Partial<StandardWorkResponse>> = {}
      responses.forEach((r) => {
        responseMap[r.item_id] = r
      })
      setLocalResponses(responseMap)
      seededRef.current = true
    }
  }, [responses])

  useEffect(() => {
    const timers = saveTimersRef.current
    return () => {
      Object.values(timers).forEach(clearTimeout)
    }
  }, [])

  // Flush a single item's pending payload bypassing the debounce timer.
  const flushItem = useCallback(
    async (itemId: string, payload?: Partial<StandardWorkResponse>) => {
      const timer = saveTimersRef.current[itemId]
      if (timer) {
        clearTimeout(timer)
        delete saveTimersRef.current[itemId]
      }
      const fullResponse = payload || {
        ...localResponsesRef.current[itemId],
        item_id: itemId,
        submission_id: submissionId,
      }
      pendingSavesRef.current++
      setIsSaving(true)
      try {
        await upsertResponse(fullResponse)
      } catch {
        // mutation toasts on persistent failure
      } finally {
        pendingSavesRef.current--
        if (pendingSavesRef.current === 0) {
          setIsSaving(false)
          setStatusAnnouncement('Saved')
        }
      }
    },
    [submissionId, upsertResponse]
  )

  // Flush every still-pending debounced save. Used on Save & Exit and on tab
  // hide / beforeunload so in-flight edits aren't silently dropped.
  const flushAllPending = useCallback(async () => {
    const pendingItemIds = Object.keys(saveTimersRef.current)
    if (pendingItemIds.length === 0) return
    await Promise.all(pendingItemIds.map((id) => flushItem(id)))
  }, [flushItem])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Best effort: fire and forget. Browsers typically allow short
        // synchronous-ish work before they actually pause the tab.
        flushAllPending()
      }
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(saveTimersRef.current).length > 0) {
        flushAllPending()
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [flushAllPending])

  // Debounced save -- 600ms inactivity per item. Reads `payload` directly
  // rather than re-deriving from React state to avoid stale-merge bugs.
  const debouncedSave = useCallback(
    (itemId: string, payload: Partial<StandardWorkResponse>) => {
      if (saveTimersRef.current[itemId]) {
        clearTimeout(saveTimersRef.current[itemId])
      }
      saveTimersRef.current[itemId] = setTimeout(() => {
        delete saveTimersRef.current[itemId]
        flushItem(itemId, payload)
      }, 600)
    },
    [flushItem]
  )

  const handleResponseChange = useCallback(
    (itemId: string, value: Partial<StandardWorkResponse>) => {
      // Functional setState so we always merge against the latest snapshot,
      // including concurrent rapid edits from different items.
      let merged: Partial<StandardWorkResponse> = {}
      setLocalResponses((prev) => {
        merged = {
          ...prev[itemId],
          ...value,
          item_id: itemId,
          submission_id: submissionId,
        }
        return { ...prev, [itemId]: merged }
      })

      const itemType = items.find((i) => i.id === itemId)?.item_type
      const isImmediate =
        itemType === 'checkbox' ||
        itemType === 'select' ||
        itemType === 'multi_select' ||
        itemType === 'photo' ||
        itemType === 'signature'

      setStatusAnnouncement('Saving…')

      if (isImmediate) {
        flushItem(itemId, merged)
      } else {
        debouncedSave(itemId, merged)
      }
    },
    [submissionId, items, debouncedSave, flushItem]
  )

  const visibleItems = useMemo(
    () => items.filter((item) => isItemVisible(item, localResponses)),
    [items, localResponses]
  )

  const requiredVisibleItems = useMemo(
    () => visibleItems.filter((i) => i.is_required),
    [visibleItems]
  )

  const handleSubmit = async () => {
    // Flush any debounced saves before validating so the latest state is
    // both in the UI and on the server.
    await flushAllPending()

    const missingRequired = requiredVisibleItems.filter((item) => {
      const response = localResponses[item.id]
      if (!response) return true
      if (item.item_type === 'checkbox') return !response.is_checked
      if (item.item_type === 'photo' || item.item_type === 'signature')
        return !response.file_url
      if (item.item_type === 'multi_select')
        return parseMultiValue(response.response_value).length === 0
      return !response.response_value
    })

    if (missingRequired.length > 0) {
      setStatusAnnouncement(
        `${missingRequired.length} required item${missingRequired.length === 1 ? '' : 's'} remaining`
      )
      toast.error(
        `Please complete all required items (${missingRequired.length} remaining)`
      )
      return
    }

    try {
      await submitChecklist(submissionId)
      setStatusAnnouncement('Submitted')
      onComplete()
    } catch (error) {
      logger.error('Submit error:', error)
    }
  }

  const handleSaveAndExit = async () => {
    await flushAllPending()
    onCancel()
  }

  const groupedItems = useMemo(() => {
    const groups: Record<string, StandardWorkItem[]> = {}
    visibleItems.forEach((item) => {
      const section = item.section_name || 'General'
      if (!groups[section]) groups[section] = []
      groups[section].push(item)
    })
    return groups
  }, [visibleItems])

  // Required-only completion percentage so optional items don't drag the
  // progress number down when most fields are nice-to-haves.
  const completedRequired = requiredVisibleItems.filter((item) => {
    const response = localResponses[item.id]
    if (!response) return false
    if (item.item_type === 'checkbox') return !!response.is_checked
    if (item.item_type === 'photo' || item.item_type === 'signature')
      return !!response.file_url
    if (item.item_type === 'multi_select')
      return parseMultiValue(response.response_value).length > 0
    return !!response.response_value && response.response_value !== ''
  }).length

  const completedTotal = visibleItems.filter((item) => {
    const response = localResponses[item.id]
    if (!response) return false
    if (item.item_type === 'checkbox') return !!response.is_checked
    if (item.item_type === 'photo' || item.item_type === 'signature')
      return !!response.file_url
    if (item.item_type === 'multi_select')
      return parseMultiValue(response.response_value).length > 0
    return !!response.response_value && response.response_value !== ''
  }).length

  const requiredProgress =
    requiredVisibleItems.length > 0
      ? (completedRequired / requiredVisibleItems.length) * 100
      : completedTotal === visibleItems.length
        ? 100
        : 0
  const totalProgress =
    visibleItems.length > 0 ? (completedTotal / visibleItems.length) * 100 : 0
  const isSubmitted = submission?.status === 'submitted'

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  const getSectionCompletion = (sectionItems: StandardWorkItem[]) => {
    const completed = sectionItems.filter((item) => {
      const response = localResponses[item.id]
      if (!response) return false
      if (item.item_type === 'checkbox') return !!response.is_checked
      if (item.item_type === 'photo' || item.item_type === 'signature')
        return !!response.file_url
      if (item.item_type === 'multi_select')
        return parseMultiValue(response.response_value).length > 0
      return !!response.response_value && response.response_value !== ''
    }).length
    return { completed, total: sectionItems.length }
  }

  if (bundleLoading) {
    return (
      <div className='mx-auto max-w-4xl space-y-4'>
        <Skeleton className='h-10 w-48' />
        <Skeleton className='h-6 w-full' />
        <Skeleton className='h-40 w-full rounded-xl' />
        <Skeleton className='h-40 w-full rounded-xl' />
      </div>
    )
  }

  if (bundleError || !submission) {
    return (
      <Alert variant='destructive' className='mx-auto max-w-4xl'>
        <AlertCircle className='h-4 w-4' />
        <AlertDescription>
          {bundleError
            ? "Couldn't load this submission. It may have been deleted, or you may not have permission to view it."
            : 'Submission not found. It may have been deleted.'}
        </AlertDescription>
      </Alert>
    )
  }

  let globalIndex = 0

  return (
    <div className='mx-auto max-w-4xl space-y-6'>
      {/* Polite live region: only screen readers see this. */}
      <p
        role='status'
        aria-live='polite'
        aria-atomic='true'
        className='sr-only'
      >
        {statusAnnouncement}
      </p>

      <div className='flex items-center gap-3'>
        <Button
          variant='ghost'
          size='sm'
          onClick={handleSaveAndExit}
          className='text-muted-foreground hover:text-foreground h-8 gap-1.5'
          aria-label='Save progress and return to dashboard'
        >
          <ArrowLeft className='h-4 w-4' />
          Back to Dashboard
        </Button>
      </div>

      <Card className='overflow-hidden'>
        <div className='from-primary/60 to-primary/20 h-1.5 bg-linear-to-r' />
        <CardContent className='p-6'>
          <div className='flex items-start justify-between gap-4'>
            <div className='flex items-start gap-4'>
              <div className='bg-primary/10 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl'>
                <ClipboardCheck
                  className='text-primary h-6 w-6'
                  aria-hidden='true'
                />
              </div>
              <div>
                <h2 className='text-lg font-bold'>
                  {submission.template?.template_name}
                </h2>
                <div className='text-muted-foreground mt-1 flex items-center gap-3 text-sm'>
                  {submission.working_area?.area_name && (
                    <span className='flex items-center gap-1'>
                      <MapPin className='h-3.5 w-3.5' aria-hidden='true' />
                      {submission.working_area.area_name}
                    </span>
                  )}
                  <span className='flex items-center gap-1'>
                    <Calendar className='h-3.5 w-3.5' aria-hidden='true' />
                    {new Date(submission.shift_date).toLocaleDateString(
                      userLocale,
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

          <div className='mt-5 space-y-2'>
            <div className='flex items-center justify-between text-sm'>
              <div className='flex items-center gap-2'>
                <span className='text-muted-foreground'>
                  {requiredVisibleItems.length > 0
                    ? 'Required progress'
                    : 'Progress'}
                </span>
                {isSaving && (
                  <span className='text-muted-foreground flex items-center gap-1 text-xs'>
                    <Loader2
                      className='h-3 w-3 animate-spin'
                      aria-hidden='true'
                    />
                    Saving
                  </span>
                )}
              </div>
              <span className='font-semibold'>
                {requiredVisibleItems.length > 0
                  ? `${completedRequired} / ${requiredVisibleItems.length}`
                  : `${completedTotal} / ${visibleItems.length}`}
                <span className='text-muted-foreground ml-1 font-normal'>
                  (
                  {Math.round(
                    requiredVisibleItems.length > 0
                      ? requiredProgress
                      : totalProgress
                  )}
                  %)
                </span>
              </span>
            </div>
            <Progress
              value={
                requiredVisibleItems.length > 0
                  ? requiredProgress
                  : totalProgress
              }
              className='h-2.5'
            />
            {requiredVisibleItems.length > 0 &&
              completedTotal !== visibleItems.length && (
                <p className='text-muted-foreground text-[11px]'>
                  All items: {completedTotal} of {visibleItems.length} (
                  {Math.round(totalProgress)}%)
                </p>
              )}
          </div>
        </CardContent>
      </Card>

      {submission.template?.instructions && (
        <Alert className='border-blue-500/20 bg-blue-500/5'>
          <FileText className='h-4 w-4 text-blue-500' />
          <AlertDescription className='text-sm'>
            {submission.template.instructions}
          </AlertDescription>
        </Alert>
      )}

      <div className='space-y-4'>
        {Object.entries(groupedItems).map(([section, sectionItems]) => {
          const { completed, total } = getSectionCompletion(sectionItems)
          const isCollapsed = !!collapsedSections[section]
          const sectionComplete = completed === total && total > 0
          const startIndex = globalIndex
          globalIndex += sectionItems.length
          const sectionId = `sw-section-${section.replace(/\s+/g, '-').toLowerCase()}`

          return (
            <Card
              key={section}
              className={cn(
                'overflow-hidden',
                sectionComplete && 'border-green-500/20'
              )}
            >
              <CardHeader className='p-0'>
                <button
                  type='button'
                  onClick={() => toggleSection(section)}
                  aria-expanded={!isCollapsed}
                  aria-controls={sectionId}
                  className='hover:bg-accent/30 focus-visible:ring-ring w-full p-4 transition-colors focus-visible:ring-2 focus-visible:ring-inset'
                >
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-3'>
                      <ChevronDown
                        className={cn(
                          'text-muted-foreground h-4 w-4 transition-transform duration-200',
                          isCollapsed && '-rotate-90'
                        )}
                        aria-hidden='true'
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
                      <CheckCircle2
                        className='h-4 w-4 text-green-500'
                        aria-hidden='true'
                      />
                    )}
                  </div>
                </button>
              </CardHeader>

              {!isCollapsed && (
                <CardContent id={sectionId} className='space-y-3 p-4 pt-0'>
                  {sectionItems.map((item, idx) => (
                    <ChecklistItemRenderer
                      key={item.id}
                      item={item}
                      response={localResponses[item.id]}
                      onResponseChange={handleResponseChange}
                      disabled={isSubmitted}
                      index={startIndex + idx}
                      organizationId={organizationId}
                      submissionId={submissionId}
                    />
                  ))}
                </CardContent>
              )}
            </Card>
          )
        })}
      </div>

      {!isSubmitted && (
        <div className='bg-background/95 sticky bottom-0 -mx-6 mt-6 border-t px-6 py-4 backdrop-blur-sm'>
          <div className='mx-auto flex max-w-4xl items-center justify-between'>
            <div className='text-muted-foreground text-sm'>
              {requiredVisibleItems.length > 0 &&
              completedRequired === requiredVisibleItems.length ? (
                <span className='flex items-center gap-1.5 font-medium text-green-600 dark:text-green-400'>
                  <CheckCircle2 className='h-4 w-4' aria-hidden='true' />
                  Required items complete — ready to submit
                </span>
              ) : requiredVisibleItems.length > 0 ? (
                <span>
                  {requiredVisibleItems.length - completedRequired} required
                  item
                  {requiredVisibleItems.length - completedRequired !== 1
                    ? 's'
                    : ''}{' '}
                  remaining
                </span>
              ) : completedTotal === visibleItems.length ? (
                <span className='flex items-center gap-1.5 font-medium text-green-600 dark:text-green-400'>
                  <CheckCircle2 className='h-4 w-4' aria-hidden='true' />
                  All items completed — ready to submit
                </span>
              ) : (
                <span>
                  {visibleItems.length - completedTotal} item
                  {visibleItems.length - completedTotal !== 1 ? 's' : ''}{' '}
                  remaining
                </span>
              )}
            </div>
            <div className='flex items-center gap-3'>
              <Button
                variant='ghost'
                onClick={handleSaveAndExit}
                className='h-9'
              >
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

// ---------- Main Checklist Component ----------

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
      // The service throws a structured error for already-submitted duplicates;
      // surface a friendlier toast in that case.
      const e = error as Error & { code?: string }
      if (e?.code === 'DUPLICATE_SUBMISSION') {
        toast.error(
          'This checklist has already been submitted today. View it in Recent Activity.'
        )
        return
      }
      logger.error('Start checklist error:', error)
    }
  }

  const handleContinueChecklist = (submissionId: string) => {
    setActiveSubmissionId(submissionId)
  }

  const handleChecklistComplete = () => {
    setActiveSubmissionId(null)
  }

  const handleChecklistCancel = () => {
    setActiveSubmissionId(null)
  }

  if (activeSubmissionId) {
    return (
      <ActiveSubmissionView
        submissionId={activeSubmissionId}
        onComplete={handleChecklistComplete}
        onCancel={handleChecklistCancel}
      />
    )
  }

  return (
    <StandardWorkDashboard
      onStartChecklist={handleStartChecklist}
      onContinueChecklist={handleContinueChecklist}
    />
  )
}

// Created and developed by Jai Singh
