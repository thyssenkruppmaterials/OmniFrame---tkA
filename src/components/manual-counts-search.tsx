import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format, toZonedTime } from 'date-fns-tz'
import {
  AlertTriangle,
  Archive,
  Camera,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Edit3,
  FileText,
  Loader2,
  MoreHorizontal,
  Package,
  Plus,
  RotateCcw,
  Scan,
  Search,
  Target,
  Trash2,
  Upload,
  User,
  UserCheck,
  UserMinus,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import type {
  CycleCountData,
  CycleCountDataWithUser,
  CycleCountPriority,
} from '@/lib/supabase/cycle-count.service'
import { CycleCountService } from '@/lib/supabase/cycle-count.service'
import { locationValidationService } from '@/lib/supabase/location-validation.service'
import { materialValidationService } from '@/lib/supabase/material-validation.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import type { WsEvent } from '@/lib/work-service/types'
import { workServiceWs } from '@/lib/work-service/websocket'
import { ACTIVE_WORKERS_QUERY_KEY } from '@/hooks/use-active-workers'
import {
  CYCLE_COUNT_OPERATIONS_QUERY_KEY,
  CYCLE_COUNT_STATISTICS_QUERY_KEY,
  useCycleCountOperations,
} from '@/hooks/use-cycle-count-operations'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { AddCountsFromLX03Modal } from '@/components/add-counts-from-lx03-modal'
import { LiveOperatorStatus } from '@/components/live-operator-status'
import { UserAssignmentModal } from '@/components/user-assignment-modal'
import { WorkDistributionPanel } from '@/components/work-distribution-panel'

// EST Timezone formatting utility (formatDateTimeEST removed - was unused)

const formatDateEST = (dateString: string | null | undefined): string => {
  if (!dateString) return 'N/A'

  try {
    const date = new Date(dateString)
    const estTimezone = 'America/New_York'
    const zonedDate = toZonedTime(date, estTimezone)

    return format(zonedDate, 'MM/dd/yyyy', { timeZone: estTimezone })
  } catch (error) {
    logger.error('Date formatting error:', error)
    return 'Invalid Date'
  }
}

interface ManualCountsSearchProps {
  enableRealtime?: boolean
}

// TableColumn interface removed - was unused

interface SortConfig {
  key: string
  direction: 'asc' | 'desc'
}

// Status color mapping
const getStatusColor = (status: string): string => {
  switch (status) {
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300'
    case 'in_progress':
      return 'bg-blue-100 text-blue-800 border-blue-300'
    case 'completed':
      return 'bg-green-100 text-green-800 border-green-300'
    case 'variance_review':
      return 'bg-orange-100 text-orange-800 border-orange-300'
    case 'approved':
      return 'bg-green-100 text-green-800 border-green-300'
    case 'cancelled':
      return 'bg-red-100 text-red-800 border-red-300'
    case 'recount':
      return 'bg-purple-100 text-purple-800 border-purple-300'
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300'
  }
}

// Count type options for the selector
const COUNT_TYPE_OPTIONS = [
  { value: 'part_verification', label: 'Part Verification' },
  { value: 'quantity_check', label: 'Quantity Check' },
  { value: 're_count', label: 'Re-Count' },
  { value: 'second_count', label: 'Second Count' },
  { value: 'third_count', label: 'Third Count' },
  { value: '999_count', label: '999 Count' },
  { value: 'empty_location_check', label: 'Empty Location Check' },
  { value: 'cycle_count', label: 'Cycle Count' },
  { value: 'physical_count', label: 'Physical Count' },
  { value: 'spot_count', label: 'Spot Count' },
] as const

// Type for count_type values
type CountTypeValue = (typeof COUNT_TYPE_OPTIONS)[number]['value']

// Legacy Add Count Modal Component (deprecated - replaced by LX03 modal)
// Kept for potential fallback or manual entry scenarios
interface AddCountModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (countData: Partial<CycleCountData>) => Promise<void>
}

