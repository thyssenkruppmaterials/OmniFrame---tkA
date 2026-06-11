// Created and developed by Jai Singh
/**
 * Kitting Data Grid
 * Draggable data grid for RR_Kitting_DATA table
 * Created: December 11, 2025
 */
import * as React from 'react'
import { format } from 'date-fns'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Cell,
  type ColumnDef,
  type Row,
} from '@tanstack/react-table'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Loader2, MessageSquareDot } from 'lucide-react'
import { HardHat } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// Flag types with colors
const flagConfig = {
  purple: {
    name: 'Purple Hat',
    color: 'bg-purple-500',
    textColor: 'text-purple-500',
    description: 'Inventory Issue',
  },
  orange: {
    name: 'Orange Hat',
    color: 'bg-orange-500',
    textColor: 'text-orange-500',
    description: 'Incora Supplier Issue',
  },
  red: {
    name: 'Red Hat',
    color: 'bg-red-500',
    textColor: 'text-red-500',
    description: 'Quality Issue',
  },
  black: {
    name: 'Black Hat',
    color: 'bg-gray-900 dark:bg-gray-800',
    textColor: 'text-gray-900 dark:text-gray-100',
    description: 'Supply Chain Issue',
  },
} as const

export type KitFlagType = 'purple' | 'orange' | 'red' | 'black'

// Active flag structure for grid display
export interface ActiveFlag {
  id: string
  flagType: KitFlagType
  setByUserName: string | null
  setDateTime: string | null
  notes: string | null
}

// Row data structure for the grid
export interface KittingGridRow {
  id: string
  kit_serial_number: string // PRIMARY KEY: Unique identifier for each kit build (format: KIT-YYYYMMDD-XXX)
  kit_po_number: string
  kit_number: string // Kit Number (can have duplicates across different kit builds)
  kit_priority: number
  kit_priority_change_count: number
  due_date: string | null
  kit_added_by_user: string | null
  kit_added_by_user_name: string | null
  kit_added_create_date_time: string | null
  kit_build_status: string | null
  // Derived granular stage for the Status column (falls back to kit_build_status).
  kit_stage_status: string | null
  // Engine program. Stand-alone single-part expedites are stamped 'EXPEDITE'.
  engine_program: string | null
  // Authorized to Ship Short part numbers attached to this kit
  authorized_ship_short_items: Array<{
    lineNumber: number
    partNumber: string
    description: string
  }>
  // Multiple flags support
  active_flags: ActiveFlag[]
  // Legacy single flag (for backward compatibility)
  kit_flag_type: KitFlagType | null
  kit_flag_set_by_user_name: string | null
}

// Extra context handed to column cells via TanStack table `meta`. Lets the
// module-level column defs read the per-user unread set without re-creating
// the columns array on every render.
interface KittingGridMeta {
  unreadKitSerials?: Set<string>
}

interface KittingDataGridProps {
  data: KittingGridRow[]
  isLoading?: boolean
  /** Kit serials with an unread operator note for the current user. */
  unreadKitSerials?: Set<string>
  onRowReorder?: (rows: KittingGridRow[]) => void
  /**
   * Fires on row click. `displayPriority` is the row's rendered position
   * (`index + 1`), i.e. the same `#n` shown in the Priority column — pass it
   * through so detail dialogs show the same positional priority.
   */
  onRowClick?: (row: KittingGridRow, displayPriority: number) => void
  onPriorityChange?: (rows: KittingGridRow[]) => Promise<void>
  /**
   * When false, renders a read-only table with no drag-to-reorder affordances.
   * Used for terminal-state views (e.g. completed kits) where priority is
   * meaningless. Default: true.
   */
  reorderable?: boolean
  /** Message shown when there are no rows to display. */
  emptyMessage?: string
}

