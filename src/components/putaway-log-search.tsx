import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, toZonedTime } from 'date-fns-tz'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Archive,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  FileText,
  Loader2,
  MoreHorizontal,
  Package,
  Search,
  Settings,
  Target,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { MaterialMasterDataService } from '@/lib/supabase/material-master-data.service'
import type { PutawayOperationsWithUser } from '@/lib/supabase/putaway-log.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { usePutawayOperations } from '@/hooks/use-putaway-operations'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// EST Timezone formatting utility
const formatDateTimeEST = (dateString: string | null | undefined): string => {
  if (!dateString) return 'N/A'

  try {
    const date = new Date(dateString)
    const estTimezone = 'America/New_York'
    const zonedDate = toZonedTime(date, estTimezone)

    // Format: MM/dd/yyyy h:mm:ss a (12-hour format with AM/PM)
    return format(zonedDate, 'MM/dd/yyyy h:mm:ss a', { timeZone: estTimezone })
  } catch (error) {
    logger.error('Date formatting error:', error)
    return 'Invalid Date'
  }
}

const formatDateEST = (dateString: string | null | undefined): string => {
  if (!dateString) return 'N/A'

  try {
    const date = new Date(dateString)
    const estTimezone = 'America/New_York'
    const zonedDate = toZonedTime(date, estTimezone)

    // Format: MM/dd/yyyy
    return format(zonedDate, 'MM/dd/yyyy', { timeZone: estTimezone })
  } catch (error) {
    logger.error('Date formatting error:', error)
    return 'Invalid Date'
  }
}

// Rust-powered search input with rotating light beam border effect
const RustPoweredSearchInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { isRustEnabled?: boolean }
>(({ className, isRustEnabled, ...props }, ref) => {
  if (!isRustEnabled) {
    return (
      <Input
        ref={ref}
        className={cn('bg-background border-border pl-10', className)}
        {...props}
      />
    )
  }

  return (
    <div className='relative'>
      {/* Outer container for the rotating gradient - sized larger than input */}
      <div className='absolute -inset-[1px] overflow-hidden rounded-md'>
        {/* Spinning gradient layer - needs to be large enough to cover corners when rotating */}
        <div
          className='absolute top-1/2 left-1/2 h-[200%] w-[200%] -translate-x-1/2 -translate-y-1/2 animate-[spin_3s_linear_infinite]'
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0deg, transparent 80deg, rgba(59, 130, 246, 0.15) 85deg, rgba(59, 130, 246, 0.4) 88deg, rgba(37, 99, 235, 0.7) 90deg, rgba(59, 130, 246, 0.4) 92deg, rgba(59, 130, 246, 0.15) 95deg, transparent 100deg, transparent 360deg)',
          }}
        />
      </div>
      {/* Inner solid background that masks the center, leaving only the border visible */}
      <div className='bg-background absolute inset-[1px] rounded-[5px]' />
      {/* Actual input - relative to appear above the mask */}
      <Input
        ref={ref}
        className={cn(
          'relative border-transparent bg-transparent pl-10 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0',
          className
        )}
        {...props}
      />
    </div>
  )
})
RustPoweredSearchInput.displayName = 'RustPoweredSearchInput'

interface PutawayLogSearchProps {
  enableRealtime?: boolean
}

interface TableColumn {
  id: string
  label: string
  key: keyof PutawayOperationsWithUser[0]
  width?: string
  sortable?: boolean
}

interface SortConfig {
  key: keyof PutawayOperationsWithUser[0]
  direction: 'asc' | 'desc'
}

// Default column configuration for putaway operations (reordered with new Confirmed By column)
const DEFAULT_COLUMNS: TableColumn[] = [
  {
    id: 'created_at',
    label: 'Putaway At',
    key: 'created_at',
    width: 'w-36',
    sortable: true,
  },
  {
    id: 'warehouse',
    label: 'Warehouse',
    key: 'warehouse',
    width: 'w-24',
    sortable: true,
  },
  {
    id: 'confirmed_by',
    label: 'Confirmed By',
    key: 'confirmed_by_user',
    width: 'w-32',
    sortable: true,
  }, // Using confirmed_by_user for proper data access
  {
    id: 'material_number',
    label: 'Material Number',
    key: 'material_number',
    width: 'w-32',
    sortable: true,
  },
  {
    id: 'to_number',
    label: 'TO Number',
    key: 'to_number',
    width: 'w-36',
    sortable: true,
  },
  {
    id: 'to_location',
    label: 'TO Location',
    key: 'to_location',
    width: 'w-32',
    sortable: true,
  },
  {
    id: 'shelf_location',
    label: 'Shelf Location',
    key: 'shelf_location',
    width: 'w-32',
    sortable: true,
  },
  {
    id: 'putaway_driver',
    label: 'Driver',
    key: 'putaway_driver',
    width: 'w-28',
    sortable: true,
  },
  {
    id: 'to_status',
    label: 'Status',
    key: 'to_status',
    width: 'w-28',
    sortable: true,
  },
  {
    id: 'is_mca_workflow',
    label: 'MCA',
    key: 'is_mca_workflow',
    width: 'w-20',
    sortable: true,
  },
  {
    id: 'stow_cart_number',
    label: 'Cart #',
    key: 'stow_cart_number' as keyof PutawayOperationsWithUser[0],
    width: 'w-24',
    sortable: true,
  },
  {
    id: 'stowed_by',
    label: 'Stowed By',
    key: 'cart_stow_assignment' as keyof PutawayOperationsWithUser[0],
    width: 'w-28',
    sortable: false,
  },
  {
    id: 'stowed_at',
    label: 'Stowed At',
    key: 'cart_stow_assignment' as keyof PutawayOperationsWithUser[0],
    width: 'w-36',
    sortable: false,
  },
  {
    id: 'cart_stow_status',
    label: 'Cart Status',
    key: 'cart_stow_assignment' as keyof PutawayOperationsWithUser[0],
    width: 'w-24',
    sortable: false,
  },
]

// Sortable table header component
function SortableTableHeader({
  column,
  sortConfig,
  onSort,
}: {
  column: TableColumn
  sortConfig: SortConfig | null
  onSort: (key: keyof PutawayOperationsWithUser[0]) => void
}) {
  const isSorted = sortConfig?.key === column.key
  const sortDirection = isSorted ? sortConfig?.direction : null

  return (
    <TableHead className={`text-foreground font-medium ${column.width}`}>
      <div className='flex items-center gap-1'>
        {column.sortable ? (
          <button
            onClick={() => onSort(column.key)}
            className='hover:text-foreground/80 flex items-center gap-1 transition-colors'
          >
            {column.label}
            {isSorted &&
              (sortDirection === 'asc' ? (
                <ChevronUp className='h-3 w-3' />
              ) : (
                <ChevronDown className='h-3 w-3' />
              ))}
          </button>
        ) : (
          <span>{column.label}</span>
        )}
      </div>
    </TableHead>
  )
}

// MCA workflow badge component
function MCABadge({ isMCA }: { isMCA?: boolean | null }) {
  if (isMCA === null || isMCA === undefined) {
    return <span className='text-muted-foreground'>N/A</span>
  }

  return (
    <Badge
      variant={isMCA ? 'destructive' : 'secondary'}
      className={
        isMCA
          ? 'border-orange-300 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300'
          : 'border-gray-300 bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
      }
    >
      {isMCA ? 'MCA' : 'Standard'}
    </Badge>
  )
}

// Clickable status component with 3-second confirmation
function ClickableStatusButton({
  item,
  onStatusUpdate,
  onMcaClick,
}: {
  item: PutawayOperationsWithUser[0]
  onStatusUpdate: (id: string, newStatus: string) => void
  onMcaClick?: (item: PutawayOperationsWithUser[0]) => void
}) {
  const [isWaitingConfirmation, setIsWaitingConfirmation] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const countdownRef = useRef<NodeJS.Timeout | null>(null)

  // Determine the base status based on MCA workflow
  const isMCA = item.is_mca_workflow
  const baseStatus = isMCA ? 'Pending MCA' : 'Pending TO Confirm'
  const confirmedStatus = 'TO Confirmed'

  // Check if item is already confirmed (including MCA statuses)
  const isConfirmed =
    item.to_status === confirmedStatus ||
    item.to_status === 'MCA Confirmed' ||
    item.to_status === 'MCA Processed'
  const currentStatus = isConfirmed
    ? (item.to_status ?? baseStatus)
    : baseStatus

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  const handleClick = useCallback(() => {
    // Handle MCA click - open modal
    if (isMCA && !isConfirmed) {
      onMcaClick?.(item)
      return
    }

    // Don't allow clicks on already confirmed items
    if (isConfirmed) {
      return
    }

    // Handle standard workflow confirmation
    if (!isWaitingConfirmation) {
      // First click - start 3-second countdown
      setIsWaitingConfirmation(true)
      setCountdown(3)

      // Start countdown timer
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            // Time expired - reset to initial state
            setIsWaitingConfirmation(false)
            if (countdownRef.current) clearInterval(countdownRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)

      // Auto-reset after 3 seconds
      timerRef.current = setTimeout(() => {
        setIsWaitingConfirmation(false)
        setCountdown(0)
        if (countdownRef.current) clearInterval(countdownRef.current)
      }, 3000)
    } else {
      // Second click within 3 seconds - confirm status change
      if (timerRef.current) clearTimeout(timerRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)

      setIsWaitingConfirmation(false)
      setCountdown(0)

      // Update status to confirmed
      onStatusUpdate(item.id, confirmedStatus)
      toast.success('Status updated to TO Confirmed')
    }
  }, [
    isMCA,
    isConfirmed,
    isWaitingConfirmation,
    item,
    onStatusUpdate,
    onMcaClick,
    confirmedStatus,
  ])

  // Status color logic
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'to confirmed':
        return 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900 dark:text-green-300'
      case 'mca confirmed':
        return 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900 dark:text-green-300'
      case 'mca processed':
        return 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900 dark:text-blue-300'
      case 'pending mca':
        return 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900 dark:text-orange-300'
      case 'pending to confirm':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900 dark:text-yellow-300'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800 dark:text-gray-300'
    }
  }

  // Render clickable button/badge based on workflow type and confirmation status
  if (isConfirmed) {
    // Already confirmed - show static green badge
    return (
      <Badge
        variant='outline'
        className={`capitalize ${getStatusColor(currentStatus)}`}
      >
        {currentStatus}
      </Badge>
    )
  }

  // Both MCA and Standard are now clickable
  return (
    <Button
      variant='outline'
      size='sm'
      onClick={handleClick}
      className={`capitalize ${getStatusColor(currentStatus)} h-6 min-w-0 border px-2 py-1 text-xs font-normal transition-all duration-200 ${
        isWaitingConfirmation
          ? 'animate-pulse ring-2 ring-blue-500 ring-offset-2'
          : isMCA
            ? 'hover:bg-orange-100 dark:hover:bg-orange-900/20'
            : 'hover:bg-accent'
      }`}
      disabled={isWaitingConfirmation && countdown === 0}
    >
      {isWaitingConfirmation ? (
        <div className='flex items-center gap-1'>
          <span>Confirm</span>
          <span className='text-xs'>({countdown})</span>
        </div>
      ) : (
        currentStatus
      )}
    </Button>
  )
}

