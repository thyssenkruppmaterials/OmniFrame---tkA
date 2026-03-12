import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  Check,
  ChevronDown,
  Circle,
  Clock,
  Flag,
  HardHat,
  Loader2,
  MessageCircle,
  Package,
  RefreshCw,
  Send,
} from 'lucide-react'
import { RRKittingDataService } from '@/lib/supabase/rr-kitting-data.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Spring animation configuration for fluid motion
const springTransition = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
  mass: 0.8,
}

// Stagger children animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: springTransition,
  },
}

const fadeInVariants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.3,
      ease: [0.4, 0, 0.2, 1] as const,
    },
  },
}

interface Stage {
  id: string
  name: string
  status: 'pending' | 'in-progress' | 'completed'
  progress: number
  completedCount: number
  totalCount: number
}

interface TOLine {
  id: string
  transferOrderNumber: string
  material: string
  materialDescription: string
  sourceStorageBin: string
  destStorageBin: string
  quantity: string
  picked: boolean
  pickedBy: string | null
  pickedAt: string | null
  kitted: boolean
  kittedBy: string | null
  kittedAt: string | null
  // Missing part tracking
  missingPartFlag: boolean
  missingPartPhotoUrl: string | null
  missingPartNotes: string | null
}

// Active flag structure (from kit_build_flags table)
interface ActiveFlag {
  id: string
  flagType: 'purple' | 'orange' | 'red' | 'black'
  setByUser: string | null
  setByUserName: string | null
  setDateTime: string | null
  notes: string | null
}

interface KitDetails {
  kitPoNumber: string
  kitBuildNumber: string
  kitSerialNumber: string
  engineProgram: string
  kitNumber: string
  deliverToPlant: string
  dueDate: string | null
  status: string
  priority: number
  addedBy: string | null
  addedAt: string | null
  toLines: TOLine[]
  stages: Stage[]
  // Kit Flag fields (legacy single flag - kept for backward compatibility)
  flagType: 'purple' | 'orange' | 'red' | 'black' | null
  flagSetByUser: string | null
  flagSetByUserName: string | null
  flagSetDateTime: string | null
  flagClearedByUser: string | null
  flagClearedByUserName: string | null
  flagClearedDateTime: string | null
}

interface KitProductionTrackerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kitSerialNumber: string | null // PRIMARY KEY: Unique identifier for each kit build
  kitPoNumber: string | null // For display purposes
}

// Chat message interface
interface ChatMessage {
  id: string
  text: string
  sender: 'user' | 'system'
  timestamp: Date
  senderName?: string
}

// Flag types with colors
const flagTypes = [
  {
    id: 'purple',
    name: 'Purple Hat',
    color: 'bg-purple-500',
    textColor: 'text-purple-500',
    description: 'Inventory Issue',
  },
  {
    id: 'orange',
    name: 'Orange Hat',
    color: 'bg-orange-500',
    textColor: 'text-orange-500',
    description: 'Incora Supplier Issue',
  },
  {
    id: 'red',
    name: 'Red Hat',
    color: 'bg-red-500',
    textColor: 'text-red-500',
    description: 'Quality Issue',
  },
  {
    id: 'black',
    name: 'Black Hat',
    color: 'bg-gray-900 dark:bg-gray-800',
    textColor: 'text-gray-900 dark:text-gray-100',
    description: 'Supply Chain Issue',
  },
] as const

type FlagType = (typeof flagTypes)[number]

// Color scheme for each production stage (similar to Delivery Audit Trail)
const stageColorScheme: Record<
  string,
  {
    border: string
    bg: string
    text: string
    badgeBg: string
    badgeText: string
    progressBg: string
  }
