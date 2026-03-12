import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowUpFromLine,
  BarChart3,
  Boxes,
  Calendar,
  ChevronLeft,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Edit2,
  Flame,
  Gamepad2,
  Hammer,
  Home,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  Monitor,
  Moon,
  Package,
  Palette,
  RotateCcw,
  Scan,
  Search,
  Sun,
  TrendingUp,
  Truck,
  User,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  hotPartAlertService,
  type HotPartAlert,
  MATCH_TYPE_LABELS,
} from '@/lib/supabase/hot-part-alert.service'
import { InboundScanService } from '@/lib/supabase/inbound-scans'
import {
  getDeviceRegistration,
  parseDeviceInfo,
  updateDeviceName,
} from '@/lib/utils/device-fingerprint'
import { logger } from '@/lib/utils/logger'
import type { WsEvent } from '@/lib/work-service/types'
import { workServiceWs } from '@/lib/work-service/websocket'
import { useTheme } from '@/context/theme-context'
import { usePushedWork, useWorkerHeartbeat } from '@/hooks/use-pushed-work'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DeviceRegistrationDialog,
  useDeviceRegistration,
} from '@/components/ui/device-registration-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import RFBuildKitForm from '@/components/ui/rf-build-kit-form'
import { RFCycleCountUnified } from '@/components/ui/rf-cycle-count-unified'
import RFDroneControl from '@/components/ui/rf-drone-control'
import RFGRSCycleCountForm from '@/components/ui/rf-grs-cycle-count-form'
import RFInspectKitForm from '@/components/ui/rf-inspect-kit-form'
import RFKittingPickingForm from '@/components/ui/rf-kitting-picking-form'
import RFLocationScanner from '@/components/ui/rf-location-scanner'
import RFPickingForm from '@/components/ui/rf-picking-form'
import RFPutawayForm from '@/components/ui/rf-putaway-form'
import RFSAPMigoForm from '@/components/ui/rf-sap-migo-form'
import RFTaskClaim from '@/components/ui/rf-task-claim'
import RFWorkQueueDashboardSimple from '@/components/ui/rf-work-queue-dashboard-simple'
import { ScannerInput } from '@/components/ui/scanner-input'
import { CycleCountErrorBoundary } from '@/components/error-boundaries/CycleCountErrorBoundary'
import {
  ActivityGantt,
  ActivityLegend,
} from '@/features/shift-productivity/team-performance/components/activity-gantt'
import { useTeamPerformance } from '@/features/shift-productivity/team-performance/hooks/use-team-performance'

// Utils function
function cn(...inputs: (string | number | boolean | undefined | null)[]) {
  return inputs.filter(Boolean).join(' ')
}

// Dock Component
type IconComponentType = React.ElementType<{ className?: string }>

export interface DockMenuItem {
  label: string
  icon: IconComponentType
  action?: () => void
}

export interface DockProps {
  items?: DockMenuItem[]
  accentColor?: string
  activeIndex?: number
  onActiveIndexChange?: (index: number) => void
}

const defaultDockItems: DockMenuItem[] = [
  { label: 'Inventory', icon: Package },
  { label: 'Locations', icon: MapPin },
  { label: 'Picking', icon: ClipboardList },
  { label: 'Profile', icon: User },
  { label: 'Reports', icon: BarChart3 },
]

