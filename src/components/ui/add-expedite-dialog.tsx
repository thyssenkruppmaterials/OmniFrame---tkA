// Created and developed by Jai Singh
/**
 * Add Expedite Part Dialog
 *
 * Imports Transfer Orders from the clipboard (same paste flow as the normal
 * "Add to Kit Build Plan" dialog) and turns EACH imported TO row into one
 * stand-alone expedite part (shown in the Expedites tab). The part number /
 * description / quantity come from the TO, so they are NOT entered by hand —
 * the operator only sets the shared delivery-time priority (+ optional reason
 * code and requested-by date) that applies to every imported part.
 *
 * Created: 2026-04-28 — reworked 2026-06-06 to a TO-import flow.
 */
import * as React from 'react'
import { format } from 'date-fns'
import {
  AlertCircle,
  CalendarIcon,
  CheckCircle2,
  ClipboardPaste,
  Clock,
  Loader2,
  X,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  EXPEDITE_DELIVERY_TIMES,
  type ExpediteDeliveryTime,
} from '@/lib/supabase/rr-kitting-data.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import {
  parseClipboardData,
  type TransferOrderRecord,
} from '@/components/ui/add-kit-build-plan-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const REASON_CODES = [
  { value: 'shortage', label: 'Shortage' },
  { value: 'damage', label: 'Damaged on receipt' },
  { value: 'engineering_change', label: 'Engineering change' },
  { value: 'customer_request', label: 'Customer request' },
  { value: 'supplier_delay', label: 'Supplier delay' },
  { value: 'other', label: 'Other' },
]

export interface ExpediteFormData {
  // Each imported TO row becomes one stand-alone expedite part.
  importedTOs: TransferOrderRecord[]
  // Shared priority / metadata applied to every imported part.
  deliveryTime: ExpediteDeliveryTime
  reasonCode: string
  requestedByDate: Date | undefined
}

interface AddExpediteDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: ExpediteFormData) => Promise<void>
}

const initialFormData: ExpediteFormData = {
  importedTOs: [],
  deliveryTime: 'critical',
  reasonCode: '',
  requestedByDate: undefined,
}