// Priority display component - shows position number
function PriorityDisplay({ priority }: { priority: number }) {
  // Color based on priority number
  const getPriorityColor = (p: number) => {
    if (p === 1)
      return 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20'
    if (p === 2)
      return 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20'
    if (p === 3)
      return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20'
    if (p <= 5)
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20'
    return 'bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20'
  }

  return (
    <Badge
      variant='outline'
      className={cn('font-mono tabular-nums', getPriorityColor(priority))}
    >
      #{priority}
    </Badge>
  )
}

// Status badge component - colors match Production Progress in Kit Build Audit Trail
function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className='text-muted-foreground'>—</span>

  // Color scheme matches Production Progress stages in Kit Production Tracker
  // pending → purple (planning), printed → indigo (picking), in_progress → cyan (kitting)
  // kit_built → cyan (kitting complete), inspection_in_progress → orange (inspection)
  // kit_inspected/completed → green (on-dock)
  const statusConfig: Record<string, { className: string; label?: string }> = {
    pending: {
      className:
        'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-500/20',
      label: 'Pending',
    },
    printed: {
      className:
        'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border-indigo-500/20',
      label: 'Printed',
    },
    in_progress: {
      className:
        'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 border-cyan-500/20',
      label: 'In Progress',
    },
    picking: {
      className:
        'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-500/20',
      label: 'Picking',
    },
    picking_complete: {
      className:
        'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 border-sky-500/20',
      label: 'Picking Complete',
    },
    kitting: {
      className:
        'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 border-teal-500/20',
      label: 'Kitting',
    },
    kit_built: {
      className:
        'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 border-cyan-500/20',
      label: 'Kit Built',
    },
    inspection_in_progress: {
      className:
        'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-500/20',
      label: 'Inspecting',
    },
    kit_inspected: {
      className:
        'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-500/20',
      label: 'Kit Inspected',
    },
    completed: {
      className:
        'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-500/20',
      label: 'Completed',
    },
    cancelled: {
      className:
        'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-500/20',
      label: 'Cancelled',
    },
    on_hold: {
      className:
        'bg-gray-100 dark:bg-gray-900/30 text-gray-700 dark:text-gray-400 border-gray-500/20',
      label: 'On Hold',
    },
  }

  const config = statusConfig[status.toLowerCase()] || {
    className:
      'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-500/20',
    label: status.replace(/_/g, ' '),
  }

  return (
    <Badge variant='outline' className={cn('capitalize', config.className)}>
      {config.label || status.replace(/_/g, ' ')}
    </Badge>
  )
}

