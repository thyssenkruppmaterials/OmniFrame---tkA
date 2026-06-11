// Created and developed by Jai Singh
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  Check,
  ChevronDown,
  Circle,
  Clock,
  HardHat,
  Loader2,
  MessageCircle,
  Package,
  Printer,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { RRKittingDataService } from '@/lib/supabase/rr-kitting-data.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useKitNotes, type KitNote } from '@/hooks/use-kit-notes'
import { useMarkKitNotesRead } from '@/hooks/use-kit-unread-notes'
import { useKitInspectionRequired } from '@/hooks/use-kitting-workflow-settings'
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
import { EditShipShortDialog } from '@/components/ui/edit-ship-short-dialog'
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
import { ConfirmDialog } from '@/components/confirm-dialog'
import { BlackHatShipShortPanel } from '@/components/kitting/black-hat-ship-short-panel'
import { CancelTOLineDialog } from '@/components/kitting/cancel-to-line-dialog'
import { KitBuildSheet } from '@/components/kitting/kit-build-sheet'

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
  // Per-line cancellation (migration 325). Cancelled lines are still
  // rendered in the TO Lines table so the audit trail is preserved,
  // but they're excluded from `pickedCount`/`kittedCount`/`totalLines`
  // so the kit can keep advancing through stages.
  cancelled: boolean
  cancelledAt: string | null
  cancelledBy: string | null
  cancelledReason: string | null
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
  // Authorized to Ship Short list (post-creation editable via the
  // EditShipShortDialog). Listing a part number here negates the
  // auto-Black-Hat for the matching BOM line.
  authorizedShipShortItems: Array<{
    lineNumber: number
    partNumber: string
    description: string
  }>
}

interface KitProductionTrackerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kitSerialNumber: string | null // PRIMARY KEY: Unique identifier for each kit build
  kitPoNumber: string | null // For display purposes
  onKitDeleted?: () => void
  /**
   * Position-based priority (#1, #2, …) as rendered on the surface that
   * opened this dialog (the Kitting Data Manager grid row or the Kanban
   * card). The raw `kit_priority` column is a monotonic sequence with gaps,
   * so every other surface shows the positional rank instead — passing it
   * here keeps the dialog header consistent with what the operator clicked.
   * Falls back to the stored `kit_priority` when not supplied.
   */
  displayPriority?: number | null
}

/**
 * Render-shape for the in-dialog chat. Decoupled from the DB `KitNote`
 * row shape so the render code stays simple and the synthetic "kit
 * created" entry (derived from `kit_added_*` columns when a kit has no
 * persisted notes yet) can sit in the same list without needing fake
 * `kit_notes` rows.
 */