// @ts-expect-error - Legacy component kept for reference, not currently used
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const AddCountModal: React.FC<AddCountModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [formData, setFormData] = useState<
    Partial<CycleCountData> & { priority?: CycleCountPriority }
  >({
    material_number: '',
    material_description: '',
    location: '',
    warehouse: '',
    system_quantity: 0,
    counted_quantity: undefined,
    unit_of_measure: 'EA',
    count_type: 'quantity_check',
    priority: 'normal',
    counter_name: '',
    count_reason: '',
    batch_number: '',
    notes: '',
  })

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isValidatingLocation, setIsValidatingLocation] = useState(false)
  const [isValidatingMaterial, setIsValidatingMaterial] = useState(false)
  const [locationValidation, setLocationValidation] = useState<{
    isValid: boolean
    message?: string
  } | null>(null)
  const [materialValidation, setMaterialValidation] = useState<{
    isValid: boolean
    message?: string
    description?: string
  } | null>(null)

  // Calculate variance in real-time
  const varianceCalculation = useMemo(() => {
    if (formData.system_quantity != null && formData.counted_quantity != null) {
      const variance = formData.counted_quantity - formData.system_quantity
      let variancePercentage: number | null = null
      let requiresReview = false

      if (formData.system_quantity > 0) {
        variancePercentage =
          (Math.abs(variance) / formData.system_quantity) * 100
        requiresReview = variancePercentage > 10 || Math.abs(variance) > 10
      } else if (
        formData.system_quantity === 0 &&
        formData.counted_quantity !== 0
      ) {
        variancePercentage = null // Infinity case
        requiresReview = true
      }

      return { variance, variancePercentage, requiresReview }
    }
    return null
  }, [formData.system_quantity, formData.counted_quantity])

  // Validate location when it changes
  useEffect(() => {
    const validateLocation = async () => {
      if (!formData.location || formData.location.trim().length < 2) {
        setLocationValidation(null)
        return
      }

      setIsValidatingLocation(true)
      const result = await locationValidationService.validateLocationExists(
        formData.location
      )
      setLocationValidation({
        isValid: result.isValid,
        message: result.message,
      })
      setIsValidatingLocation(false)
    }

    const timer = setTimeout(validateLocation, 500) // Debounce
    return () => clearTimeout(timer)
  }, [formData.location])

  // Validate material when it changes
  useEffect(() => {
    const validateMaterial = async () => {
      if (
        !formData.material_number ||
        formData.material_number.trim().length < 2
      ) {
        setMaterialValidation(null)
        return
      }

      setIsValidatingMaterial(true)
      const result = await materialValidationService.validateMaterialExists(
        formData.material_number
      )
      setMaterialValidation({
        isValid: result.isValid,
        message: result.message,
        description: result.description,
      })

      // Auto-fill material description if found (uses functional update to avoid stale closure)
      if (result.description) {
        setFormData((prev) =>
          prev.material_description
            ? prev
            : { ...prev, material_description: result.description! }
        )
      }

      setIsValidatingMaterial(false)
    }

    const timer = setTimeout(validateMaterial, 500) // Debounce
    return () => clearTimeout(timer)
  }, [formData.material_number])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate required fields
    if (
      !formData.material_number ||
      !formData.location ||
      formData.system_quantity == null
    ) {
      toast.error('Please fill in all required fields')
      return
    }

    // Validate location exists
    if (locationValidation && !locationValidation.isValid) {
      toast.error(
        'Invalid location. Please verify the location exists in the warehouse system.'
      )
      return
    }

    // Warn if material doesn't exist (but allow submission)
    if (materialValidation && !materialValidation.isValid) {
      toast.warning(
        'Material not found in system. Count will be created but may need verification.'
      )
    }

    // Validate counted quantity if provided
    if (formData.counted_quantity != null && formData.counted_quantity < 0) {
      toast.error('Counted quantity cannot be negative')
      return
    }

    try {
      setIsSubmitting(true)
      await onSubmit(formData)

      // Reset form
      setFormData({
        material_number: '',
        material_description: '',
        location: '',
        warehouse: '',
        system_quantity: 0,
        counted_quantity: undefined,
        unit_of_measure: 'EA',
        count_type: 'cycle_count',
        priority: 'normal',
        counter_name: '',
        count_reason: '',
        batch_number: '',
        notes: '',
      })
      setLocationValidation(null)
      setMaterialValidation(null)
      onClose()
    } catch (error) {
      logger.error('Error submitting count:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className='max-h-[90vh] max-w-2xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Plus className='h-5 w-5' />
            Add New Count
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            {/* Material Number - Required */}
            <div>
              <Label htmlFor='material_number'>Material Number *</Label>
              <div className='relative'>
                <Input
                  id='material_number'
                  value={formData.material_number || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      material_number: e.target.value,
                    })
                  }
                  placeholder='Enter material number'
                  required
                  className={cn(
                    materialValidation !== null &&
                      (materialValidation.isValid
                        ? 'border-green-500'
                        : 'border-orange-500')
                  )}
                />
                {isValidatingMaterial && (
                  <Loader2 className='text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin' />
                )}
                {!isValidatingMaterial &&
                  materialValidation &&
                  (materialValidation.isValid ? (
                    <Check className='absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-green-500' />
                  ) : (
                    <AlertTriangle className='absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-orange-500' />
                  ))}
              </div>
              {materialValidation && (
                <p
                  className={cn(
                    'mt-1 text-xs',
                    materialValidation.isValid
                      ? 'text-green-600'
                      : 'text-orange-600'
                  )}
                >
                  {materialValidation.message}
                </p>
              )}
            </div>

            {/* Location - Required */}
            <div>
              <Label htmlFor='location'>Location *</Label>
              <div className='relative'>
                <Input
                  id='location'
                  value={formData.location || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, location: e.target.value })
                  }
                  placeholder='Enter location'
                  required
                  className={cn(
                    locationValidation !== null &&
                      (locationValidation.isValid
                        ? 'border-green-500'
                        : 'border-red-500')
                  )}
                />
                {isValidatingLocation && (
                  <Loader2 className='text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin' />
                )}
                {!isValidatingLocation &&
                  locationValidation &&
                  (locationValidation.isValid ? (
                    <Check className='absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-green-500' />
                  ) : (
                    <AlertTriangle className='absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-red-500' />
                  ))}
              </div>
              {locationValidation && (
                <p
                  className={cn(
                    'mt-1 text-xs',
                    locationValidation.isValid
                      ? 'text-green-600'
                      : 'text-red-600'
                  )}
                >
                  {locationValidation.message}
                </p>
              )}
            </div>

            {/* Material Description */}
            <div className='md:col-span-2'>
              <Label htmlFor='material_description'>Material Description</Label>
              <Input
                id='material_description'
                value={formData.material_description || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    material_description: e.target.value,
                  })
                }
                placeholder='Enter material description'
              />
            </div>

            {/* System Quantity - Required */}
            <div>
              <Label htmlFor='system_quantity'>System Quantity *</Label>
              <Input
                id='system_quantity'
                type='number'
                step='0.001'
                value={formData.system_quantity || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    system_quantity: parseFloat(e.target.value) || 0,
                  })
                }
                placeholder='0.000'
                required
              />
            </div>

            {/* Counted Quantity */}
            <div>
              <Label htmlFor='counted_quantity'>Counted Quantity</Label>
              <Input
                id='counted_quantity'
                type='number'
                step='0.001'
                value={formData.counted_quantity || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    counted_quantity: e.target.value
                      ? parseFloat(e.target.value)
                      : undefined,
                  })
                }
                placeholder='Enter counted quantity'
              />
            </div>

            {/* Variance Preview Card */}
            {varianceCalculation && (
              <div className='md:col-span-2'>
                <Card
                  className={cn(
                    'border-2',
                    varianceCalculation.requiresReview
                      ? 'border-orange-300 bg-orange-50 dark:bg-orange-950/20'
                      : 'border-green-300 bg-green-50 dark:bg-green-950/20'
                  )}
                >
                  <CardHeader className='pb-2'>
                    <CardTitle className='flex items-center gap-2 text-sm'>
                      {varianceCalculation.requiresReview ? (
                        <>
                          <AlertTriangle className='h-4 w-4 text-orange-600' />
                          <span className='text-orange-800 dark:text-orange-200'>
                            Variance Detected - Review Required
                          </span>
                        </>
                      ) : (
                        <>
                          <CheckCircle className='h-4 w-4 text-green-600' />
                          <span className='text-green-800 dark:text-green-200'>
                            Variance Within Acceptable Range
                          </span>
                        </>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-2'>
                    <div className='grid grid-cols-3 gap-3 text-sm'>
                      <div>
                        <p className='text-muted-foreground text-xs'>
                          Variance
                        </p>
                        <p
                          className={cn(
                            'font-semibold',
                            varianceCalculation.variance > 0
                              ? 'text-orange-600'
                              : varianceCalculation.variance < 0
                                ? 'text-red-600'
                                : 'text-gray-600'
                          )}
                        >
                          {varianceCalculation.variance > 0 ? '+' : ''}
                          {varianceCalculation.variance}{' '}
                          {formData.unit_of_measure || 'EA'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground text-xs'>
                          Percentage
                        </p>
                        <p className='font-semibold text-orange-600'>
                          {varianceCalculation.variancePercentage === null
                            ? 'N/A (Zero base)'
                            : `${varianceCalculation.variancePercentage.toFixed(2)}%`}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground text-xs'>Status</p>
                        <Badge
                          variant={
                            varianceCalculation.requiresReview
                              ? 'destructive'
                              : 'default'
                          }
                          className='text-xs'
                        >
                          {varianceCalculation.requiresReview
                            ? 'Requires Recount'
                            : 'Acceptable'}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Priority Selection */}
            <div>
              <Label htmlFor='priority'>Priority Level</Label>
              <Select
                value={formData.priority || 'normal'}
                onValueChange={(value: CycleCountPriority) =>
                  setFormData({ ...formData, priority: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder='Select priority level' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='critical'>
                    <div className='flex items-center gap-2'>
                      <div className='h-2 w-2 rounded-full bg-red-500'></div>
                      Critical
                    </div>
                  </SelectItem>
                  <SelectItem value='hot'>
                    <div className='flex items-center gap-2'>
                      <div className='h-2 w-2 rounded-full bg-orange-500'></div>
                      Hot
                    </div>
                  </SelectItem>
                  <SelectItem value='normal'>
                    <div className='flex items-center gap-2'>
                      <div className='h-2 w-2 rounded-full bg-blue-500'></div>
                      Normal
                    </div>
                  </SelectItem>
                  <SelectItem value='low'>
                    <div className='flex items-center gap-2'>
                      <div className='h-2 w-2 rounded-full bg-gray-500'></div>
                      Low
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Unit of Measure */}
            <div>
              <Label htmlFor='unit_of_measure'>Unit of Measure</Label>
              <Input
                id='unit_of_measure'
                value={formData.unit_of_measure || 'EA'}
                onChange={(e) =>
                  setFormData({ ...formData, unit_of_measure: e.target.value })
                }
                placeholder='EA'
              />
            </div>

            {/* Count Type Selection */}
            <div className='md:col-span-2'>
              <Label htmlFor='count_type'>Count Type *</Label>
              <Select
                value={formData.count_type || 'quantity_check'}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    count_type: value as CountTypeValue,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder='Select count type' />
                </SelectTrigger>
                <SelectContent>
                  {COUNT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='text-muted-foreground mt-1 text-xs'>
                Select the type of count to determine the appropriate workflow
              </p>
            </div>
          </div>

          <div className='flex justify-end gap-2 pt-4'>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className='mr-2 h-4 w-4' />
                  Add Count
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Edit Count Modal Component - Enhanced with Tabs and Better Organization
interface EditCountModalProps {
  isOpen: boolean
  onClose: () => void
  countData: CycleCountDataWithUser | null
  onInitiateRecount: (countId: string, reason?: string) => Promise<void>
  onApprove: (countId: string, countNumber: string) => Promise<void>
}

const EditCountModal: React.FC<EditCountModalProps> = ({
  isOpen,
  onClose,
  countData,
  onInitiateRecount,
  onApprove,
}) => {
  const [recountReason, setRecountReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset state when modal opens
  React.useEffect(() => {
    if (isOpen && countData) {
      setRecountReason('')
    }
  }, [isOpen, countData])

  // Clean up body pointer-events when dialog closes
  React.useEffect(() => {
    if (!isOpen) {
      document.body.style.pointerEvents = ''
    }
  }, [isOpen])

  // Handle close with explicit state check
  const handleClose = React.useCallback(
    (open: boolean) => {
      if (!open) {
        onClose()
        setTimeout(() => {
          document.body.style.pointerEvents = ''
        }, 0)
      }
    },
    [onClose]
  )

  const handleInitiateRecount = async () => {
    if (!countData) return

    try {
      setIsSubmitting(true)
      await onInitiateRecount(countData.id, recountReason || undefined)
      setRecountReason('')
      onClose()
    } catch (error) {
      logger.error('Error initiating recount:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!countData) return null

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
        <DialogHeader className='sr-only'>
          <DialogTitle>Cycle Count Details</DialogTitle>
        </DialogHeader>

        {countData && (
          <div className='space-y-5'>
            {/* Count Number Header - Baseball Card Style */}
            <Card className='border-primary/20 from-background to-muted/30 border-2 bg-linear-to-r'>
              <CardHeader className='pb-4'>
                <div className='flex items-start justify-between'>
                  <div className='flex-1'>
                    <CardTitle className='mb-2 flex items-center gap-3 text-2xl font-bold'>
                      <div className='bg-primary/10 rounded-lg p-2'>
                        <Package className='text-primary h-5 w-5' />
                      </div>
                      <span className='font-mono'>
                        {countData.count_number}
                      </span>
                    </CardTitle>
                    <p className='text-muted-foreground ml-12 text-sm'>
                      {countData.material_number} —{' '}
                      {countData.material_description || 'No description'}
                    </p>
                  </div>
                  <div className='flex flex-col items-end gap-2'>
                    <Badge variant='secondary' className='text-xs'>
                      Warehouse: {countData.warehouse || 'N/A'}
                    </Badge>
                    <div className='flex items-center gap-1.5'>
                      <span
                        className={cn(
                          'h-2.5 w-2.5 rounded-full',
                          countData.priority === 'critical' &&
                            'animate-pulse bg-red-500',
                          countData.priority === 'hot' && 'bg-orange-500',
                          countData.priority === 'normal' && 'bg-blue-500',
                          countData.priority === 'low' && 'bg-gray-400',
                          !countData.priority && 'bg-blue-500'
                        )}
                      />
                      <Badge
                        className={CycleCountService.getPriorityColor(
                          countData.priority || 'normal'
                        )}
                      >
                        {CycleCountService.getPriorityLabel(
                          countData.priority || 'normal'
                        )}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Baseball Card Body */}
            <div className='grid grid-cols-3 gap-6 px-2'>
              {/* LEFT: Photo Placeholder */}
              <div className='col-span-1'>
                <Card className='border-muted overflow-hidden border-2'>
                  <div className='bg-muted/30 relative flex aspect-3/4 items-center justify-center'>
                    <div className='text-center'>
                      <Camera className='text-muted-foreground mx-auto mb-2 h-16 w-16' />
                      <p className='text-muted-foreground px-4 text-sm'>
                        No photo available
                      </p>
                    </div>
                  </div>
                </Card>

                {/* Location Badge */}
                <div className='mt-4'>
                  <div className='bg-muted/50 border-muted rounded-lg border-2 p-3 text-center'>
                    <p className='text-muted-foreground mb-1 text-xs tracking-wide uppercase'>
                      Location
                    </p>
                    <p className='font-mono text-lg font-bold'>
                      {countData.location}
                    </p>
                  </div>
                </div>
              </div>

              {/* RIGHT: Info Sections */}
              <div className='col-span-2 space-y-4'>
                {/* INVENTORY STATS */}
                <Card className='border-muted border-2'>
                  <CardHeader className='pb-3'>
                    <CardTitle className='flex items-center gap-2 text-sm font-semibold tracking-wide uppercase'>
                      <Package className='h-4 w-4' />
                      Inventory Stats
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-3'>
                    <div className='grid grid-cols-3 gap-3'>
                      {/* System Quantity */}
                      <div className='rounded-lg border-2 border-green-300 bg-green-100 p-3 text-center dark:border-green-800 dark:bg-green-950/30'>
                        <p className='mb-1 text-xs tracking-wide text-green-700 uppercase dark:text-green-300'>
                          System
                        </p>
                        <p className='text-3xl font-bold text-green-800 dark:text-green-200'>
                          {countData.system_quantity}
                        </p>
                        <p className='mt-1 text-xs text-green-600 dark:text-green-400'>
                          {countData.unit_of_measure || 'EA'}
                        </p>
                      </div>

                      {/* Counted Quantity */}
                      <div className='rounded-lg border-2 border-blue-300 bg-blue-100 p-3 text-center dark:border-blue-800 dark:bg-blue-950/30'>
                        <p className='mb-1 text-xs tracking-wide text-blue-700 uppercase dark:text-blue-300'>
                          Counted
                        </p>
                        <p className='text-3xl font-bold text-blue-800 dark:text-blue-200'>
                          {countData.counted_quantity != null
                            ? countData.counted_quantity
                            : 0}
                        </p>
                        <p className='mt-1 text-xs text-blue-600 dark:text-blue-400'>
                          {countData.unit_of_measure || 'EA'}
                        </p>
                      </div>

                      {/* Variance */}
                      <div
                        className={cn(
                          'rounded-lg border-2 p-3 text-center',
                          countData.variance_quantity == null
                            ? 'border-gray-300 bg-gray-100 dark:border-gray-800 dark:bg-gray-950/30'
                            : countData.requires_recount
                              ? 'border-red-300 bg-red-100 dark:border-red-800 dark:bg-red-950/30'
                              : 'border-yellow-300 bg-yellow-100 dark:border-yellow-800 dark:bg-yellow-950/30'
                        )}
                      >
                        <p
                          className={cn(
                            'mb-1 text-xs tracking-wide uppercase',
                            countData.variance_quantity == null
                              ? 'text-gray-700 dark:text-gray-300'
                              : countData.requires_recount
                                ? 'text-red-700 dark:text-red-300'
                                : 'text-yellow-700 dark:text-yellow-300'
                          )}
                        >
                          Variance
                        </p>
                        <p
                          className={cn(
                            'text-3xl font-bold',
                            countData.variance_quantity == null
                              ? 'text-gray-800 dark:text-gray-200'
                              : countData.requires_recount
                                ? 'text-red-800 dark:text-red-200'
                                : 'text-yellow-800 dark:text-yellow-200'
                          )}
                        >
                          {countData.variance_quantity != null
                            ? (countData.variance_quantity > 0 ? '+' : '') +
                              countData.variance_quantity
                            : 'N/A'}
                        </p>
                        <p
                          className={cn(
                            'mt-1 text-xs',
                            countData.variance_quantity == null
                              ? 'text-gray-600 dark:text-gray-400'
                              : countData.requires_recount
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-yellow-600 dark:text-yellow-400'
                          )}
                        >
                          {countData.variance_percentage != null
                            ? `${countData.variance_percentage.toFixed(1)}%`
                            : ''}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* COUNT DETAILS */}
                <Card className='border-muted border-2'>
                  <CardHeader className='pb-3'>
                    <CardTitle className='flex items-center gap-2 text-sm font-semibold tracking-wide uppercase'>
                      <Scan className='h-4 w-4' />
                      Count Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-3'>
                    <div className='grid grid-cols-2 gap-x-6 gap-y-3 text-sm'>
                      <div>
                        <p className='text-muted-foreground mb-1 text-xs font-medium'>
                          STATUS
                        </p>
                        <Badge
                          className={getStatusColor(countData.status || '')}
                        >
                          {countData.status?.replace('_', ' ').toUpperCase()}
                        </Badge>
                      </div>
                      <div>
                        <p className='text-muted-foreground mb-1 text-xs font-medium'>
                          COUNT TYPE
                        </p>
                        <Badge variant='outline'>
                          {COUNT_TYPE_OPTIONS.find(
                            (opt) => opt.value === countData.count_type
                          )?.label || countData.count_type}
                        </Badge>
                      </div>
                    </div>

                    <Separator />

                    <div>
                      <p className='text-muted-foreground mb-2 text-xs font-medium'>
                        COUNT COMPLETED
                      </p>
                      <p className='text-sm font-bold'>
                        {countData.count_date
                          ? formatDateEST(countData.count_date)
                          : 'Not Completed'}
                      </p>
                      {countData.counter_name && (
                        <p className='text-muted-foreground mt-1 text-xs'>
                          By {countData.counter_name}
                        </p>
                      )}
                    </div>

                    {countData.counted_quantity != null && (
                      <>
                        <Separator />
                        <div>
                          <p className='text-muted-foreground mb-1 text-xs font-medium'>
                            COUNTED BY
                          </p>
                          <p className='text-sm'>
                            {countData.counter_name || 'N/A'}
                          </p>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* ADDITIONAL INFO */}
                <Card className='border-muted border-2'>
                  <CardHeader className='pb-3'>
                    <CardTitle className='flex items-center gap-2 text-sm font-semibold tracking-wide uppercase'>
                      <FileText className='h-4 w-4' />
                      Additional Info
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-3'>
                    <div className='grid grid-cols-2 gap-x-6 gap-y-3 text-sm'>
                      <div>
                        <p className='text-muted-foreground mb-1 text-xs font-medium'>
                          Material
                        </p>
                        <p className='font-mono font-bold'>
                          {countData.material_number}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground mb-1 text-xs font-medium'>
                          Batch
                        </p>
                        <p className='font-mono'>
                          {countData.batch_number || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground mb-1 text-xs font-medium'>
                          Storage Loc
                        </p>
                        <p className='font-bold'>{countData.location}</p>
                      </div>
                      <div>
                        <p className='text-muted-foreground mb-1 text-xs font-medium'>
                          Unit of Measure
                        </p>
                        <p>{countData.unit_of_measure || 'EA'}</p>
                      </div>
                      <div className='col-span-2'>
                        <p className='text-muted-foreground mb-1 text-xs font-medium'>
                          Confirmed Yield
                        </p>
                        <p>
                          {countData.counted_quantity != null
                            ? `${countData.counted_quantity} ${countData.unit_of_measure}`
                            : 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground mb-1 text-xs font-medium'>
                          Created
                        </p>
                        <p>{formatDateEST(countData.created_at)}</p>
                      </div>
                      <div>
                        <p className='text-muted-foreground mb-1 text-xs font-medium'>
                          Last Updated
                        </p>
                        <p>{formatDateEST(countData.updated_at)}</p>
                      </div>
                      {countData.assigned_to_user && (
                        <div className='col-span-2'>
                          <p className='text-muted-foreground mb-1 text-xs font-medium'>
                            Assigned To
                          </p>
                          <div className='flex items-center gap-2'>
                            <User className='h-4 w-4 text-blue-600' />
                            <span className='font-medium text-blue-700'>
                              {countData.assigned_to_user.full_name}
                            </span>
                          </div>
                        </div>
                      )}
                      {countData.notes && (
                        <div className='col-span-2'>
                          <p className='text-muted-foreground mb-1 text-xs font-medium'>
                            Notes
                          </p>
                          <p className='text-sm'>{countData.notes}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Recount Action Section - Only show if eligible */}
                {countData.status !== 'completed' &&
                  countData.status !== 'approved' && (
                    <Card className='border-2 border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20'>
                      <CardHeader className='pb-3'>
                        <CardTitle className='flex items-center gap-2 text-sm font-semibold tracking-wide text-orange-800 uppercase dark:text-orange-200'>
                          <RotateCcw className='h-4 w-4' />
                          Initiate Recount
                        </CardTitle>
                      </CardHeader>
                      <CardContent className='space-y-3'>
                        <p className='text-xs text-orange-700 dark:text-orange-300'>
                          Send this count back to the queue for a different
                          counter to recount
                        </p>

                        <div>
                          <Label
                            htmlFor='recount_reason'
                            className='text-xs text-orange-800 dark:text-orange-200'
                          >
                            Reason (Optional)
                          </Label>
                          <Input
                            id='recount_reason'
                            placeholder='e.g., Discrepancy found, verification needed...'
                            value={recountReason}
                            onChange={(e) => setRecountReason(e.target.value)}
                            className='dark:bg-background mt-1 bg-white'
                          />
                        </div>

                        <Button
                          onClick={handleInitiateRecount}
                          disabled={isSubmitting}
                          variant='destructive'
                          className='w-full'
                        >
                          {isSubmitting ? (
                            <>
                              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                              Initiating...
                            </>
                          ) : (
                            <>
                              <RotateCcw className='mr-2 h-4 w-4' />
                              Setup for Recount
                            </>
                          )}
                        </Button>
                      </CardContent>
                    </Card>
                  )}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className='mt-6 flex items-center justify-between gap-4 border-t pt-6'>
          <div className='text-muted-foreground flex items-center gap-2 text-xs'>
            <span className='bg-muted rounded px-2 py-1 font-mono'>
              ID: {countData?.id.substring(0, 8)}...
            </span>
          </div>
          <div className='flex gap-3'>
            <Button
              type='button'
              variant='outline'
              onClick={onClose}
              className='min-w-[100px]'
            >
              Close
            </Button>
            {countData?.status === 'variance_review' && (
              <Button
                type='button'
                variant='default'
                disabled={isSubmitting}
                className='min-w-[160px] bg-emerald-600 text-white hover:bg-emerald-700'
                onClick={async () => {
                  setIsSubmitting(true)
                  await onApprove(countData.id, countData.count_number)
                  setIsSubmitting(false)
                  onClose()
                }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    Approving...
                  </>
                ) : (
                  <>
                    <Check className='mr-2 h-4 w-4' />
                    Approve Variance
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const ManualCountsSearch: React.FC<ManualCountsSearchProps> = React.memo(
  ({ enableRealtime = true }) => {
    const [currentPage, setCurrentPage] = useState(1)
    const [isVisible, setIsVisible] = useState(false)
    const [sortConfig] = useState<SortConfig>({
      key: 'created_at',
      direction: 'desc',
    })

    // Add Counts from LX03 Modal state
    const [lx03ModalOpen, setLx03ModalOpen] = useState(false)

    // User Assignment Modal state
    const [assignmentModalOpen, setAssignmentModalOpen] = useState(false)
    const [selectedCount, setSelectedCount] =
      useState<CycleCountDataWithUser | null>(null)

    // Edit Count Modal state
    const [editCountModalOpen, setEditCountModalOpen] = useState(false)
    const [selectedCountForEdit, setSelectedCountForEdit] =
      useState<CycleCountDataWithUser | null>(null)

    // Multi-selection state
    const [selectedCountIds, setSelectedCountIds] = useState<Set<string>>(
      new Set()
    )
    const [selectAll, setSelectAll] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

    // Work distribution panel state
    const [showOperatorStatus, setShowOperatorStatus] = useState(true)

    const componentRef = useRef<HTMLDivElement>(null)
    const recordsPerPage = 25

    // Get current authenticated user and query client for WebSocket integration
    const { authState } = useUnifiedAuth()
    const queryClient = useQueryClient()

    // WebSocket event handler for queue updates
    const handleWsEvent = useCallback(
      (event: WsEvent) => {
        if (event.type === 'QueueStatsUpdated') {
          queryClient.invalidateQueries({
            queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
          })
        }
        if (
          event.type === 'TaskStatusChanged' ||
          event.type === 'TaskAssigned' ||
          event.type === 'PushedWork'
        ) {
          queryClient.invalidateQueries({
            queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
          })
        }
        if (event.type === 'WorkerStatusChanged') {
          queryClient.invalidateQueries({
            queryKey: [ACTIVE_WORKERS_QUERY_KEY],
          })
        }
      },
      [queryClient]
    )

    // Connect to WebSocket on mount if organization is available
    useEffect(() => {
      const orgId = authState?.profile?.organization_id
      if (!orgId || !enableRealtime) return

      workServiceWs.connect(orgId, handleWsEvent)

      return () => {
        workServiceWs.removeHandler(handleWsEvent)
      }
    }, [authState?.profile?.organization_id, enableRealtime, handleWsEvent])

    // Intersection Observer to only enable real-time updates when component is visible
    useEffect(() => {
      const observer = new IntersectionObserver(
        ([entry]) => {
          setIsVisible(entry.isIntersecting)
        },
        {
          threshold: 0.1,
          rootMargin: '50px',
        }
      )

      if (componentRef.current) {
        observer.observe(componentRef.current)
      }

      return () => {
        observer.disconnect()
      }
    }, [])

    // Only enable real-time when component is visible and user wants it enabled
    const shouldEnableRealtime = enableRealtime && isVisible

    const {
      filteredData,
      statistics,
      isLoading,
      error,
      searchQuery,
      setSearchQuery,
      refreshData,
      exportToCSV,
      createMultipleCycleCounts,
      importFromClipboard,
      isImporting,
      assignCountToUser,
      unassignCount,
      updateCycleCountPriority,
      initiateRecount,
    } = useCycleCountOperations({ enableRealtime: shouldEnableRealtime })

    // Sort and paginate data
    const sortedData = useMemo(() => {
      if (!filteredData || filteredData.length === 0) return []

      return [...filteredData].sort((a, b) => {
        const aValue = a[sortConfig.key as keyof typeof a]
        const bValue = b[sortConfig.key as keyof typeof b]

        if (aValue == null && bValue == null) return 0
        if (aValue == null) return sortConfig.direction === 'asc' ? -1 : 1
        if (bValue == null) return sortConfig.direction === 'asc' ? 1 : -1

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1
        return 0
      })
    }, [filteredData, sortConfig])

    const paginatedData = useMemo(() => {
      const startIndex = (currentPage - 1) * recordsPerPage
      return sortedData.slice(startIndex, startIndex + recordsPerPage)
    }, [sortedData, currentPage, recordsPerPage])

    const totalPages = Math.ceil(sortedData.length / recordsPerPage)

    // Get selected counts data for the work distribution panel
    const selectedCounts = useMemo(() => {
      return filteredData.filter((count) => selectedCountIds.has(count.id))
    }, [filteredData, selectedCountIds])

    // Handle Add Counts from LX03
    const handleAddCountsFromLX03 = useCallback(
      async (
        counts: Array<{
          material_number: string
          location: string
          warehouse: string | null
          system_quantity: number
          count_type: string
          priority: string
          assigned_to?: string | null
        }>
      ) => {
        try {
          // Cast count_type and priority to the expected enum types
          const typedCounts = counts.map((c) => ({
            ...c,
            count_type: c.count_type as CountTypeValue,
            priority: c.priority as CycleCountPriority,
          }))
          await createMultipleCycleCounts(typedCounts)
          // Success toast is handled in the hook
        } catch (error) {
          logger.error('Error adding counts from LX03:', error)
          // Error toast is handled in the hook
        }
      },
      [createMultipleCycleCounts]
    )

    // Handle Assignment
    const handleOpenAssignmentModal = useCallback(
      (count: CycleCountDataWithUser) => {
        setSelectedCount(count)
        setAssignmentModalOpen(true)
      },
      []
    )

    const handleAssignCount = useCallback(
      async (userId: string) => {
        if (!selectedCount) return

        try {
          await assignCountToUser(selectedCount.id, userId)
          setAssignmentModalOpen(false)
          setSelectedCount(null)
        } catch (error) {
          logger.error('Error assigning count:', error)
        }
      },
      [selectedCount, assignCountToUser]
    )

    const handleUnassignCount = useCallback(
      async (countId: string) => {
        try {
          await unassignCount(countId)
        } catch (error) {
          logger.error('Error unassigning count:', error)
        }
      },
      [unassignCount]
    )

    const handleUpdatePriority = useCallback(
      async (countId: string, priority: CycleCountPriority) => {
        try {
          await updateCycleCountPriority(countId, priority)
        } catch (error) {
          logger.error('Error updating priority:', error)
        }
      },
      [updateCycleCountPriority]
    )

    // Handle Edit Count
    const handleOpenEditModal = useCallback((count: CycleCountDataWithUser) => {
      setSelectedCountForEdit(count)
      setEditCountModalOpen(true)
    }, [])

    const handleInitiateRecount = useCallback(
      async (countId: string, reason?: string) => {
        try {
          await initiateRecount(countId, reason)
          setEditCountModalOpen(false)
          setSelectedCountForEdit(null)
        } catch (error) {
          logger.error('Error initiating recount:', error)
        }
      },
      [initiateRecount]
    )

    // Handle select all toggle
    const handleSelectAll = useCallback(() => {
      if (selectAll) {
        setSelectedCountIds(new Set())
        setSelectAll(false)
      } else {
        const allIds = new Set(paginatedData.map((count) => count.id))
        setSelectedCountIds(allIds)
        setSelectAll(true)
      }
    }, [selectAll, paginatedData])

    // Handle individual row selection
    const handleRowToggle = useCallback(
      (countId: string) => {
        setSelectedCountIds((prev) => {
          const newSet = new Set(prev)
          if (newSet.has(countId)) {
            newSet.delete(countId)
          } else {
            newSet.add(countId)
          }
          setSelectAll(
            newSet.size === paginatedData.length && paginatedData.length > 0
          )
          return newSet
        })
      },
      [paginatedData.length]
    )

    // Handle mass assignment
    const handleMassAssignment = useCallback(async () => {
      if (selectedCountIds.size === 0) {
        toast.error('Please select at least one count to assign')
        return
      }

      // Use first selected count for the modal
      const firstSelectedId = Array.from(selectedCountIds)[0]
      const firstCount = filteredData.find((c) => c.id === firstSelectedId)
      if (firstCount) {
        setSelectedCount(firstCount)
        setAssignmentModalOpen(true)
      }
    }, [selectedCountIds, filteredData])

    // Handle mass assignment confirmation
    const handleMassAssignConfirm = useCallback(
      async (userId: string) => {
        try {
          // Assign all selected counts to the user
          await Promise.all(
            Array.from(selectedCountIds).map((countId) =>
              assignCountToUser(countId, userId)
            )
          )

          toast.success(
            `Successfully assigned ${selectedCountIds.size} count(s) to user`
          )
          setSelectedCountIds(new Set())
          setSelectAll(false)
          setAssignmentModalOpen(false)
          setSelectedCount(null)
        } catch (error) {
          logger.error('Error in mass assignment:', error)
          toast.error('Failed to assign some counts')
        }
      },
      [selectedCountIds, assignCountToUser]
    )

    // Handle mass delete - show confirmation
    const handleMassDelete = useCallback(() => {
      if (selectedCountIds.size === 0) {
        toast.error('Please select at least one count to delete')
        return
      }
      setShowDeleteConfirm(true)
    }, [selectedCountIds.size])

    // Handle delete confirmation
    const handleDeleteConfirm = useCallback(async () => {
      setShowDeleteConfirm(false)

      try {
        const idsToDelete = Array.from(selectedCountIds)
        let successCount = 0
        let errorCount = 0
        const errors: string[] = []

        // Delete each count individually to capture specific errors
        for (const countId of idsToDelete) {
          try {
            const { error } = await supabase
              .from('rr_cyclecount_data')
              .delete()
              .eq('id', countId)

            if (error) {
              errorCount++
              errors.push(`${countId}: ${error.message}`)
              logger.error('Delete error for', countId, error)
            } else {
              successCount++
            }
          } catch (err) {
            errorCount++
            errors.push(
              `${countId}: ${err instanceof Error ? err.message : 'Unknown error'}`
            )
            logger.error('Delete exception for', countId, err)
          }
        }

        // Show results
        if (successCount > 0) {
          toast.success(`Successfully deleted ${successCount} count(s)`)
        }
        if (errorCount > 0) {
          toast.error(
            `Failed to delete ${errorCount} count(s). Check console for details.`
          )
          logger.error('Delete errors:', errors)
        }

        // Clear selection and refresh
        setSelectedCountIds(new Set())
        setSelectAll(false)
        refreshData()
      } catch (error) {
        logger.error('Error in delete operation:', error)
        toast.error(
          `Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }, [selectedCountIds, refreshData])

    // Handle cleanup abandoned counts
    const handleCleanupAbandoned = useCallback(async () => {
      try {
        toast.info('Checking for abandoned counts...')

        // Call the RPC function to release abandoned counts (30 min threshold)
        const { data, error } = await supabase.rpc(
          'release_abandoned_cycle_counts' as never,
          {
            p_abandonment_threshold_minutes: 30,
            p_max_releases: 100,
          } as never
        )

        if (error) {
          toast.error(`Error cleaning up abandoned counts: ${error.message}`)
          return
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = data as any
        if (result && result.success) {
          const releasedCount = result.released_count || 0
          if (releasedCount > 0) {
            toast.success(
              `✓ Released ${releasedCount} abandoned count(s) back to PENDING status`
            )
            refreshData()
          } else {
            toast.success(
              '✓ No abandoned counts found (checked for counts idle > 30 min)'
            )
          }
        }
      } catch (error: unknown) {
        logger.error('Error cleaning up abandoned counts:', error)
        toast.error(
          `Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }, [refreshData])

    // Handle approve count
    const handleApproveCount = useCallback(
      async (countId: string, countNumber: string) => {
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser()
          if (!user) {
            toast.error('User not authenticated')
            return
          }

          // Update count to approved status
          const { error } = await supabase
            .from('rr_cyclecount_data')
            .update({
              status: 'approved',
              approved_by: user.id,
              approved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', countId)

          if (error) {
            toast.error(`Failed to approve count: ${error.message}`)
            logger.error('Approve error:', error)
            return
          }

          toast.success(`✓ Count ${countNumber} approved successfully`)
          refreshData()
        } catch (error: unknown) {
          logger.error('Error approving count:', error)
          toast.error(
            `Approval failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        }
      },
      [refreshData]
    )

    // Handle export data
    const handleExportData = useCallback(() => {
      if (sortedData.length === 0) {
        toast.warning('No data to export')
        return
      }

      try {
        const csvContent = exportToCSV()

        // Download CSV file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute(
          'download',
          `cycle-counts-${new Date().toISOString().split('T')[0]}.csv`
        )
        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)

        toast.success(`Exported ${sortedData.length} cycle counts`)
      } catch (error) {
        toast.error('Export failed')
        logger.error('Export error:', error)
      }
    }, [sortedData, exportToCSV])

    // Calculate additional metrics
    const normalCounts = useMemo(() => {
      if (!statistics?.priorityBreakdown) return 0
      return statistics.priorityBreakdown.normal || 0
    }, [statistics])

    // Calculate accuracy metrics
    const countAccuracy = useMemo(() => {
      if (!statistics) return 0
      const total = statistics.totalCounts || 0
      const accurate =
        (statistics.completedCounts || 0) -
        (statistics.countsRequiringRecount || 0)
      if (total === 0) return 0
      return Math.round((accurate / total) * 100)
    }, [statistics])

    const binAccuracy = useMemo(() => {
      if (!statistics) return 0
      const total = statistics.totalCounts || 0
      const accurate = total - (statistics.varianceReviewCounts || 0)
      if (total === 0) return 0
      return Math.round((accurate / total) * 100)
    }, [statistics])

    // Statistics Cards - Enhanced with larger metrics, better visual hierarchy, and hover states
    const StatisticsCards = useMemo(
      () => (
        <div className='mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
          {/* Card 1: Count Status - Total Counts, Pending, Completed */}
          <Card className='hover:border-primary/50 from-background cursor-pointer bg-linear-to-br to-slate-50/50 transition-all duration-200 hover:shadow-md dark:to-slate-900/50'>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
              <CardTitle className='text-muted-foreground flex items-center gap-2 text-sm font-medium'>
                <Archive className='h-4 w-4' />
                Count Status
              </CardTitle>
              <Badge variant='outline' className='text-xs'>
                Overview
              </Badge>
            </CardHeader>
            <CardContent className='pt-2'>
              <div className='flex items-center justify-around space-x-4'>
                <div className='text-center'>
                  <div className='text-3xl font-bold tracking-tight'>
                    {statistics?.totalCounts || 0}
                  </div>
                  <p className='text-muted-foreground mt-1 text-xs'>Total</p>
                </div>

                <Separator
                  orientation='vertical'
                  className='bg-border/60 h-16'
                />

                <div className='text-center'>
                  <div className='text-3xl font-bold tracking-tight text-amber-600 dark:text-amber-500'>
                    {statistics?.pendingCounts || 0}
                  </div>
                  <p className='text-muted-foreground mt-1 text-xs'>Pending</p>
                </div>

                <Separator
                  orientation='vertical'
                  className='bg-border/60 h-16'
                />

                <div className='text-center'>
                  <div className='text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-500'>
                    {statistics?.completedCounts || 0}
                  </div>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    Completed
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Variance Metrics - Variance Review, Need Recounts, Total Variance */}
          <Card
            className={cn(
              'hover:border-primary/50 cursor-pointer transition-all duration-200 hover:shadow-md',
              (statistics?.varianceReviewCounts || 0) > 0
                ? 'border-amber-200 bg-linear-to-br from-amber-50/80 to-orange-50/50 dark:border-amber-800/50 dark:from-amber-950/30 dark:to-orange-950/20'
                : 'from-background bg-linear-to-br to-slate-50/50 dark:to-slate-900/50'
            )}
          >
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
              <CardTitle className='text-muted-foreground flex items-center gap-2 text-sm font-medium'>
                <AlertTriangle
                  className={cn(
                    'h-4 w-4',
                    (statistics?.varianceReviewCounts || 0) > 0 &&
                      'text-amber-600'
                  )}
                />
                Variance Metrics
              </CardTitle>
              {(statistics?.varianceReviewCounts || 0) > 0 && (
                <Badge
                  variant='secondary'
                  className='bg-amber-100 text-xs text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
                >
                  Needs Review
                </Badge>
              )}
            </CardHeader>
            <CardContent className='pt-2'>
              <div className='flex items-center justify-around space-x-4'>
                <div className='text-center'>
                  <div className='text-3xl font-bold tracking-tight text-orange-600 dark:text-orange-500'>
                    {statistics?.varianceReviewCounts || 0}
                  </div>
                  <p className='text-muted-foreground mt-1 text-xs'>Review</p>
                </div>

                <Separator
                  orientation='vertical'
                  className='bg-border/60 h-16'
                />

                <div className='text-center'>
                  <div className='text-3xl font-bold tracking-tight text-purple-600 dark:text-purple-500'>
                    {statistics?.countsRequiringRecount || 0}
                  </div>
                  <p className='text-muted-foreground mt-1 text-xs'>Recounts</p>
                </div>

                <Separator
                  orientation='vertical'
                  className='bg-border/60 h-16'
                />

                <div className='text-center'>
                  <div className='text-3xl font-bold tracking-tight'>
                    {statistics?.totalVarianceValue || 0}
                  </div>
                  <p className='text-muted-foreground mt-1 text-xs'>Variance</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 3: Priority Breakdown - Critical, Hot, Normal */}
          <Card
            className={cn(
              'hover:border-primary/50 cursor-pointer transition-all duration-200 hover:shadow-md',
              (statistics?.priorityBreakdown?.critical || 0) > 0
                ? 'border-red-200 bg-linear-to-br from-red-50/80 to-rose-50/50 dark:border-red-800/50 dark:from-red-950/30 dark:to-rose-950/20'
                : 'from-background bg-linear-to-br to-slate-50/50 dark:to-slate-900/50'
            )}
          >
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
              <CardTitle className='text-muted-foreground flex items-center gap-2 text-sm font-medium'>
                <Target
                  className={cn(
                    'h-4 w-4',
                    (statistics?.priorityBreakdown?.critical || 0) > 0 &&
                      'text-red-600'
                  )}
                />
                Priority Breakdown
              </CardTitle>
              {(statistics?.priorityBreakdown?.critical || 0) > 0 && (
                <Badge variant='destructive' className='animate-pulse text-xs'>
                  {statistics?.priorityBreakdown?.critical} Critical
                </Badge>
              )}
            </CardHeader>
            <CardContent className='pt-2'>
              <div className='flex items-center justify-around space-x-4'>
                <div className='text-center'>
                  <div className='flex items-center justify-center gap-1.5'>
                    <span className='h-2.5 w-2.5 animate-pulse rounded-full bg-red-500'></span>
                    <span className='text-3xl font-bold tracking-tight text-red-600 dark:text-red-500'>
                      {statistics?.priorityBreakdown?.critical || 0}
                    </span>
                  </div>
                  <p className='text-muted-foreground mt-1 text-xs'>Critical</p>
                </div>

                <Separator
                  orientation='vertical'
                  className='bg-border/60 h-16'
                />

                <div className='text-center'>
                  <div className='flex items-center justify-center gap-1.5'>
                    <span className='h-2.5 w-2.5 rounded-full bg-orange-500'></span>
                    <span className='text-3xl font-bold tracking-tight text-orange-600 dark:text-orange-500'>
                      {statistics?.priorityBreakdown?.hot || 0}
                    </span>
                  </div>
                  <p className='text-muted-foreground mt-1 text-xs'>Hot</p>
                </div>

                <Separator
                  orientation='vertical'
                  className='bg-border/60 h-16'
                />

                <div className='text-center'>
                  <div className='flex items-center justify-center gap-1.5'>
                    <span className='h-2.5 w-2.5 rounded-full bg-blue-500'></span>
                    <span className='text-3xl font-bold tracking-tight text-blue-600 dark:text-blue-500'>
                      {normalCounts}
                    </span>
                  </div>
                  <p className='text-muted-foreground mt-1 text-xs'>Normal</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 4: Accuracy Metrics - Count Accuracy, Bin Accuracy */}
          <Card
            className={cn(
              'hover:border-primary/50 cursor-pointer transition-all duration-200 hover:shadow-md',
              countAccuracy >= 95
                ? 'border-emerald-200 bg-linear-to-br from-emerald-50/80 to-green-50/50 dark:border-emerald-800/50 dark:from-emerald-950/30 dark:to-green-950/20'
                : 'from-background bg-linear-to-br to-slate-50/50 dark:to-slate-900/50'
            )}
          >
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
              <CardTitle className='text-muted-foreground flex items-center gap-2 text-sm font-medium'>
                <CheckCircle
                  className={cn(
                    'h-4 w-4',
                    countAccuracy >= 95 && 'text-emerald-600'
                  )}
                />
                Accuracy Metrics
              </CardTitle>
              {countAccuracy >= 95 && (
                <Badge
                  variant='secondary'
                  className='bg-emerald-100 text-xs text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                >
                  On Target
                </Badge>
              )}
            </CardHeader>
            <CardContent className='pt-2'>
              <div className='flex items-center justify-around space-x-6'>
                <div className='flex-1 text-center'>
                  <div
                    className={cn(
                      'text-4xl font-bold tracking-tight',
                      countAccuracy >= 95
                        ? 'text-emerald-600 dark:text-emerald-500'
                        : countAccuracy >= 80
                          ? 'text-amber-600 dark:text-amber-500'
                          : 'text-red-600 dark:text-red-500'
                    )}
                  >
                    {countAccuracy}%
                  </div>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    Count Accuracy
                  </p>
                </div>

                <Separator
                  orientation='vertical'
                  className='bg-border/60 h-16'
                />

                <div className='flex-1 text-center'>
                  <div
                    className={cn(
                      'text-4xl font-bold tracking-tight',
                      binAccuracy >= 95
                        ? 'text-emerald-600 dark:text-emerald-500'
                        : binAccuracy >= 80
                          ? 'text-amber-600 dark:text-amber-500'
                          : 'text-red-600 dark:text-red-500'
                    )}
                  >
                    {binAccuracy}%
                  </div>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    Bin Accuracy
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ),
      [statistics, normalCounts, countAccuracy, binAccuracy]
    )

    if (isLoading) {
      return (
        <Card className='bg-background border-border w-full'>
          <CardContent className='py-16'>
            <div className='flex flex-col items-center justify-center space-y-4'>
              <div className='relative'>
                <div className='border-muted h-16 w-16 animate-pulse rounded-full border-4'></div>
                <Loader2 className='text-primary absolute top-1/2 left-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 animate-spin' />
              </div>
              <div className='text-center'>
                <p className='text-foreground font-medium'>
                  Loading cycle count data...
                </p>
                <p className='text-muted-foreground mt-1 text-sm'>
                  Please wait while we fetch your records
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )
    }

    if (error) {
      return (
        <Card className='bg-background border-border w-full'>
          <CardContent className='py-16'>
            <div className='space-y-4 text-center'>
              <div className='mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/30'>
                <AlertTriangle className='h-8 w-8 text-red-600 dark:text-red-400' />
              </div>
              <div>
                <h3 className='text-foreground mb-2 text-lg font-semibold'>
                  Error Loading Data
                </h3>
                <p className='text-muted-foreground mx-auto mb-6 max-w-sm'>
                  {error.message ||
                    'Failed to load cycle count data. Please try again.'}
                </p>
                <Button onClick={refreshData} variant='outline' size='lg'>
                  <RotateCcw className='mr-2 h-4 w-4' />
                  Try Again
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )
    }

    return (
      <div className='space-y-6' ref={componentRef}>
        {/* Statistics Cards */}
        {StatisticsCards}

        {/* Live Operator Status Panel */}
        {showOperatorStatus && <LiveOperatorStatus />}

        {/* Work Distribution Panel - Shows when counts are selected */}
        {selectedCountIds.size > 0 && (
          <WorkDistributionPanel
            selectedCounts={selectedCounts}
            onPushComplete={() => {
              setSelectedCountIds(new Set())
              setSelectAll(false)
              refreshData()
            }}
          />
        )}

        {/* Data Table */}
        <Card className='bg-background border-border w-full'>
          <CardHeader className='border-b pb-4'>
            <div className='flex flex-col space-y-4'>
              {/* Main Header Row */}
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                  <div className='bg-primary/10 rounded-lg p-2'>
                    <Scan className='text-primary h-5 w-5' />
                  </div>
                  <div>
                    <h2 className='text-foreground text-xl font-semibold'>
                      Manual Counts
                    </h2>
                    <p className='text-muted-foreground text-xs'>
                      {sortedData.length} total records
                    </p>
                  </div>
                </div>

                {/* Selection indicator */}
                {selectedCountIds.size > 0 && (
                  <Badge
                    variant='secondary'
                    className='bg-blue-100 px-3 py-1.5 text-sm text-blue-800 dark:bg-blue-900/50 dark:text-blue-200'
                  >
                    <CheckCircle className='mr-1.5 h-3.5 w-3.5' />
                    {selectedCountIds.size} selected
                  </Badge>
                )}
              </div>

              {/* Toolbar Row */}
              <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
                {/* Search Bar - Left side */}
                <div className='flex max-w-md min-w-[200px] flex-1 items-center gap-2'>
                  <div className='relative flex-1'>
                    <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                    <Input
                      placeholder='Search materials, locations, counters...'
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className='bg-background border-border focus-visible:ring-primary/20 h-10 pr-10 pl-10 focus-visible:ring-2'
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className='text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors'
                      >
                        <svg
                          className='h-4 w-4'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M6 18L18 6M6 6l12 12'
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Action Buttons - Right side */}
                <div className='flex flex-wrap items-center gap-2'>
                  {/* Operator Status Toggle */}
                  <Button
                    variant={showOperatorStatus ? 'secondary' : 'outline'}
                    size='sm'
                    onClick={() => setShowOperatorStatus(!showOperatorStatus)}
                    className={cn(
                      'border-border h-9 transition-colors',
                      showOperatorStatus &&
                        'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300'
                    )}
                  >
                    <Users className='mr-2 h-4 w-4' />
                    Operators
                  </Button>

                  <Separator
                    orientation='vertical'
                    className='mx-1 hidden h-6 sm:block'
                  />

                  {/* Primary Actions Group */}
                  <div className='flex items-center gap-2'>
                    <Button
                      variant='default'
                      size='sm'
                      onClick={() => setLx03ModalOpen(true)}
                      className='bg-primary text-primary-foreground hover:bg-primary/90 h-9 shadow-sm'
                    >
                      <Plus className='mr-2 h-4 w-4' />
                      Add Counts
                    </Button>

                    <Button
                      variant='outline'
                      size='sm'
                      onClick={handleExportData}
                      className='border-border hover:bg-accent h-9'
                    >
                      <Download className='mr-2 h-4 w-4' />
                      Export
                    </Button>
                  </div>

                  {/* More Actions Menu */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='outline'
                        size='sm'
                        className='border-border hover:bg-accent h-9'
                      >
                        <MoreHorizontal className='h-4 w-4' />
                        <span className='ml-2 hidden sm:inline'>More</span>
                        <ChevronDown className='ml-1 h-3 w-3' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align='end'
                      className='bg-background border-border w-56'
                    >
                      <DropdownMenuItem
                        onClick={importFromClipboard}
                        disabled={isImporting}
                        className='hover:bg-accent cursor-pointer'
                      >
                        {isImporting ? (
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        ) : (
                          <Upload className='mr-2 h-4 w-4' />
                        )}
                        Import Bulk Counts
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        onClick={handleMassAssignment}
                        disabled={selectedCountIds.size === 0}
                        className={cn(
                          'hover:bg-accent cursor-pointer',
                          selectedCountIds.size === 0 && 'opacity-50'
                        )}
                      >
                        <Users className='mr-2 h-4 w-4' />
                        Assign Selected
                        {selectedCountIds.size > 0 && (
                          <Badge
                            variant='secondary'
                            className='ml-auto text-xs'
                          >
                            {selectedCountIds.size}
                          </Badge>
                        )}
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        onClick={handleMassDelete}
                        disabled={selectedCountIds.size === 0}
                        className={cn(
                          'cursor-pointer text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30',
                          selectedCountIds.size === 0 && 'opacity-50'
                        )}
                      >
                        <Trash2 className='mr-2 h-4 w-4' />
                        Delete Selected
                        {selectedCountIds.size > 0 && (
                          <Badge
                            variant='destructive'
                            className='ml-auto text-xs'
                          >
                            {selectedCountIds.size}
                          </Badge>
                        )}
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        onClick={handleCleanupAbandoned}
                        className='hover:bg-accent cursor-pointer'
                      >
                        <Clock className='mr-2 h-4 w-4' />
                        Cleanup Abandoned Counts
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={refreshData}
                        className='hover:bg-accent cursor-pointer'
                      >
                        <RotateCcw className='mr-2 h-4 w-4' />
                        Refresh Data
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className='pt-6'>
            {filteredData.length === 0 ? (
              <div className='py-16 text-center'>
                <div className='bg-muted/50 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full'>
                  {searchQuery ? (
                    <Search className='text-muted-foreground h-10 w-10' />
                  ) : (
                    <FileText className='text-muted-foreground h-10 w-10' />
                  )}
                </div>
                <h3 className='text-foreground mb-2 text-xl font-semibold'>
                  {searchQuery ? 'No Results Found' : 'No Count Data'}
                </h3>
                <p className='text-muted-foreground mx-auto mb-6 max-w-sm'>
                  {searchQuery
                    ? `No cycle counts match "${searchQuery}". Try adjusting your search terms.`
                    : 'No cycle counts have been recorded yet. Start by adding counts from an LX03 report.'}
                </p>
                <div className='flex items-center justify-center gap-3'>
                  {searchQuery ? (
                    <Button
                      variant='outline'
                      onClick={() => setSearchQuery('')}
                    >
                      <Search className='mr-2 h-4 w-4' />
                      Clear Search
                    </Button>
                  ) : (
                    <Button onClick={() => setLx03ModalOpen(true)} size='lg'>
                      <Plus className='mr-2 h-4 w-4' />
                      Add First Count
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className='border-border overflow-hidden rounded-lg border shadow-sm'>
                  <div className='overflow-x-auto'>
                    <Table>
                      <TableHeader className='bg-muted/80 sticky top-0 z-10 backdrop-blur-sm'>
                        <TableRow className='border-border border-b-2 hover:bg-transparent'>
                          <TableHead className='w-12 py-3'>
                            <Checkbox
                              checked={selectAll}
                              onCheckedChange={handleSelectAll}
                              aria-label='Select all counts'
                              className='translate-y-[2px]'
                            />
                          </TableHead>
                          <TableHead className='text-foreground w-[120px] py-3 font-semibold'>
                            Count #
                          </TableHead>
                          <TableHead className='text-foreground py-3 font-semibold'>
                            Count Type
                          </TableHead>
                          <TableHead className='text-foreground py-3 font-semibold'>
                            Priority
                          </TableHead>
                          <TableHead className='text-foreground py-3 font-semibold'>
                            Location
                          </TableHead>
                          <TableHead className='text-foreground py-3 font-semibold'>
                            Material
                          </TableHead>
                          <TableHead className='text-foreground py-3 text-right font-semibold'>
                            System Qty
                          </TableHead>
                          <TableHead className='text-foreground py-3 text-right font-semibold'>
                            Counted Qty
                          </TableHead>
                          <TableHead className='text-foreground py-3 text-right font-semibold'>
                            Variance
                          </TableHead>
                          <TableHead className='text-foreground py-3 font-semibold'>
                            Status
                          </TableHead>
                          <TableHead className='text-foreground py-3 font-semibold'>
                            Counter
                          </TableHead>
                          <TableHead className='text-foreground py-3 font-semibold'>
                            Count Date
                          </TableHead>
                          <TableHead className='text-foreground py-3 font-semibold'>
                            Assigned To
                          </TableHead>
                          <TableHead className='text-foreground py-3 text-center font-semibold'>
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedData.map((item, index) => (
                          <TableRow
                            key={item.id}
                            className={cn(
                              'transition-colors',
                              'hover:bg-muted/50',
                              selectedCountIds.has(item.id) &&
                                'bg-blue-50/80 hover:bg-blue-100/80 dark:bg-blue-950/30 dark:hover:bg-blue-950/40',
                              index % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                            )}
                          >
                            <TableCell className='py-3'>
                              <Checkbox
                                checked={selectedCountIds.has(item.id)}
                                onCheckedChange={() => handleRowToggle(item.id)}
                                aria-label={`Select ${item.count_number}`}
                                className='translate-y-[2px]'
                              />
                            </TableCell>
                            <TableCell className='py-3 font-mono text-sm font-medium'>
                              {item.count_number}
                            </TableCell>
                            <TableCell className='py-3'>
                              <Badge
                                variant='outline'
                                className='border-muted-foreground/30 text-xs font-medium'
                              >
                                {COUNT_TYPE_OPTIONS.find(
                                  (opt) => opt.value === item.count_type
                                )?.label ||
                                  item.count_type ||
                                  'Quantity Check'}
                              </Badge>
                            </TableCell>
                            <TableCell className='py-3'>
                              <div className='flex items-center gap-1.5'>
                                <span
                                  className={cn(
                                    'h-2.5 w-2.5 shrink-0 rounded-full',
                                    item.priority === 'critical' &&
                                      'animate-pulse bg-red-500',
                                    item.priority === 'hot' && 'bg-orange-500',
                                    item.priority === 'normal' && 'bg-blue-500',
                                    item.priority === 'low' && 'bg-gray-400',
                                    !item.priority && 'bg-blue-500'
                                  )}
                                />
                                <Badge
                                  className={cn(
                                    'text-xs font-medium',
                                    CycleCountService.getPriorityColor(
                                      (item.priority as CycleCountPriority) ||
                                        'normal'
                                    )
                                  )}
                                >
                                  {CycleCountService.getPriorityLabel(
                                    (item.priority as CycleCountPriority) ||
                                      'normal'
                                  )}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell className='py-3 font-mono text-sm'>
                              {item.location}
                            </TableCell>
                            <TableCell className='py-3 font-medium'>
                              {item.material_number}
                            </TableCell>
                            <TableCell className='py-3 text-right tabular-nums'>
                              <span className='font-medium'>
                                {item.system_quantity}
                              </span>
                              <span className='text-muted-foreground ml-1 text-xs'>
                                {item.unit_of_measure}
                              </span>
                            </TableCell>
                            <TableCell className='py-3 text-right tabular-nums'>
                              {item.counted_quantity != null ? (
                                <>
                                  <span className='font-medium'>
                                    {item.counted_quantity}
                                  </span>
                                  <span className='text-muted-foreground ml-1 text-xs'>
                                    {item.unit_of_measure}
                                  </span>
                                </>
                              ) : (
                                <span className='text-muted-foreground text-sm italic'>
                                  Not Counted
                                </span>
                              )}
                            </TableCell>
                            <TableCell className='py-3 text-right tabular-nums'>
                              {item.variance_quantity != null ? (
                                <Badge
                                  variant='outline'
                                  className={cn(
                                    'font-mono font-medium tabular-nums',
                                    item.variance_quantity > 0 &&
                                      'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400',
                                    item.variance_quantity < 0 &&
                                      'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400',
                                    item.variance_quantity === 0 &&
                                      'border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-950/30 dark:text-gray-400'
                                  )}
                                >
                                  {item.variance_quantity > 0 ? '+' : ''}
                                  {item.variance_quantity}
                                </Badge>
                              ) : (
                                <span className='text-muted-foreground text-sm'>
                                  —
                                </span>
                              )}
                            </TableCell>
                            <TableCell className='py-3'>
                              <Badge
                                className={cn(
                                  'text-xs font-medium capitalize',
                                  getStatusColor(item.status || '')
                                )}
                              >
                                {item.status === 'in_progress' && (
                                  <Clock className='mr-1 h-3 w-3' />
                                )}
                                {item.status === 'completed' && (
                                  <CheckCircle className='mr-1 h-3 w-3' />
                                )}
                                {item.status === 'variance_review' && (
                                  <AlertTriangle className='mr-1 h-3 w-3' />
                                )}
                                {item.status === 'pending' && (
                                  <Clock className='mr-1 h-3 w-3' />
                                )}
                                {item.status?.replace('_', ' ')}
                              </Badge>
                            </TableCell>
                            <TableCell className='py-3 text-sm'>
                              {item.counter_name || (
                                <span className='text-muted-foreground'>—</span>
                              )}
                            </TableCell>
                            <TableCell className='py-3 text-sm tabular-nums'>
                              {formatDateEST(item.count_date)}
                            </TableCell>
                            <TableCell className='py-3'>
                              {item.assigned_to_user ? (
                                <div className='flex items-center gap-2'>
                                  <div className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50'>
                                    <User className='h-3.5 w-3.5 text-blue-600 dark:text-blue-400' />
                                  </div>
                                  <span className='max-w-[120px] truncate text-sm font-medium text-blue-700 dark:text-blue-300'>
                                    {item.assigned_to_user.full_name}
                                  </span>
                                </div>
                              ) : (
                                <div className='text-muted-foreground flex items-center gap-2'>
                                  <div className='bg-muted flex h-6 w-6 shrink-0 items-center justify-center rounded-full'>
                                    <UserMinus className='h-3.5 w-3.5' />
                                  </div>
                                  <span className='text-sm'>Unassigned</span>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className='py-3 text-center'>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='hover:bg-muted h-8 w-8 p-0'
                                  >
                                    <MoreHorizontal className='h-4 w-4' />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align='end'
                                  className='bg-background border-border w-[200px]'
                                >
                                  <DropdownMenuItem
                                    onClick={() => handleOpenEditModal(item)}
                                    className='cursor-pointer'
                                  >
                                    <Edit3 className='mr-2 h-4 w-4' />
                                    View / Edit Count
                                  </DropdownMenuItem>

                                  <DropdownMenuSeparator />

                                  {item.assigned_to ? (
                                    <>
                                      <DropdownMenuItem
                                        onClick={() =>
                                          handleOpenAssignmentModal(item)
                                        }
                                        className='cursor-pointer'
                                      >
                                        <UserCheck className='mr-2 h-4 w-4' />
                                        Reassign Count
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() =>
                                          handleUnassignCount(item.id)
                                        }
                                        className='cursor-pointer'
                                      >
                                        <UserMinus className='mr-2 h-4 w-4' />
                                        Unassign Count
                                      </DropdownMenuItem>
                                    </>
                                  ) : (
                                    <DropdownMenuItem
                                      onClick={() =>
                                        handleOpenAssignmentModal(item)
                                      }
                                      className='cursor-pointer'
                                    >
                                      <User className='mr-2 h-4 w-4' />
                                      Assign to User
                                    </DropdownMenuItem>
                                  )}

                                  <DropdownMenuSeparator />

                                  {/* Priority Change Options */}
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleUpdatePriority(item.id, 'critical')
                                    }
                                    className='cursor-pointer'
                                  >
                                    <div className='flex items-center gap-2'>
                                      <div className='h-2.5 w-2.5 rounded-full bg-red-500'></div>
                                      Set Critical
                                    </div>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleUpdatePriority(item.id, 'hot')
                                    }
                                    className='cursor-pointer'
                                  >
                                    <div className='flex items-center gap-2'>
                                      <div className='h-2.5 w-2.5 rounded-full bg-orange-500'></div>
                                      Set Hot
                                    </div>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleUpdatePriority(item.id, 'normal')
                                    }
                                    className='cursor-pointer'
                                  >
                                    <div className='flex items-center gap-2'>
                                      <div className='h-2.5 w-2.5 rounded-full bg-blue-500'></div>
                                      Set Normal
                                    </div>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleUpdatePriority(item.id, 'low')
                                    }
                                    className='cursor-pointer'
                                  >
                                    <div className='flex items-center gap-2'>
                                      <div className='h-2.5 w-2.5 rounded-full bg-gray-400'></div>
                                      Set Low
                                    </div>
                                  </DropdownMenuItem>

                                  <DropdownMenuSeparator />

                                  {item.requires_recount &&
                                    !item.recount_completed && (
                                      <DropdownMenuItem className='cursor-pointer'>
                                        <RotateCcw className='mr-2 h-4 w-4' />
                                        Complete Recount
                                      </DropdownMenuItem>
                                    )}
                                  {item.status === 'variance_review' && (
                                    <DropdownMenuItem
                                      onClick={() =>
                                        handleApproveCount(
                                          item.id,
                                          item.count_number
                                        )
                                      }
                                      className='cursor-pointer text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30'
                                    >
                                      <Check className='mr-2 h-4 w-4' />
                                      Approve Variance
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className='mt-6 flex flex-col items-center justify-between gap-4 border-t pt-4 sm:flex-row'>
                    <div className='text-muted-foreground text-sm'>
                      Showing{' '}
                      <span className='text-foreground font-medium'>
                        {(currentPage - 1) * recordsPerPage + 1}
                      </span>{' '}
                      to{' '}
                      <span className='text-foreground font-medium'>
                        {Math.min(
                          currentPage * recordsPerPage,
                          sortedData.length
                        )}
                      </span>{' '}
                      of{' '}
                      <span className='text-foreground font-medium'>
                        {sortedData.length}
                      </span>{' '}
                      entries
                    </div>

                    <div className='flex items-center gap-1.5'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() =>
                          setCurrentPage(Math.max(1, currentPage - 1))
                        }
                        disabled={currentPage === 1}
                        className='border-border hover:bg-muted h-9 w-9 p-0 disabled:opacity-40'
                      >
                        <ChevronLeft className='h-4 w-4' />
                        <span className='sr-only'>Previous page</span>
                      </Button>

                      <div className='flex items-center gap-1'>
                        {/* First page */}
                        {totalPages > 5 && currentPage > 3 && (
                          <>
                            <Button
                              variant='outline'
                              size='sm'
                              onClick={() => setCurrentPage(1)}
                              className='border-border hover:bg-muted h-9 w-9 p-0'
                            >
                              1
                            </Button>
                            {currentPage > 4 && (
                              <span className='text-muted-foreground px-2 text-sm'>
                                ...
                              </span>
                            )}
                          </>
                        )}

                        {/* Page numbers */}
                        {Array.from(
                          { length: Math.min(5, totalPages) },
                          (_, i) => {
                            let pageNum = i + 1
                            if (totalPages > 5) {
                              if (
                                currentPage > 3 &&
                                currentPage < totalPages - 2
                              ) {
                                pageNum = currentPage - 2 + i
                              } else if (currentPage >= totalPages - 2) {
                                pageNum = totalPages - 4 + i
                              }
                            }

                            return (
                              <Button
                                key={pageNum}
                                variant={
                                  currentPage === pageNum
                                    ? 'default'
                                    : 'outline'
                                }
                                size='sm'
                                onClick={() => setCurrentPage(pageNum)}
                                className={cn(
                                  'border-border h-9 w-9 p-0 transition-colors',
                                  currentPage === pageNum
                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                    : 'hover:bg-muted'
                                )}
                              >
                                {pageNum}
                              </Button>
                            )
                          }
                        )}

                        {/* Last page */}
                        {totalPages > 5 && currentPage < totalPages - 2 && (
                          <>
                            {currentPage < totalPages - 3 && (
                              <span className='text-muted-foreground px-2 text-sm'>
                                ...
                              </span>
                            )}
                            <Button
                              variant='outline'
                              size='sm'
                              onClick={() => setCurrentPage(totalPages)}
                              className='border-border hover:bg-muted h-9 w-9 p-0'
                            >
                              {totalPages}
                            </Button>
                          </>
                        )}
                      </div>

                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() =>
                          setCurrentPage(Math.min(totalPages, currentPage + 1))
                        }
                        disabled={currentPage === totalPages}
                        className='border-border hover:bg-muted h-9 w-9 p-0 disabled:opacity-40'
                      >
                        <ChevronRight className='h-4 w-4' />
                        <span className='sr-only'>Next page</span>
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Add Counts from LX03 Modal */}
        <AddCountsFromLX03Modal
          isOpen={lx03ModalOpen}
          onClose={() => setLx03ModalOpen(false)}
          onSubmit={handleAddCountsFromLX03}
        />

        {/* Edit Count Modal */}
        <EditCountModal
          isOpen={editCountModalOpen}
          onClose={() => {
            setEditCountModalOpen(false)
            setSelectedCountForEdit(null)
          }}
          countData={selectedCountForEdit}
          onInitiateRecount={handleInitiateRecount}
          onApprove={handleApproveCount}
        />

        {/* User Assignment Modal */}
        <UserAssignmentModal
          isOpen={assignmentModalOpen}
          onClose={() => {
            setAssignmentModalOpen(false)
            setSelectedCount(null)
          }}
          onAssign={
            selectedCountIds.size > 1
              ? handleMassAssignConfirm
              : handleAssignCount
          }
          currentAssignee={
            selectedCount?.assigned_to_user as
              | { id: string; full_name: string; email: string }
              | undefined
          }
          countInfo={
            selectedCount
              ? {
                  id: selectedCount.id,
                  count_number:
                    selectedCountIds.size > 1
                      ? `${selectedCountIds.size} Selected Counts`
                      : selectedCount.count_number,
                  material_number:
                    selectedCountIds.size > 1
                      ? 'Multiple Items'
                      : selectedCount.material_number,
                  location:
                    selectedCountIds.size > 1
                      ? 'Multiple Locations'
                      : selectedCount.location,
                  priority: (selectedCount.priority ||
                    'normal') as CycleCountPriority,
                }
              : undefined
          }
        />

        {/* Delete Confirmation Dialog */}
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title='Delete Cycle Counts'
          description='Are you sure you want to delete the selected count(s)?'
          message={`You are about to delete ${selectedCountIds.size} cycle count(s). This action cannot be undone.`}
          variant='danger'
          confirmText='Delete'
          cancelText='Cancel'
          onConfirm={handleDeleteConfirm}
          onCancel={() => setShowDeleteConfirm(false)}
          details={[
            `${selectedCountIds.size} count(s) will be permanently deleted`,
            'This will remove them from the database',
            'Audit logs will still contain the history',
          ]}
        />
      </div>
    )
  }
)

ManualCountsSearch.displayName = 'ManualCountsSearch'

export default ManualCountsSearch