> = {
  planning: {
    border: 'border-purple-500',
    bg: 'bg-purple-500',
    text: 'text-purple-700 dark:text-purple-400',
    badgeBg: 'bg-purple-100 dark:bg-purple-900/30',
    badgeText: 'text-purple-700 dark:text-purple-400',
    progressBg: '[&>div]:bg-purple-500',
  },
  picking: {
    border: 'border-indigo-500',
    bg: 'bg-indigo-500',
    text: 'text-indigo-700 dark:text-indigo-400',
    badgeBg: 'bg-indigo-100 dark:bg-indigo-900/30',
    badgeText: 'text-indigo-700 dark:text-indigo-400',
    progressBg: '[&>div]:bg-indigo-500',
  },
  kitting: {
    border: 'border-cyan-500',
    bg: 'bg-cyan-500',
    text: 'text-cyan-700 dark:text-cyan-400',
    badgeBg: 'bg-cyan-100 dark:bg-cyan-900/30',
    badgeText: 'text-cyan-700 dark:text-cyan-400',
    progressBg: '[&>div]:bg-cyan-500',
  },
  inspection: {
    border: 'border-orange-500',
    bg: 'bg-orange-500',
    text: 'text-orange-700 dark:text-orange-400',
    badgeBg: 'bg-orange-100 dark:bg-orange-900/30',
    badgeText: 'text-orange-700 dark:text-orange-400',
    progressBg: '[&>div]:bg-orange-500',
  },
  'on-dock': {
    border: 'border-green-500',
    bg: 'bg-green-500',
    text: 'text-green-700 dark:text-green-400',
    badgeBg: 'bg-green-100 dark:bg-green-900/30',
    badgeText: 'text-green-700 dark:text-green-400',
    progressBg: '[&>div]:bg-green-500',
  },
}

function TimelineStage({ stage, isLast }: { stage: Stage; isLast: boolean }) {
  // Get color scheme for this stage, with fallback
  const colors = stageColorScheme[stage.id] || {
    border: 'border-gray-500',
    bg: 'bg-gray-500',
    text: 'text-gray-700 dark:text-gray-400',
    badgeBg: 'bg-gray-100 dark:bg-gray-900/30',
    badgeText: 'text-gray-700 dark:text-gray-400',
    progressBg: '[&>div]:bg-gray-500',
  }

  const getStatusIcon = () => {
    switch (stage.status) {
      case 'completed':
        return (
          <div
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full border-2 text-white',
              colors.border,
              colors.bg
            )}
          >
            <Check className='h-4 w-4' />
          </div>
        )
      case 'in-progress':
        return (
          <div
            className={cn(
              'flex h-8 w-8 animate-pulse items-center justify-center rounded-full border-2 text-white',
              colors.border,
              colors.bg
            )}
          >
            <Loader2 className='h-4 w-4 animate-spin' />
          </div>
        )
      default:
        return (
          <div
            className={cn(
              'bg-background flex h-8 w-8 items-center justify-center rounded-full border-2',
              colors.border,
              'opacity-40'
            )}
          >
            <Circle className='text-muted-foreground/50 h-3 w-3' />
          </div>
        )
    }
  }

  const getConnectorColor = () => {
    switch (stage.status) {
      case 'completed':
        return colors.bg
      case 'in-progress':
        return colors.bg
      default:
        return 'bg-muted-foreground/30'
    }
  }

  const getTextColor = () => {
    switch (stage.status) {
      case 'completed':
      case 'in-progress':
        return colors.text
      default:
        return 'text-muted-foreground'
    }
  }

  return (
    <div className='relative flex gap-4'>
      <div className='relative flex flex-col items-center'>
        {getStatusIcon()}
        {!isLast && (
          <div
            className={cn('mt-2 min-h-16 w-0.5 flex-1', getConnectorColor())}
          />
        )}
      </div>

      <div className={cn('flex-1 pb-6', isLast && 'pb-2')}>
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <h3 className={cn('text-base font-semibold', getTextColor())}>
              {stage.name}
            </h3>
            <span
              className={cn(
                'text-sm font-medium',
                stage.status !== 'pending'
                  ? colors.text
                  : 'text-muted-foreground'
              )}
            >
              {stage.completedCount}/{stage.totalCount}
            </span>
          </div>

          <div className='space-y-1'>
            <Progress
              value={stage.progress}
              className={cn(
                'h-2',
                stage.status !== 'pending' ? colors.progressBg : ''
              )}
            />
            <p className='text-muted-foreground text-xs'>
              {stage.progress}% complete
            </p>
          </div>

          <span
            className={cn(
              'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
              stage.status === 'completed' &&
                cn(colors.badgeBg, colors.badgeText),
              stage.status === 'in-progress' &&
                cn(colors.badgeBg, colors.badgeText),
              stage.status === 'pending' && 'bg-muted text-muted-foreground'
            )}
          >
            {stage.status === 'completed' && 'Completed'}
            {stage.status === 'in-progress' && 'In Progress'}
            {stage.status === 'pending' && 'Pending'}
          </span>
        </div>
      </div>
    </div>
  )
}