const Dock: React.FC<DockProps> = ({
  items,
  accentColor,
  activeIndex: controlledActiveIndex,
  onActiveIndexChange,
}) => {
  const finalItems = useMemo(() => {
    const isValid =
      items && Array.isArray(items) && items.length >= 2 && items.length <= 6
    if (!isValid) {
      return defaultDockItems
    }
    return items
  }, [items])

  const [internalActiveIndex, setInternalActiveIndex] = useState(0)
  const textRefs = useRef<(HTMLElement | null)[]>([])
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Use controlled activeIndex if provided, otherwise use internal state
  const activeIndex =
    controlledActiveIndex !== undefined
      ? controlledActiveIndex
      : internalActiveIndex

  useEffect(() => {
    if (activeIndex >= finalItems.length) {
      const newIndex = 0
      if (controlledActiveIndex !== undefined && onActiveIndexChange) {
        onActiveIndexChange(newIndex)
      } else {
        setInternalActiveIndex(newIndex)
      }
    }
  }, [finalItems, activeIndex, controlledActiveIndex, onActiveIndexChange])

  useEffect(() => {
    const setLineWidth = () => {
      const activeItemElement = itemRefs.current[activeIndex]
      const activeTextElement = textRefs.current[activeIndex]

      if (activeItemElement && activeTextElement) {
        const textWidth = activeTextElement.offsetWidth
        activeItemElement.style.setProperty('--lineWidth', `${textWidth}px`)
      }
    }

    setLineWidth()
    window.addEventListener('resize', setLineWidth)
    return () => {
      window.removeEventListener('resize', setLineWidth)
    }
  }, [activeIndex, finalItems])

  const handleItemClick = (index: number) => {
    if (controlledActiveIndex !== undefined && onActiveIndexChange) {
      onActiveIndexChange(index)
    } else {
      setInternalActiveIndex(index)
    }
    if (finalItems[index].action) {
      finalItems[index].action!()
    }
  }

  const navStyle = useMemo(() => {
    const activeColor = accentColor || 'var(--primary)'
    return { '--component-active-color': activeColor } as React.CSSProperties
  }, [accentColor])

  return (
    <nav
      className='bg-card border-border fixed left-1/2 z-50 -translate-x-1/2 transform rounded-2xl border p-2 shadow-lg'
      style={{
        ...navStyle,
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
      }}
    >
      <div className='flex items-center space-x-2'>
        {finalItems.map((item, index) => {
          const isActive = index === activeIndex
          const IconComponent = item.icon

          return (
            <button
              key={item.label}
              className={cn(
                'relative flex h-16 w-16 flex-col items-center justify-center rounded-xl p-3 transition-all duration-300',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
              onClick={() => handleItemClick(index)}
              ref={(el) => {
                if (el) itemRefs.current[index] = el
              }}
            >
              <div className='flex flex-col items-center'>
                <IconComponent className='mb-1 h-5 w-5' />
                <span
                  className='text-xs font-medium'
                  ref={(el) => {
                    if (el) textRefs.current[index] = el
                  }}
                >
                  {item.label}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

// Theme Toggle Button Component for RF Interface
// 4-Option Theme Selector for Profile Section
const RFThemeSelector = () => {
  const { theme, setTheme } = useTheme()

  const themeOptions = [
    {
      value: 'light',
      label: 'Light',
      icon: Sun,
      description: 'Light theme',
    },
    {
      value: 'dark',
      label: 'Dark',
      icon: Moon,
      description: 'Dark theme',
    },
    {
      value: 'system',
      label: 'System',
      icon: Monitor,
      description: 'Follow system',
    },
    {
      value: 'custom',
      label: 'Custom',
      icon: Palette,
      description: 'Custom colors',
    },
  ]

  return (
    <div className='grid grid-cols-2 gap-2'>
      {themeOptions.map((option) => {
        const Icon = option.icon
        const isActive = theme === option.value

        return (
          <Button
            key={option.value}
            variant={isActive ? 'default' : 'outline'}
            size='sm'
            onClick={() =>
              setTheme(option.value as 'light' | 'dark' | 'system' | 'custom')
            }
            className={`flex h-auto flex-col items-center justify-center space-y-1 py-3 transition-all ${
              isActive
                ? 'bg-primary text-primary-foreground shadow-md'
                : 'hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <Icon
              className={`h-5 w-5 ${isActive ? 'text-primary-foreground' : ''}`}
            />
            <span className='text-xs font-medium'>{option.label}</span>
            <span className='text-[10px] opacity-70'>{option.description}</span>
          </Button>
        )
      })}
    </div>
  )
}

// Safe Area Spacer Component - handles iOS notch/Dynamic Island
const SafeAreaTop = () => {
  return (
    <div
      className='bg-background w-full flex-shrink-0'
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    />
  )
}

// Status Bar Component (kept for future use)
const StatusBar = () => {
  // Theme toggle has been moved to the Profile section
  return null
}

// Quick Action Button Component
const QuickActionButton = ({
  icon: Icon,
  label,
  onClick,
  variant = 'default',
}: {
  icon: IconComponentType
  label: string
  onClick: () => void
  variant?:
    | 'default'
    | 'success'
    | 'warning'
    | 'destructive'
    | 'info'
    | 'orange'
    | 'teal'
    | 'slate'
}) => {
  const variantStyles = {
    default: 'bg-card hover:bg-accent text-foreground',
    success:
      'bg-green-50 hover:bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:hover:bg-green-900/60 dark:text-green-100 dark:border-green-800/40',
    warning:
      'bg-yellow-50 hover:bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/40 dark:hover:bg-yellow-900/60 dark:text-yellow-100 dark:border-yellow-800/40',
    destructive:
      'bg-red-50 hover:bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-100 dark:border-red-800/40',
    info: 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:hover:bg-blue-900/60 dark:text-blue-100 dark:border-blue-800/40',
    orange:
      'bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:hover:bg-orange-900/60 dark:text-orange-100 dark:border-orange-800/40',
    teal: 'bg-teal-50 hover:bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/40 dark:hover:bg-teal-900/60 dark:text-teal-100 dark:border-teal-800/40',
    slate:
      'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:hover:bg-slate-800/80 dark:text-slate-100 dark:border-slate-700/60',
  }

  return (
    <Button
      variant='outline'
      size='sm'
      className={cn(
        'h-16 w-full flex-col space-y-1 border-2 text-center transition-all duration-200',
        variantStyles[variant]
      )}
      onClick={onClick}
    >
      <Icon className='h-5 w-5 transition-colors duration-200' />
      <span className='text-xs font-medium transition-colors duration-200'>
        {label}
      </span>
    </Button>
  )
}

// Enhanced Inbound Scan Form Component (5 Fields + Hot Truck Checkbox) with Auto-Advance
const InboundScanForm = ({
  onScanSubmit,
  isScanning = false,
  onBackClick,
}: {
  onScanSubmit: (formData: {
    tracking_number: string
    so_line_rma_afa: string
    material_number: string
    quantity: number
    tka_batch_number: string
    hot_truck: boolean
  }) => void
  isScanning?: boolean
  onBackClick?: () => void
}) => {
  const [formData, setFormData] = useState({
    tracking_number: '',
    so_line_rma_afa: '',
    material_number: '',
    quantity: '',
    tka_batch_number: '',
    hot_truck: false,
  })

  // Auto-advance system
  const fieldOrder = [
    'tracking_number',
    'so_line_rma_afa',
    'material_number',
    'quantity',
    'tka_batch_number',
  ]
  const [currentActiveField, setCurrentActiveField] =
    useState('tracking_number')
  const [timers, setTimers] = useState(new Map<string, NodeJS.Timeout>())
  const autoAdvanceDelay = 800 // 800ms delay like Django app

  // Refs for each input field
  const trackingRef = useRef<HTMLInputElement>(null)
  const soLineRef = useRef<HTMLInputElement>(null)
  const materialRef = useRef<HTMLInputElement>(null)
  const quantityRef = useRef<HTMLInputElement>(null)
  const tkaBatchRef = useRef<HTMLInputElement>(null)

  const fieldRefs = {
    tracking_number: trackingRef,
    so_line_rma_afa: soLineRef,
    material_number: materialRef,
    quantity: quantityRef,
    tka_batch_number: tkaBatchRef,
  }

  // Auto-focus on first field when component mounts
  useEffect(() => {
    const timer = setTimeout(() => {
      setActiveField('tracking_number')
    }, 100) // Small delay to ensure DOM is ready

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- One-time mount effect to auto-focus first field
  }, [])

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
    }
  }, [timers])

  // Comprehensive form validation including all business rules
  const isFormValid =
    formData.tracking_number.trim() &&
    formData.so_line_rma_afa.trim() &&
    formData.material_number.trim() &&
    formData.quantity.trim() &&
    !isNaN(parseFloat(formData.quantity)) &&
    parseFloat(formData.quantity) > 0 &&
    formData.tka_batch_number.trim() &&
    formData.tka_batch_number.trim().length === 10 &&
    formData.tka_batch_number.trim().startsWith('TK2')

  // Auto-submit when form becomes valid and last field is complete
  useEffect(() => {
    // Only auto-submit if we're on the last field and form is valid
    if (
      currentActiveField === 'tka_batch_number' &&
      isFormValid &&
      !isScanning
    ) {
      // Small delay to ensure user has finished typing
      const autoSubmitTimer = setTimeout(() => {
        logger.log(
          '✅ RF Inbound Scanner: Auto-submitting form - all fields valid'
        )
        handleAutoSubmit()
      }, 1000) // 1 second delay after last field is complete

      return () => clearTimeout(autoSubmitTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleAutoSubmit is a non-memoized helper; its deps (isFormValid, isScanning) are already tracked
  }, [formData.tka_batch_number, isFormValid, currentActiveField, isScanning])

  // Field completion detection logic (based on Django app)
  const isFieldComplete = (value: string, fieldId: string): boolean => {
    const trimmedValue = value.trim()

    switch (fieldId) {
      case 'tracking_number':
        return trimmedValue.length >= 8 // Minimum tracking number length
      case 'so_line_rma_afa':
        return trimmedValue.length >= 3 // Minimum SO/Line length
      case 'material_number':
        return trimmedValue.length >= 5 // Minimum material number length
      case 'quantity':
        return (
          trimmedValue.length > 0 &&
          !isNaN(Number(trimmedValue)) &&
          Number(trimmedValue) >= 0
        )
      case 'tka_batch_number':
        return trimmedValue.startsWith('TK2') && trimmedValue.length === 10
      default:
        return trimmedValue.length > 0
    }
  }

  // Clear timer for specific field
  const clearTimer = (fieldId: string) => {
    const currentTimer = timers.get(fieldId)
    if (currentTimer) {
      clearTimeout(currentTimer)
      setTimers((prev) => {
        const newTimers = new Map(prev)
        newTimers.delete(fieldId)
        return newTimers
      })
    }
  }

  // Clear all timers
  const clearAllTimers = () => {
    timers.forEach((timer) => clearTimeout(timer))
    setTimers(new Map())
  }

  // Set active field with focus and selection for immediate input
  const setActiveField = (fieldId: string) => {
    setCurrentActiveField(fieldId)
    const fieldRef = fieldRefs[fieldId as keyof typeof fieldRefs]
    if (fieldRef?.current) {
      // Force focus first
      fieldRef.current.focus()
      // Use requestAnimationFrame to ensure DOM is ready, then select all content
      requestAnimationFrame(() => {
        if (fieldRef?.current) {
          fieldRef.current.select()
          // For extra reliability with barcode scanners, also set selection range
          // (only works on text inputs, not number inputs)
          if (fieldRef.current.type !== 'number') {
            try {
              fieldRef.current.setSelectionRange(
                0,
                fieldRef.current.value.length
              )
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (e) {
              // Silently ignore for input types that don't support selection range
            }
          }
        }
      })
    }
  }

  // Move to next field in sequence
  const moveToNextField = (currentFieldId: string) => {
    const currentIndex = fieldOrder.indexOf(currentFieldId)
    if (currentIndex < fieldOrder.length - 1) {
      const nextFieldId = fieldOrder[currentIndex + 1]
      setActiveField(nextFieldId)
    } else {
      // Last field reached - auto submit if all fields are valid
      if (isFormValid) {
        setTimeout(() => {
          handleAutoSubmit()
        }, 500)
      }
    }
  }

  // Handle field changes with auto-advance logic
  const handleFieldChange = (fieldId: string, value: string) => {
    clearTimer(fieldId) // Clear existing timer

    if (isFieldComplete(value, fieldId)) {
      // Set timer for auto advance
      const timer = setTimeout(() => {
        moveToNextField(fieldId)
      }, autoAdvanceDelay)

      setTimers((prev) => new Map(prev).set(fieldId, timer))
    }
  }

  // Handle Enter key press
  const handleKeyPress = (e: React.KeyboardEvent, fieldId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      clearTimer(fieldId)
      moveToNextField(fieldId)
    }
  }

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))

    // Trigger auto-advance logic for string fields
    if (typeof value === 'string') {
      handleFieldChange(field, value)
    }
  }

  // Auto-submit function
  const handleAutoSubmit = () => {
    if (isFormValid && !isScanning) {
      handleScanItem(new Event('submit') as unknown as React.FormEvent)
    }
  }

  // Reset form and return focus to first field
  // Note: hot_truck flag is preserved until manually turned off
  const resetFormAndFocus = () => {
    setFormData((prev) => ({
      tracking_number: '',
      so_line_rma_afa: '',
      material_number: '',
      quantity: '',
      tka_batch_number: '',
      hot_truck: prev.hot_truck, // Preserve Hot Truck flag
    }))
    clearAllTimers()
    setCurrentActiveField('tracking_number')

    // Enhanced focus management specifically for barcode scanner input readiness
    // Critical: For barcode scanners, we need the input to be truly active with cursor positioned
    const activateFieldForScanner = () => {
      if (trackingRef.current) {
        // Step 1: Focus the field
        trackingRef.current.focus()

        // Step 2: Ensure cursor is at start position (ready for new input)
        trackingRef.current.selectionStart = 0
        trackingRef.current.selectionEnd = 0

        // Step 3: Trigger click event to fully activate the input
        trackingRef.current.click()

        // Step 4: Force blur and refocus to reset input state
        trackingRef.current.blur()
        setTimeout(() => {
          if (trackingRef.current) {
            trackingRef.current.focus()
            logger.log(
              '✅ RF Inbound Scanner: Tracking field fully activated for scanner input'
            )
          }
        }, 10)
      }
    }

    // Multiple retry attempts with progressive timing
    setTimeout(activateFieldForScanner, 50)
    setTimeout(activateFieldForScanner, 150)
    setTimeout(activateFieldForScanner, 300)
  }

  // Handle Clear button
  const handleClear = () => {
    resetFormAndFocus()
    toast.success('Form cleared')
  }

  // Handle Scan Item button
  const handleScanItem = (e: React.FormEvent) => {
    e.preventDefault()
    clearAllTimers() // Clear any pending timers

    // Validate required fields
    if (
      !formData.tracking_number.trim() ||
      !formData.so_line_rma_afa.trim() ||
      !formData.material_number.trim() ||
      !formData.quantity.trim() ||
      !formData.tka_batch_number.trim()
    ) {
      toast.error('All fields are required')
      return
    }

    // Validate TK batch number format and length
    const tkBatch = formData.tka_batch_number.trim()
    if (!tkBatch.startsWith('TK2')) {
      toast.error('TK Batch Number must start with "TK2"')
      return
    }
    if (tkBatch.length !== 10) {
      toast.error('TK Batch Number must be exactly 10 characters')
      return
    }

    // Validate quantity is a number
    const quantity = parseFloat(formData.quantity)
    if (isNaN(quantity) || quantity <= 0) {
      toast.error('Quantity must be a positive number')
      return
    }

    onScanSubmit({
      tracking_number: formData.tracking_number.trim(),
      so_line_rma_afa: formData.so_line_rma_afa.trim(),
      material_number: formData.material_number.trim(),
      quantity,
      tka_batch_number: formData.tka_batch_number.trim(),
      hot_truck: formData.hot_truck,
    })

    // Reset form and return focus to first field after successful submission
    // Note: resetFormAndFocus preserves the hot_truck flag value
    resetFormAndFocus()

    // Additional focus enforcement after form reset - critical for scanner readiness
    setTimeout(() => {
      if (trackingRef.current) {
        trackingRef.current.focus()
        trackingRef.current.selectionStart = 0
        trackingRef.current.selectionEnd = 0
        setCurrentActiveField('tracking_number')
        logger.log(
          '✅ RF Inbound Scanner: Post-submit focus enforcement completed'
        )
      }
    }, 400)
  }

  return (
    <div className='mx-auto flex w-full max-w-md flex-1 flex-col space-y-3 p-2'>
      {/* Form Content */}
      <Card className='flex w-full flex-1 flex-col'>
        <CardHeader className='relative pb-2 text-center'>
          {onBackClick && (
            <Button
              variant='ghost'
              size='sm'
              onClick={onBackClick}
              className='absolute top-2 left-2'
            >
              <ChevronLeft className='h-4 w-4' />
              Back
            </Button>
          )}
          <CardTitle className='flex flex-col items-center gap-2 text-sm'>
            <Scan className='h-8 w-8' />
            Inbound Scanner
          </CardTitle>
        </CardHeader>
        <CardContent className='flex flex-1 flex-col'>
          <form
            onSubmit={handleScanItem}
            className='flex flex-1 flex-col space-y-3'
          >
            <div className='flex-1 space-y-3'>
              {/* Tracking Number */}
              <div className='space-y-1'>
                <Label
                  htmlFor='tracking_number'
                  className='text-xs font-medium'
                >
                  Tracking Number *
                </Label>
                <ScannerInput
                  ref={trackingRef}
                  id='tracking_number'
                  type='text'
                  placeholder='Scan or enter tracking number'
                  value={formData.tracking_number}
                  onChange={(e) =>
                    updateField('tracking_number', e.target.value)
                  }
                  onKeyDown={(e) => handleKeyPress(e, 'tracking_number')}
                  onFocus={() => setCurrentActiveField('tracking_number')}
                  className={cn(
                    'h-10 text-center font-mono text-sm',
                    currentActiveField === 'tracking_number'
                      ? 'ring-primary ring-opacity-20 border-primary ring-2'
                      : ''
                  )}
                  disabled={isScanning}
                />
              </div>

              {/* SO/Line, RMA/AFA# */}
              <div className='space-y-1'>
                <Label
                  htmlFor='so_line_rma_afa'
                  className='text-xs font-medium'
                >
                  SO/Line, RMA/AFA # *
                </Label>
                <ScannerInput
                  ref={soLineRef}
                  id='so_line_rma_afa'
                  type='text'
                  placeholder='Scan or enter SO/Line, RMA/AFA #'
                  value={formData.so_line_rma_afa}
                  onChange={(e) =>
                    updateField('so_line_rma_afa', e.target.value)
                  }
                  onKeyDown={(e) => handleKeyPress(e, 'so_line_rma_afa')}
                  onFocus={() => setCurrentActiveField('so_line_rma_afa')}
                  className={cn(
                    'h-10 text-center font-mono text-sm',
                    currentActiveField === 'so_line_rma_afa'
                      ? 'ring-primary ring-opacity-20 border-primary ring-2'
                      : ''
                  )}
                  disabled={isScanning}
                />
              </div>

              {/* Material Number */}
              <div className='space-y-1'>
                <Label
                  htmlFor='material_number'
                  className='text-xs font-medium'
                >
                  Material Number *
                </Label>
                <ScannerInput
                  ref={materialRef}
                  id='material_number'
                  type='text'
                  placeholder='Scan or enter material number'
                  value={formData.material_number}
                  onChange={(e) =>
                    updateField('material_number', e.target.value)
                  }
                  onKeyDown={(e) => handleKeyPress(e, 'material_number')}
                  onFocus={() => setCurrentActiveField('material_number')}
                  className={cn(
                    'h-10 text-center font-mono text-sm',
                    currentActiveField === 'material_number'
                      ? 'ring-primary ring-opacity-20 border-primary ring-2'
                      : ''
                  )}
                  disabled={isScanning}
                />
              </div>

              {/* Quantity */}
              <div className='space-y-1'>
                <Label htmlFor='quantity' className='text-xs font-medium'>
                  Quantity *
                </Label>
                <ScannerInput
                  ref={quantityRef}
                  id='quantity'
                  type='number'
                  step='0.001'
                  min='0.001'
                  placeholder='Enter quantity'
                  value={formData.quantity}
                  onChange={(e) => updateField('quantity', e.target.value)}
                  onKeyDown={(e) => handleKeyPress(e, 'quantity')}
                  onFocus={() => setCurrentActiveField('quantity')}
                  className={cn(
                    'h-10 text-center font-mono text-sm',
                    currentActiveField === 'quantity'
                      ? 'ring-primary ring-opacity-20 border-primary ring-2'
                      : ''
                  )}
                  disabled={isScanning}
                />
              </div>

              {/* TKA Batch Number */}
              <div className='space-y-1'>
                <Label
                  htmlFor='tka_batch_number'
                  className='text-xs font-medium'
                >
                  TKA Batch Number * (Must be exactly 10 characters)
                </Label>
                <ScannerInput
                  ref={tkaBatchRef}
                  id='tka_batch_number'
                  type='text'
                  placeholder='TK2XXXXXXXX'
                  value={formData.tka_batch_number}
                  onChange={(e) =>
                    updateField(
                      'tka_batch_number',
                      e.target.value.toUpperCase()
                    )
                  }
                  onKeyDown={(e) => handleKeyPress(e, 'tka_batch_number')}
                  onFocus={() => setCurrentActiveField('tka_batch_number')}
                  className={cn(
                    'h-10 text-center font-mono text-sm',
                    currentActiveField === 'tka_batch_number'
                      ? 'ring-primary ring-opacity-20 border-primary ring-2'
                      : '',
                    formData.tka_batch_number &&
                      formData.tka_batch_number.length !== 10
                      ? 'border-red-500'
                      : ''
                  )}
                  disabled={isScanning}
                  minLength={10}
                  maxLength={10}
                  pattern='TK2[A-Z0-9]{7}'
                  title='TK Batch Number must be exactly 10 characters starting with TK2'
                />
                {formData.tka_batch_number &&
                  formData.tka_batch_number.length !== 10 && (
                    <p className='text-xs text-red-500'>
                      Current length: {formData.tka_batch_number.length}/10
                      characters
                    </p>
                  )}
              </div>

              {/* Hot Truck Checkbox */}
              <div className='rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-950/20'>
                <div className='flex items-center space-x-2'>
                  <Checkbox
                    id='hot_truck'
                    checked={formData.hot_truck}
                    onCheckedChange={(checked) =>
                      updateField('hot_truck', String(checked))
                    }
                    disabled={isScanning}
                    className='h-4 w-4 data-[state=checked]:border-orange-600 data-[state=checked]:bg-orange-600'
                  />
                  <Label
                    htmlFor='hot_truck'
                    className='flex cursor-pointer items-center text-xs font-medium'
                  >
                    🚛 Hot Truck Item (Priority)
                  </Label>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className='mt-auto flex space-x-2 pt-3'>
              <Button
                type='button'
                onClick={handleClear}
                variant='outline'
                className='h-10 flex-1'
                disabled={isScanning}
              >
                <RotateCcw className='mr-1 h-3 w-3' />
                Clear
              </Button>

              <Button
                type='submit'
                className={cn(
                  'h-10 flex-1',
                  formData.hot_truck ? 'bg-orange-600 hover:bg-orange-700' : ''
                )}
                disabled={!isFormValid || isScanning}
              >
                {isScanning ? (
                  <>
                    <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                    Recording...
                  </>
                ) : (
                  <>
                    <Scan className='mr-1 h-3 w-3' />
                    Scan Item {formData.hot_truck ? '🚛' : ''}
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// Main RF Interface Component
const RFInterface = () => {
  const [currentView, setCurrentView] = useState('home')
  const [dockActiveIndex, setDockActiveIndex] = useState(0)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [kittingPickingKitPo, setKittingPickingKitPo] = useState<string | null>(
    null
  ) // Track Kit PO for kitting picking

  // Hot Part Alert state
  const [hotPartAlertMatch, setHotPartAlertMatch] = useState<
    HotPartAlert[] | null
  >(null)
  const [hotPartAlertScanData, setHotPartAlertScanData] = useState<{
    material_number: string
    so_line_rma_afa: string
    tracking_number: string
  } | null>(null)
  const { authState, signOut } = useUnifiedAuth()
  const { user, profile } = authState
  const navigate = useNavigate()

  // Pushed work tracking for Cycle Count OUT
  const { pushedCount, newPushAlert: _newPushAlert } = usePushedWork()

  // Track current task for heartbeat
  // Note: setCurrentTask and setCurrentZone are intentionally unused for now
  // They will be used when task tracking is fully implemented
  const [currentTask, _setCurrentTask] = useState<{
    id: string
    location: string
  } | null>(null)
  const [currentZone, _setCurrentZone] = useState<string | null>(null)

  // WebSocket event handler
  const handleWsEvent = useCallback((event: WsEvent) => {
    if (event.type === 'PushedWork') {
      // Already handled by usePushedWork hook
      logger.log('[RFInterface] Received PushedWork event:', event)
    }
    if (event.type === 'QueueStatsUpdated') {
      // Could update local stats display if needed
      logger.log('[RFInterface] Queue stats updated:', event)
    }
    if (event.type === 'WorkerStatusChanged') {
      logger.log('[RFInterface] Worker status changed:', event)
    }
  }, [])

  // Connect WebSocket and start heartbeat on mount
  useEffect(() => {
    const orgId = authState.profile?.organization_id
    if (!orgId) return

    // Connect to WebSocket
    workServiceWs.connect(orgId, handleWsEvent)

    // Start heartbeat interval (every 30 seconds)
    const heartbeatInterval = setInterval(() => {
      workServiceWs.sendHeartbeat({
        task_id: currentTask?.id,
        task_type: 'cycle_count',
        zone: currentZone || undefined,
        location: currentTask?.location,
        status: currentTask ? 'busy' : 'idle',
      })
    }, 30000)

    // Send initial heartbeat
    workServiceWs.sendHeartbeat({
      status: 'online',
    })

    return () => {
      clearInterval(heartbeatInterval)
      // Send offline status before disconnecting
      workServiceWs.sendHeartbeat({ status: 'offline' })
      workServiceWs.disconnect()
    }
  }, [
    authState.profile?.organization_id,
    currentTask,
    currentZone,
    handleWsEvent,
  ])

  // Use the worker heartbeat hook as well for redundancy
  useWorkerHeartbeat({
    enabled: !!authState.profile?.organization_id,
    interval: 30000,
    taskId: currentTask?.id,
    taskType: 'cycle_count',
    zone: currentZone || undefined,
    location: currentTask?.location,
  })

  // Use team performance service for activity timeline
  const {
    performanceData,
    isLoadingPerformance,
    refresh: refreshPerformanceData,
  } = useTeamPerformance({
    autoRefresh: false,
    enableTimelineEvents: true,
  })

  // Device registration state
  const { needsRegistration, setNeedsRegistration } = useDeviceRegistration()
  const [showDeviceRegistration, setShowDeviceRegistration] = useState(false)
  const [deviceName, setDeviceName] = useState<string>('RF Terminal')
  const [isEditingDeviceName, setIsEditingDeviceName] = useState(false)
  const [deviceInfo, setDeviceInfo] = useState<Awaited<
    ReturnType<typeof parseDeviceInfo>
  > | null>(null)

  // Load registered device name and sync to database (with retroactive sync)
  useEffect(() => {
    const loadAndSyncDeviceInfo = async () => {
      // Load device info first (using native APIs if available)
      const info = await parseDeviceInfo()
      setDeviceInfo(info)

      const device = await getDeviceRegistration()
      if (device) {
        setDeviceName(device.device_name)

        // ALWAYS attempt to sync device to database if user is logged in
        // This handles retroactive syncing of devices that were registered but failed to sync
        if (user && profile?.organization_id) {
          try {
            logger.log(
              '🔄 Syncing device to database (retroactive sync if needed)...'
            )
            const { DeviceRegistrationService } =
              await import('@/lib/supabase/device-registration.service')
            await DeviceRegistrationService.syncDeviceToDatabase(
              user.id,
              profile.organization_id
            )
            logger.log('✅ Device successfully synced to database')
          } catch (syncError) {
            logger.error('❌ Failed to sync device to database:', syncError)
            // Show a subtle warning - device still works locally
            toast.warning(
              'Device sync to database failed. Session Management may not show this device.',
              {
                duration: 3000,
              }
            )
          }
        } else if (user && !profile?.organization_id) {
          logger.warn(
            '⚠️ Cannot sync device - no organization_id available yet'
          )
        }
      } else {
        setDeviceName(info.deviceType)
        // Show device registration dialog for new devices
        if (user) {
          setShowDeviceRegistration(true)
        }
      }
    }

    // Only run when we have auth state loaded
    if (user !== undefined) {
      loadAndSyncDeviceInfo()
    }
  }, [user, profile])

  // Show registration dialog on first login
  useEffect(() => {
    if (user && needsRegistration) {
      // Small delay to let the UI settle after login
      const timer = setTimeout(() => {
        setShowDeviceRegistration(true)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [user, needsRegistration])

  // Helper function to navigate and sync dock active index
  const navigateToView = (view: string, dockIndex: number) => {
    setCurrentView(view)
    setDockActiveIndex(dockIndex)
  }

  // Sample data
  const inventoryItems = [
    {
      id: 'SKU001',
      name: 'Widget A',
      location: 'A1-B2-C3',
      quantity: 150,
      status: 'In Stock',
    },
    {
      id: 'SKU002',
      name: 'Widget B',
      location: 'A2-B1-C4',
      quantity: 75,
      status: 'Low Stock',
    },
    {
      id: 'SKU003',
      name: 'Widget C',
      location: 'A3-B3-C1',
      quantity: 0,
      status: 'Out of Stock',
    },
  ]

  // Refresh performance data when switching to productivity view
  useEffect(() => {
    if (currentView === 'my-productivity') {
      refreshPerformanceData()
    }
  }, [currentView, refreshPerformanceData])

  const handleScanSubmit = async (formData: {
    tracking_number: string
    so_line_rma_afa: string
    material_number: string
    quantity: number
    tka_batch_number: string
    hot_truck: boolean
  }) => {
    setIsScanning(true)
    try {
      // Create the scan in the database with enhanced 5-field structure
      const { data, error } = await InboundScanService.createScan({
        tracking_number: formData.tracking_number,
        so_line_rma_afa: formData.so_line_rma_afa,
        material_number: formData.material_number,
        quantity: formData.quantity,
        tka_batch_number: formData.tka_batch_number,
        hot_truck: formData.hot_truck,
        scan_location: 'RF Terminal', // Could be made configurable
      })

      if (error) {
        logger.error('Error creating inbound scan:', error)
        toast.error(
          `Failed to save scan: ${(error as { message?: string })?.message || 'Unknown error'}`
        )
        return
      }

      if (data) {
        toast.success(
          `✅ Inbound scan recorded${formData.hot_truck ? ' (HOT TRUCK)' : ''}`
        )
      }

      // Check for hot part alerts (non-blocking - don't fail the scan if alert check fails)
      try {
        const { alerts } = await hotPartAlertService.checkForAlerts({
          material_number: formData.material_number,
          so_line_rma_afa: formData.so_line_rma_afa,
          tracking_number: formData.tracking_number,
        })

        if (alerts && alerts.length > 0) {
          logger.log('🔥 HOT PART ALERT TRIGGERED:', alerts)
          setHotPartAlertMatch(alerts)
          setHotPartAlertScanData({
            material_number: formData.material_number,
            so_line_rma_afa: formData.so_line_rma_afa,
            tracking_number: formData.tracking_number,
          })
        }
      } catch (alertError) {
        logger.warn('Hot part alert check failed (non-critical):', alertError)
      }
    } catch (error: unknown) {
      logger.error('Error processing scan:', error)
      toast.error(
        `Failed to process scan: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    } finally {
      setIsScanning(false)
    }
  }

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      await signOut()
      toast.success('Logged out successfully')
      navigate({ to: '/rf-signin' })
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to log out')
    } finally {
      setIsLoggingOut(false)
    }
  }

  const dockItems: DockMenuItem[] = [
    {
      label: 'Home',
      icon: Home,
      action: () => navigateToView('home', 0),
    },
    {
      label: 'Inventory',
      icon: Package,
      action: () => navigateToView('inventory', 1),
    },
    {
      label: 'Locations',
      icon: MapPin,
      action: () => navigateToView('locations', 2),
    },
    {
      label: 'Picking',
      icon: ClipboardList,
      action: () => navigateToView('picking', 3),
    },
    {
      label: 'Profile',
      icon: User,
      action: () => navigateToView('profile', 4),
    },
  ]

  const renderView = () => {
    switch (currentView) {
      case 'home':
        return (
          <div className='flex flex-1 flex-col space-y-3'>
            <div className='mb-3 text-center'>
              <h1 className='mb-1 text-lg font-bold'>
                Welcome,{' '}
                {profile?.full_name || user?.email?.split('@')[0] || 'User'}
              </h1>
              <p className='text-muted-foreground text-sm'>
                OmniFrame RF Intelligence
              </p>
            </div>

            <div className='flex-1'>
              <h2 className='mb-3 text-base font-bold'>Application Cluster</h2>
              <div className='grid grid-cols-2 gap-3'>
                <QuickActionButton
                  icon={Scan}
                  label='Inbound Scanner'
                  onClick={() => setCurrentView('scan')}
                  variant='info'
                />
                <QuickActionButton
                  icon={Package}
                  label='Put Away'
                  onClick={() => setCurrentView('putaway')}
                  variant='success'
                />
                <QuickActionButton
                  icon={ClipboardList}
                  label='Picking'
                  onClick={() => setCurrentView('picking')}
                  variant='warning'
                />
                <QuickActionButton
                  icon={Boxes}
                  label='Kitting Apps'
                  onClick={() => setCurrentView('kitting-apps')}
                  variant='teal'
                />
                <div className='relative w-full'>
                  <QuickActionButton
                    icon={BarChart3}
                    label='Cycle Count'
                    onClick={() => setCurrentView('cycle-count')}
                    variant='info'
                  />
                  {pushedCount > 0 && (
                    <Badge
                      variant='destructive'
                      className='absolute -top-1 -right-1 flex h-5 min-w-5 animate-pulse items-center justify-center text-xs'
                    >
                      {pushedCount}
                    </Badge>
                  )}
                </div>
                <QuickActionButton
                  icon={RotateCcw}
                  label='GRS Cycle Count'
                  onClick={() => setCurrentView('grs-cycle-count')}
                  variant='orange'
                />
                <QuickActionButton
                  icon={ArrowUpFromLine}
                  label='GRS Core Pulls'
                  onClick={() => setCurrentView('grs-core-pulls')}
                  variant='teal'
                />
                <QuickActionButton
                  icon={Gamepad2}
                  label='Drone Control'
                  onClick={() => setCurrentView('drone-control')}
                  variant='destructive'
                />
                <QuickActionButton
                  icon={TrendingUp}
                  label='My Productivity'
                  onClick={() => setCurrentView('my-productivity')}
                  variant='slate'
                />
                <QuickActionButton
                  icon={ClipboardList}
                  label='Work Queue'
                  onClick={() => setCurrentView('work-queue')}
                  variant='info'
                />
                <QuickActionButton
                  icon={Package}
                  label='Claim Tasks'
                  onClick={() => setCurrentView('claim-tasks')}
                  variant='success'
                />
                <QuickActionButton
                  icon={Truck}
                  label='SAP MIGO'
                  onClick={() => setCurrentView('sap-migo')}
                  variant='orange'
                />
              </div>
            </div>
          </div>
        )

      case 'scan':
        return (
          <div className='flex flex-1 flex-col'>
            <InboundScanForm
              onScanSubmit={handleScanSubmit}
              isScanning={isScanning}
              onBackClick={() => navigateToView('home', 0)}
            />
          </div>
        )

      case 'putaway':
        return (
          <div className='flex flex-1 flex-col'>
            <RFPutawayForm onBack={() => navigateToView('home', 0)} />
          </div>
        )

      case 'inventory':
        return (
          <div className='flex flex-1 flex-col space-y-3'>
            <div className='flex items-center'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => navigateToView('home', 0)}
              >
                <ChevronLeft className='mr-1 h-3 w-3' />
                Back
              </Button>
              <h2 className='flex-1 text-center text-base font-bold'>
                Inventory
              </h2>
              <div className='w-14 shrink-0' />
            </div>

            <div className='relative'>
              <Search className='text-muted-foreground absolute top-1/2 left-3 h-3 w-3 -translate-y-1/2 transform' />
              <Input
                placeholder='Search inventory...'
                className='h-10 pl-8 text-sm'
              />
            </div>

            <div className='flex-1 overflow-y-auto'>
              <div className='space-y-2'>
                {inventoryItems.map((item) => (
                  <Card key={item.id} className='p-3'>
                    <div className='flex items-start justify-between'>
                      <div className='flex-1'>
                        <h4 className='text-sm font-semibold'>{item.name}</h4>
                        <p className='text-muted-foreground text-xs'>
                          {item.id}
                        </p>
                        <p className='text-muted-foreground text-xs'>
                          {item.location}
                        </p>
                      </div>
                      <div className='text-right'>
                        <p className='text-sm font-bold'>{item.quantity}</p>
                        <Badge
                          variant={
                            item.status === 'In Stock'
                              ? 'default'
                              : item.status === 'Low Stock'
                                ? 'secondary'
                                : 'destructive'
                          }
                          className='text-xs'
                        >
                          {item.status}
                        </Badge>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )

      case 'locations':
        return (
          <div className='flex flex-1 flex-col'>
            <RFLocationScanner onBack={() => navigateToView('home', 0)} />
          </div>
        )

      case 'picking':
        return (
          <div className='flex flex-1 flex-col'>
            <RFPickingForm
              onBack={() => navigateToView('home', 0)}
              onSwitchToKitting={(kitPoNumber) => {
                // Switch to kitting picking mode with the detected Kit PO
                setKittingPickingKitPo(kitPoNumber)
                setCurrentView('kitting-picking')
              }}
            />
          </div>
        )

      case 'kitting-apps':
        return (
          <div className='flex flex-1 flex-col space-y-3'>
            <div className='flex items-center'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => navigateToView('home', 0)}
              >
                <ChevronLeft className='mr-1 h-3 w-3' />
                Back
              </Button>
              <h2 className='flex-1 text-center text-base font-bold'>
                Kitting Apps
              </h2>
              <div className='w-14 shrink-0' />
            </div>

            <div className='mb-2 text-center'>
              <p className='text-muted-foreground text-sm'>
                Select a kitting application
              </p>
            </div>

            <div className='flex-1'>
              <div className='grid grid-cols-2 gap-3'>
                <QuickActionButton
                  icon={Package}
                  label='Kit Picking'
                  onClick={() => {
                    setKittingPickingKitPo(null)
                    setCurrentView('kitting-picking')
                  }}
                  variant='teal'
                />
                <QuickActionButton
                  icon={Hammer}
                  label='Build Kit'
                  onClick={() => setCurrentView('build-kit')}
                  variant='warning'
                />
                <QuickActionButton
                  icon={ClipboardCheck}
                  label='Inspect Kit'
                  onClick={() => setCurrentView('inspect-kit')}
                  variant='info'
                />
              </div>
            </div>
          </div>
        )

      case 'build-kit':
        return (
          <div className='flex flex-1 flex-col'>
            <RFBuildKitForm onBack={() => setCurrentView('kitting-apps')} />
          </div>
        )

      case 'inspect-kit':
        return (
          <div className='flex flex-1 flex-col'>
            <RFInspectKitForm onBack={() => setCurrentView('kitting-apps')} />
          </div>
        )

      case 'kitting-picking':
        return (
          <div className='flex flex-1 flex-col'>
            <RFKittingPickingForm
              onBack={() => {
                setKittingPickingKitPo(null)
                navigateToView('home', 0)
              }}
              initialKitPoNumber={kittingPickingKitPo || undefined}
            />
          </div>
        )

      case 'cycle-count':
        return (
          <div className='flex flex-1 flex-col'>
            <CycleCountErrorBoundary onReset={() => navigateToView('home', 0)}>
              <RFCycleCountUnified
                onBack={() => navigateToView('home', 0)}
                initialMode='auto'
              />
            </CycleCountErrorBoundary>
          </div>
        )

      case 'grs-cycle-count':
        return (
          <div className='flex flex-1 flex-col'>
            <RFGRSCycleCountForm onBack={() => navigateToView('home', 0)} />
          </div>
        )

      case 'grs-cycle-count-old':
        return (
          <div className='space-y-6'>
            <div className='flex items-center'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => navigateToView('home', 0)}
              >
                <ChevronLeft className='mr-1 h-4 w-4' />
                Back
              </Button>
              <h2 className='flex-1 text-center text-2xl font-bold'>
                GRS Cycle Count
              </h2>
              <div className='w-14 shrink-0' />
            </div>

            <div className='py-8 text-center'>
              <RotateCcw className='text-muted-foreground mx-auto mb-4 h-16 w-16' />
              <h3 className='mb-2 text-base font-semibold'>
                GRS Cycle Count Module
              </h3>
              <p className='text-muted-foreground mb-4'>
                Initialize GRS cycle counting process for goods receipt
                verification
              </p>
              <Button size='lg' className='w-full'>
                Start GRS Cycle Count
              </Button>
            </div>

            <Card className='p-4'>
              <h4 className='mb-3 font-semibold'>Instructions</h4>
              <div className='text-muted-foreground space-y-2 text-sm'>
                <p>• Scan GRS location barcode to begin count</p>
                <p>• Verify receipt quantities and conditions</p>
                <p>• Document any discrepancies or damages</p>
                <p>• Submit count for GRS variance analysis</p>
              </div>
            </Card>
          </div>
        )

      case 'grs-core-pulls':
        return (
          <div className='space-y-6'>
            <div className='flex items-center'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => navigateToView('home', 0)}
              >
                <ChevronLeft className='mr-1 h-4 w-4' />
                Back
              </Button>
              <h2 className='flex-1 text-center text-2xl font-bold'>
                GRS Core Pulls
              </h2>
              <div className='w-14 shrink-0' />
            </div>

            <div className='py-8 text-center'>
              <ArrowUpFromLine className='text-muted-foreground mx-auto mb-4 h-16 w-16' />
              <h3 className='mb-2 text-base font-semibold'>
                GRS Core Pulls Module
              </h3>
              <p className='text-muted-foreground mb-4'>
                Manage core item pulls from goods receipt staging areas
              </p>
              <Button size='lg' className='w-full'>
                Initialize Core Pulls
              </Button>
            </div>

            <Card className='p-4'>
              <h4 className='mb-3 font-semibold'>Instructions</h4>
              <div className='text-muted-foreground space-y-2 text-sm'>
                <p>• Scan core item barcodes for retrieval</p>
                <p>• Verify item conditions and quantities</p>
                <p>• Update pull status in real-time</p>
                <p>• Document any issues or exceptions</p>
              </div>
            </Card>
          </div>
        )

      case 'drone-control':
        return (
          <RFDroneControl
            onBack={() => navigateToView('home', 0)}
            onScanCaptured={(scan) => {
              // Handle captured scan - could upload to API here
              logger.log('Drone scan captured:', scan)
              toast.success('Photo captured and ready for AI analysis')
            }}
          />
        )

      case 'work-queue':
        return (
          <div className='flex flex-1 flex-col'>
            <RFWorkQueueDashboardSimple
              onBack={() => navigateToView('home', 0)}
            />
          </div>
        )

      case 'claim-tasks':
        return (
          <div className='flex flex-1 flex-col'>
            <RFTaskClaim
              onBack={() => navigateToView('home', 0)}
              onTasksClaimed={(tasks) => {
                logger.log(`Claimed ${tasks.length} tasks`)
                setCurrentView('work-queue')
              }}
            />
          </div>
        )

      case 'sap-migo':
        return (
          <div className='flex flex-1 flex-col'>
            <RFSAPMigoForm onBack={() => navigateToView('home', 0)} />
          </div>
        )

      case 'my-productivity': {
        // Get current user's performance data from team performance service
        const currentUserData =
          performanceData?.associates?.find((a) => a.user_id === user?.id) ||
          null
        const hasTimeline = currentUserData && currentUserData.timeline
        const isLoadingData = isLoadingPerformance

        // Get user initials
        const getInitials = (name: string) => {
          const parts = name.split(' ')
          if (parts.length >= 2) {
            return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
          }
          return name.substring(0, 2).toUpperCase()
        }

        // Format time string (e.g., "06:00" to "6:00 AM")
        const formatTimeString = (timeStr: string) => {
          if (!timeStr) return ''
          const [hours, minutes] = timeStr.split(':').map(Number)
          const period = hours >= 12 ? 'PM' : 'AM'
          const displayHours = hours % 12 || 12
          return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`
        }

        // Task metrics from currentUserData
        const taskMetrics = currentUserData
          ? [
              {
                label: 'Scans',
                value: currentUserData.inbound_scans || 0,
                color: 'bg-blue-500',
              },
              {
                label: 'Putaway',
                value: currentUserData.put_aways || 0,
                color: 'bg-purple-500',
              },
              {
                label: 'Picking',
                value: currentUserData.picking || 0,
                color: 'bg-green-500',
              },
              {
                label: 'Pack',
                value: currentUserData.packed || 0,
                color: 'bg-orange-500',
              },
              {
                label: 'Ship',
                value: currentUserData.shipped || 0,
                color: 'bg-teal-500',
              },
              {
                label: 'Final',
                value: currentUserData.final_packed || 0,
                color: 'bg-amber-500',
              },
              {
                label: 'Putback',
                value: currentUserData.putbacks || 0,
                color: 'bg-rose-500',
              },
              {
                label: 'Count',
                value: currentUserData.cycle_counts || 0,
                color: 'bg-indigo-500',
              },
            ].filter((m) => m.value > 0)
          : []

        const totalTasks = taskMetrics.reduce((sum, m) => sum + m.value, 0)

        return (
          <div className='flex flex-1 flex-col space-y-3 overflow-hidden'>
            {/* Header */}
            <div className='flex items-center'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => navigateToView('home', 0)}
                className='h-8 w-8 p-0'
              >
                <ChevronLeft className='h-4 w-4' />
              </Button>
              <h2 className='flex-1 text-center text-base font-bold'>
                My Productivity
              </h2>
              <Button
                variant='ghost'
                size='sm'
                onClick={refreshPerformanceData}
                disabled={isLoadingData}
                className='h-8 w-8 p-0'
              >
                <RotateCcw
                  className={`h-4 w-4 ${isLoadingData ? 'animate-spin' : ''}`}
                />
              </Button>
            </div>

            {/* Scrollable Content */}
            <div className='flex-1 space-y-3 overflow-y-auto pb-4'>
              {/* Loading State */}
              {isLoadingData && (
                <div className='flex items-center justify-center py-8'>
                  <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
                </div>
              )}

              {/* No Data State */}
              {!isLoadingData && !currentUserData && (
                <div className='py-8 text-center'>
                  <BarChart3 className='text-muted-foreground mx-auto mb-3 h-10 w-10 opacity-50' />
                  <p className='text-muted-foreground text-sm'>
                    No productivity data available
                  </p>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    Your activities will appear here as you work
                  </p>
                </div>
              )}

              {/* User Profile Card - Compact Mobile Version */}
              {!isLoadingData && currentUserData && (
                <Card>
                  <CardContent className='p-3'>
                    <div className='flex items-center gap-3'>
                      {/* Avatar with Status */}
                      <div className='relative'>
                        <div className='bg-primary/10 text-primary flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold'>
                          {getInitials(currentUserData.user_name)}
                        </div>
                        <div
                          className={`border-background absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 ${
                            currentUserData.status === 'active'
                              ? 'bg-green-500'
                              : currentUserData.status === 'break'
                                ? 'bg-yellow-500'
                                : 'bg-gray-400'
                          }`}
                        />
                      </div>

                      {/* Name and Info */}
                      <div className='min-w-0 flex-1'>
                        <h3 className='truncate text-sm font-semibold'>
                          {currentUserData.user_name}
                        </h3>
                        <p className='text-muted-foreground truncate text-xs'>
                          {currentUserData.position_title || 'Associate'}
                        </p>
                        <div className='mt-1 flex items-center gap-1.5'>
                          <span
                            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              currentUserData.status === 'active'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : currentUserData.status === 'break'
                                  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                            }`}
                          >
                            {currentUserData.status === 'active'
                              ? 'Active'
                              : currentUserData.status === 'break'
                                ? 'On Break'
                                : 'Offline'}
                          </span>
                          {currentUserData.working_area_name && (
                            <span className='text-muted-foreground inline-flex items-center gap-0.5 text-[10px]'>
                              <MapPin className='h-2.5 w-2.5' />
                              {currentUserData.area_code ||
                                currentUserData.working_area_name}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Task Count Badge */}
                      <div className='text-right'>
                        <div className='text-primary text-2xl font-bold'>
                          {totalTasks}
                        </div>
                        <div className='text-muted-foreground text-[10px] tracking-wide uppercase'>
                          Tasks
                        </div>
                      </div>
                    </div>

                    {/* Shift Info */}
                    {currentUserData.scheduled_shift_start &&
                      currentUserData.scheduled_shift_end && (
                        <div className='border-border/50 mt-2 flex items-center justify-between border-t pt-2 text-xs'>
                          <div className='text-muted-foreground flex items-center gap-1'>
                            <Clock className='h-3 w-3' />
                            <span>
                              Shift:{' '}
                              {formatTimeString(
                                currentUserData.scheduled_shift_start
                              )}{' '}
                              -{' '}
                              {formatTimeString(
                                currentUserData.scheduled_shift_end
                              )}
                            </span>
                          </div>
                          {currentUserData.schedule_name && (
                            <span className='bg-muted rounded px-1.5 py-0.5 text-[10px]'>
                              {currentUserData.schedule_name}
                            </span>
                          )}
                        </div>
                      )}
                  </CardContent>
                </Card>
              )}

              {/* Activity Timeline */}
              {!isLoadingData && hasTimeline && (
                <Card>
                  <CardHeader className='px-3 pt-3 pb-2'>
                    <CardTitle className='flex items-center gap-2 text-sm'>
                      <BarChart3 className='h-4 w-4' />
                      Activity Timeline
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='px-3 pt-0 pb-3'>
                    <ActivityGantt
                      timeline={currentUserData!.timeline!}
                      height={40}
                      showLabels={true}
                      showSummary={true}
                      showShiftMarkers={true}
                      startHour={5} // 5 AM - better time scale for mobile
                      endHour={19} // 7 PM - 14 hour range
                      compactSummary={true} // 25% smaller footer text for mobile
                    />
                    <ActivityLegend
                      timeline={currentUserData!.timeline!}
                      compact={true}
                      className='mt-2'
                      showShiftMarker={true}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Task Breakdown - Compact Grid */}
              {!isLoadingData && taskMetrics.length > 0 && (
                <Card>
                  <CardHeader className='px-3 pt-3 pb-2'>
                    <CardTitle className='flex items-center gap-2 text-sm'>
                      <TrendingUp className='h-4 w-4' />
                      Task Breakdown
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='px-3 pt-0 pb-3'>
                    <div className='grid grid-cols-4 gap-2'>
                      {taskMetrics.map((metric, idx) => (
                        <div
                          key={idx}
                          className='bg-muted/50 flex flex-col items-center rounded-lg p-2'
                        >
                          <div
                            className={`h-2 w-2 rounded-full ${metric.color} mb-1`}
                          />
                          <span className='text-lg font-bold'>
                            {metric.value}
                          </span>
                          <span className='text-muted-foreground text-center text-[10px] leading-tight'>
                            {metric.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Task Breakdown by Area - Compact */}
              {!isLoadingData &&
                currentUserData?.taskBreakdown &&
                currentUserData.taskBreakdown.length > 0 && (
                  <Card>
                    <CardHeader className='px-3 pt-3 pb-2'>
                      <CardTitle className='flex items-center gap-2 text-sm'>
                        <MapPin className='h-4 w-4' />
                        By Area
                      </CardTitle>
                    </CardHeader>
                    <CardContent className='space-y-2 px-3 pt-0 pb-3'>
                      {currentUserData.taskBreakdown.map((breakdown, idx) => {
                        const areaTaskTypes = [
                          {
                            label: 'Scan',
                            value: breakdown.inbound_scans,
                            color: 'bg-blue-500',
                          },
                          {
                            label: 'Put',
                            value: breakdown.put_aways,
                            color: 'bg-purple-500',
                          },
                          {
                            label: 'Pick',
                            value: breakdown.picking,
                            color: 'bg-green-500',
                          },
                          {
                            label: 'Pack',
                            value: breakdown.packed,
                            color: 'bg-orange-500',
                          },
                          {
                            label: 'Ship',
                            value: breakdown.shipped,
                            color: 'bg-teal-500',
                          },
                          {
                            label: 'Final',
                            value: breakdown.final_packed,
                            color: 'bg-amber-500',
                          },
                          {
                            label: 'Back',
                            value: breakdown.putbacks,
                            color: 'bg-rose-500',
                          },
                          {
                            label: 'Count',
                            value: breakdown.cycle_counts,
                            color: 'bg-indigo-500',
                          },
                        ].filter((t) => t.value > 0)

                        return (
                          <div key={idx} className='bg-muted/50 rounded-lg p-2'>
                            <div className='mb-1.5 flex items-center justify-between'>
                              <span className='truncate text-xs font-medium'>
                                {breakdown.area}
                              </span>
                              <span className='bg-primary/10 text-primary rounded px-1.5 py-0.5 text-xs font-bold'>
                                {breakdown.total}
                              </span>
                            </div>
                            <div className='flex flex-wrap gap-1'>
                              {areaTaskTypes.map((task, tidx) => (
                                <div
                                  key={tidx}
                                  className='bg-background flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]'
                                >
                                  <div
                                    className={`h-1.5 w-1.5 rounded-full ${task.color}`}
                                  />
                                  <span className='font-medium'>
                                    {task.value}
                                  </span>
                                  <span className='text-muted-foreground'>
                                    {task.label}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </CardContent>
                  </Card>
                )}
            </div>
          </div>
        )
      }

      case 'profile':
        return (
          <div className='flex flex-1 flex-col space-y-3'>
            <div className='flex items-center'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => navigateToView('home', 0)}
              >
                <ChevronLeft className='mr-1 h-3 w-3' />
                Back
              </Button>
              <h2 className='flex-1 text-center text-base font-bold'>
                Profile
              </h2>
              <div className='w-14 shrink-0' />
            </div>

            <div className='flex-1 space-y-3 overflow-y-auto'>
              {/* User Avatar and Name */}
              <Card className='p-4'>
                <div className='mb-3 flex items-center space-x-3'>
                  <div className='bg-primary text-primary-foreground flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold'>
                    {profile?.full_name
                      ? profile.full_name
                          .split(' ')
                          .map((n: string) => n[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase()
                      : user?.email?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <div className='flex-1'>
                    <h3 className='text-base font-semibold'>
                      {profile?.full_name ||
                        `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() ||
                        'User'}
                    </h3>
                    <p className='text-muted-foreground text-xs'>
                      RF Terminal User
                    </p>
                  </div>
                </div>

                <div className='space-y-2'>
                  <div className='flex items-center space-x-2'>
                    <Mail className='text-muted-foreground h-3 w-3' />
                    <span className='text-xs'>
                      {user?.email || 'No email available'}
                    </span>
                  </div>
                  <div className='flex items-center space-x-2'>
                    <User className='text-muted-foreground h-3 w-3' />
                    <span className='text-xs'>
                      User ID: {user?.id?.slice(-8) || 'N/A'}
                    </span>
                  </div>
                  <div className='flex items-center space-x-2'>
                    <Calendar className='text-muted-foreground h-3 w-3' />
                    <span className='text-xs'>
                      Last sign in:{' '}
                      {user?.last_sign_in_at
                        ? new Date(user.last_sign_in_at).toLocaleDateString()
                        : 'N/A'}
                    </span>
                  </div>
                </div>

                {/* Logout Button */}
                <div className='border-border mt-4 border-t pt-4'>
                  <Button
                    variant='destructive'
                    size='sm'
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className='h-9 w-full'
                  >
                    {isLoggingOut ? (
                      <>
                        <div className='mr-2 h-3 w-3 animate-spin rounded-full border-b-2 border-white' />
                        <span>Logging out...</span>
                      </>
                    ) : (
                      <>
                        <LogOut className='mr-2 h-3 w-3' />
                        <span>Sign Out</span>
                      </>
                    )}
                  </Button>
                </div>
              </Card>

              {/* Profile Information */}
              <Card className='p-3'>
                <h4 className='mb-2 text-sm font-semibold'>
                  Profile Information
                </h4>
                <div className='space-y-1'>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground text-xs'>Role:</span>
                    <span className='text-xs'>{profile?.role || 'User'}</span>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground text-xs'>
                      Department:
                    </span>
                    <span className='text-xs'>{'Warehouse'}</span>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground text-xs'>
                      Status:
                    </span>
                    <Badge variant='secondary' className='h-4 text-xs'>
                      Active
                    </Badge>
                  </div>
                </div>
              </Card>

              {/* Terminal Information */}
              <Card className='p-3'>
                <div className='mb-2 flex items-center justify-between'>
                  <h4 className='text-sm font-semibold'>
                    Terminal Information
                  </h4>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 px-2'
                    onClick={() => setIsEditingDeviceName(true)}
                  >
                    <Edit2 className='h-3 w-3' />
                  </Button>
                </div>
                <div className='space-y-1.5'>
                  <div className='flex items-center justify-between'>
                    <span className='text-muted-foreground text-xs'>
                      Device Name:
                    </span>
                    <span className='text-primary text-xs font-medium'>
                      {deviceName}
                    </span>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground text-xs'>Type:</span>
                    <span className='text-xs'>
                      {deviceInfo?.deviceType || 'Loading...'}
                    </span>
                  </div>
                  {deviceInfo?.model && (
                    <div className='flex justify-between'>
                      <span className='text-muted-foreground text-xs'>
                        Model:
                      </span>
                      <span className='text-xs'>{deviceInfo.model}</span>
                    </div>
                  )}
                  {deviceInfo?.manufacturer && (
                    <div className='flex justify-between'>
                      <span className='text-muted-foreground text-xs'>
                        Manufacturer:
                      </span>
                      <span className='text-xs'>{deviceInfo.manufacturer}</span>
                    </div>
                  )}
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground text-xs'>OS:</span>
                    <span className='text-xs'>
                      {deviceInfo?.osName || 'Unknown'}{' '}
                      {deviceInfo?.osVersion || ''}
                    </span>
                  </div>
                  {deviceInfo?.webViewVersion && (
                    <div className='flex justify-between'>
                      <span className='text-muted-foreground text-xs'>
                        WebView:
                      </span>
                      <span className='text-xs'>
                        {deviceInfo.webViewVersion}
                      </span>
                    </div>
                  )}
                  {/* Device ID (UUID) - Alternative to IMEI which is not available on iOS */}
                  {deviceInfo?.deviceId && (
                    <div className='border-border/50 flex items-start justify-between border-t pt-1'>
                      <span className='text-muted-foreground text-xs'>
                        Device ID:
                      </span>
                      <span className='max-w-[180px] text-right font-mono text-xs break-all'>
                        {deviceInfo.deviceId.length > 20
                          ? `${deviceInfo.deviceId.substring(0, 8)}...${deviceInfo.deviceId.substring(deviceInfo.deviceId.length - 8)}`
                          : deviceInfo.deviceId}
                      </span>
                    </div>
                  )}
                  {!deviceInfo?.deviceId && deviceInfo?.isNativeApp && (
                    <div className='border-border/50 flex items-start justify-between border-t pt-1'>
                      <span className='text-muted-foreground text-xs'>
                        Device ID:
                      </span>
                      <span className='text-xs text-amber-500'>
                        Retrieving...
                      </span>
                    </div>
                  )}
                  <div className='flex justify-between pt-1'>
                    <span className='text-muted-foreground text-xs'>
                      Platform:
                    </span>
                    <Badge
                      variant={
                        deviceInfo?.isNativeApp ? 'default' : 'secondary'
                      }
                      className='h-4 text-xs'
                    >
                      {deviceInfo?.isNativeApp
                        ? '📱 Native iOS App'
                        : '🌐 Web Browser'}
                    </Badge>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground text-xs'>
                      Session:
                    </span>
                    <Badge variant='secondary' className='h-4 text-xs'>
                      Active
                    </Badge>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground text-xs'>
                      Connection:
                    </span>
                    <Badge variant='default' className='h-4 text-xs'>
                      Connected
                    </Badge>
                  </div>
                </div>
              </Card>

              {/* Appearance Settings */}
              <Card className='p-3'>
                <h4 className='mb-3 text-sm font-semibold'>Appearance</h4>
                <div className='space-y-2'>
                  <p className='text-muted-foreground mb-2 text-xs'>
                    Choose your preferred theme
                  </p>
                  <RFThemeSelector />
                </div>
              </Card>
            </div>
          </div>
        )

      default:
        return <div>View not found</div>
    }
  }

  return (
    <div className='bg-background flex h-screen flex-col overflow-hidden'>
      {/* iOS Safe Area - Top spacing for notch/Dynamic Island */}
      <SafeAreaTop />
      <StatusBar />

      <main className='container mx-auto flex max-w-md flex-1 flex-col overflow-y-auto px-4 py-4'>
        <AnimatePresence mode='wait'>
          <motion.div
            key={currentView}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className='flex flex-1 flex-col'
          >
            {renderView()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Fixed space for dock - accounts for iOS safe area bottom */}
      <div
        className='flex-shrink-0'
        style={{ height: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
      />
      <Dock
        items={dockItems}
        activeIndex={dockActiveIndex}
        onActiveIndexChange={setDockActiveIndex}
      />

      {/* Device Registration Dialog (shown on first login) */}
      <DeviceRegistrationDialog
        open={showDeviceRegistration}
        onComplete={(name) => {
          setDeviceName(name)
          setShowDeviceRegistration(false)
          setNeedsRegistration(false)
          toast.success('Device registered successfully!')
        }}
        userName={
          profile?.first_name ||
          profile?.full_name ||
          user?.email?.split('@')[0]
        }
        userId={user?.id}
      />

      {/* Edit Device Name Dialog */}
      <DeviceRegistrationDialog
        open={isEditingDeviceName}
        onComplete={async (name) => {
          await updateDeviceName(name)
          setDeviceName(name)
          setIsEditingDeviceName(false)
          toast.success('Device name updated!')
        }}
        userName={
          profile?.first_name ||
          profile?.full_name ||
          user?.email?.split('@')[0]
        }
        userId={user?.id}
      />

      {/* ─── Hot Part Alert Full-Screen Overlay ─── */}
      <AnimatePresence>
        {hotPartAlertMatch && hotPartAlertMatch.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className='fixed inset-0 z-[9999] flex items-center justify-center p-4'
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.85)' }}
          >
            <motion.div
              initial={{ scale: 0.8, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.8, y: 20 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              className='w-full max-w-sm'
            >
              <Card className='overflow-hidden border-2 border-red-500 bg-red-50 shadow-2xl dark:bg-red-950/80'>
                {/* Animated Alert Banner */}
                <div className='flex animate-pulse items-center justify-between bg-red-600 px-4 py-3 dark:bg-red-700'>
                  <div className='flex items-center gap-2'>
                    <Flame className='h-6 w-6 text-white' />
                    <span className='text-lg font-bold tracking-wide text-white'>
                      HOT PART ALERT
                    </span>
                    <Flame className='h-6 w-6 text-white' />
                  </div>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-8 w-8 p-0 text-white hover:bg-red-700 dark:hover:bg-red-800'
                    onClick={() => {
                      setHotPartAlertMatch(null)
                      setHotPartAlertScanData(null)
                    }}
                  >
                    <X className='h-5 w-5' />
                  </Button>
                </div>

                <CardContent className='space-y-4 p-4'>
                  {/* Priority indicator */}
                  <div className='text-center'>
                    <AlertTriangle className='mx-auto mb-2 h-12 w-12 text-red-600 dark:text-red-400' />
                    <p className='text-base font-bold text-red-800 dark:text-red-200'>
                      PRIORITY RECEIVE & PUTAWAY
                    </p>
                    <p className='mt-1 text-sm text-red-600 dark:text-red-300'>
                      This item requires immediate attention!
                    </p>
                  </div>

                  {/* Scanned data that triggered the alert */}
                  {hotPartAlertScanData && (
                    <div className='space-y-2 rounded-lg border border-red-200 bg-white p-3 dark:border-red-700 dark:bg-red-900/30'>
                      <p className='text-xs font-semibold tracking-wider text-red-700 uppercase dark:text-red-300'>
                        Scanned Item
                      </p>
                      {hotPartAlertScanData.material_number && (
                        <div className='flex justify-between text-sm'>
                          <span className='text-muted-foreground'>
                            Material #:
                          </span>
                          <span className='font-mono font-bold'>
                            {hotPartAlertScanData.material_number}
                          </span>
                        </div>
                      )}
                      {hotPartAlertScanData.so_line_rma_afa && (
                        <div className='flex justify-between text-sm'>
                          <span className='text-muted-foreground'>SO/RMA:</span>
                          <span className='font-mono font-bold'>
                            {hotPartAlertScanData.so_line_rma_afa}
                          </span>
                        </div>
                      )}
                      {hotPartAlertScanData.tracking_number && (
                        <div className='flex justify-between text-sm'>
                          <span className='text-muted-foreground'>
                            Tracking:
                          </span>
                          <span className='font-mono font-bold'>
                            {hotPartAlertScanData.tracking_number}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Alert rules that matched */}
                  <div className='space-y-2'>
                    {hotPartAlertMatch.map((alert) => (
                      <div
                        key={alert.id}
                        className={cn(
                          'rounded-lg border p-3',
                          alert.priority === 'critical'
                            ? 'border-red-300 bg-red-100 dark:border-red-600 dark:bg-red-900/40'
                            : alert.priority === 'high'
                              ? 'border-orange-300 bg-orange-100 dark:border-orange-600 dark:bg-orange-900/40'
                              : 'border-yellow-300 bg-yellow-100 dark:border-yellow-600 dark:bg-yellow-900/40'
                        )}
                      >
                        <div className='mb-1 flex items-center gap-2'>
                          <Badge
                            className={cn(
                              'text-xs',
                              alert.priority === 'critical'
                                ? 'bg-red-600 text-white'
                                : alert.priority === 'high'
                                  ? 'bg-orange-600 text-white'
                                  : 'bg-yellow-600 text-white'
                            )}
                          >
                            {alert.priority.toUpperCase()}
                          </Badge>
                          <span className='text-muted-foreground text-xs'>
                            Matched:{' '}
                            <code className='font-mono font-bold'>
                              {alert.match_value}
                            </code>
                          </span>
                        </div>
                        <p className='text-muted-foreground text-xs'>
                          Field: {MATCH_TYPE_LABELS[alert.match_type]}
                        </p>
                        {alert.notes && (
                          <p className='text-foreground mt-1 text-sm font-medium'>
                            {alert.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Action button */}
                  <Button
                    className='h-12 w-full bg-red-600 text-base font-bold text-white hover:bg-red-700'
                    onClick={() => {
                      setHotPartAlertMatch(null)
                      setHotPartAlertScanData(null)
                    }}
                  >
                    Acknowledged - Will Receive & Putaway
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default RFInterface