interface ChatMessage {
  id: string
  text: string
  sender: 'user' | 'system'
  /** True when this message was written by the currently signed-in user (drives right-aligned blue bubble). */
  isMine: boolean
  /** True for the synthetic creation entry (no DB row backing it). */
  isSynthetic?: boolean
  timestamp: Date
  senderName?: string
  eventKind?: string | null
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

/**
 * HorizontalProgressStepper
 *
 * Salesforce "Path"-style horizontal stepper. Renders one column per
 * production stage with a connecting line that fills as upstream stages
 * complete, plus per-stage progress bar + count + status pill. Designed
 * to live inside a full-width card so all four stages stay visible
 * without scrolling, which the old vertical timeline could not do on a
 * wide dialog.
 */
function HorizontalProgressStepper({ stages }: { stages: Stage[] }) {
  const fallback = {
    border: 'border-gray-500',
    bg: 'bg-gray-500',
    text: 'text-gray-700 dark:text-gray-400',
    badgeBg: 'bg-gray-100 dark:bg-gray-900/30',
    badgeText: 'text-gray-700 dark:text-gray-400',
    progressBg: '[&>div]:bg-gray-500',
  }

  // Fraction of the connector line that should render as "filled".
  // 1.0 if both adjacent stages are completed, 0.5 if the current stage
  // is in-progress (we've moved past the prior stage but not done yet),
  // 0 otherwise.
  const connectorFraction = (a: Stage, b: Stage) => {
    if (a.status === 'completed' && b.status !== 'pending') return 1
    if (a.status === 'completed') return 0.5
    if (a.status === 'in-progress') return 0.25
    return 0
  }

  return (
    <div className='relative'>
      {/* Background connector — sits centered behind the status circles.
          Inset left/right so it doesn't extend past the first/last dot. */}
      <div
        className='bg-border absolute top-[19px] h-0.5'
        style={{
          left: `${100 / (stages.length * 2)}%`,
          right: `${100 / (stages.length * 2)}%`,
        }}
        aria-hidden
      />

      <div
        className='relative grid'
        style={{
          gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`,
        }}
      >
        {stages.map((stage, index) => {
          const colors = stageColorScheme[stage.id] || fallback
          const isCompleted = stage.status === 'completed'
          const isActive = stage.status === 'in-progress'
          const isPending = stage.status === 'pending'
          const nextStage = stages[index + 1]
          const fillFrac = nextStage ? connectorFraction(stage, nextStage) : 0

          return (
            <div
              key={stage.id}
              className='relative flex flex-col items-center gap-3 px-3'
            >
              {/* Per-stage forward connector fill — sits over the
                  background line and extends rightward from this dot. */}
              {nextStage && fillFrac > 0 && (
                <div
                  className={cn(
                    'absolute top-[19px] left-1/2 h-0.5',
                    colors.bg
                  )}
                  style={{ width: `calc(${fillFrac * 100}% - 0px)` }}
                  aria-hidden
                />
              )}

              {/* Status circle */}
              <div
                className={cn(
                  'bg-background relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors',
                  isCompleted && cn(colors.bg, colors.border, 'text-white'),
                  isActive &&
                    cn(colors.bg, colors.border, 'animate-pulse text-white'),
                  isPending && 'border-muted-foreground/30'
                )}
              >
                {isCompleted && <Check className='h-4 w-4' />}
                {isActive && <Loader2 className='h-4 w-4 animate-spin' />}
                {isPending && (
                  <Circle className='text-muted-foreground/40 h-3 w-3' />
                )}
              </div>

              {/* Stage name + counts */}
              <div className='space-y-0.5 text-center'>
                <p
                  className={cn(
                    'text-sm font-semibold tracking-tight',
                    isCompleted || isActive
                      ? colors.text
                      : 'text-muted-foreground'
                  )}
                >
                  {stage.name}
                </p>
                <p className='text-muted-foreground text-xs tabular-nums'>
                  {stage.completedCount} / {stage.totalCount}
                </p>
              </div>

              {/* Progress bar + percentage */}
              <div className='w-full space-y-1'>
                <Progress
                  value={stage.progress}
                  className={cn('h-1.5', !isPending && colors.progressBg)}
                />
                <p className='text-muted-foreground text-center text-[11px] tabular-nums'>
                  {stage.progress}% complete
                </p>
              </div>

              {/* Status pill */}
              <span
                className={cn(
                  'inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                  (isCompleted || isActive) &&
                    cn(colors.badgeBg, colors.badgeText),
                  isPending && 'bg-muted text-muted-foreground'
                )}
              >
                {isCompleted && 'Completed'}
                {isActive && 'In Progress'}
                {isPending && 'Pending'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function KitProductionTrackerDialog({
  open,
  onOpenChange,
  kitSerialNumber,
  kitPoNumber,
  onKitDeleted,
  displayPriority,
}: KitProductionTrackerDialogProps) {
  const [details, setDetails] = useState<KitDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Cover sheet reprint state — opens the printable KitBuildSheet for a
  // quick reprint without leaving the audit trail.
  const [isCoverSheetOpen, setIsCoverSheetOpen] = useState(false)

  // Chat state — persistent notes are loaded via useKitNotes (table
  // `public.kit_notes`, migration 313). The dialog only keeps the
  // input-buffer locally; everything else lives in TanStack Query.
  const [newMessage, setNewMessage] = useState('')
  const chatScrollRef = useRef<HTMLDivElement>(null)

  // Auth context — used to mark a row "isMine" so the same iOS-style
  // right-aligned bubble appears for messages the signed-in user
  // authored, regardless of which device/session they're on now.
  const { authState } = useUnifiedAuth()
  const currentUserId = authState.user?.id ?? null

  const {
    notes,
    isLoading: notesLoading,
    isSending: notesSending,
    addUserNote,
    addSystemNote,
  } = useKitNotes(open ? kitSerialNumber : null)

  // Opening the audit trail = the operator has seen this kit's notes, so
  // advance their read watermark (clears the "New message" indicator on the
  // Kit Build Plans grid). Fires once per open; resets when the dialog closes.
  const { mutate: markKitNotesRead } = useMarkKitNotesRead()
  const markedReadRef = useRef<string | null>(null)
  useEffect(() => {
    if (!open) {
      markedReadRef.current = null
      return
    }
    if (kitSerialNumber && markedReadRef.current !== kitSerialNumber) {
      markedReadRef.current = kitSerialNumber
      markKitNotesRead(kitSerialNumber)
    }
  }, [open, kitSerialNumber, markKitNotesRead])

  // Multiple flags state
  const [activeFlags, setActiveFlags] = useState<ActiveFlag[]>([])
  const [addingFlag, setAddingFlag] = useState(false)

  // Edit Ship Short state
  const [showEditShipShort, setShowEditShipShort] = useState(false)
  const [savingShipShort, setSavingShipShort] = useState(false)

  // Org workflow flag — when off, the timeline omits the Inspection
  // stage and the on-dock stage gates on "all kitted" instead of
  // "inspected". Defaults to true (legacy three-stage flow) until
  // the settings query lands.
  const kitInspectionRequired = useKitInspectionRequired()

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

  const handleSaveShipShort = useCallback(
    async (items: Array<{ partNumber: string; description: string }>) => {
      if (!kitSerialNumber) return
      setSavingShipShort(true)
      try {
        const result =
          await RRKittingDataService.updateAuthorizedShipShortItems(
            kitSerialNumber,
            items
          )

        if (result.success) {
          const baseDescription = `${items.length} part${items.length === 1 ? '' : 's'} authorized for ${details?.kitPoNumber || kitPoNumber || 'this kit'}.`
          const coverageNote = result.flagCleared
            ? ' Black Hat cleared — kit can now be picked.'
            : result.bomCoverageComplete === false
              ? ' BOM coverage still incomplete — Black Hat remains.'
              : ''

          toast.success('Ship-short list updated', {
            description: baseDescription + coverageNote,
          })

          setShowEditShipShort(false)
          await loadDetails(true)

          // Persist a system note so the change is captured in the
          // audit trail across sessions and shows up for every user
          // who opens this kit.
          await addSystemNote(
            `Authorized to Ship Short list updated (${items.length} part${items.length === 1 ? '' : 's'})` +
              (result.flagCleared ? ' — Black Hat auto-cleared.' : ''),
            'ship_short_authorized'
          )
        } else {
          toast.error('Failed to update ship-short list', {
            description: result.error || 'An unexpected error occurred.',
          })
        }
      } catch (err) {
        logger.error('[KitProductionTracker] handleSaveShipShort error:', err)
        toast.error('Failed to update ship-short list')
      } finally {
        setSavingShipShort(false)
      }
    },
    [
      kitSerialNumber,
      details?.kitPoNumber,
      kitPoNumber,
      loadDetails,
      addSystemNote,
    ]
  )

  const handleDeleteKit = useCallback(async () => {
    if (!kitSerialNumber) return
    setDeleting(true)
    const result =
      await RRKittingDataService.deleteKitBySerialNumber(kitSerialNumber)
    setDeleting(false)
    setShowDeleteConfirm(false)

    if (result.success) {
      toast.success('Kit deleted', {
        description: `Kit ${kitSerialNumber} has been removed from the build plan.`,
      })
      onOpenChange(false)
      onKitDeleted?.()
    } else {
      toast.error('Failed to delete kit', {
        description: result.error || 'An unexpected error occurred.',
      })
    }
  }, [kitSerialNumber, onOpenChange, onKitDeleted])

  // TO Lines bucket counts. Cancelled lines are pulled out of the
  // pending / complete buckets entirely so the header pills reflect
  // *active* workload — they'd otherwise inflate "pending" forever.
  // The cancelled lines still render in the table itself with their
  // own visual treatment so the audit trail stays intact.
  const activeLines = details?.toLines.filter((line) => !line.cancelled) || []
  const incompleteLines = activeLines.filter((line) => !line.kitted)
  const completedLines = activeLines.filter((line) => line.kitted)
  const cancelledLines = details?.toLines.filter((line) => line.cancelled) || []

  // Cancel-line dialog state. The dialog is parent-driven so the
  // service call + the system-note stamp + the local data refresh all
  // sequence correctly through one handler.
  const [cancelTarget, setCancelTarget] = useState<{
    toLineId: string
    transferOrderNumber: string
    material: string
    materialDescription: string
  } | null>(null)
  const [cancellingLine, setCancellingLine] = useState(false)

  // Whether the kit currently has an active Black Hat flag — drives the
  // visibility of the inline ship-short authorization panel below the
  // Kit Information card. Source of truth is the `activeFlags` array
  // (per-serial, populated by `getActiveFlagsBySerialNumber`).
  const hasActiveBlackHat = activeFlags.some(
    (flag) => flag.flagType === 'black'
  )

  const handleBlackHatPanelSaved = useCallback(
    async (result: {
      event: 'ship_short_authorized' | 'to_added'
      count: number
      coversCount?: number
      flagCleared: boolean
      bomCoverageComplete?: boolean
    }) => {
      // Persist a system note for the audit trail. The wording + event
      // kind branch on which on-ramp fired so the chat thread reads
      // clearly ("X parts authorized via Picking Blocked panel" vs
      // "Y TOs imported via Picking Blocked panel").
      if (result.event === 'ship_short_authorized') {
        await addSystemNote(
          `Authorized to Ship Short list updated (${result.count} part${result.count === 1 ? '' : 's'} via Picking Blocked panel)` +
            (result.flagCleared ? ' — Black Hat auto-cleared.' : ''),
          'black_hat_panel_authorized'
        )
      } else {
        const coverageNote =
          result.coversCount && result.coversCount > 0
            ? ` — ${result.coversCount} missing component${result.coversCount === 1 ? '' : 's'} now covered`
            : ''
        await addSystemNote(
          `${result.count} Transfer Order${result.count === 1 ? '' : 's'} imported via Picking Blocked panel${coverageNote}.`,
          'black_hat_panel_to_added'
        )
      }
      await loadDetails(true)
    },
    [loadDetails, addSystemNote]
  )

  // Per-line cancellation handler. Wires together:
  //   1. The DB mutation (RRKittingDataService.cancelTOLine).
  //   2. A system note stamped on the kit_notes audit trail
  //      (event_kind = 'to_line_cancelled').
  //   3. A refresh of the local details so the cancelled-row styling
  //      + new stage counts render immediately.
  // Errors are surfaced via a toast and the dialog stays open so the
  // operator can adjust the reason and retry.
  const handleCancelTOLine = useCallback(
    async (
      target: {
        toLineId: string
        transferOrderNumber: string
        material: string
        materialDescription: string
      },
      reason: string
    ) => {
      setCancellingLine(true)
      try {
        const result = await RRKittingDataService.cancelTOLine(
          target.toLineId,
          reason
        )
        if (!result.success) {
          toast.error('Failed to cancel TO line', {
            description: result.error || 'An unexpected error occurred.',
          })
          return
        }

        toast.success('TO line cancelled', {
          description: `TO ${target.transferOrderNumber} / Material ${target.material} excluded from kit progress.`,
        })

        await addSystemNote(
          `TO ${target.transferOrderNumber} / Material ${target.material} cancelled. Reason: ${reason}`,
          'to_line_cancelled'
        )
        setCancelTarget(null)
        await loadDetails(true)
      } catch (err) {
        logger.error('[KitProductionTracker] handleCancelTOLine error:', err)
        toast.error('Failed to cancel TO line')
      } finally {
        setCancellingLine(false)
      }
    },
    [loadDetails, addSystemNote]
  )

  /**
   * Render-list for the chat. Maps persisted `KitNote` rows into the
   * UI-friendly `ChatMessage` shape and prepends a synthetic
   * "Kit build plan created" entry derived from the kit's
   * `kit_added_*` columns, so kits that pre-date the `kit_notes` table
   * still get a creation marker without needing a one-shot backfill.
   *
   * The synthetic entry is only included when the kit has a `addedAt`
   * timestamp AND it's not already represented by a real `kit_created`
   * note (forward-compat — if we ever stamp creation notes server-side
   * on `createKitBuildPlan`, the synthetic one self-deduplicates).
   */
  const chatMessages = useMemo<ChatMessage[]>(() => {
    const persisted: ChatMessage[] = notes.map((note: KitNote) => ({
      id: note.id,
      text: note.body,
      sender: note.sender_type,
      isMine:
        note.sender_type === 'user' &&
        !!currentUserId &&
        note.sender_user_id === currentUserId,
      timestamp: new Date(note.created_at),
      senderName:
        note.sender_type === 'system'
          ? 'System'
          : (note.sender_name ?? 'Unknown'),
      eventKind: note.event_kind,
    }))

    const hasCreatedNote = notes.some((n) => n.event_kind === 'kit_created')

    if (!hasCreatedNote && details?.addedAt) {
      const createdBy = details.addedBy?.trim() || 'an operator'
      const synthetic: ChatMessage = {
        id: `synthetic-created-${details.kitSerialNumber || details.kitPoNumber || 'unknown'}`,
        text: `Kit build plan created by ${createdBy}.`,
        sender: 'system',
        isMine: false,
        isSynthetic: true,
        timestamp: new Date(details.addedAt),
        senderName: 'System',
        eventKind: 'kit_created',
      }
      // Synthetic entry first; the persisted list is already
      // chronological from the service.
      return [synthetic, ...persisted]
    }

    return persisted
  }, [notes, currentUserId, details])

  // Track if we should scroll to bottom (only for messages the
  // currently-signed-in user just sent, not on every refetch).
  const shouldScrollRef = useRef(false)

  const scrollToBottom = () => {
    if (shouldScrollRef.current && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
      shouldScrollRef.current = false
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [chatMessages])

  // Send message handler — persists via `addUserNote`. The hook
  // invalidates the notes query on success, which causes
  // `chatMessages` to re-derive and the effect above to scroll.
  const handleSendMessage = () => {
    const trimmed = newMessage.trim()
    if (!trimmed || notesSending || !kitSerialNumber) return

    shouldScrollRef.current = true
    setNewMessage('')
    addUserNote(trimmed)
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

      await addSystemNote(
        `${flag.name} flag added — ${flag.description}`,
        'flag_added'
      )
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

      const flagConfig = flagTypes.find((f) => f.id === flagType)
      await addSystemNote(
        `${flagConfig?.name || flagType} flag removed`,
        'flag_cleared'
      )
    } else {
      logger.error('Failed to remove flag:', result.error)
    }
  }

  // Handle clearing all flags
  const handleClearFlag = async () => {
    if (!kitSerialNumber || activeFlags.length === 0) return

    const clearedCount = activeFlags.length
    for (const flag of activeFlags) {
      await RRKittingDataService.clearFlagById(flag.id)
    }

    setActiveFlags([])

    await addSystemNote(
      `All flags cleared (${clearedCount} flag${clearedCount === 1 ? '' : 's'})`,
      'flag_cleared'
    )
  }

  // Get flags that are not yet active (can still be added)
  const availableFlags = flagTypes.filter(
    (ft) => !activeFlags.some((af) => af.flagType === ft.id)
  )

  // Format chat timestamp with finer granularity for fresh messages.
  // Returns 'Just now' (<60s), 'Xm ago' (<60min), 'Xh ago' (<24h),
  // 'Xd ago' (<7d), or the localized date for older entries.
  const formatChatTime = (date: Date) => {
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    if (diffMs < 60_000) return 'Just now'

    const minutes = Math.floor(diffMs / 60_000)
    if (minutes < 60) return `${minutes}m ago`

    const hours = Math.floor(diffMs / 3_600_000)
    if (hours < 24) return `${hours}h ago`

    const days = Math.floor(diffMs / 86_400_000)
    if (days < 7) return `${days}d ago`

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
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
      <DialogContent className='flex max-h-[92vh] w-[95vw] max-w-[1600px] min-w-[1280px] flex-col gap-0 overflow-hidden p-0'>
        <DialogHeader className='shrink-0 gap-0 space-y-0 border-b px-6 pt-5 pr-14 pb-4'>
          {/* Line 1 — title, status pill, refresh. Edit Ship Short
              moved into the Production Progress header alongside Add
              Flag; Delete moved to the sticky dialog footer. */}
          <div className='flex items-start justify-between gap-4'>
            <div className='flex min-w-0 items-center gap-3'>
              <DialogTitle className='text-foreground truncate text-xl font-semibold tracking-tight'>
                Kit Build Audit Trail
              </DialogTitle>
              {details && (
                <span className='inline-flex shrink-0 items-center'>
                  {getStatusBadge(details.status)}
                </span>
              )}
            </div>
            {details && (
              <div className='flex shrink-0 items-center gap-2'>
                <Button
                  onClick={() => loadDetails(true)}
                  variant='ghost'
                  size='sm'
                  disabled={refreshing}
                  className='h-8 w-8 p-0'
                  title='Refresh kit data'
                >
                  <RefreshCw
                    className={cn('h-4 w-4', refreshing && 'animate-spin')}
                  />
                  <span className='sr-only'>Refresh</span>
                </Button>
              </div>
            )}
          </div>

          {/* Line 2 — enterprise meta strip. Glanceable identity +
              priority + due + plant in a single horizontal rule of
              label/value pairs separated by dot dividers. This is the
              canonical "record-detail" header pattern used by
              Salesforce/Linear/Jira. */}
          {details ? (
            <div className='text-muted-foreground mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]'>
              <span className='flex items-center gap-1.5'>
                <span className='text-[11px] font-semibold tracking-wider uppercase'>
                  Kit
                </span>
                <span className='text-foreground font-mono text-[15px] font-medium'>
                  {details.kitSerialNumber ||
                    kitSerialNumber ||
                    details.kitPoNumber ||
                    kitPoNumber}
                </span>
              </span>
              <span className='text-border'>•</span>
              <span className='flex items-center gap-1.5'>
                <span className='text-[11px] font-semibold tracking-wider uppercase'>
                  Priority
                </span>
                <span className='text-foreground text-[15px] font-semibold tabular-nums'>
                  #{displayPriority ?? details.priority}
                </span>
              </span>
              <span className='text-border'>•</span>
              <span className='flex items-center gap-1.5'>
                <span className='text-[11px] font-semibold tracking-wider uppercase'>
                  Due
                </span>
                <span className='text-foreground text-[15px] font-medium'>
                  {formatDate(details.dueDate)}
                </span>
              </span>
              <span className='text-border'>•</span>
              <span className='flex items-center gap-1.5'>
                <span className='text-[11px] font-semibold tracking-wider uppercase'>
                  Plant
                </span>
                <span className='text-foreground text-[15px] font-medium'>
                  {details.deliverToPlant || 'N/A'}
                </span>
              </span>
            </div>
          ) : (
            <DialogDescription className='text-muted-foreground mt-2 text-[13px]'>
              Loading kit{' '}
              <span className='text-foreground font-mono font-medium'>
                {kitSerialNumber || kitPoNumber}
              </span>
              …
            </DialogDescription>
          )}
        </DialogHeader>

        <ConfirmDialog
          open={showDeleteConfirm}
          onOpenChange={setShowDeleteConfirm}
          title='Delete Kit from Build Plan'
          desc={`This will permanently delete kit ${kitSerialNumber || kitPoNumber} and all associated data including TO lines, flags, and kanban cards. This action cannot be undone.`}
          confirmText={deleting ? 'Deleting...' : 'Delete Kit'}
          destructive
          isLoading={deleting}
          handleConfirm={handleDeleteKit}
        />

        <CancelTOLineDialog
          open={!!cancelTarget}
          onOpenChange={(next) => {
            if (!next && !cancellingLine) setCancelTarget(null)
          }}
          target={cancelTarget}
          onConfirm={handleCancelTOLine}
        />

        <EditShipShortDialog
          isOpen={showEditShipShort}
          onOpenChange={setShowEditShipShort}
          kitSerialNumber={kitSerialNumber}
          kitPoNumber={details?.kitPoNumber ?? kitPoNumber ?? null}
          initialItems={details?.authorizedShipShortItems ?? []}
          onSubmit={handleSaveShipShort}
        />

        {/* Cover sheet reprint — serial-scoped so multi-kit POs print the
            exact kit currently open (see [[Kit-Serial-Scoping]]). */}
        <KitBuildSheet
          open={isCoverSheetOpen}
          onOpenChange={setIsCoverSheetOpen}
          kitPoNumber={details?.kitPoNumber ?? kitPoNumber ?? null}
          kitSerialNumber={kitSerialNumber}
        />

        <div className='bg-muted/30 flex-1 overflow-y-auto px-6 pt-5 pb-6'>
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
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      ease: 'linear',
                    }}
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
              className='space-y-5'
              variants={containerVariants}
              initial='hidden'
              animate='visible'
            >
              {/* Black-Hat Ship-Short Authorization Panel
                Rendered only when the kit is currently Black-Hat-flagged
                AND the org has the policy enabled (see
                `kitting_workflow_settings`). The panel hides itself in
                both other cases, so it's safe to always mount here. */}
              <motion.div variants={itemVariants}>
                <BlackHatShipShortPanel
                  kitSerialNumber={kitSerialNumber}
                  kitPoNumber={details.kitPoNumber || kitPoNumber}
                  hasActiveBlackHat={hasActiveBlackHat}
                  existingAuthorizedItems={details.authorizedShipShortItems}
                  onSaved={handleBlackHatPanelSaved}
                />
              </motion.div>

              {/* Production Progress — full-width horizontal stepper
                with the Build Flags promoted inline into the card
                header. The header strip would otherwise be mostly empty
                whitespace; inline flag pills + Add Flag dropdown turn
                it into a precision status bar that surfaces the kit's
                quality state alongside its production state. */}
              <motion.div variants={itemVariants}>
                <Card className='overflow-hidden'>
                  <CardHeader className='border-b px-5 py-2'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <CardTitle className='text-muted-foreground flex items-center gap-2 text-[13px] font-semibold tracking-wider uppercase'>
                        <Clock className='h-3.5 w-3.5' />
                        Production Progress
                      </CardTitle>

                      {/* Inline flag bar — active flag pills then the
                        Add Flag dropdown. Pills use a colored dot prefix
                        + flag name + hover-revealed X to remove, which
                        is the canonical enterprise "chip with delete"
                        pattern (Linear labels, Jira components, GitHub
                        labels). */}
                      <div className='flex flex-wrap items-center gap-1.5'>
                        {activeFlags.map((flag) => {
                          const flagConfig = flagTypes.find(
                            (f) => f.id === flag.flagType
                          )
                          if (!flagConfig) return null
                          const setMeta = flag.setByUserName
                            ? `Set by ${flag.setByUserName}${
                                flag.setDateTime
                                  ? ` · ${new Date(
                                      flag.setDateTime
                                    ).toLocaleString()}`
                                  : ''
                              }`
                            : flagConfig.description
                          return (
                            <span
                              key={flag.id}
                              className={cn(
                                'group inline-flex h-6 items-center gap-1.5 rounded-full border pr-0.5 pl-2 text-[11px] font-semibold transition-colors',
                                flag.flagType === 'purple' &&
                                  'border-purple-500/40 bg-purple-500/10 text-purple-700 hover:bg-purple-500/15 dark:text-purple-400',
                                flag.flagType === 'orange' &&
                                  'border-orange-500/40 bg-orange-500/10 text-orange-700 hover:bg-orange-500/15 dark:text-orange-400',
                                flag.flagType === 'red' &&
                                  'border-red-500/40 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-400',
                                flag.flagType === 'black' &&
                                  'border-gray-900/40 bg-gray-900/10 text-gray-900 hover:bg-gray-900/15 dark:border-gray-100/40 dark:bg-gray-100/10 dark:text-gray-100'
                              )}
                              title={setMeta}
                            >
                              <span
                                className={cn(
                                  'h-2 w-2 shrink-0 rounded-full',
                                  flagConfig.color
                                )}
                                aria-hidden
                              />
                              <span className='leading-none'>
                                {flagConfig.name}
                              </span>
                              <button
                                type='button'
                                onClick={() =>
                                  handleRemoveFlag(flag.id, flag.flagType)
                                }
                                className='hover:text-destructive flex h-5 w-5 shrink-0 items-center justify-center rounded-full opacity-50 transition-all hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10'
                                title='Remove flag'
                                aria-label={`Remove ${flagConfig.name} flag`}
                              >
                                <X className='h-3 w-3' />
                              </button>
                            </span>
                          )
                        })}

                        {/* Subtle vertical divider when there are pills
                          so the action buttons read as distinct
                          affordances, not another pill. */}
                        {activeFlags.length > 0 && (
                          <span
                            className='bg-border mx-0.5 h-4 w-px'
                            aria-hidden
                          />
                        )}

                        {/* Edit Ship Short — promoted into the Production
                          Progress header alongside Add Flag. Both are
                          quality/exception actions that operate on the
                          current kit, so grouping them here is the
                          natural information-architecture fit. */}
                        <Button
                          onClick={() => setShowEditShipShort(true)}
                          variant='outline'
                          size='sm'
                          disabled={savingShipShort}
                          className='h-7 gap-1.5 border-amber-500/40 px-2.5 text-xs text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200'
                        >
                          <ShieldCheck className='h-3 w-3' />
                          <span>Edit Ship Short</span>
                          {details.authorizedShipShortItems.length > 0 && (
                            <span className='ml-0.5 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold'>
                              {details.authorizedShipShortItems.length}
                            </span>
                          )}
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant='outline'
                              size='sm'
                              className='h-7 gap-1.5 px-2.5 text-xs'
                              disabled={
                                addingFlag || availableFlags.length === 0
                              }
                            >
                              {addingFlag ? (
                                <>
                                  <Loader2 className='h-3 w-3 animate-spin' />
                                  <span>Adding…</span>
                                </>
                              ) : (
                                <>
                                  <HardHat className='h-3 w-3' />
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
                    </div>
                  </CardHeader>
                  <CardContent className='px-6 py-6'>
                    {(() => {
                      // When the org disabled kit inspections, hide the
                      // Inspection step from the stepper entirely. The
                      // on-dock stage's status is already correct (the
                      // skip-inspection completion path stamps both
                      // `kit_inspection_completion_date_time` and
                      // `kit_ready_on_dock_date_time` so the service-
                      // computed stage already reads "completed").
                      const visibleStages = kitInspectionRequired
                        ? details.stages
                        : details.stages.filter((s) => s.id !== 'inspection')
                      return (
                        <HorizontalProgressStepper stages={visibleStages} />
                      )
                    })()}
                  </CardContent>
                </Card>
              </motion.div>

              {/* Record-detail body — Details rail (left) and Audit
                Trail (right). Two-column 4/8 split gives the chat
                thread the dominant share of width + height; the rail is
                pure reference data. Flags moved into the Production
                Progress header above. */}
              <motion.div
                variants={itemVariants}
                className='grid grid-cols-1 gap-5 lg:grid-cols-12'
              >
                {/* Left rail — Details card with grouped sections
                  (Identifiers / Schedule / Logistics). Grouped
                  definition-list pattern is the canonical Salesforce/
                  Hubspot record-detail layout: each label/value pair
                  occupies a row, sections separated by a muted bar
                  with a small-caps heading. */}
                <Card className='overflow-hidden lg:col-span-4'>
                  <CardHeader className='border-b px-5 py-2'>
                    <CardTitle className='text-muted-foreground text-[13px] font-semibold tracking-wider uppercase'>
                      Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='p-0'>
                    {/* Identifiers */}
                    <div className='border-b'>
                      <div className='bg-muted/40 px-5 py-1.5'>
                        <h4 className='text-muted-foreground text-[11px] font-semibold tracking-wider uppercase'>
                          Identifiers
                        </h4>
                      </div>
                      <dl className='divide-border/60 divide-y'>
                        <div className='flex items-baseline justify-between gap-3 px-5 py-2.5'>
                          <dt className='text-muted-foreground shrink-0 text-[13px]'>
                            Kit PO
                          </dt>
                          <dd className='truncate text-right font-mono text-sm font-medium'>
                            {details.kitPoNumber}
                          </dd>
                        </div>
                        <div className='flex items-baseline justify-between gap-3 px-5 py-2.5'>
                          <dt className='text-muted-foreground shrink-0 text-[13px]'>
                            Build Number
                          </dt>
                          <dd className='truncate text-right font-mono text-sm font-medium'>
                            {details.kitBuildNumber}
                          </dd>
                        </div>
                        <div className='flex items-baseline justify-between gap-3 px-5 py-2.5'>
                          <dt className='text-muted-foreground shrink-0 text-[13px]'>
                            Kit Number
                          </dt>
                          <dd className='truncate text-right text-sm font-medium'>
                            {details.kitNumber || (
                              <span className='text-muted-foreground'>—</span>
                            )}
                          </dd>
                        </div>
                        <div className='flex items-baseline justify-between gap-3 px-5 py-2.5'>
                          <dt className='text-muted-foreground shrink-0 text-[13px]'>
                            Engine Program
                          </dt>
                          <dd className='truncate text-right text-sm font-medium'>
                            {details.engineProgram || (
                              <span className='text-muted-foreground'>—</span>
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    {/* Schedule */}
                    <div className='border-b'>
                      <div className='bg-muted/40 px-5 py-1.5'>
                        <h4 className='text-muted-foreground text-[11px] font-semibold tracking-wider uppercase'>
                          Schedule
                        </h4>
                      </div>
                      <dl className='divide-border/60 divide-y'>
                        <div className='flex items-baseline justify-between gap-3 px-5 py-2.5'>
                          <dt className='text-muted-foreground shrink-0 text-[13px]'>
                            Due Date
                          </dt>
                          <dd className='truncate text-right text-sm font-medium'>
                            {formatDate(details.dueDate)}
                          </dd>
                        </div>
                        <div className='flex items-baseline justify-between gap-3 px-5 py-2.5'>
                          <dt className='text-muted-foreground shrink-0 text-[13px]'>
                            Created By
                          </dt>
                          <dd className='truncate text-right text-sm font-medium'>
                            {details.addedBy || (
                              <span className='text-muted-foreground'>—</span>
                            )}
                          </dd>
                        </div>
                        <div className='flex items-baseline justify-between gap-3 px-5 py-2.5'>
                          <dt className='text-muted-foreground shrink-0 text-[13px]'>
                            Created At
                          </dt>
                          <dd className='text-right text-sm font-medium'>
                            {formatDateTime(details.addedAt)}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    {/* Logistics */}
                    <div>
                      <div className='bg-muted/40 px-5 py-1.5'>
                        <h4 className='text-muted-foreground text-[11px] font-semibold tracking-wider uppercase'>
                          Logistics
                        </h4>
                      </div>
                      <dl className='divide-border/60 divide-y'>
                        <div className='flex items-baseline justify-between gap-3 px-5 py-2.5'>
                          <dt className='text-muted-foreground shrink-0 text-[13px]'>
                            Deliver To
                          </dt>
                          <dd className='truncate text-right text-sm font-medium'>
                            {details.deliverToPlant || (
                              <span className='text-muted-foreground'>—</span>
                            )}
                          </dd>
                        </div>
                        {details.authorizedShipShortItems.length > 0 && (
                          <div className='flex items-baseline justify-between gap-3 px-5 py-2.5'>
                            <dt className='text-muted-foreground shrink-0 text-[13px]'>
                              Ship-Short Auth.
                            </dt>
                            <dd className='text-right text-sm font-medium'>
                              <span className='inline-flex items-center rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400'>
                                {details.authorizedShipShortItems.length}{' '}
                                authorized
                              </span>
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  </CardContent>
                </Card>

                {/* Right column — Audit Trail / Notes
                  Takes the dominant 8/12 share of width and is sized to
                  `h-[640px]` so the chat thread is the visual focal
                  point of the dialog. The thread itself uses an iOS-
                  style bubble UI with system messages (italic, neutral)
                  visually distinct from user notes (right-aligned blue
                  for current user, left-aligned grey for others). */}
                <motion.div variants={itemVariants} className='lg:col-span-8'>
                  <Card className='flex h-[640px] flex-col overflow-hidden'>
                    <CardHeader className='shrink-0 border-b px-5 py-2'>
                      <div className='flex items-center justify-between gap-2'>
                        <CardTitle className='text-muted-foreground flex items-center gap-2 text-[13px] font-semibold tracking-wider uppercase'>
                          <MessageCircle className='h-3.5 w-3.5' />
                          Audit Trail
                          {notesLoading && (
                            <Loader2 className='ml-1 h-3 w-3 animate-spin' />
                          )}
                        </CardTitle>
                        <span className='text-muted-foreground text-[13px] font-medium'>
                          {chatMessages.length}{' '}
                          {chatMessages.length === 1 ? 'entry' : 'entries'}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className='flex flex-1 flex-col overflow-hidden p-0'>
                      {/* Messages Area */}
                      <div
                        ref={chatScrollRef}
                        className='bg-muted/20 flex-1 overflow-y-auto px-5'
                      >
                        <div className='space-y-3 py-4'>
                          {chatMessages.length === 0 && !notesLoading && (
                            <div className='text-muted-foreground py-16 text-center text-xs'>
                              <MessageCircle className='mx-auto mb-3 h-10 w-10 opacity-30' />
                              <p className='text-sm font-medium'>
                                No entries yet
                              </p>
                              <p className='mt-1 text-xs'>
                                Type a message below to start this kit's audit
                                trail.
                              </p>
                            </div>
                          )}
                          {chatMessages.map((message) => (
                            <div
                              key={message.id}
                              className={cn(
                                'flex max-w-[75%] flex-col',
                                message.isMine
                                  ? 'ml-auto items-end'
                                  : 'items-start'
                              )}
                            >
                              <div
                                className={cn(
                                  'rounded-2xl px-4 py-2 text-sm wrap-break-word whitespace-pre-wrap shadow-sm',
                                  message.isMine
                                    ? 'rounded-br-md bg-blue-500 text-white'
                                    : message.sender === 'system'
                                      ? 'bg-background text-foreground/90 rounded-bl-md border italic'
                                      : 'bg-background rounded-bl-md border'
                                )}
                              >
                                {message.text}
                              </div>
                              <div className='mt-1 flex items-center gap-1 px-1'>
                                <span className='text-muted-foreground text-[10px] font-medium'>
                                  {message.isMine
                                    ? 'You'
                                    : (message.senderName ?? 'Unknown')}
                                </span>
                                <span className='text-muted-foreground text-[10px]'>
                                  ·
                                </span>
                                <span className='text-muted-foreground text-[10px]'>
                                  {formatChatTime(message.timestamp)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Input Area */}
                      <div className='bg-background shrink-0 border-t p-3'>
                        <div className='flex items-center gap-2'>
                          <Input
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleSendMessage()
                              }
                            }}
                            placeholder='Type a message…'
                            disabled={notesSending || !kitSerialNumber}
                            maxLength={4000}
                            className='bg-muted/60 flex-1 rounded-full border-0 focus-visible:ring-1'
                          />
                          <Button
                            size='icon'
                            onClick={handleSendMessage}
                            disabled={
                              !newMessage.trim() ||
                              notesSending ||
                              !kitSerialNumber
                            }
                            className='h-9 w-9 rounded-full bg-blue-500 hover:bg-blue-600'
                          >
                            {notesSending ? (
                              <Loader2 className='h-4 w-4 animate-spin' />
                            ) : (
                              <Send className='h-4 w-4' />
                            )}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              </motion.div>

              {/* TO Lines Table */}
              <motion.div variants={itemVariants}>
                <Card className='overflow-hidden'>
                  <CardHeader className='border-b px-5 py-2'>
                    <div className='flex items-center justify-between gap-2'>
                      <CardTitle className='text-muted-foreground flex items-center gap-2 text-[13px] font-semibold tracking-wider uppercase'>
                        <Package className='h-3.5 w-3.5' />
                        Transfer Order Lines
                        <span className='text-muted-foreground ml-1 text-[13px] font-medium normal-case'>
                          ({details.toLines.length} total)
                        </span>
                      </CardTitle>
                      <div className='flex items-center gap-1.5'>
                        <Badge
                          variant='outline'
                          className='h-6 border-yellow-500/30 bg-yellow-500/10 text-[11px] font-medium text-yellow-700 dark:text-yellow-400'
                        >
                          {incompleteLines.length} Pending
                        </Badge>
                        <Badge
                          variant='outline'
                          className='h-6 border-green-500/30 bg-green-500/10 text-[11px] font-medium text-green-700 dark:text-green-400'
                        >
                          {completedLines.length} Complete
                        </Badge>
                        {cancelledLines.length > 0 && (
                          <Badge
                            variant='outline'
                            className='text-muted-foreground border-muted-foreground/30 bg-muted/40 h-6 text-[11px] font-medium'
                          >
                            {cancelledLines.length} Cancelled
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className='p-0'>
                    {details.toLines.length === 0 ? (
                      <div className='py-10 text-center'>
                        <Package className='text-muted-foreground/40 mx-auto mb-3 h-9 w-9' />
                        <p className='text-muted-foreground text-sm font-medium'>
                          No TO lines imported
                        </p>
                      </div>
                    ) : (
                      <div className='overflow-hidden'>
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
                              <TableHead className='w-12 text-right'>
                                <span className='sr-only'>Actions</span>
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {details.toLines.map((line) => (
                              <TableRow
                                key={line.id}
                                className={cn(
                                  line.cancelled &&
                                    'bg-muted/40 text-muted-foreground',
                                  !line.cancelled &&
                                    line.missingPartFlag &&
                                    'border-l-4 border-l-purple-500 bg-purple-100 dark:bg-purple-900/30'
                                )}
                              >
                                <TableCell
                                  className={cn(
                                    'font-mono text-xs',
                                    line.cancelled && 'line-through opacity-70'
                                  )}
                                >
                                  {line.transferOrderNumber}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    'font-mono text-xs',
                                    line.cancelled && 'line-through opacity-70',
                                    !line.cancelled &&
                                      line.missingPartFlag &&
                                      'font-semibold text-purple-700 dark:text-purple-400'
                                  )}
                                >
                                  {line.material}
                                  {!line.cancelled && line.missingPartFlag && (
                                    <span className='ml-2 inline-flex items-center gap-1 rounded bg-purple-200 px-1.5 py-0.5 text-xs text-purple-700 no-underline dark:bg-purple-800 dark:text-purple-300'>
                                      <AlertCircle className='h-3 w-3' />
                                      Missing
                                    </span>
                                  )}
                                  {line.cancelled && (
                                    <span
                                      className='border-destructive/30 bg-destructive/10 text-destructive ml-2 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase no-underline'
                                      title={
                                        line.cancelledReason
                                          ? `${line.cancelledReason}${line.cancelledBy ? ` — ${line.cancelledBy}` : ''}${line.cancelledAt ? ` · ${new Date(line.cancelledAt).toLocaleString()}` : ''}`
                                          : 'Cancelled'
                                      }
                                    >
                                      <Trash2 className='h-3 w-3' />
                                      Cancelled
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    'max-w-[200px] truncate text-sm',
                                    line.cancelled && 'line-through opacity-70'
                                  )}
                                >
                                  {line.materialDescription || '—'}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    'text-right font-medium',
                                    line.cancelled && 'line-through opacity-70'
                                  )}
                                >
                                  {line.quantity}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    'font-mono text-xs',
                                    line.cancelled && 'line-through opacity-70',
                                    !line.cancelled &&
                                      line.missingPartFlag &&
                                      'text-purple-600 dark:text-purple-400'
                                  )}
                                >
                                  {line.sourceStorageBin || '—'}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    'font-mono text-xs',
                                    line.cancelled && 'line-through opacity-70'
                                  )}
                                >
                                  {line.destStorageBin || '—'}
                                </TableCell>
                                <TableCell>
                                  {line.cancelled ? (
                                    <span className='text-muted-foreground/60 text-xs'>
                                      —
                                    </span>
                                  ) : line.missingPartFlag ? (
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
                                  {line.cancelled ? (
                                    <span className='text-muted-foreground/60 text-xs'>
                                      —
                                    </span>
                                  ) : line.kitted ? (
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
                                <TableCell className='text-right'>
                                  {line.cancelled ? (
                                    <span className='text-muted-foreground/40 text-[10px] uppercase'>
                                      Cancelled
                                    </span>
                                  ) : (
                                    <Button
                                      variant='ghost'
                                      size='icon'
                                      className='hover:text-destructive hover:bg-destructive/10 h-7 w-7'
                                      onClick={() =>
                                        setCancelTarget({
                                          toLineId: line.id,
                                          transferOrderNumber:
                                            line.transferOrderNumber,
                                          material: line.material,
                                          materialDescription:
                                            line.materialDescription,
                                        })
                                      }
                                      disabled={cancellingLine}
                                      title='Cancel this TO line'
                                      aria-label={`Cancel TO ${line.transferOrderNumber}`}
                                    >
                                      <Trash2 className='h-3.5 w-3.5' />
                                    </Button>
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
        </div>

        {/* Sticky footer — houses the destructive Delete action so it
            doesn't compete with the primary read/edit affordances at
            the top of the dialog. Right-aligned destructive button is
            the canonical enterprise pattern (Linear, Notion, Jira). */}
        {details && (
          <div className='bg-background flex shrink-0 items-center justify-between gap-3 border-t px-6 py-3'>
            <p className='text-muted-foreground text-xs'>
              Deleting this kit removes its TO lines, flags, kanban cards, and
              audit trail. This action cannot be undone.
            </p>
            <div className='flex shrink-0 items-center gap-2'>
              <Button
                onClick={() => setIsCoverSheetOpen(true)}
                variant='outline'
                size='sm'
                className='h-8'
              >
                <Printer className='mr-1.5 h-3.5 w-3.5' />
                Print Cover Sheet
              </Button>
              <Button
                onClick={() => setShowDeleteConfirm(true)}
                variant='outline'
                size='sm'
                disabled={deleting}
                className='text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30 h-8'
              >
                <Trash2 className='mr-1.5 h-3.5 w-3.5' />
                Delete Kit
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