// Stepper Context (following pack-tool pattern)
interface StepperContextValue {
  activeStep: number
  setActiveStep: (step: number) => void
  orientation: 'horizontal' | 'vertical'
}

const StepperContext = React.createContext<StepperContextValue | undefined>(
  undefined
)

const useStepper = () => {
  const context = React.useContext(StepperContext)
  if (!context) {
    throw new Error('useStepper must be used within a Stepper')
  }
  return context
}

// Stepper Components (following pack-tool pattern)
interface StepperProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: number
  value?: number
  onValueChange?: (value: number) => void
  orientation?: 'horizontal' | 'vertical'
}

const Stepper = React.forwardRef<HTMLDivElement, StepperProps>(
  (
    {
      defaultValue = 0,
      value,
      onValueChange,
      orientation = 'horizontal',
      className,
      ...props
    },
    ref
  ) => {
    const [activeStep, setInternalStep] = React.useState(defaultValue)

    const setActiveStep = React.useCallback(
      (step: number) => {
        if (value === undefined) {
          setInternalStep(step)
        }
        onValueChange?.(step)
      },
      [value, onValueChange]
    )

    const currentStep = value ?? activeStep

    return (
      <StepperContext.Provider
        value={{
          activeStep: currentStep,
          setActiveStep,
          orientation,
        }}
      >
        <div
          ref={ref}
          className={cn(
            'group/stepper inline-flex data-[orientation=horizontal]:w-full data-[orientation=horizontal]:flex-row data-[orientation=vertical]:flex-col',
            className
          )}
          data-orientation={orientation}
          {...props}
        />
      </StepperContext.Provider>
    )
  }
)
Stepper.displayName = 'Stepper'

interface StepperItemProps extends React.HTMLAttributes<HTMLDivElement> {
  step: number
  completed?: boolean
  disabled?: boolean
  loading?: boolean
}

const StepperItem = React.forwardRef<HTMLDivElement, StepperItemProps>(
  (
    {
      step,
      completed = false,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      disabled = false,
      loading = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const { activeStep } = useStepper()
    const state =
      completed || step < activeStep
        ? 'completed'
        : activeStep === step
          ? 'active'
          : 'inactive'
    const isLoading = loading && step === activeStep

    return (
      <div
        ref={ref}
        className={cn(
          'group/step flex items-center group-data-[orientation=horizontal]/stepper:flex-row group-data-[orientation=vertical]/stepper:flex-col',
          className
        )}
        data-state={state}
        {...(isLoading ? { 'data-loading': true } : {})}
        {...props}
      >
        {children}
      </div>
    )
  }
)
StepperItem.displayName = 'StepperItem'

const StepperIndicator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        'bg-muted text-muted-foreground data-[state=active]:bg-primary data-[state=completed]:bg-primary data-[state=active]:text-primary-foreground data-[state=completed]:text-primary-foreground relative flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-medium',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
})
StepperIndicator.displayName = 'StepperIndicator'

const StepperSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        'bg-muted group-data-[state=completed]/step:bg-primary m-0.5 group-data-[orientation=horizontal]/stepper:h-0.5 group-data-[orientation=horizontal]/stepper:w-full group-data-[orientation=horizontal]/stepper:flex-1 group-data-[orientation=vertical]/stepper:h-12 group-data-[orientation=vertical]/stepper:w-0.5',
        className
      )}
      {...props}
    />
  )
})
StepperSeparator.displayName = 'StepperSeparator'

// MCA Processing completion data interface
interface MCAProcessingData {
  to_status: string
  mca_redirected_location?: string | null
  mca_space_assessment?: string | null
  mca_processed_at: string
  mca_processed_by?: string | null
}

// MCA Processing Modal Component
interface MCAProcessingModalProps {
  isOpen: boolean
  onClose: () => void
  putawayOperation: PutawayOperationsWithUser[0]
  onProcessingComplete: (id: string, updateData: MCAProcessingData) => void
  currentUserId?: string | null
}

// MCA Workflow definitions based on reason type
const getMCAWorkflowSteps = (mcaReason: string | null) => {
  const reasonCode = mcaReason?.toUpperCase() || ''

  if (
    reasonCode.includes('MIXED_INVENTORY') ||
    reasonCode.includes('MIXED INVENTORY')
  ) {
    return [
      {
        id: 0,
        title: 'Validate Reason',
        icon: AlertTriangle,
        description: 'Capture part numbers in location',
      },
      {
        id: 1,
        title: 'SAP Verification',
        icon: Target,
        description: 'LS26 - Verify part location',
      },
      {
        id: 2,
        title: 'Location Decision',
        icon: FileText,
        description: 'Determine correct workflow',
      },
      {
        id: 3,
        title: 'Complete Move',
        icon: CheckCircle,
        description: 'Complete LT01 transaction',
      },
    ]
  }

  if (
    reasonCode.includes('LOCATION_FULL') ||
    reasonCode.includes('LOCATION FULL')
  ) {
    return [
      {
        id: 0,
        title: 'Space Verification',
        icon: AlertTriangle,
        description: 'Check available space',
      },
      {
        id: 1,
        title: 'LS26 Check',
        icon: Target,
        description: 'Verify overflow locations',
      },
      {
        id: 2,
        title: 'Consolidation',
        icon: FileText,
        description: 'Consolidate to overflow',
      },
      {
        id: 3,
        title: 'Block Location',
        icon: CheckCircle,
        description: 'LS02N - Block overflow',
      },
    ]
  }

  if (
    reasonCode.includes('SIZE_CHANGE') ||
    reasonCode.includes('LOCATION_SIZE_CHANGE')
  ) {
    return [
      {
        id: 0,
        title: 'AI Processing',
        icon: AlertTriangle,
        description: 'OmniFrame size analysis',
      },
      {
        id: 1,
        title: 'Confirm & Move',
        icon: CheckCircle,
        description: 'LT01 to correct location',
      },
    ]
  }

  if (
    reasonCode.includes('BINBLOCK_NEEDBIN') ||
    reasonCode.includes('BINBLOCK') ||
    reasonCode.includes('NEEDBIN')
  ) {
    return [
      {
        id: 0,
        title: 'AI Processing',
        icon: AlertTriangle,
        description: 'OmniFrame bin analysis',
      },
      {
        id: 1,
        title: 'Confirm & Move',
        icon: CheckCircle,
        description: 'LT01 to assigned bin',
      },
    ]
  }

  // Default workflow for other reasons
  return [
    {
      id: 0,
      title: 'Review MCA',
      icon: AlertTriangle,
      description: 'Review MCA details',
    },
    {
      id: 1,
      title: 'Process Action',
      icon: Target,
      description: 'Execute required action',
    },
    {
      id: 2,
      title: 'Complete',
      icon: CheckCircle,
      description: 'Finalize processing',
    },
  ]
}