export function KitProductionTrackerDialog({
  open,
  onOpenChange,
  kitSerialNumber,
  kitPoNumber,
}: KitProductionTrackerDialogProps) {
  const [details, setDetails] = useState<KitDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      text: 'Kit build plan created',
      sender: 'system',
      timestamp: new Date(Date.now() - 86400000),
      senderName: 'System',
    },
    {
      id: '2',
      text: 'Ready for picking',
      sender: 'system',
      timestamp: new Date(Date.now() - 43200000),
      senderName: 'System',
    },
  ])
  const [newMessage, setNewMessage] = useState('')
  const chatScrollRef = useRef<HTMLDivElement>(null)

  // Multiple flags state
  const [activeFlags, setActiveFlags] = useState<ActiveFlag[]>([])
  const [addingFlag, setAddingFlag] = useState(false)

  const loadDetails = useCallback(
    async (showRefreshing = false) => {
      if (!kitSerialNumber) return

      if (showRefreshing) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      // Load kit details and active flags in parallel
      // Use kitSerialNumber as the unique identifier
      const [data, flags] = await Promise.all([
        RRKittingDataService.getKitBuildPlanDetailsBySerialNumber(
          kitSerialNumber
        ),
        RRKittingDataService.getActiveFlagsBySerialNumber(kitSerialNumber),
      ])

      if (data) {
        setDetails(data)
        setActiveFlags(flags)
      } else {
        setError('Failed to load kit details')
      }

      setLoading(false)
      setRefreshing(false)
    },
    [kitSerialNumber]
  )

  useEffect(() => {
    if (open && kitSerialNumber) {
      loadDetails()
    }
  }, [open, kitSerialNumber, loadDetails])

  useEffect(() => {
    if (!open) {
      setDetails(null)
      setError(null)
    }
  }, [open])

  const incompleteLines = details?.toLines.filter((line) => !line.kitted) || []
  const completedLines = details?.toLines.filter((line) => line.kitted) || []

  // Track if we should scroll to bottom (only for user messages, not system)
  const shouldScrollRef = useRef(false)

  // Scroll to bottom of chat - only within the chat container
  const scrollToBottom = () => {
    if (shouldScrollRef.current && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
      shouldScrollRef.current = false
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Send message handler
  const handleSendMessage = () => {
    if (!newMessage.trim()) return

    shouldScrollRef.current = true // Only scroll for user messages
    const message: ChatMessage = {
      id: Date.now().toString(),
      text: newMessage.trim(),
      sender: 'user',
      timestamp: new Date(),
      senderName: 'You',
    }
    setMessages((prev) => [...prev, message])
    setNewMessage('')
  }

  // Handle adding a new flag (multiple flags support)
  const handleAddFlag = async (flag: FlagType) => {
    if (!kitSerialNumber) return

    setAddingFlag(true)
    const result = await RRKittingDataService.addFlagBySerialNumber(
      kitSerialNumber,
      flag.id as 'purple' | 'orange' | 'red' | 'black'
    )

    if (result.success) {
      // Refresh the flags list
      const updatedFlags =
        await RRKittingDataService.getActiveFlagsBySerialNumber(kitSerialNumber)
      setActiveFlags(updatedFlags)

      // Add a system message about the flag being set
      const message: ChatMessage = {
        id: Date.now().toString(),
        text: `${flag.name} flag added - ${flag.description}`,
        sender: 'system',
        timestamp: new Date(),
        senderName: 'System',
      }
      setMessages((prev) => [...prev, message])
    } else {
      logger.error('Failed to add flag:', result.error)
    }
    setAddingFlag(false)
  }

  // Handle removing a specific flag by ID
  const handleRemoveFlag = async (flagId: string, flagType: string) => {
    if (!kitSerialNumber) return

    const result = await RRKittingDataService.clearFlagById(flagId)

    if (result.success) {
      // Refresh the flags list
      const updatedFlags =
        await RRKittingDataService.getActiveFlagsBySerialNumber(kitSerialNumber)
      setActiveFlags(updatedFlags)

      // Add a system message about the flag being cleared
      const flagConfig = flagTypes.find((f) => f.id === flagType)
      const message: ChatMessage = {
        id: Date.now().toString(),
        text: `${flagConfig?.name || flagType} flag removed`,
        sender: 'system',
        timestamp: new Date(),
        senderName: 'System',
      }
      setMessages((prev) => [...prev, message])
    } else {
      logger.error('Failed to remove flag:', result.error)
    }
  }

  // Handle clearing all flags
  const handleClearFlag = async () => {
    if (!kitSerialNumber || activeFlags.length === 0) return

    // Clear all active flags
    for (const flag of activeFlags) {
      await RRKittingDataService.clearFlagById(flag.id)
    }

    setActiveFlags([])

    // Add a system message
    const message: ChatMessage = {
      id: Date.now().toString(),
      text: 'All flags cleared',
      sender: 'system',
      timestamp: new Date(),
      senderName: 'System',
    }
    setMessages((prev) => [...prev, message])
  }

  // Get flags that are not yet active (can still be added)
  const availableFlags = flagTypes.filter(
    (ft) => !activeFlags.some((af) => af.flagType === ft.id)
  )

  // Format chat timestamp
  const formatChatTime = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    return 'Just now'
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge className='border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400'>
            Completed
          </Badge>
        )
      case 'in_progress':
      case 'in-progress':
        return (
          <Badge className='border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400'>
            In Progress
          </Badge>
        )
      default:
        return <Badge variant='outline'>Pending</Badge>
    }
  }

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return 'N/A'
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A'
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
        <DialogHeader>
          <div className='flex items-center justify-between'>
            <div>
              <DialogTitle className='text-2xl font-bold'>
                Kit Build Audit Trail
              </DialogTitle>
              <DialogDescription>
                Complete workflow history and progress tracking for kit{' '}
                {kitSerialNumber || kitPoNumber}
              </DialogDescription>
            </div>
            {details && (
              <Button
                onClick={() => loadDetails(true)}
                variant='outline'
                size='sm'
                disabled={refreshing}
              >
                <RefreshCw
                  className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')}
                />
                Refresh
              </Button>
            )}
          </div>
        </DialogHeader>

        <AnimatePresence mode='wait'>
          {loading && (
            <motion.div
              key='loading'
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className='flex items-center justify-center py-12'
            >
              <motion.div
                className='space-y-3 text-center'
                initial={{ y: 10 }}
                animate={{ y: 0 }}
                transition={springTransition}
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <Loader2 className='text-primary mx-auto h-8 w-8' />
                </motion.div>
                <p className='text-muted-foreground text-sm'>
                  Loading kit details...
                </p>
              </motion.div>
            </motion.div>
          )}

          {error && !loading && (
            <motion.div
              key='error'
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className='flex items-center justify-center py-12'
            >
              <motion.div
                className='space-y-3 text-center'
                initial={{ y: 10 }}
                animate={{ y: 0 }}
                transition={springTransition}
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                >
                  <AlertCircle className='text-destructive mx-auto h-10 w-10' />
                </motion.div>
                <p className='text-muted-foreground text-sm'>{error}</p>
                <Button
                  onClick={() => loadDetails()}
                  variant='outline'
                  size='sm'
                >
                  Try Again
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {details && !loading && (
          <motion.div
            key='details'
            className='space-y-6'
            variants={containerVariants}
            initial='hidden'
            animate='visible'
          >
            {/* Kit Information */}
            <motion.div variants={itemVariants}>
              <Card className='bg-muted/50 overflow-hidden'>
                <CardHeader className='pb-3'>
                  <CardTitle className='text-lg font-semibold'>
                    Kit Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <motion.div
                    className='grid grid-cols-2 gap-4 text-sm lg:grid-cols-4'
                    variants={containerVariants}
                    initial='hidden'
                    animate='visible'
                  >
                    <motion.div variants={fadeInVariants}>
                      <p className='text-muted-foreground'>Kit Serial Number</p>
                      <p className='text-base font-semibold'>
                        {details.kitSerialNumber || 'N/A'}
                      </p>
                    </motion.div>
                    <motion.div variants={fadeInVariants}>
                      <p className='text-muted-foreground'>Kit PO Number</p>
                      <p className='text-base font-semibold'>
                        {details.kitPoNumber}
                      </p>
                    </motion.div>
                    <motion.div variants={fadeInVariants}>
                      <p className='text-muted-foreground'>Kit Build Number</p>
                      <p className='text-base font-semibold'>
                        {details.kitBuildNumber}
                      </p>
                    </motion.div>
                    <motion.div variants={fadeInVariants}>
                      <p className='text-muted-foreground'>Current Status</p>
                      <div className='mt-1'>
                        {getStatusBadge(details.status)}
                      </div>
                    </motion.div>
                    <motion.div variants={fadeInVariants}>
                      <p className='text-muted-foreground'>Priority</p>
                      <p className='text-base font-semibold text-orange-600'>
                        #{details.priority}
                      </p>
                    </motion.div>
                    <motion.div variants={fadeInVariants}>
                      <p className='text-muted-foreground'>Engine Program</p>
                      <p className='text-base font-medium'>
                        {details.engineProgram || 'N/A'}
                      </p>
                    </motion.div>
                    <motion.div variants={fadeInVariants}>
                      <p className='text-muted-foreground'>Kit Number</p>
                      <p className='text-base font-medium'>
                        {details.kitNumber || 'N/A'}
                      </p>
                    </motion.div>
                    <motion.div variants={fadeInVariants}>
                      <p className='text-muted-foreground'>Deliver To Plant</p>
                      <p className='text-base font-medium'>
                        {details.deliverToPlant || 'N/A'}
                      </p>
                    </motion.div>
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Timeline & Dates */}
            <motion.div variants={itemVariants}>
              <Card className='overflow-hidden'>
                <CardHeader className='pb-3'>
                  <CardTitle className='text-lg font-semibold'>
                    Timeline & Dates
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <motion.div
                    className='grid grid-cols-2 gap-4 text-sm lg:grid-cols-3'
                    variants={containerVariants}
                    initial='hidden'
                    animate='visible'
                  >
                    <motion.div variants={fadeInVariants}>
                      <p className='text-muted-foreground'>Due Date</p>
                      <p className='text-base font-medium'>
                        {formatDate(details.dueDate)}
                      </p>
                    </motion.div>
                    <motion.div variants={fadeInVariants}>
                      <p className='text-muted-foreground'>Created By</p>
                      <p className='text-base font-medium'>
                        {details.addedBy || 'N/A'}
                      </p>
                    </motion.div>
                    <motion.div variants={fadeInVariants}>
                      <p className='text-muted-foreground'>Created At</p>
                      <p className='text-base font-medium'>
                        {formatDateTime(details.addedAt)}
                      </p>
                    </motion.div>
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Production Progress & Communication Section - Two Columns */}
            <motion.div
              variants={itemVariants}
              className='grid grid-cols-1 gap-6 lg:grid-cols-2'
            >
              {/* Production Progress */}
              <Card className='overflow-hidden'>
                <CardHeader className='pb-3'>
                  <CardTitle className='flex items-center gap-2 text-lg font-semibold'>
                    <motion.div
                      initial={{ rotate: -90, opacity: 0 }}
                      animate={{ rotate: 0, opacity: 1 }}
                      transition={{ delay: 0.3, ...springTransition }}
                    >
                      <Clock className='h-5 w-5' />
                    </motion.div>
                    Production Progress
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <motion.div
                    className='space-y-4'
                    variants={containerVariants}
                    initial='hidden'
                    animate='visible'
                  >
                    {details.stages.map((stage, index) => (
                      <motion.div key={stage.id} variants={itemVariants}>
                        <TimelineStage
                          stage={stage}
                          isLast={index === details.stages.length - 1}
                        />
                      </motion.div>
                    ))}
                  </motion.div>
                </CardContent>
              </Card>

              {/* Communication & Flags Section */}
              <motion.div
                className='space-y-4'
                variants={containerVariants}
                initial='hidden'
                animate='visible'
              >
                {/* Kit Build Flags (Multiple) */}
                <motion.div variants={itemVariants}>
                  <Card className='overflow-hidden'>
                    <CardHeader className='pb-3'>
                      <div className='flex items-center justify-between'>
                        <CardTitle className='flex items-center gap-2 text-lg font-semibold'>
                          <Flag className='h-5 w-5' />
                          Kit Build Flags
                          {activeFlags.length > 0 && (
                            <Badge variant='secondary' className='ml-1 text-xs'>
                              {activeFlags.length}
                            </Badge>
                          )}
                        </CardTitle>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant='outline'
                              size='sm'
                              className='gap-2'
                              disabled={
                                addingFlag || availableFlags.length === 0
                              }
                            >
                              {addingFlag ? (
                                <>
                                  <Loader2 className='h-4 w-4 animate-spin' />
                                  <span>Adding...</span>
                                </>
                              ) : (
                                <>
                                  <HardHat className='h-4 w-4' />
                                  <span>Add Flag</span>
                                  <ChevronDown className='h-3 w-3 opacity-50' />
                                </>
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end' className='w-56'>
                            {availableFlags.length > 0 ? (
                              availableFlags.map((flag) => (
                                <DropdownMenuItem
                                  key={flag.id}
                                  onClick={() => handleAddFlag(flag)}
                                  className='cursor-pointer gap-3'
                                >
                                  <div
                                    className={cn(
                                      'flex h-5 w-5 items-center justify-center rounded-full',
                                      flag.color
                                    )}
                                  >
                                    <HardHat className='h-3 w-3 text-white' />
                                  </div>
                                  <div className='flex-1'>
                                    <p className='font-medium'>{flag.name}</p>
                                    <p className='text-muted-foreground text-xs'>
                                      {flag.description}
                                    </p>
                                  </div>
                                </DropdownMenuItem>
                              ))
                            ) : (
                              <DropdownMenuItem
                                disabled
                                className='text-muted-foreground'
                              >
                                All flags are active
                              </DropdownMenuItem>
                            )}
                            {activeFlags.length > 0 && (
                              <>
                                <div className='bg-border my-1 h-px' />
                                <DropdownMenuItem
                                  onClick={handleClearFlag}
                                  className='text-destructive cursor-pointer'
                                >
                                  Clear All Flags
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {activeFlags.length > 0 ? (
                        <div className='space-y-3'>
                          {/* Display all active flags */}
                          {activeFlags.map((flag) => {
                            const flagConfig = flagTypes.find(
                              (f) => f.id === flag.flagType
                            )
                            if (!flagConfig) return null

                            return (
                              <div
                                key={flag.id}
                                className={cn(
                                  'group flex items-center gap-3 rounded-lg border-2 p-3',
                                  flag.flagType === 'purple' &&
                                    'border-purple-500 bg-purple-500/10',
                                  flag.flagType === 'orange' &&
                                    'border-orange-500 bg-orange-500/10',
                                  flag.flagType === 'red' &&
                                    'border-red-500 bg-red-500/10',
                                  flag.flagType === 'black' &&
                                    'border-gray-900 bg-gray-900/10 dark:border-gray-100 dark:bg-gray-100/10'
                                )}
                              >
                                <div
                                  className={cn(
                                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                                    flagConfig.color
                                  )}
                                >
                                  <HardHat className='h-5 w-5 text-white' />
                                </div>
                                <div className='min-w-0 flex-1'>
                                  <p
                                    className={cn(
                                      'font-semibold',
                                      flagConfig.textColor
                                    )}
                                  >
                                    {flagConfig.name}
                                  </p>
                                  <p className='text-muted-foreground text-sm'>
                                    {flagConfig.description}
                                  </p>
                                  {flag.setByUserName && (
                                    <p className='text-muted-foreground mt-1 text-xs'>
                                      Set by {flag.setByUserName}
                                      {flag.setDateTime && (
                                        <span>
                                          {' '}
                                          •{' '}
                                          {new Date(
                                            flag.setDateTime
                                          ).toLocaleString()}
                                        </span>
                                      )}
                                    </p>
                                  )}
                                </div>
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  className='h-8 w-8 shrink-0 opacity-0 transition-opacity group-hover:opacity-100'
                                  onClick={() =>
                                    handleRemoveFlag(flag.id, flag.flagType)
                                  }
                                  title='Remove flag'
                                >
                                  <AlertCircle className='text-destructive h-4 w-4' />
                                </Button>
                              </div>
                            )
                          })}

                          {/* Show cleared info if available */}
                          {details?.flagClearedByUserName &&
                            activeFlags.length === 0 && (
                              <div className='text-muted-foreground border-t px-1 pt-2 text-xs'>
                                <p>
                                  <span className='font-medium'>
                                    Last cleared by:
                                  </span>{' '}
                                  {details.flagClearedByUserName}
                                </p>
                                {details.flagClearedDateTime && (
                                  <p>
                                    <span className='font-medium'>At:</span>{' '}
                                    {new Date(
                                      details.flagClearedDateTime
                                    ).toLocaleString()}
                                  </p>
                                )}
                              </div>
                            )}
                        </div>
                      ) : (
                        <div className='space-y-3'>
                          <div className='text-muted-foreground py-4 text-center'>
                            <HardHat className='mx-auto mb-2 h-8 w-8 opacity-30' />
                            <p className='text-sm'>No flags set for this kit</p>
                            <p className='mt-1 text-xs'>
                              Click "Add Flag" to add one or more flags
                            </p>
                          </div>
                          {/* Show last cleared info if available */}
                          {details?.flagClearedByUserName && (
                            <div className='text-muted-foreground border-t px-1 pt-2 text-xs'>
                              <p>
                                <span className='font-medium'>
                                  Last cleared by:
                                </span>{' '}
                                {details.flagClearedByUserName}
                              </p>
                              {details.flagClearedDateTime && (
                                <p>
                                  <span className='font-medium'>At:</span>{' '}
                                  {new Date(
                                    details.flagClearedDateTime
                                  ).toLocaleString()}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>

                {/* iOS-Style Messages Chat */}
                <motion.div variants={itemVariants}>
                  <Card className='flex h-[320px] flex-col overflow-hidden'>
                    <CardHeader className='flex-shrink-0 pb-3'>
                      <CardTitle className='flex items-center gap-2 text-lg font-semibold'>
                        <MessageCircle className='h-5 w-5' />
                        Kit Notes
                      </CardTitle>
                    </CardHeader>
                    <CardContent className='flex flex-1 flex-col overflow-hidden p-0'>
                      {/* Messages Area */}
                      <div
                        ref={chatScrollRef}
                        className='flex-1 overflow-y-auto px-4'
                      >
                        <div className='space-y-3 py-2'>
                          {messages.map((message) => (
                            <div
                              key={message.id}
                              className={cn(
                                'flex max-w-[85%] flex-col',
                                message.sender === 'user'
                                  ? 'ml-auto items-end'
                                  : 'items-start'
                              )}
                            >
                              <div
                                className={cn(
                                  'rounded-2xl px-4 py-2 text-sm',
                                  message.sender === 'user'
                                    ? 'rounded-br-md bg-blue-500 text-white'
                                    : 'bg-muted rounded-bl-md'
                                )}
                              >
                                {message.text}
                              </div>
                              <div className='mt-1 flex items-center gap-1 px-1'>
                                <span className='text-muted-foreground text-[10px]'>
                                  {message.senderName}
                                </span>
                                <span className='text-muted-foreground text-[10px]'>
                                  •
                                </span>
                                <span className='text-muted-foreground text-[10px]'>
                                  {formatChatTime(message.timestamp)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Input Area - iOS Style */}
                      <div className='bg-background/95 flex-shrink-0 border-t p-3 backdrop-blur'>
                        <div className='flex items-center gap-2'>
                          <Input
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            onKeyDown={(e) =>
                              e.key === 'Enter' && handleSendMessage()
                            }
                            placeholder='Type a message...'
                            className='bg-muted flex-1 rounded-full border-0 focus-visible:ring-1'
                          />
                          <Button
                            size='icon'
                            onClick={handleSendMessage}
                            disabled={!newMessage.trim()}
                            className='h-9 w-9 rounded-full bg-blue-500 hover:bg-blue-600'
                          >
                            <Send className='h-4 w-4' />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              </motion.div>
            </motion.div>

            {/* TO Lines Table */}
            <motion.div variants={itemVariants}>
              <Card className='overflow-hidden'>
                <CardHeader className='pb-3'>
                  <div className='flex items-center justify-between'>
                    <CardTitle className='flex items-center gap-2 text-lg font-semibold'>
                      <Package className='h-5 w-5' />
                      Transfer Order Lines
                    </CardTitle>
                    <div className='flex items-center gap-2'>
                      <Badge
                        variant='outline'
                        className='bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                      >
                        {incompleteLines.length} Pending
                      </Badge>
                      <Badge
                        variant='outline'
                        className='bg-green-500/10 text-green-700 dark:text-green-400'
                      >
                        {completedLines.length} Complete
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {details.toLines.length === 0 ? (
                    <div className='bg-muted/30 rounded-lg border py-8 text-center'>
                      <Package className='text-muted-foreground/50 mx-auto mb-3 h-10 w-10' />
                      <p className='text-muted-foreground text-sm font-medium'>
                        No TO lines imported
                      </p>
                    </div>
                  ) : (
                    <div className='rounded-md border'>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>TO #</TableHead>
                            <TableHead>Material</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className='text-right'>Qty</TableHead>
                            <TableHead>From Bin</TableHead>
                            <TableHead>To Bin</TableHead>
                            <TableHead>Picked</TableHead>
                            <TableHead>Kitted</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {details.toLines.map((line) => (
                            <TableRow
                              key={line.id}
                              className={cn(
                                line.missingPartFlag &&
                                  'border-l-4 border-l-purple-500 bg-purple-100 dark:bg-purple-900/30'
                              )}
                            >
                              <TableCell className='font-mono text-xs'>
                                {line.transferOrderNumber}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  'font-mono text-xs',
                                  line.missingPartFlag &&
                                    'font-semibold text-purple-700 dark:text-purple-400'
                                )}
                              >
                                {line.material}
                                {line.missingPartFlag && (
                                  <span className='ml-2 inline-flex items-center gap-1 rounded bg-purple-200 px-1.5 py-0.5 text-xs text-purple-700 dark:bg-purple-800 dark:text-purple-300'>
                                    <AlertCircle className='h-3 w-3' />
                                    Missing
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className='max-w-[200px] truncate text-sm'>
                                {line.materialDescription || '—'}
                              </TableCell>
                              <TableCell className='text-right font-medium'>
                                {line.quantity}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  'font-mono text-xs',
                                  line.missingPartFlag &&
                                    'text-purple-600 dark:text-purple-400'
                                )}
                              >
                                {line.sourceStorageBin || '—'}
                              </TableCell>
                              <TableCell className='font-mono text-xs'>
                                {line.destStorageBin || '—'}
                              </TableCell>
                              <TableCell>
                                {line.missingPartFlag ? (
                                  <div className='space-y-0.5'>
                                    <div className='flex items-center gap-1'>
                                      <HardHat className='h-4 w-4 text-purple-500' />
                                      <span className='text-xs font-medium text-purple-600 dark:text-purple-400'>
                                        Not Found
                                      </span>
                                    </div>
                                    <p className='text-muted-foreground text-xs'>
                                      {line.pickedBy || 'Unknown'}
                                    </p>
                                  </div>
                                ) : line.picked ? (
                                  <div className='space-y-0.5'>
                                    <Check className='h-4 w-4 text-green-500' />
                                    <p className='text-muted-foreground text-xs'>
                                      {line.pickedBy || 'Unknown'}
                                    </p>
                                  </div>
                                ) : (
                                  <Circle className='text-muted-foreground/30 h-4 w-4' />
                                )}
                              </TableCell>
                              <TableCell>
                                {line.kitted ? (
                                  <div className='space-y-0.5'>
                                    <Check className='h-4 w-4 text-green-500' />
                                    <p className='text-muted-foreground text-xs'>
                                      {line.kittedBy || 'Unknown'}
                                    </p>
                                  </div>
                                ) : (
                                  <Circle className='text-muted-foreground/30 h-4 w-4' />
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </DialogContent>
    </Dialog>
  )
}