// Flag badge component - displays multiple kit build flags with hard hat icons
function FlagBadge({
  activeFlags,
  legacyFlagType,
  legacySetByName,
}: {
  activeFlags: ActiveFlag[]
  legacyFlagType: KitFlagType | null
  legacySetByName: string | null
}) {
  // Use active_flags if available, otherwise fall back to legacy single flag
  const flags =
    activeFlags.length > 0
      ? activeFlags
      : legacyFlagType
        ? [
            {
              id: 'legacy',
              flagType: legacyFlagType,
              setByUserName: legacySetByName,
              setDateTime: null,
              notes: null,
            },
          ]
        : []

  if (flags.length === 0)
    return <span className='text-muted-foreground'>—</span>

  return (
    <div className='flex items-center gap-1'>
      {flags.map((flag) => {
        const config = flagConfig[flag.flagType]
        if (!config) return null

        return (
          <TooltipProvider key={flag.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    'flex h-6 w-6 cursor-help items-center justify-center rounded-full',
                    config.color
                  )}
                >
                  <HardHat className='h-3.5 w-3.5 text-white' />
                </div>
              </TooltipTrigger>
              <TooltipContent side='top' className='max-w-[220px]'>
                <p className='font-medium'>{config.name}</p>
                <p className='text-muted-foreground text-sm'>
                  {config.description}
                </p>
                {flag.setByUserName && (
                  <p className='text-muted-foreground mt-1 text-xs'>
                    Set by: {flag.setByUserName}
                  </p>
                )}
                {flag.notes && (
                  <p className='text-muted-foreground mt-1 text-xs'>
                    Note: {flag.notes}
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      })}
    </div>
  )
}

// Ship Short authorization cell — lists the authorized part numbers as amber
// badges (with the description on hover). Renders a muted dash when the kit
// has no ship-short authorization.
function ShipShortCell({
  items,
}: {
  items: Array<{ lineNumber: number; partNumber: string; description: string }>
}) {
  const authorized = (items || []).filter((item) => item.partNumber?.trim())

  if (authorized.length === 0)
    return <span className='text-muted-foreground'>—</span>

  return (
    <div className='flex flex-wrap items-center gap-1'>
      {authorized.map((item) => (
        <TooltipProvider key={`${item.lineNumber}-${item.partNumber}`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant='outline'
                className='cursor-help border-amber-500/30 bg-amber-500/10 font-mono text-[11px] text-amber-700 dark:text-amber-400'
              >
                {item.partNumber}
              </Badge>
            </TooltipTrigger>
            {item.description && (
              <TooltipContent side='top' className='max-w-[220px]'>
                <p className='text-sm'>{item.description}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  )
}

// Format date for display
function formatDate(dateString: string | null): string {
  if (!dateString) return '—'
  try {
    return format(new Date(dateString), 'MMM d, yyyy')
  } catch {
    return dateString
  }
}

// Format datetime for display
function formatDateTime(dateString: string | null): string {
  if (!dateString) return '—'
  try {
    return format(new Date(dateString), 'MMM d, yyyy h:mm a')
  } catch {
    return dateString
  }
}

// Column definitions
// Order (left→right): Priority · Date Added · Due Date · Kit Serial # ·
// Kit PO Number · Kit Number · Status · Ship Short · Flags.
const columns: ColumnDef<KittingGridRow>[] = [
  {
    id: 'drag',
    header: '',
    cell: () => null, // Handled in SortableRow
    size: 40,
  },
  {
    accessorKey: 'kit_priority',
    header: 'Priority',
    cell: ({ row }) => <PriorityDisplay priority={row.index + 1} />,
  },
  {
    accessorKey: 'kit_added_create_date_time',
    header: 'Date Added',
    cell: ({ row }) => formatDateTime(row.original.kit_added_create_date_time),
  },
  {
    accessorKey: 'due_date',
    header: 'Due Date',
    cell: ({ row }) => formatDate(row.original.due_date),
  },
  {
    accessorKey: 'kit_serial_number',
    header: 'Kit Serial #',
    cell: ({ row }) => (
      <span className='font-mono text-xs text-blue-600 dark:text-blue-400'>
        {row.original.kit_serial_number}
      </span>
    ),
  },
  {
    accessorKey: 'kit_po_number',
    header: 'Kit PO Number',
    cell: ({ row }) => (
      <span className='font-medium'>{row.original.kit_po_number}</span>
    ),
  },
  {
    accessorKey: 'kit_number',
    header: 'Kit Number',
    cell: ({ row }) => (
      <span className='text-muted-foreground'>
        {row.original.kit_number || '—'}
      </span>
    ),
  },
  {
    accessorKey: 'kit_build_status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.kit_stage_status ?? row.original.kit_build_status}
      />
    ),
  },
  {
    accessorKey: 'authorized_ship_short_items',
    header: 'Ship Short',
    cell: ({ row }) => (
      <ShipShortCell items={row.original.authorized_ship_short_items || []} />
    ),
  },
  {
    id: 'unread_messages',
    header: 'Messages',
    cell: ({ row, table }) => {
      const meta = table.options.meta as KittingGridMeta | undefined
      const hasUnread =
        meta?.unreadKitSerials?.has(row.original.kit_serial_number) ?? false
      if (!hasUnread) return <span className='text-muted-foreground'>—</span>
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-400'>
                <MessageSquareDot className='h-3.5 w-3.5' />
                New
              </span>
            </TooltipTrigger>
            <TooltipContent side='top'>
              New message — open the kit to read it
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    },
  },
  {
    accessorKey: 'active_flags',
    header: 'Flags',
    cell: ({ row }) => (
      <FlagBadge
        activeFlags={row.original.active_flags || []}
        legacyFlagType={row.original.kit_flag_type}
        legacySetByName={row.original.kit_flag_set_by_user_name}
      />
    ),
  },
]

// Sortable row component
function SortableRow({
  row,
  onRowClick,
  isDragOverlay = false,
}: {
  row: Row<KittingGridRow>
  onRowClick?: (row: KittingGridRow, displayPriority: number) => void
  isDragOverlay?: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.original.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)',
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 1 : 0,
    position: 'relative' as const,
  }

  // For drag overlay, use different styling
  const overlayStyle: React.CSSProperties = isDragOverlay
    ? {
        boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
        background: 'var(--background)',
        borderRadius: '6px',
      }
    : {}

  const handleRowClick = () => {
    if (!isDragOverlay) {
      onRowClick?.(row.original, row.index + 1)
    }
  }

  return (
    <TableRow
      ref={!isDragOverlay ? setNodeRef : undefined}
      style={{ ...style, ...overlayStyle }}
      onClick={handleRowClick}
      className={cn(
        'hover:bg-muted/50 cursor-pointer transition-colors',
        isDragging && 'bg-muted/30',
        isDragOverlay && 'bg-background border shadow-lg'
      )}
    >
      <TableCell className='w-10 px-2'>
        <button
          {...(isDragOverlay ? {} : { ...attributes, ...listeners })}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'rounded p-1 transition-colors',
            isDragOverlay
              ? 'bg-muted cursor-grabbing'
              : 'hover:bg-muted cursor-grab active:cursor-grabbing'
          )}
        >
          <GripVertical className='text-muted-foreground h-4 w-4' />
        </button>
      </TableCell>
      {row.getVisibleCells().map((cell: Cell<KittingGridRow, unknown>) => {
        if (cell.column.id === 'drag') return null
        return (
          <TableCell key={cell.id}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        )
      })}
    </TableRow>
  )
}

// Read-only row — used when the grid is non-reorderable (e.g. completed kits).
// No drag handle and no useSortable hook, so it renders outside a DndContext.
function StaticRow({
  row,
  onRowClick,
}: {
  row: Row<KittingGridRow>
  onRowClick?: (row: KittingGridRow, displayPriority: number) => void
}) {
  return (
    <TableRow
      onClick={() => onRowClick?.(row.original, row.index + 1)}
      className='hover:bg-muted/50 cursor-pointer transition-colors'
    >
      {row.getVisibleCells().map((cell: Cell<KittingGridRow, unknown>) => {
        if (cell.column.id === 'drag') return null
        return (
          <TableCell key={cell.id}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        )
      })}
    </TableRow>
  )
}

// Static row for drag overlay
function DragOverlayRow({ row }: { row: KittingGridRow; index: number }) {
  return (
    <div className='bg-background flex items-center gap-3 rounded-md border px-2 py-2 shadow-lg'>
      <GripVertical className='text-muted-foreground h-4 w-4' />
      <span className='font-mono text-xs text-blue-600 dark:text-blue-400'>
        {row.kit_serial_number}
      </span>
      <span className='font-medium'>{row.kit_po_number}</span>
      {row.kit_number && (
        <span className='text-muted-foreground text-sm'>
          ({row.kit_number})
        </span>
      )}
      <Badge variant='outline' className='font-mono text-xs'>
        Moving...
      </Badge>
    </div>
  )
}

export function KittingDataGrid({
  data,
  isLoading = false,
  unreadKitSerials,
  onRowReorder,
  onRowClick,
  onPriorityChange,
  reorderable = true,
  emptyMessage = 'No kit build plans found. Click "Add to Kit Build Plan" to create one.',
}: KittingDataGridProps) {
  const [rows, setRows] = React.useState<KittingGridRow[]>(data)
  const [isSaving, setIsSaving] = React.useState(false)
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const pendingUpdateRef = React.useRef(false)

  // Update rows when data changes, but not during drag or pending save
  React.useEffect(() => {
    if (!activeId && !pendingUpdateRef.current) {
      // Only update if the data IDs actually changed (not just a refetch)
      const dataIds = data.map((d) => d.id).join(',')
      const rowIds = rows.map((r) => r.id).join(',')
      if (dataIds !== rowIds || rows.length === 0) {
        setRows(data)
      }
    }
  }, [data, activeId, rows])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    meta: { unreadKitSerials } satisfies KittingGridMeta,
  })

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (over && active.id !== over.id) {
      const oldIndex = rows.findIndex((item) => item.id === active.id)
      const newIndex = rows.findIndex((item) => item.id === over.id)
      const newOrder = arrayMove(rows, oldIndex, newIndex)

      // Update local state immediately for responsive UI
      setRows(newOrder)
      onRowReorder?.(newOrder)

      // Save priority changes to database
      if (onPriorityChange) {
        pendingUpdateRef.current = true
        setIsSaving(true)
        await onPriorityChange(newOrder)
        setIsSaving(false)
        // Small delay before allowing data sync to prevent flash
        setTimeout(() => {
          pendingUpdateRef.current = false
        }, 500)
      }
    }
  }

  const handleDragCancel = () => {
    setActiveId(null)
  }

  const activeRow = activeId ? rows.find((r) => r.id === activeId) : null

  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-12'>
        <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
        <span className='text-muted-foreground ml-2'>
          Loading kitting data...
        </span>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className='border-muted-foreground/30 rounded-md border border-dashed py-12 text-center'>
        <p className='text-muted-foreground'>{emptyMessage}</p>
      </div>
    )
  }

  const gridTable = (
    <div className='border-border min-w-0 rounded-md border'>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              className='bg-muted/50 hover:bg-muted/50'
            >
              {reorderable && <TableHead className='w-10 px-2' />}
              {headerGroup.headers.map((header) => {
                if (header.id === 'drag') return null
                return (
                  <TableHead
                    key={header.id}
                    className='text-foreground font-medium'
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {reorderable ? (
            <SortableContext
              items={rows.map((row) => row.id)}
              strategy={verticalListSortingStrategy}
            >
              {table.getRowModel().rows.map((row) => (
                <SortableRow
                  key={row.original.id}
                  row={row}
                  onRowClick={onRowClick}
                />
              ))}
            </SortableContext>
          ) : (
            table
              .getRowModel()
              .rows.map((row) => (
                <StaticRow
                  key={row.original.id}
                  row={row}
                  onRowClick={onRowClick}
                />
              ))
          )}
        </TableBody>
      </Table>
    </div>
  )

  // Read-only mode (e.g. completed kits) — no DnD context, no priority hints.
  if (!reorderable) {
    return (
      <>
        {gridTable}
        <div className='text-muted-foreground mt-2 text-xs'>
          {rows.length} completed kit{rows.length === 1 ? '' : 's'}
        </div>
      </>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {gridTable}

      {/* Drag overlay for smooth visual feedback */}
      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
        }}
      >
        {activeRow ? (
          <DragOverlayRow
            row={activeRow}
            index={rows.findIndex((r) => r.id === activeRow.id)}
          />
        ) : null}
      </DragOverlay>

      <div className='text-muted-foreground mt-2 flex items-center justify-between text-xs'>
        <span>
          Drag rows to reorder priority • {rows.length} kit build plan
          {rows.length === 1 ? '' : 's'}
        </span>
        {isSaving && (
          <span className='flex items-center gap-1 text-blue-600 dark:text-blue-400'>
            <Loader2 className='h-3 w-3 animate-spin' />
            Saving priorities...
          </span>
        )}
      </div>
    </DndContext>
  )
}

// Created and developed by Jai Singh