const MCAProcessingModal: React.FC<MCAProcessingModalProps> = ({
  isOpen,
  onClose,
  putawayOperation,
  onProcessingComplete,
  currentUserId,
}) => {
  const [currentStep, setCurrentStep] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [workflowData, setWorkflowData] = useState({
    capturedParts: [] as string[],
    partBelongsInLocation: null as boolean | null,
    newLocation: '',
    overflowLocation: '',
    consolidationQty: '',
    sapTransactionComplete: false,
    notes: '',
    spaceAssessment: '', // Add this new field
    homeBinLocations: [] as Array<{
      material: string
      warehouse_number: string
      storage_type: string
      storage_bin: string
    }>,
    isLoadingHomeBins: false,
  })

  // Get dynamic steps based on MCA reason
  const steps = getMCAWorkflowSteps(putawayOperation.mca_reason)
  const mcaReasonCode = putawayOperation.mca_reason?.toUpperCase() || ''

  // Reset step when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0)
      setIsProcessing(false)
      setWorkflowData({
        capturedParts: [''], // Initialize with one empty part field
        partBelongsInLocation: null,
        newLocation: '',
        overflowLocation: '',
        consolidationQty: '',
        sapTransactionComplete: false,
        notes: '',
        spaceAssessment: '', // Add this
        homeBinLocations: [],
        isLoadingHomeBins: false,
      })
    }
  }, [isOpen])

  // Navigation functions
  const goToPreviousStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }, [currentStep])

  const goToNextStep = useCallback(async () => {
    // Validate current step before proceeding
    if (mcaReasonCode.includes('MIXED_INVENTORY')) {
      if (currentStep === 0) {
        // Validate that at least one part number is captured
        const validParts = workflowData.capturedParts.filter(
          (part) => part.trim().length > 0
        )
        if (validParts.length === 0) {
          toast.error(
            'Please capture at least one part number before proceeding'
          )
          return
        }

        // Query home bin locations for captured parts
        setWorkflowData((prev) => ({ ...prev, isLoadingHomeBins: true }))

        try {
          const materialService = MaterialMasterDataService.getInstance()
          const homeBinData = await materialService.getHomeBinLocations(
            validParts,
            putawayOperation.warehouse
          )

          setWorkflowData((prev) => ({
            ...prev,
            homeBinLocations: homeBinData,
            isLoadingHomeBins: false,
          }))

          logger.log(
            `🏠 Retrieved ${homeBinData.length} home bin locations for MCA workflow`
          )
        } catch (error) {
          logger.error('❌ Failed to query home bin locations:', error)
          setWorkflowData((prev) => ({ ...prev, isLoadingHomeBins: false }))
          toast.error('Failed to retrieve home bin locations')
          // Continue with workflow even if home bin lookup fails
        }
      } else if (currentStep === 1) {
        // Validate that user has selected whether part belongs
        if (workflowData.partBelongsInLocation === null) {
          toast.error(
            'Please indicate whether the part belongs in this location'
          )
          return
        }
      } else if (currentStep === 2) {
        // Validate that new location is provided
        if (!workflowData.newLocation.trim()) {
          toast.error('Please enter the correct location before proceeding')
          return
        }
        if (
          !workflowData.partBelongsInLocation &&
          !workflowData.consolidationQty.trim()
        ) {
          toast.error('Please enter the total quantity in bin after move')
          return
        }
      }
    } else if (mcaReasonCode.includes('LOCATION_FULL')) {
      if (currentStep === 0) {
        // Validate that space assessment selection is made
        if (!workflowData.spaceAssessment) {
          toast.error(
            'Please select a space assessment result before proceeding'
          )
          return
        }
      } else if (currentStep === 2) {
        // Validate that location is provided (either overflow or AI location)
        if (
          !workflowData.overflowLocation.trim() &&
          !workflowData.newLocation.trim()
        ) {
          toast.error(
            'Please enter the consolidation location before proceeding'
          )
          return
        }
      }
    }

    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }, [
    currentStep,
    steps.length,
    mcaReasonCode,
    workflowData,
    putawayOperation.warehouse,
  ])

  const handleComplete = useCallback(async () => {
    // Determine if this is a "Does Fit In Location" quick confirmation
    const isDoesNotFitConfirmation =
      mcaReasonCode.includes('LOCATION_FULL') &&
      workflowData.spaceAssessment === 'Does Fit In Location'

    // Validate completion requirements
    if (
      mcaReasonCode.includes('MIXED_INVENTORY') ||
      mcaReasonCode.includes('LOCATION_FULL') ||
      mcaReasonCode.includes('BINBLOCK') ||
      mcaReasonCode.includes('SIZE_CHANGE')
    ) {
      if (!workflowData.sapTransactionComplete) {
        toast.error(
          isDoesNotFitConfirmation
            ? 'Please confirm that the part fits in the location'
            : 'Please confirm SAP transaction completion before finishing'
        )
        return
      }
    }

    setIsProcessing(true)
    try {
      // Determine the final status based on workflow path
      const finalStatus = isDoesNotFitConfirmation
        ? 'MCA Confirmed'
        : 'MCA Processed'

      // Determine if the part was redirected to a different location
      // For "Does Fit In Location" - no redirect, stays in original location
      // For other workflows - the new/overflow location is the redirect
      const redirectedLocation = isDoesNotFitConfirmation
        ? null // Part stays in original location, no redirect
        : workflowData.newLocation || workflowData.overflowLocation || null

      const now = new Date()

      // Create the Supabase update data with all MCA processing fields
      const mcaUpdateData: MCAProcessingData = {
        to_status: finalStatus,
        mca_redirected_location: redirectedLocation,
        mca_space_assessment: workflowData.spaceAssessment || null,
        mca_processed_at: now.toISOString(),
        mca_processed_by: currentUserId || null,
      }

      // Create comprehensive logging data
      const completionData = {
        mca_reason: putawayOperation.mca_reason,
        workflow_type: mcaReasonCode.includes('MIXED_INVENTORY')
          ? 'MIXED_INVENTORY'
          : mcaReasonCode.includes('LOCATION_FULL')
            ? 'LOCATION_FULL'
            : mcaReasonCode.includes('SIZE_CHANGE')
              ? 'SIZE_CHANGE'
              : mcaReasonCode.includes('BINBLOCK')
                ? 'BINBLOCK_NEEDBIN'
                : 'OTHER',
        captured_parts: workflowData.capturedParts.filter((p) => p.trim()),
        part_belongs_in_location: workflowData.partBelongsInLocation,
        original_location: putawayOperation.to_location,
        final_location: isDoesNotFitConfirmation
          ? putawayOperation.to_location // Part stays in original location
          : workflowData.newLocation || workflowData.overflowLocation,
        redirected_location: redirectedLocation,
        consolidation_qty: workflowData.consolidationQty,
        space_assessment: workflowData.spaceAssessment,
        sap_transaction_complete: workflowData.sapTransactionComplete,
        processing_notes: isDoesNotFitConfirmation
          ? `Part confirmed to fit in original location: ${putawayOperation.to_location}`
          : workflowData.notes,
        completed_at: now.toISOString(),
        completed_by: currentUserId,
      }

      logger.log('🔧 MCA Processing completion data:', completionData)
      logger.log('📊 Supabase update data:', mcaUpdateData)
      logger.log(
        `📋 Final status: ${finalStatus}${isDoesNotFitConfirmation ? ' (Part fits in location)' : ''}`
      )

      // Simulate processing time
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Send the complete update data to Supabase
      onProcessingComplete(putawayOperation.id, mcaUpdateData)
      toast.success(
        isDoesNotFitConfirmation
          ? 'MCA confirmed - Part fits in original location'
          : 'MCA processing completed successfully'
      )
      onClose()
    } catch (error) {
      toast.error('Failed to complete MCA processing')
      logger.error('❌ MCA processing error:', error)
    } finally {
      setIsProcessing(false)
    }
  }, [
    putawayOperation,
    onProcessingComplete,
    onClose,
    mcaReasonCode,
    workflowData,
    currentUserId,
  ])

  // Animation variants (following pack-tool pattern)
  const contentVariants = {
    hidden: { opacity: 0, x: 50 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -50, transition: { duration: 0.2 } },
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-[600px]'>
        <DialogHeader>
          <DialogTitle className='text-lg font-semibold'>
            MCA Processing Workflow
          </DialogTitle>
        </DialogHeader>

        <div className='space-y-6'>
          {/* Progress Stepper */}
          <Stepper value={currentStep} className='w-full'>
            {steps.map((step, index) => (
              <StepperItem
                key={step.id}
                step={index}
                completed={index < currentStep}
                className='[&:not(:last-child)]:flex-1'
              >
                <div className='flex flex-col items-center space-y-2'>
                  <StepperIndicator
                    data-state={
                      index < currentStep
                        ? 'completed'
                        : index === currentStep
                          ? 'active'
                          : 'inactive'
                    }
                  >
                    {index < currentStep ? (
                      <CheckCircle className='h-4 w-4' />
                    ) : (
                      React.createElement(step.icon, { className: 'h-4 w-4' })
                    )}
                  </StepperIndicator>
                  <div className='text-center'>
                    <div className='text-xs font-medium'>{step.title}</div>
                    <div className='text-muted-foreground hidden text-xs sm:block'>
                      {step.description}
                    </div>
                  </div>
                </div>
                {index < steps.length - 1 && (
                  <StepperSeparator
                    data-state={index < currentStep ? 'completed' : 'inactive'}
                    className='mx-2'
                  />
                )}
              </StepperItem>
            ))}
          </Stepper>

          {/* MCA Operation Details */}
          <Card className='border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20'>
            <CardHeader className='pb-3'>
              <CardTitle className='text-sm text-orange-800 dark:text-orange-200'>
                MCA Operation Details
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-2'>
              <div className='grid grid-cols-2 gap-4 text-sm'>
                <div>
                  <span className='text-muted-foreground'>Material:</span>
                  <div className='font-mono font-medium'>
                    {putawayOperation.material_number}
                  </div>
                </div>
                <div>
                  <span className='text-muted-foreground'>TO Number:</span>
                  <div className='font-mono font-medium'>
                    {putawayOperation.to_number}
                  </div>
                </div>
                <div>
                  <span className='text-muted-foreground'>Location:</span>
                  <div className='font-mono font-medium'>
                    {putawayOperation.to_location}
                  </div>
                </div>
                <div>
                  <span className='text-muted-foreground'>Driver:</span>
                  <div className='font-medium'>
                    {putawayOperation.putaway_driver}
                  </div>
                </div>
                {putawayOperation.mca_reason && (
                  <div className='col-span-2'>
                    <span className='text-muted-foreground'>MCA Reason:</span>
                    <div className='font-medium text-orange-700 dark:text-orange-300'>
                      {putawayOperation.mca_reason}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Step Content */}
          <Card className='min-h-[300px]'>
            <CardContent className='pt-6'>
              <AnimatePresence mode='wait'>
                <motion.div
                  key={currentStep}
                  initial='hidden'
                  animate='visible'
                  exit='exit'
                  variants={contentVariants}
                  className='space-y-4'
                >
                  {/* MIXED_INVENTORY Step 0: Validate Reason */}
                  {mcaReasonCode.includes('MIXED_INVENTORY') &&
                    currentStep === 0 && (
                      <div className='space-y-4'>
                        <div className='mb-6 space-y-2 text-center'>
                          <AlertTriangle className='mx-auto h-16 w-16 text-orange-500' />
                          <h3 className='text-lg font-semibold'>
                            Mixed Inventory - Capture Part Numbers
                          </h3>
                          <p className='text-muted-foreground'>
                            Go to location{' '}
                            <code className='bg-muted rounded px-2 py-1 font-mono'>
                              {putawayOperation.to_location}
                            </code>{' '}
                            and capture all part numbers found.
                          </p>
                        </div>

                        <div className='space-y-4'>
                          <div>
                            <label className='text-sm font-medium'>
                              Part Numbers Found in Location
                            </label>
                            <div className='mt-2 space-y-2'>
                              {workflowData.capturedParts.map((part, index) => (
                                <div
                                  key={index}
                                  className='flex items-center gap-2'
                                >
                                  <Input
                                    value={part}
                                    onChange={(e) => {
                                      const newParts = [
                                        ...workflowData.capturedParts,
                                      ]
                                      newParts[index] = e.target.value
                                      setWorkflowData((prev) => ({
                                        ...prev,
                                        capturedParts: newParts,
                                      }))
                                    }}
                                    placeholder='Enter part number'
                                    className='font-mono'
                                  />
                                  <Button
                                    variant='outline'
                                    size='sm'
                                    onClick={() => {
                                      const newParts =
                                        workflowData.capturedParts.filter(
                                          (_, i) => i !== index
                                        )
                                      setWorkflowData((prev) => ({
                                        ...prev,
                                        capturedParts: newParts,
                                      }))
                                    }}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              ))}
                              <Button
                                variant='outline'
                                onClick={() => {
                                  setWorkflowData((prev) => ({
                                    ...prev,
                                    capturedParts: [...prev.capturedParts, ''],
                                  }))
                                }}
                                className='w-full'
                              >
                                + Add Part Number
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                  {/* LOCATION_FULL Step 0: Space Verification */}
                  {mcaReasonCode.includes('LOCATION_FULL') &&
                    currentStep === 0 && (
                      <div className='space-y-4'>
                        <div className='mb-6 space-y-2 text-center'>
                          <AlertTriangle className='mx-auto h-16 w-16 text-orange-500' />
                          <h3 className='text-lg font-semibold'>
                            Location Full - Space Verification
                          </h3>
                          <p className='text-muted-foreground'>
                            Verify available space in location{' '}
                            <code className='bg-muted rounded px-2 py-1 font-mono'>
                              {putawayOperation.to_location}
                            </code>
                          </p>
                        </div>

                        <div className='rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-950/20'>
                          <h4 className='mb-2 font-medium text-orange-800 dark:text-orange-200'>
                            Physical Verification Steps
                          </h4>
                          <ol className='space-y-1 text-sm text-orange-700 dark:text-orange-300'>
                            <li>
                              1. Go to the location to verify available space
                            </li>
                            <li>
                              2. Attempt to cube out the pallet for additional
                              pieces
                            </li>
                            <li>
                              3. If unable to fit inventory, proceed to next
                              step
                            </li>
                          </ol>
                        </div>

                        <div className='space-y-2'>
                          <label className='text-sm font-medium'>
                            Space Assessment
                          </label>
                          <Select
                            value={workflowData.spaceAssessment}
                            onValueChange={(value) =>
                              setWorkflowData((prev) => ({
                                ...prev,
                                spaceAssessment: value,
                                notes: value, // Keep notes for backward compatibility
                              }))
                            }
                          >
                            <SelectTrigger className='w-full'>
                              <SelectValue placeholder='Select space assessment result' />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value='Does Fit In Location'>
                                Does Fit In Location
                              </SelectItem>
                              <SelectItem value='Part Needs Larger Homebin'>
                                Part Needs Larger Homebin
                              </SelectItem>
                              <SelectItem value='Part Needs go to Overflow'>
                                Part Needs go to Overflow
                              </SelectItem>
                              <SelectItem value='Create New Overflow'>
                                Create New Overflow
                              </SelectItem>
                              <SelectItem value='Split Putaway Between Homebin and Overflow'>
                                Split Putaway Between Homebin and Overflow
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Branch workflows based on selection */}
                        {workflowData.spaceAssessment &&
                          workflowData.spaceAssessment !==
                            'Does Fit In Location' && (
                            <div className='mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20'>
                              <p className='text-sm text-blue-700 dark:text-blue-300'>
                                <strong>Selected:</strong>{' '}
                                {workflowData.spaceAssessment}
                              </p>
                              <p className='mt-1 text-xs text-blue-600 dark:text-blue-400'>
                                Workflow branching will be implemented based on
                                this selection.
                              </p>
                            </div>
                          )}

                        {/* Does Fit In Location - Confirmation Section */}
                        {workflowData.spaceAssessment ===
                          'Does Fit In Location' && (
                          <div className='mt-4 space-y-4'>
                            <div className='rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/20'>
                              <h4 className='mb-2 flex items-center gap-2 font-medium text-green-800 dark:text-green-200'>
                                <CheckCircle className='h-5 w-5' />
                                Confirm Part Fits in Original Location
                              </h4>
                              <p className='mb-3 text-sm text-green-700 dark:text-green-300'>
                                You have indicated that the part{' '}
                                <strong>does fit</strong> in the original
                                location:
                                <code className='ml-1 rounded bg-green-100 px-2 py-1 font-mono dark:bg-green-900'>
                                  {putawayOperation.to_location}
                                </code>
                              </p>
                              <div className='rounded border border-green-300 bg-green-100 p-3 dark:border-green-700 dark:bg-green-900/30'>
                                <p className='mb-2 text-sm font-medium text-green-800 dark:text-green-200'>
                                  Before confirming, please verify:
                                </p>
                                <ul className='list-inside list-disc space-y-1 text-sm text-green-700 dark:text-green-300'>
                                  <li>
                                    The part has been physically placed in the
                                    location
                                  </li>
                                  <li>
                                    There is adequate space for the entire
                                    quantity
                                  </li>
                                  <li>
                                    The part matches the material number on the
                                    TO
                                  </li>
                                </ul>
                              </div>
                            </div>

                            <div className='space-y-2'>
                              <div className='flex items-center gap-2'>
                                <input
                                  type='checkbox'
                                  id='confirmFitsInLocation'
                                  checked={workflowData.sapTransactionComplete}
                                  onChange={(e) =>
                                    setWorkflowData((prev) => ({
                                      ...prev,
                                      sapTransactionComplete: e.target.checked,
                                    }))
                                  }
                                  className='h-4 w-4 rounded text-green-600 focus:ring-green-500'
                                />
                                <label
                                  htmlFor='confirmFitsInLocation'
                                  className='text-sm font-medium'
                                >
                                  I confirm the part fits in the original
                                  location and the TO can be confirmed
                                </label>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                  {/* SIZE_CHANGE Step 0: AI Processing */}
                  {mcaReasonCode.includes('SIZE_CHANGE') &&
                    currentStep === 0 && (
                      <div className='space-y-4'>
                        <div className='mb-6 space-y-2 text-center'>
                          <AlertTriangle className='mx-auto h-16 w-16 text-orange-500' />
                          <h3 className='text-lg font-semibold'>
                            Location Size Change - AI Analysis
                          </h3>
                          <p className='text-muted-foreground'>
                            OmniFrame is analyzing size requirements for part{' '}
                            {putawayOperation.material_number}
                          </p>
                        </div>

                        <div className='rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/20'>
                          <h4 className='mb-2 font-medium text-blue-800 dark:text-blue-200'>
                            Size Recommendation Analysis
                          </h4>
                          <p className='mb-3 text-sm text-blue-700 dark:text-blue-300'>
                            OmniFrame will analyze the part requirements and
                            provide a size recommendation:
                          </p>
                          <div className='space-y-2 text-sm'>
                            <div className='flex justify-between'>
                              <span>🏗️ Kardex Location:</span>
                              <span className='text-muted-foreground'>
                                Automated storage system
                              </span>
                            </div>
                            <div className='flex justify-between'>
                              <span>📚 Shelf Location:</span>
                              <span className='text-muted-foreground'>
                                Standard shelving unit
                              </span>
                            </div>
                            <div className='flex justify-between'>
                              <span>🏭 Rack Location:</span>
                              <span className='text-muted-foreground'>
                                Large rack storage
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className='p-4 text-center'>
                          <div className='flex items-center justify-center gap-2 text-blue-600'>
                            <Loader2 className='h-5 w-5 animate-spin' />
                            <span className='text-sm'>
                              OmniFrame analyzing size requirements...
                            </span>
                          </div>
                          <p className='text-muted-foreground mt-2 text-xs'>
                            Status will change to "Ready for MCA" when analysis
                            is complete
                          </p>
                        </div>
                      </div>
                    )}

                  {/* BINBLOCK Step 0: AI Processing */}
                  {mcaReasonCode.includes('BINBLOCK') && currentStep === 0 && (
                    <div className='space-y-4'>
                      <div className='mb-6 space-y-2 text-center'>
                        <AlertTriangle className='mx-auto h-16 w-16 text-orange-500' />
                        <h3 className='text-lg font-semibold'>
                          Binblock Need Bin - AI Analysis
                        </h3>
                        <p className='text-muted-foreground'>
                          OmniFrame is processing bin assignment for part{' '}
                          {putawayOperation.material_number}
                        </p>
                      </div>

                      <div className='rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/20'>
                        <h4 className='mb-2 font-medium text-blue-800 dark:text-blue-200'>
                          Bin Assignment Analysis
                        </h4>
                        <p className='text-sm text-blue-700 dark:text-blue-300'>
                          OmniFrame is analyzing available bins and will assign
                          the optimal location for this material. The system
                          will consider bin capacity, material type, and
                          warehouse logistics.
                        </p>
                      </div>

                      <div className='p-4 text-center'>
                        <div className='flex items-center justify-center gap-2 text-blue-600'>
                          <Loader2 className='h-5 w-5 animate-spin' />
                          <span className='text-sm'>
                            OmniFrame analyzing bin requirements...
                          </span>
                        </div>
                        <p className='text-muted-foreground mt-2 text-xs'>
                          Status will change to "Ready for MCA" when bin
                          assignment is complete
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Default Step 0 for other MCA types */}
                  {!mcaReasonCode.includes('MIXED_INVENTORY') &&
                    !mcaReasonCode.includes('LOCATION_FULL') &&
                    !mcaReasonCode.includes('SIZE_CHANGE') &&
                    !mcaReasonCode.includes('BINBLOCK') &&
                    currentStep === 0 && (
                      <div className='space-y-4 text-center'>
                        <AlertTriangle className='mx-auto h-16 w-16 text-orange-500' />
                        <h3 className='text-lg font-semibold'>
                          Review MCA Details
                        </h3>
                        <p className='text-muted-foreground'>
                          Review the Material Change Action details before
                          processing.
                        </p>
                        <div className='bg-muted rounded-lg p-4 text-left'>
                          <p className='text-sm'>
                            <strong>Current Status:</strong> This putaway
                            operation requires Material Change Action
                            processing. The workflow will guide you through the
                            necessary steps to resolve the MCA.
                          </p>
                        </div>
                      </div>
                    )}

                  {/* MIXED_INVENTORY Step 1: SAP LS26 Verification */}
                  {mcaReasonCode.includes('MIXED_INVENTORY') &&
                    currentStep === 1 && (
                      <div className='space-y-4'>
                        <div className='mb-6 space-y-2 text-center'>
                          <Target className='mx-auto h-16 w-16 text-blue-500' />
                          <h3 className='text-lg font-semibold'>
                            SAP LS26 Verification & Home Bin Locations
                          </h3>
                          <p className='text-muted-foreground'>
                            Review home bin locations and verify if parts belong
                            in the current location.
                          </p>
                        </div>

                        {/* Home Bin Locations Section */}
                        <div className='rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/20'>
                          <h4 className='mb-3 flex items-center gap-2 font-medium text-green-800 dark:text-green-200'>
                            🏠 Home Bin Locations
                            {workflowData.isLoadingHomeBins && (
                              <Loader2 className='h-4 w-4 animate-spin' />
                            )}
                          </h4>

                          {workflowData.isLoadingHomeBins ? (
                            <div className='flex items-center justify-center py-4'>
                              <Loader2 className='mr-2 h-6 w-6 animate-spin' />
                              <span className='text-sm'>
                                Querying home bin locations...
                              </span>
                            </div>
                          ) : workflowData.homeBinLocations.length > 0 ? (
                            <div className='space-y-2'>
                              <p className='mb-3 text-sm text-green-700 dark:text-green-300'>
                                Found home bin locations for captured parts:
                              </p>
                              <div className='grid gap-2'>
                                {workflowData.homeBinLocations.map(
                                  (location, index) => (
                                    <div
                                      key={index}
                                      className='rounded border border-green-300 bg-green-100 p-3 dark:border-green-700 dark:bg-green-900/30'
                                    >
                                      <div className='flex items-center justify-between'>
                                        <div>
                                          <span className='font-mono font-medium text-green-800 dark:text-green-200'>
                                            {location.material}
                                          </span>
                                          <span className='ml-2 text-sm text-green-600 dark:text-green-400'>
                                            (WH: {location.warehouse_number})
                                          </span>
                                        </div>
                                        <div className='text-right'>
                                          <div className='font-mono font-medium text-green-800 dark:text-green-200'>
                                            {location.storage_bin}
                                          </div>
                                          <div className='text-xs text-green-600 dark:text-green-400'>
                                            {location.storage_type}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className='text-sm text-orange-700 dark:text-orange-300'>
                              ⚠️ No home bin locations found for the captured
                              parts in warehouse {putawayOperation.warehouse}.
                              Parts may not exist in Material Master Data or may
                              be in different warehouse.
                            </div>
                          )}
                        </div>

                        <div className='rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/20'>
                          <h4 className='mb-2 font-medium text-blue-800 dark:text-blue-200'>
                            SAP Transaction Instructions
                          </h4>
                          <ol className='space-y-1 text-sm text-blue-700 dark:text-blue-300'>
                            <li>1. Go into SAP</li>
                            <li>
                              2. Enter transaction{' '}
                              <code className='rounded bg-blue-100 px-1 dark:bg-blue-900'>
                                LS26
                              </code>
                            </li>
                            <li>
                              3. Enter part number:{' '}
                              <code className='rounded bg-blue-100 px-1 dark:bg-blue-900'>
                                {workflowData.capturedParts[0] ||
                                  'First Part Number'}
                              </code>
                            </li>
                            <li>
                              4. Verify if part belongs in location:{' '}
                              <code className='rounded bg-blue-100 px-1 dark:bg-blue-900'>
                                {putawayOperation.to_location}
                              </code>
                            </li>
                            <li>
                              5. Compare with home bin locations shown above
                            </li>
                          </ol>
                        </div>

                        <div className='space-y-4'>
                          <div>
                            <label className='text-sm font-medium'>
                              Does the part belong in this location?
                            </label>
                            <div className='mt-2 flex gap-4'>
                              <Button
                                variant={
                                  workflowData.partBelongsInLocation === true
                                    ? 'default'
                                    : 'outline'
                                }
                                onClick={() =>
                                  setWorkflowData((prev) => ({
                                    ...prev,
                                    partBelongsInLocation: true,
                                  }))
                                }
                                className='flex-1'
                              >
                                Yes - Part Belongs
                              </Button>
                              <Button
                                variant={
                                  workflowData.partBelongsInLocation === false
                                    ? 'default'
                                    : 'outline'
                                }
                                onClick={() =>
                                  setWorkflowData((prev) => ({
                                    ...prev,
                                    partBelongsInLocation: false,
                                  }))
                                }
                                className='flex-1'
                              >
                                No - Part Does Not Belong
                              </Button>
                            </div>
                          </div>

                          {workflowData.partBelongsInLocation !== null && (
                            <div className='mt-4 rounded-lg border p-3'>
                              <p className='text-sm font-medium'>
                                {workflowData.partBelongsInLocation
                                  ? '✅ Part belongs in location - OmniFrame will provide new location'
                                  : "❌ Part does not belong - You'll need to find correct bin using LS26"}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                  {/* LOCATION_FULL Step 1: LS26 Overflow Check */}
                  {mcaReasonCode.includes('LOCATION_FULL') &&
                    currentStep === 1 && (
                      <div className='space-y-4'>
                        <div className='mb-6 space-y-2 text-center'>
                          <Target className='mx-auto h-16 w-16 text-blue-500' />
                          <h3 className='text-lg font-semibold'>
                            LS26 - Check Overflow Locations
                          </h3>
                          <p className='text-muted-foreground'>
                            Use SAP LS26 to verify overflow locations for part{' '}
                            {putawayOperation.material_number}
                          </p>
                        </div>

                        <div className='rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/20'>
                          <h4 className='mb-2 font-medium text-blue-800 dark:text-blue-200'>
                            SAP LS26 Instructions
                          </h4>
                          <ol className='space-y-1 text-sm text-blue-700 dark:text-blue-300'>
                            <li>
                              1. Enter transaction{' '}
                              <code className='rounded bg-blue-100 px-1 dark:bg-blue-900'>
                                LS26
                              </code>
                            </li>
                            <li>
                              2. Enter part number:{' '}
                              <code className='rounded bg-blue-100 px-1 dark:bg-blue-900'>
                                {putawayOperation.material_number}
                              </code>
                            </li>
                            <li>3. Check for existing overflow locations</li>
                          </ol>
                        </div>

                        <div className='space-y-2'>
                          <div>
                            <label className='text-sm font-medium'>
                              Overflow Location Found
                            </label>
                            <Input
                              value={workflowData.overflowLocation}
                              onChange={(e) =>
                                setWorkflowData((prev) => ({
                                  ...prev,
                                  overflowLocation: e.target.value,
                                }))
                              }
                              placeholder='Enter overflow location or leave empty if none found'
                              className='mt-1 font-mono'
                            />
                          </div>
                        </div>
                      </div>
                    )}

                  {/* SIZE_CHANGE Step 1: Confirm & Move */}
                  {mcaReasonCode.includes('SIZE_CHANGE') &&
                    currentStep === 1 && (
                      <div className='space-y-4'>
                        <div className='mb-6 space-y-2 text-center'>
                          <CheckCircle className='mx-auto h-16 w-16 text-green-500' />
                          <h3 className='text-lg font-semibold'>
                            Confirm TO & Complete LT01
                          </h3>
                          <p className='text-muted-foreground'>
                            Complete the transfer order movement to the
                            recommended location.
                          </p>
                        </div>

                        <div className='rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/20'>
                          <h4 className='mb-2 font-medium text-green-800 dark:text-green-200'>
                            Final Transaction Steps
                          </h4>
                          <ol className='space-y-1 text-sm text-green-700 dark:text-green-300'>
                            <li>
                              1. Confirm TO:{' '}
                              <code className='rounded bg-green-100 px-1 dark:bg-green-900'>
                                {putawayOperation.to_number}
                              </code>{' '}
                              or 800 no bin TO
                            </li>
                            <li>
                              2. Use{' '}
                              <code className='rounded bg-green-100 px-1 dark:bg-green-900'>
                                LT01
                              </code>{' '}
                              to move to correct bin location
                            </li>
                            <li>3. Complete transaction</li>
                          </ol>
                        </div>

                        <div className='space-y-2'>
                          <div className='flex items-center gap-2'>
                            <input
                              type='checkbox'
                              id='sizeChangeLT01Complete'
                              checked={workflowData.sapTransactionComplete}
                              onChange={(e) =>
                                setWorkflowData((prev) => ({
                                  ...prev,
                                  sapTransactionComplete: e.target.checked,
                                }))
                              }
                              className='rounded'
                            />
                            <label
                              htmlFor='sizeChangeLT01Complete'
                              className='text-sm font-medium'
                            >
                              LT01 transaction completed successfully
                            </label>
                          </div>
                        </div>
                      </div>
                    )}

                  {/* BINBLOCK Step 1: Confirm & Move */}
                  {mcaReasonCode.includes('BINBLOCK') && currentStep === 1 && (
                    <div className='space-y-4'>
                      <div className='mb-6 space-y-2 text-center'>
                        <CheckCircle className='mx-auto h-16 w-16 text-green-500' />
                        <h3 className='text-lg font-semibold'>
                          Confirm Bin Block & Complete LT01
                        </h3>
                        <p className='text-muted-foreground'>
                          Complete the bin block confirmation and transfer order
                          movement.
                        </p>
                      </div>

                      <div className='rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/20'>
                        <h4 className='mb-2 font-medium text-green-800 dark:text-green-200'>
                          Final Transaction Steps
                        </h4>
                        <ol className='space-y-1 text-sm text-green-700 dark:text-green-300'>
                          <li>
                            1. Confirm need bin block or 800 no bin TO:{' '}
                            <code className='rounded bg-green-100 px-1 dark:bg-green-900'>
                              {putawayOperation.to_number}
                            </code>
                          </li>
                          <li>
                            2. Use{' '}
                            <code className='rounded bg-green-100 px-1 dark:bg-green-900'>
                              LT01
                            </code>{' '}
                            to move to assigned bin
                          </li>
                          <li>3. Complete transaction</li>
                        </ol>
                      </div>

                      <div className='space-y-2'>
                        <div className='flex items-center gap-2'>
                          <input
                            type='checkbox'
                            id='binblockLT01Complete'
                            checked={workflowData.sapTransactionComplete}
                            onChange={(e) =>
                              setWorkflowData((prev) => ({
                                ...prev,
                                sapTransactionComplete: e.target.checked,
                              }))
                            }
                            className='rounded'
                          />
                          <label
                            htmlFor='binblockLT01Complete'
                            className='text-sm font-medium'
                          >
                            Bin block confirmation and LT01 transaction
                            completed
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Default Step 1 for other MCA types */}
                  {!mcaReasonCode.includes('MIXED_INVENTORY') &&
                    !mcaReasonCode.includes('LOCATION_FULL') &&
                    !mcaReasonCode.includes('SIZE_CHANGE') &&
                    !mcaReasonCode.includes('BINBLOCK') &&
                    currentStep === 1 && (
                      <div className='space-y-4 text-center'>
                        <Target className='mx-auto h-16 w-16 text-blue-500' />
                        <h3 className='text-lg font-semibold'>
                          Process MCA Action
                        </h3>
                        <p className='text-muted-foreground'>
                          Execute the required Material Change Action based on
                          the identified reason.
                        </p>
                        <div className='bg-muted rounded-lg p-4 text-left'>
                          <p className='text-sm'>
                            <strong>Next Steps:</strong> Processing actions will
                            be implemented here. This step will contain the
                            specific workflow for handling the MCA reason.
                          </p>
                        </div>
                      </div>
                    )}

                  {/* MIXED_INVENTORY Step 2: Location Decision */}
                  {mcaReasonCode.includes('MIXED_INVENTORY') &&
                    currentStep === 2 && (
                      <div className='space-y-4'>
                        <div className='mb-6 space-y-2 text-center'>
                          <FileText className='mx-auto h-16 w-16 text-purple-500' />
                          <h3 className='text-lg font-semibold'>
                            {workflowData.partBelongsInLocation
                              ? 'New Location Assignment'
                              : 'Correct Bin Location'}
                          </h3>
                          <p className='text-muted-foreground'>
                            {workflowData.partBelongsInLocation
                              ? 'OmniFrame has provided a new location for this material.'
                              : 'Find the correct bin location and move the part physically.'}
                          </p>
                        </div>

                        {workflowData.partBelongsInLocation ? (
                          <div className='space-y-4'>
                            <div className='rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/20'>
                              <h4 className='mb-2 font-medium text-green-800 dark:text-green-200'>
                                OmniFrame Location Assignment
                              </h4>
                              <div className='space-y-2'>
                                <div>
                                  <label className='text-sm font-medium'>
                                    New Location (AI Provided)
                                  </label>
                                  <Input
                                    value={workflowData.newLocation}
                                    onChange={(e) =>
                                      setWorkflowData((prev) => ({
                                        ...prev,
                                        newLocation: e.target.value,
                                      }))
                                    }
                                    placeholder='Enter new location from OmniFrame'
                                    className='mt-1 font-mono'
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className='space-y-4'>
                            <div className='rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/20'>
                              <h4 className='mb-2 font-medium text-red-800 dark:text-red-200'>
                                Manual Relocation Required
                              </h4>
                              <ol className='space-y-1 text-sm text-red-700 dark:text-red-300'>
                                <li>
                                  1. Use LS26 to find correct bin for the part
                                </li>
                                <li>2. Move the part physically to that bin</li>
                                <li>
                                  3. Record total quantity in bin after move
                                </li>
                              </ol>
                            </div>

                            <div className='space-y-2'>
                              <div>
                                <label className='text-sm font-medium'>
                                  Correct Bin Location
                                </label>
                                <Input
                                  value={workflowData.newLocation}
                                  onChange={(e) =>
                                    setWorkflowData((prev) => ({
                                      ...prev,
                                      newLocation: e.target.value,
                                    }))
                                  }
                                  placeholder='Enter correct bin location'
                                  className='mt-1 font-mono'
                                />
                              </div>
                              <div>
                                <label className='text-sm font-medium'>
                                  Total Quantity in Bin After Move
                                </label>
                                <Input
                                  value={workflowData.consolidationQty}
                                  onChange={(e) =>
                                    setWorkflowData((prev) => ({
                                      ...prev,
                                      consolidationQty: e.target.value,
                                    }))
                                  }
                                  placeholder='Enter total quantity'
                                  className='mt-1 font-mono'
                                  type='number'
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                  {/* MIXED_INVENTORY Step 3: Complete LT01 */}
                  {mcaReasonCode.includes('MIXED_INVENTORY') &&
                    currentStep === 3 && (
                      <div className='space-y-4'>
                        <div className='mb-6 space-y-2 text-center'>
                          <CheckCircle className='mx-auto h-16 w-16 text-green-500' />
                          <h3 className='text-lg font-semibold'>
                            Complete LT01 Transaction
                          </h3>
                          <p className='text-muted-foreground'>
                            Use SAP LT01 to move the TO to the correct location.
                          </p>
                        </div>

                        <div className='rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/20'>
                          <h4 className='mb-2 font-medium text-green-800 dark:text-green-200'>
                            SAP LT01 Instructions
                          </h4>
                          <ol className='space-y-1 text-sm text-green-700 dark:text-green-300'>
                            <li>
                              1. Confirm TO:{' '}
                              <code className='rounded bg-green-100 px-1 dark:bg-green-900'>
                                {putawayOperation.to_number}
                              </code>
                            </li>
                            <li>
                              2. Use LT01 to move part/qty from TO to location:{' '}
                              <code className='rounded bg-green-100 px-1 dark:bg-green-900'>
                                {workflowData.newLocation}
                              </code>
                            </li>
                            <li>3. Complete the transaction in SAP</li>
                          </ol>
                        </div>

                        <div className='space-y-2'>
                          <div className='flex items-center gap-2'>
                            <input
                              type='checkbox'
                              id='mixedInventoryLT01Complete'
                              checked={workflowData.sapTransactionComplete}
                              onChange={(e) =>
                                setWorkflowData((prev) => ({
                                  ...prev,
                                  sapTransactionComplete: e.target.checked,
                                }))
                              }
                              className='rounded'
                            />
                            <label
                              htmlFor='mixedInventoryLT01Complete'
                              className='text-sm font-medium'
                            >
                              SAP LT01 transaction completed successfully
                            </label>
                          </div>
                        </div>
                      </div>
                    )}

                  {/* LOCATION_FULL Step 2: Consolidation */}
                  {mcaReasonCode.includes('LOCATION_FULL') &&
                    currentStep === 2 && (
                      <div className='space-y-4'>
                        <div className='mb-6 space-y-2 text-center'>
                          <FileText className='mx-auto h-16 w-16 text-purple-500' />
                          <h3 className='text-lg font-semibold'>
                            Consolidation Process
                          </h3>
                          <p className='text-muted-foreground'>
                            {workflowData.overflowLocation
                              ? `Consolidate parts to overflow location: ${workflowData.overflowLocation}`
                              : 'OmniFrame will provide new location for consolidation'}
                          </p>
                        </div>

                        <div className='space-y-4'>
                          <div className='rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-950/20'>
                            <h4 className='mb-2 font-medium text-purple-800 dark:text-purple-200'>
                              Consolidation Steps
                            </h4>
                            <ol className='space-y-1 text-sm text-purple-700 dark:text-purple-300'>
                              <li>1. Consolidate parts to overflow location</li>
                              <li>
                                2. Make sure pallet is wrapped and labeled with
                                material/quantity.
                                <br />
                                <span className='ml-4 text-xs text-purple-600 dark:text-purple-400'>
                                  -Write large enough to see from Floor.
                                </span>
                              </li>
                              <li>3. Unblock the overflow location in SAP.</li>
                              <li>4. Confirm the TO and move the quantity</li>
                              <li>5. Go to LS02N to block in next step</li>
                            </ol>
                          </div>

                          {!workflowData.overflowLocation && (
                            <div>
                              <label className='text-sm font-medium'>
                                OmniFrame Provided Location
                              </label>
                              <Input
                                value={workflowData.newLocation}
                                onChange={(e) =>
                                  setWorkflowData((prev) => ({
                                    ...prev,
                                    newLocation: e.target.value,
                                  }))
                                }
                                placeholder='Enter location provided by OmniFrame'
                                className='mt-1 font-mono'
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                  {/* LOCATION_FULL Step 3: Block Location with LS02N */}
                  {mcaReasonCode.includes('LOCATION_FULL') &&
                    currentStep === 3 && (
                      <div className='space-y-4'>
                        <div className='mb-6 space-y-2 text-center'>
                          <CheckCircle className='mx-auto h-16 w-16 text-green-500' />
                          <h3 className='text-lg font-semibold'>
                            Block Overflow Location - LS02N
                          </h3>
                          <p className='text-muted-foreground'>
                            Use SAP LS02N to block the overflow location after
                            consolidation.
                          </p>
                        </div>

                        <div className='rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/20'>
                          <h4 className='mb-2 font-medium text-green-800 dark:text-green-200'>
                            SAP LS02N Instructions
                          </h4>
                          <ol className='space-y-1 text-sm text-green-700 dark:text-green-300'>
                            <li>
                              1. Enter transaction{' '}
                              <code className='rounded bg-green-100 px-1 dark:bg-green-900'>
                                LS02N
                              </code>
                            </li>
                            <li>
                              2. Block overflow location for stock removal and
                              putaway:{' '}
                              <code className='rounded bg-green-100 px-1 dark:bg-green-900'>
                                {workflowData.overflowLocation ||
                                  workflowData.newLocation}
                              </code>
                            </li>
                            <li>
                              3. Complete blocking transaction by hitting
                              Execute.
                            </li>
                          </ol>
                        </div>

                        <div className='space-y-2'>
                          <div className='flex items-center gap-2'>
                            <input
                              type='checkbox'
                              id='locationFullLS02NComplete'
                              checked={workflowData.sapTransactionComplete}
                              onChange={(e) =>
                                setWorkflowData((prev) => ({
                                  ...prev,
                                  sapTransactionComplete: e.target.checked,
                                }))
                              }
                              className='rounded'
                            />
                            <label
                              htmlFor='locationFullLS02NComplete'
                              className='text-sm font-medium'
                            >
                              LS02N blocking transaction completed successfully
                            </label>
                          </div>
                        </div>
                      </div>
                    )}

                  {/* Default Step 2 and 3 for other MCA types */}
                  {!mcaReasonCode.includes('MIXED_INVENTORY') &&
                    !mcaReasonCode.includes('LOCATION_FULL') &&
                    !mcaReasonCode.includes('SIZE_CHANGE') &&
                    !mcaReasonCode.includes('BINBLOCK') &&
                    currentStep === 2 && (
                      <div className='space-y-4 text-center'>
                        <FileText className='mx-auto h-16 w-16 text-purple-500' />
                        <h3 className='text-lg font-semibold'>
                          Verification & Documentation
                        </h3>
                        <p className='text-muted-foreground'>
                          Verify the completed actions and document any
                          additional notes.
                        </p>
                        <div className='bg-muted rounded-lg p-4 text-left'>
                          <p className='text-sm'>
                            <strong>Documentation:</strong> Verification steps
                            and documentation forms will be implemented here.
                            This ensures proper audit trail for MCA processing.
                          </p>
                        </div>
                      </div>
                    )}

                  {!mcaReasonCode.includes('MIXED_INVENTORY') &&
                    !mcaReasonCode.includes('LOCATION_FULL') &&
                    !mcaReasonCode.includes('SIZE_CHANGE') &&
                    !mcaReasonCode.includes('BINBLOCK') &&
                    currentStep >= 2 && (
                      <div className='space-y-4 text-center'>
                        <CheckCircle className='mx-auto h-16 w-16 text-green-500' />
                        <h3 className='text-lg font-semibold'>
                          Complete MCA Processing
                        </h3>
                        <p className='text-muted-foreground'>
                          Finalize the MCA processing and update the operation
                          status.
                        </p>
                        <div className='bg-muted rounded-lg p-4 text-left'>
                          <p className='text-sm'>
                            <strong>Completion:</strong> Click "Complete MCA
                            Processing" to finalize this workflow and update the
                            status to "MCA Processed".
                          </p>
                        </div>

                        {isProcessing && (
                          <div className='py-4 text-center'>
                            <Loader2 className='mx-auto mb-2 h-8 w-8 animate-spin' />
                            <p className='text-muted-foreground text-sm'>
                              Processing MCA workflow...
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                </motion.div>
              </AnimatePresence>
            </CardContent>
          </Card>

          {/* Navigation Buttons */}
          <div className='flex justify-between space-x-3'>
            <Button
              variant='outline'
              onClick={goToPreviousStep}
              disabled={currentStep === 0 || isProcessing}
              className='flex-1'
            >
              <ChevronLeft className='mr-1 h-4 w-4' />
              Back
            </Button>

            {/* Show Complete button for "Does Fit In Location" at Step 0 */}
            {mcaReasonCode.includes('LOCATION_FULL') &&
            currentStep === 0 &&
            workflowData.spaceAssessment === 'Does Fit In Location' ? (
              <Button
                onClick={handleComplete}
                disabled={isProcessing || !workflowData.sapTransactionComplete}
                className='flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-400'
              >
                {isProcessing ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    Processing...
                  </>
                ) : (
                  <>
                    <CheckCircle className='mr-2 h-4 w-4' />
                    Confirm MCA - Part Fits
                  </>
                )}
              </Button>
            ) : currentStep < steps.length - 1 ? (
              <Button
                onClick={goToNextStep}
                disabled={isProcessing}
                className='flex-1'
              >
                Next
                <ChevronRight className='ml-1 h-4 w-4' />
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                disabled={
                  isProcessing ||
                  ((mcaReasonCode.includes('MIXED_INVENTORY') ||
                    mcaReasonCode.includes('LOCATION_FULL') ||
                    mcaReasonCode.includes('BINBLOCK') ||
                    mcaReasonCode.includes('SIZE_CHANGE')) &&
                    !workflowData.sapTransactionComplete)
                }
                className='flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-400'
              >
                {isProcessing ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    Processing...
                  </>
                ) : (
                  <>
                    <CheckCircle className='mr-2 h-4 w-4' />
                    Complete MCA Processing
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

const PutawayLogSearch: React.FC<PutawayLogSearchProps> = React.memo(
  ({ enableRealtime = true }) => {
    const [currentPage, setCurrentPage] = useState(1)
    const [isVisible, setIsVisible] = useState(false)
    const [sortConfig, setSortConfig] = useState<SortConfig>({
      key: 'created_at',
      direction: 'desc',
    })

    // MCA Modal state
    const [mcaModalOpen, setMcaModalOpen] = useState(false)
    const [selectedMcaOperation, setSelectedMcaOperation] = useState<
      PutawayOperationsWithUser[0] | null
    >(null)
    const componentRef = useRef<HTMLDivElement>(null)
    const recordsPerPage = 25

    // Get current authenticated user for confirmation tracking
    const { authState } = useUnifiedAuth()
    const { profile } = authState

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
      data,
      filteredData,
      statistics,
      isLoading,
      error,
      searchQuery,
      setSearchQuery,
      refreshData,
      exportToCSV,
      updatePutawayOperation,
      isUsingRust,
    } = usePutawayOperations({ enableRealtime: shouldEnableRealtime })

    // Sort and paginate data
    const sortedData = useMemo(() => {
      const processedData = [...filteredData]

      // Apply sorting
      if (sortConfig) {
        processedData.sort((a, b) => {
          const aValue = a[sortConfig.key]
          const bValue = b[sortConfig.key]

          // Handle null/undefined values
          if (aValue === null || aValue === undefined) return 1
          if (bValue === null || bValue === undefined) return -1

          // Handle different data types
          let comparison = 0
          if (typeof aValue === 'boolean' && typeof bValue === 'boolean') {
            comparison = aValue === bValue ? 0 : aValue ? -1 : 1
          } else if (
            sortConfig.key.toString().includes('_date') ||
            sortConfig.key.toString().includes('_at')
          ) {
            // Handle date fields specially
            const aDate = new Date(aValue as string)
            const bDate = new Date(bValue as string)
            comparison = aDate.getTime() - bDate.getTime()
          } else {
            // Convert to string for comparison
            const aStr = String(aValue).toLowerCase()
            const bStr = String(bValue).toLowerCase()
            comparison = aStr < bStr ? -1 : aStr > bStr ? 1 : 0
          }

          return sortConfig.direction === 'desc' ? -comparison : comparison
        })
      }

      return processedData
    }, [filteredData, sortConfig])

    // Pagination calculations
    const totalRecords = sortedData.length
    const totalPages = Math.ceil(totalRecords / recordsPerPage)
    const startIndex = (currentPage - 1) * recordsPerPage
    const endIndex = startIndex + recordsPerPage
    const currentPageData = sortedData.slice(startIndex, endIndex)

    // Sorting handler
    const handleSort = useCallback(
      (key: keyof PutawayOperationsWithUser[0]) => {
        setSortConfig((prevConfig) => ({
          key,
          direction:
            prevConfig?.key === key && prevConfig.direction === 'asc'
              ? 'desc'
              : 'asc',
        }))
      },
      []
    )

    // Reset to first page when search changes
    React.useEffect(() => {
      setCurrentPage(1)
    }, [searchQuery])

    // Handle status update
    const handleStatusUpdate = useCallback(
      async (id: string, newStatus: string) => {
        try {
          // Create update data with status and confirmation tracking
          const updateData: Record<string, unknown> = { to_status: newStatus }

          // Include confirmation data in database update when confirming
          if (newStatus === 'TO Confirmed') {
            const now = new Date()
            updateData.confirmed_by = profile?.id || null
            updateData.confirmed_at = now.toISOString()

            logger.log(
              '🕐 Putaway Confirmation: User confirmation stored in database:',
              {
                operationId: id,
                confirmedBy:
                  profile?.full_name || profile?.email || 'Current User',
                confirmedAt: updateData.confirmed_at,
                localTime: now.toLocaleString('en-US', {
                  timeZone: 'America/New_York',
                }),
                note: 'Stored in database confirmed_by and confirmed_at fields',
              }
            )
          }

          await updatePutawayOperation(id, updateData)
          logger.log(
            `✅ Putaway status updated: ${id} → ${newStatus}`,
            updateData
          )
        } catch (error) {
          logger.error('❌ Failed to update putaway status:', error)
          toast.error('Failed to update status')
        }
      },
      [updatePutawayOperation, profile]
    )

    // Handle MCA click - open modal
    const handleMcaClick = useCallback((item: PutawayOperationsWithUser[0]) => {
      setSelectedMcaOperation(item)
      setMcaModalOpen(true)
      logger.log(`🔧 Opening MCA modal for operation: ${item.id}`)
    }, [])

    // Handle MCA processing completion
    const handleMcaProcessingComplete = useCallback(
      async (id: string, updateData: MCAProcessingData) => {
        try {
          // Update Supabase with all MCA processing data including redirected location
          await updatePutawayOperation(id, {
            to_status: updateData.to_status,
            mca_redirected_location: updateData.mca_redirected_location,
            mca_space_assessment: updateData.mca_space_assessment,
            mca_processed_at: updateData.mca_processed_at,
            mca_processed_by: updateData.mca_processed_by,
          })

          logger.log(
            `✅ MCA processing completed: ${id} → ${updateData.to_status}`,
            {
              redirectedLocation:
                updateData.mca_redirected_location || '(original location)',
              spaceAssessment: updateData.mca_space_assessment,
              processedAt: updateData.mca_processed_at,
              processedBy: updateData.mca_processed_by,
            }
          )
          setMcaModalOpen(false)
          setSelectedMcaOperation(null)
        } catch (error) {
          logger.error('❌ Failed to complete MCA processing:', error)
          toast.error('Failed to complete MCA processing')
        }
      },
      [updatePutawayOperation]
    )

    // Handle copy individual TO number
    const handleCopyIndividualTO = useCallback(async (toNumber: string) => {
      try {
        if (!toNumber) {
          toast.warning('TO number is empty or invalid')
          return
        }

        // Copy single TO number to clipboard
        await navigator.clipboard.writeText(toNumber)

        toast.success(`Copied TO number: ${toNumber}`)
        logger.log(`📋 Copied individual TO number: ${toNumber}`)
      } catch (error) {
        toast.error('Failed to copy TO number to clipboard')
        logger.error('Copy individual TO number error:', error)
      }
    }, [])

    // Handle copy TO numbers for "Pending TO Confirm" status
    const handleCopyTONumbers = useCallback(async () => {
      try {
        // Filter for records with "Pending TO Confirm" status
        const pendingToConfirmRecords = sortedData.filter((item) => {
          const isMCA = item.is_mca_workflow
          const isConfirmed = item.to_status === 'TO Confirmed'
          const baseStatus = isMCA ? 'Pending MCA' : 'Pending TO Confirm'
          return !isConfirmed && !isMCA && baseStatus === 'Pending TO Confirm'
        })

        if (pendingToConfirmRecords.length === 0) {
          toast.warning('No TO numbers found with "Pending TO Confirm" status')
          return
        }

        // Extract TO numbers
        const toNumbers = pendingToConfirmRecords
          .map((item) => item.to_number)
          .filter((toNumber) => toNumber) // Remove any null/undefined values
          .join('\n') // Join with newlines for easy pasting

        // Copy to clipboard
        await navigator.clipboard.writeText(toNumbers)

        toast.success(
          `Copied ${pendingToConfirmRecords.length} TO numbers to clipboard`
        )
        logger.log(
          `📋 Copied TO numbers: ${pendingToConfirmRecords.length} records`,
          toNumbers.split('\n')
        )
      } catch (error) {
        toast.error('Failed to copy TO numbers to clipboard')
        logger.error('Copy TO numbers error:', error)
      }
    }, [sortedData])

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
          `putaway-operations-${new Date().toISOString().split('T')[0]}.csv`
        )
        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)

        toast.success(`Exported ${sortedData.length} putaway operations`)
      } catch (error) {
        toast.error('Export failed')
        logger.error('Export error:', error)
      }
    }, [sortedData, exportToCSV])

    // Pagination handlers
    const goToPage = useCallback(
      (page: number) => {
        if (page >= 1 && page <= totalPages) {
          setCurrentPage(page)
        }
      },
      [totalPages]
    )

    const goToPreviousPage = useCallback(() => {
      if (currentPage > 1) {
        setCurrentPage(currentPage - 1)
      }
    }, [currentPage])

    const goToNextPage = useCallback(() => {
      if (currentPage < totalPages) {
        setCurrentPage(currentPage + 1)
      }
    }, [currentPage, totalPages])

    // Get cell content based on column
    const getCellContent = (
      item: PutawayOperationsWithUser[0],
      column: TableColumn
    ): React.ReactNode => {
      // Special handling for confirmed_by column
      if (column.id === 'confirmed_by') {
        // Check if operation is MCA Confirmed/Processed and has mca_processed_by data
        if (
          (item.to_status === 'MCA Confirmed' ||
            item.to_status === 'MCA Processed') &&
          (item as Record<string, unknown>).mca_processed_by_user
        ) {
          const mcaUser = (item as Record<string, unknown>)
            .mca_processed_by_user as {
            first_name?: string
            last_name?: string
            full_name?: string
            email?: string
          } | null
          return (
            <div className='space-y-1'>
              <div className='font-medium text-orange-600 dark:text-orange-400'>
                {mcaUser?.full_name || mcaUser?.email}
              </div>
              {item.mca_processed_at && (
                <div className='text-muted-foreground text-xs'>
                  {formatDateTimeEST(item.mca_processed_at)}
                </div>
              )}
            </div>
          )
        }
        // For MCA items without user data (legacy data)
        else if (
          item.to_status === 'MCA Confirmed' ||
          item.to_status === 'MCA Processed'
        ) {
          return (
            <div className='space-y-1'>
              <div className='font-medium text-orange-600 dark:text-orange-400'>
                MCA Processed
              </div>
              {item.mca_processed_at && (
                <div className='text-muted-foreground text-xs'>
                  {formatDateTimeEST(item.mca_processed_at)}
                </div>
              )}
            </div>
          )
        }
        // Check if operation is TO Confirmed and has confirmed_by data
        else if (item.to_status === 'TO Confirmed' && item.confirmed_by_user) {
          return (
            <div className='space-y-1'>
              <div className='text-foreground font-medium'>
                {item.confirmed_by_user.full_name ||
                  item.confirmed_by_user.email}
              </div>
              {item.confirmed_at && (
                <div className='text-muted-foreground text-xs'>
                  {formatDateTimeEST(item.confirmed_at)}
                </div>
              )}
            </div>
          )
        }
        // For TO Confirmed items without user data (legacy data)
        else if (item.to_status === 'TO Confirmed') {
          return (
            <div className='space-y-1'>
              <div className='text-foreground font-medium'>System</div>
              {item.confirmed_at && (
                <div className='text-muted-foreground text-xs'>
                  {formatDateTimeEST(item.confirmed_at)}
                </div>
              )}
            </div>
          )
        }
        // For pending items
        else {
          return <span className='text-muted-foreground'>Pending</span>
        }
      }

      if (column.id === 'stow_cart_number') {
        const cartNum = (item as any).stow_cart_number
        return cartNum ? (
          <span className='font-medium'>{cartNum}</span>
        ) : (
          <span className='text-muted-foreground'>—</span>
        )
      }
      if (column.id === 'stowed_by') {
        const assignment = (item as any).cart_stow_assignment
        const name = assignment?.stowed_by_user?.full_name
        return name ? (
          <span>{name}</span>
        ) : (
          <span className='text-muted-foreground'>—</span>
        )
      }
      if (column.id === 'stowed_at') {
        const assignment = (item as any).cart_stow_assignment
        return assignment?.stowed_at ? (
          <span>{formatDateTimeEST(assignment.stowed_at)}</span>
        ) : (
          <span className='text-muted-foreground'>—</span>
        )
      }
      if (column.id === 'cart_stow_status') {
        const assignment = (item as any).cart_stow_assignment
        if (!assignment) return <span className='text-muted-foreground'>—</span>
        const st = assignment.status as string
        return (
          <Badge
            variant={st === 'on_cart' ? 'default' : 'secondary'}
            className={
              st === 'on_cart'
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                : st === 'cleared'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : ''
            }
          >
            {st === 'on_cart' ? 'On Cart' : st === 'cleared' ? 'Cleared' : st}
          </Badge>
        )
      }

      const value = item[column.key]

      switch (column.key) {
        case 'to_status':
          return (
            <ClickableStatusButton
              item={item}
              onStatusUpdate={handleStatusUpdate}
              onMcaClick={handleMcaClick}
            />
          )
        case 'is_mca_workflow':
          return <MCABadge isMCA={value as boolean} />
        case 'confirmed_by_user':
          // Handle user object for confirmed_by_user column
          if (
            value &&
            typeof value === 'object' &&
            'full_name' in value &&
            'email' in value
          ) {
            return (
              <span className='text-foreground font-medium'>
                {value.full_name || value.email || 'N/A'}
              </span>
            )
          }
          return <span className='text-muted-foreground'>N/A</span>
        case 'to_number':
          // Ensure to_number is always treated as string, not object
          // eslint-disable-next-line no-case-declarations
          const toNumberValue =
            typeof value === 'string' ? value : String(value || '')
          return (
            <div className='flex items-center gap-2'>
              <span className='text-foreground font-medium'>
                {toNumberValue || 'N/A'}
              </span>
              {toNumberValue && (
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCopyIndividualTO(toNumberValue)
                  }}
                  className='hover:bg-accent h-6 w-6 p-0'
                  title={`Copy TO number: ${toNumberValue}`}
                >
                  <Copy className='h-3 w-3' />
                </Button>
              )}
            </div>
          )
        case 'putaway_date':
          return formatDateEST(value as string)
        case 'created_at':
        case 'updated_at':
          return formatDateTimeEST(value as string)
        case 'putaway_time':
          return (
            (typeof value === 'string' ? value : String(value || '')) || 'N/A'
          )
        case 'created_by':
          return (
            (typeof value === 'string' ? value : String(value || '')) || 'N/A'
          )
        case 'mca_reason':
          return value ? (
            <span
              className='block max-w-[200px] truncate'
              title={value as string}
            >
              {value as string}
            </span>
          ) : (
            'N/A'
          )
        case 'shelf_location':
          // For MCA Confirmed/Processed items, show the redirected location with a different color
          if (
            (item.to_status === 'MCA Confirmed' ||
              item.to_status === 'MCA Processed') &&
            item.mca_redirected_location
          ) {
            return (
              <span
                className='font-medium text-orange-600 dark:text-orange-400'
                title={`Redirected from: ${item.shelf_location || 'N/A'}`}
              >
                {item.mca_redirected_location}
              </span>
            )
          }
          // Ensure we return a string, not an object
          return typeof value === 'string'
            ? value
            : value
              ? String(value)
              : 'N/A'
        default:
          // Ensure we never try to render objects as JSX
          if (value && typeof value === 'object') {
            return 'N/A'
          }
          return value || 'N/A'
      }
    }

    // Memoized statistics cards to prevent unnecessary re-renders
    const StatisticsCards = useMemo(
      () => (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Putaways Completed Today
              </CardTitle>
              <Archive className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.todayPutaways || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                {statistics?.totalPutaways || 0} total putaways
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Pending Confirms
              </CardTitle>
              <Package className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.pendingConfirms || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                TOs awaiting confirmation
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Average Per Driver
              </CardTitle>
              <Truck className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.averagePerDriver || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                Putaways per driver
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Pending MCA</CardTitle>
              <Settings className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {statistics?.mcaPutaways || 0}
              </div>
              <p className='text-muted-foreground text-xs'>
                Awaiting processing
              </p>
            </CardContent>
          </Card>
        </div>
      ),
      [statistics]
    )

    return (
      <div ref={componentRef} className='space-y-6'>
        {/* Error State */}
        {error ? (
          <Card className='bg-background border-border w-full'>
            <CardContent className='p-6'>
              <div className='text-destructive text-center'>
                <p>Failed to load putaway operations data: {error.message}</p>
                <Button onClick={refreshData} className='mt-4'>
                  Try Again
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Statistics Cards */}
            {StatisticsCards}

            {/* Data Table */}
            <Card className='bg-background border-border w-full'>
              <CardHeader className='pb-4'>
                <div className='flex flex-col space-y-4'>
                  {/* Main Header */}
                  <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
                    <div className='flex flex-1 flex-col items-start gap-4 sm:flex-row sm:items-center'>
                      <h2 className='text-foreground text-2xl font-semibold'>
                        Putaway Log Search
                      </h2>
                      <div className='relative max-w-sm flex-1'>
                        <Search
                          className={cn(
                            'absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2 transform',
                            isUsingRust
                              ? 'text-blue-500'
                              : 'text-muted-foreground'
                          )}
                        />
                        <RustPoweredSearchInput
                          placeholder='Search materials, drivers, locations...'
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          isRustEnabled={isUsingRust}
                        />
                      </div>
                    </div>

                    <div className='flex items-center gap-2'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={handleExportData}
                        disabled={sortedData.length === 0}
                        className='border-border hover:bg-accent'
                      >
                        <Download className='mr-2 h-4 w-4' />
                        Export
                      </Button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant='outline'
                            size='sm'
                            className='border-border hover:bg-accent'
                          >
                            <MoreHorizontal className='mr-2 h-4 w-4' />
                            More
                            <ChevronDown className='ml-2 h-4 w-4' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align='end'
                          className='bg-background border-border'
                        >
                          <DropdownMenuItem
                            onClick={handleCopyTONumbers}
                            className='hover:bg-accent'
                          >
                            <Copy className='mr-2 h-4 w-4' />
                            Copy TO #'s
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={refreshData}
                            className='hover:bg-accent'
                          >
                            <Package className='mr-2 h-4 w-4' />
                            Refresh Data
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setSearchQuery('')}
                            className='hover:bg-accent'
                          >
                            <Search className='mr-2 h-4 w-4' />
                            Clear Search
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent>
                {isLoading ? (
                  <div className='flex items-center justify-center py-12'>
                    <Loader2 className='h-8 w-8 animate-spin' />
                    <span className='ml-2'>
                      Loading putaway operations data...
                    </span>
                  </div>
                ) : (
                  <div className='border-border overflow-hidden rounded-md border'>
                    <Table>
                      <TableHeader>
                        <TableRow className='bg-muted/50 hover:bg-muted/50'>
                          {DEFAULT_COLUMNS.map((column) => (
                            <SortableTableHeader
                              key={column.id}
                              column={column}
                              sortConfig={sortConfig}
                              onSort={handleSort}
                            />
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {currentPageData.length > 0 ? (
                          currentPageData.map((item) => (
                            <TableRow
                              key={item.id}
                              className='hover:bg-muted/50'
                            >
                              {DEFAULT_COLUMNS.map((column) => (
                                <TableCell
                                  key={column.id}
                                  className={`${column.width} ${
                                    column.key === 'material_number'
                                      ? 'text-foreground font-medium'
                                      : column.key === 'to_number'
                                        ? 'text-foreground font-medium'
                                        : column.key === 'mca_reason'
                                          ? 'text-muted-foreground'
                                          : 'text-foreground'
                                  }`}
                                >
                                  {getCellContent(item, column)}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell
                              colSpan={DEFAULT_COLUMNS.length}
                              className='text-muted-foreground py-8 text-center'
                            >
                              {data.length === 0
                                ? 'No putaway operations found.'
                                : 'No data found matching your search criteria.'}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {!isLoading && (
                  <div className='mt-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
                    {/* Left side: Info and status indicators */}
                    <div className='text-muted-foreground flex items-center gap-4 text-sm'>
                      <span>
                        Showing {startIndex + 1}-
                        {Math.min(endIndex, totalRecords)} of {totalRecords}{' '}
                        entries
                        {totalRecords !== data.length &&
                          ` (filtered from ${data.length} total)`}
                      </span>
                      {enableRealtime && (
                        <span className='flex items-center gap-1 text-green-500'>
                          ● Live Updates
                        </span>
                      )}
                      {sortConfig && (
                        <span className='flex items-center gap-1 text-purple-600'>
                          ● Sorted by{' '}
                          {
                            DEFAULT_COLUMNS.find(
                              (col) => col.key === sortConfig.key
                            )?.label
                          }{' '}
                          ({sortConfig.direction === 'asc' ? 'A-Z' : 'Z-A'})
                        </span>
                      )}
                    </div>

                    {/* Right side: Pagination and actions */}
                    <div className='flex items-center gap-2'>
                      {/* Pagination Controls */}
                      {totalPages > 1 && (
                        <div className='mr-4 flex items-center gap-1'>
                          <Button
                            variant='outline'
                            size='sm'
                            onClick={goToPreviousPage}
                            disabled={currentPage === 1}
                            className='border-border h-8 w-8 p-0'
                          >
                            <ChevronLeft className='h-4 w-4' />
                          </Button>

                          <div className='flex items-center gap-1'>
                            {/* Show page numbers */}
                            {Array.from(
                              { length: Math.min(5, totalPages) },
                              (_, i) => {
                                let pageNum
                                if (totalPages <= 5) {
                                  pageNum = i + 1
                                } else if (currentPage <= 3) {
                                  pageNum = i + 1
                                } else if (currentPage >= totalPages - 2) {
                                  pageNum = totalPages - 4 + i
                                } else {
                                  pageNum = currentPage - 2 + i
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
                                    onClick={() => goToPage(pageNum)}
                                    className='h-8 w-8 p-0 text-xs'
                                  >
                                    {pageNum}
                                  </Button>
                                )
                              }
                            )}
                          </div>

                          <Button
                            variant='outline'
                            size='sm'
                            onClick={goToNextPage}
                            disabled={currentPage === totalPages}
                            className='border-border h-8 w-8 p-0'
                          >
                            <ChevronRight className='h-4 w-4' />
                          </Button>
                        </div>
                      )}

                      {/* Action buttons */}
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={refreshData}
                        className='border-border'
                      >
                        Refresh
                      </Button>
                      {searchQuery && (
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => setSearchQuery('')}
                          className='border-border'
                        >
                          Clear Search
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* MCA Processing Modal */}
        {selectedMcaOperation && (
          <MCAProcessingModal
            isOpen={mcaModalOpen}
            onClose={() => {
              setMcaModalOpen(false)
              setSelectedMcaOperation(null)
            }}
            putawayOperation={selectedMcaOperation}
            onProcessingComplete={handleMcaProcessingComplete}
            currentUserId={profile?.id || null}
          />
        )}
      </div>
    )
  }
)

PutawayLogSearch.displayName = 'PutawayLogSearch'

export default PutawayLogSearch