export function AddExpediteDialog({
  isOpen,
  onOpenChange,
  onSubmit,
}: AddExpediteDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [isImporting, setIsImporting] = React.useState(false)
  const [calendarOpen, setCalendarOpen] = React.useState(false)
  const [formData, setFormData] =
    React.useState<ExpediteFormData>(initialFormData)

  // Re-seed the form each time the dialog opens.
  React.useEffect(() => {
    if (isOpen) {
      setFormData(initialFormData)
    }
  }, [isOpen])

  const handleField = <K extends keyof ExpediteFormData>(
    key: K,
    value: ExpediteFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }

  const handleImportFromClipboard = async () => {
    setIsImporting(true)
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.error('Clipboard is empty', {
          description: 'Copy the Transfer Order rows from Excel and try again.',
        })
        return
      }

      const records = parseClipboardData(text)
      if (records.length === 0) {
        toast.error('No valid Transfer Orders found', {
          description:
            'Ensure rows have at least 11 columns including a Transfer Order Number.',
        })
        return
      }

      setFormData((prev) => ({ ...prev, importedTOs: records }))
      toast.success(
        `Imported ${records.length} expedite part${records.length === 1 ? '' : 's'}`,
        { description: 'Each Transfer Order row becomes one expedite part.' }
      )
    } catch (error) {
      logger.error('[AddExpediteDialog] clipboard read error:', error)
      toast.error('Failed to read clipboard', {
        description: 'Please allow clipboard access and try again.',
      })
    } finally {
      setIsImporting(false)
    }
  }

  const handleClearImportedData = () => {
    setFormData((prev) => ({ ...prev, importedTOs: [] }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.importedTOs.length === 0) return
    setIsSubmitting(true)
    try {
      await onSubmit(formData)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    if (!isSubmitting) {
      onOpenChange(false)
    }
  }

  const isFormValid =
    formData.importedTOs.length > 0 && formData.deliveryTime != null

  const deliveryDescription = React.useMemo(
    () =>
      EXPEDITE_DELIVERY_TIMES.find((dt) => dt.value === formData.deliveryTime)
        ?.description ?? '',
    [formData.deliveryTime]
  )

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className='max-h-[80vh] overflow-y-auto sm:max-w-[640px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Zap className='h-5 w-5' />
            Add Expedite Part
          </DialogTitle>
          <DialogDescription>
            Import Transfer Orders from the clipboard — each TO row becomes one
            stand-alone expedite part in the Expedites tab. The part number,
            description, and quantity come from the TO; you only set the
            delivery-time priority below.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldSet className='py-3'>
            <FieldLegend className='sr-only'>Expedite Details</FieldLegend>

            <FieldGroup className='gap-5'>
              {/* Import TOs from clipboard */}
              <Field>
                <FieldLabel>
                  Import Transfer Orders
                  <span className='text-destructive ml-1'>*</span>
                </FieldLabel>
                <div className='space-y-3'>
                  <div className='flex items-center gap-3'>
                    <Button
                      type='button'
                      variant='outline'
                      onClick={handleImportFromClipboard}
                      disabled={isSubmitting || isImporting}
                      className='flex-1'
                    >
                      {isImporting ? (
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      ) : (
                        <ClipboardPaste className='mr-2 h-4 w-4' />
                      )}
                      {isImporting
                        ? 'Importing...'
                        : 'Import TOs from Clipboard'}
                    </Button>

                    {formData.importedTOs.length > 0 && (
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        onClick={handleClearImportedData}
                        disabled={isSubmitting}
                        className='shrink-0'
                      >
                        <X className='h-4 w-4' />
                        <span className='sr-only'>Clear imported data</span>
                      </Button>
                    )}
                  </div>

                  {formData.importedTOs.length > 0 && (
                    <div className='rounded-md border border-green-500/30 bg-green-500/10 p-3'>
                      <div className='flex items-center gap-2 text-sm text-green-700 dark:text-green-400'>
                        <CheckCircle2 className='h-4 w-4' />
                        <span className='font-medium'>
                          {formData.importedTOs.length} expedite part
                          {formData.importedTOs.length === 1 ? '' : 's'}{' '}
                          imported
                        </span>
                      </div>
                      <div className='mt-2 flex flex-wrap gap-1.5'>
                        {formData.importedTOs.slice(0, 6).map((to, idx) => (
                          <Badge
                            key={idx}
                            variant='secondary'
                            className='font-mono text-xs'
                          >
                            {to.material || to.transferOrderNumber || '—'}
                          </Badge>
                        ))}
                        {formData.importedTOs.length > 6 && (
                          <Badge variant='outline' className='text-xs'>
                            +{formData.importedTOs.length - 6} more
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <FieldDescription>
                  Copy the TO rows from Excel/SAP, then click import. Each row
                  is added as its own expedite part.
                </FieldDescription>
              </Field>

              {/* Delivery time + reason (applied to every imported part) */}
              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                <Field>
                  <FieldLabel htmlFor='expedite-delivery'>
                    Delivery Time
                    <span className='text-destructive ml-1'>*</span>
                  </FieldLabel>
                  <Select
                    value={formData.deliveryTime}
                    onValueChange={(v: ExpediteDeliveryTime) =>
                      handleField('deliveryTime', v)
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger id='expedite-delivery' className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPEDITE_DELIVERY_TIMES.map((dt) => (
                        <SelectItem key={dt.value} value={dt.value}>
                          {dt.value === 'critical' ? (
                            <span className='flex items-center gap-2'>
                              <AlertCircle className='h-3.5 w-3.5 text-red-500' />
                              {dt.label}
                            </span>
                          ) : (
                            <span className='flex items-center gap-2'>
                              <Clock className='h-3.5 w-3.5' />
                              {dt.label}
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {deliveryDescription && (
                    <FieldDescription>{deliveryDescription}</FieldDescription>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor='expedite-reason'>Reason Code</FieldLabel>
                  <Select
                    value={formData.reasonCode || '_none'}
                    onValueChange={(v) =>
                      handleField('reasonCode', v === '_none' ? '' : v)
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger id='expedite-reason' className='w-full'>
                      <SelectValue placeholder='Optional' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='_none'>None</SelectItem>
                      {REASON_CODES.map((rc) => (
                        <SelectItem key={rc.value} value={rc.value}>
                          {rc.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {/* Requested-by date */}
              <Field>
                <FieldLabel htmlFor='expedite-requested-by'>
                  Requested By Date
                </FieldLabel>
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id='expedite-requested-by'
                      type='button'
                      variant='outline'
                      disabled={isSubmitting}
                      className={cn(
                        'w-full justify-start text-left font-normal',
                        !formData.requestedByDate && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className='mr-2 h-4 w-4' />
                      {formData.requestedByDate
                        ? format(formData.requestedByDate, 'PPP')
                        : 'Select target date (optional)'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className='w-auto p-0' align='start'>
                    <Calendar
                      mode='single'
                      selected={formData.requestedByDate}
                      onSelect={(date) => {
                        handleField('requestedByDate', date)
                        setCalendarOpen(false)
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FieldDescription>
                  Optional. The date the expedited parts are needed by (applies
                  to every imported part).
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FieldSet>

          <DialogFooter className='gap-3'>
            <Button
              type='button'
              variant='outline'
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type='submit' disabled={isSubmitting || !isFormValid}>
              {isSubmitting ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Adding…
                </>
              ) : formData.importedTOs.length > 1 ? (
                `Add ${formData.importedTOs.length} Expedite Parts`
              ) : (
                'Add Expedite Part'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
