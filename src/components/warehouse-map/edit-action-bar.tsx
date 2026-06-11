// Created and developed by Jai Singh
/**
 * EditActionBar — contextual secondary toolbar that appears below the main
 * MapToolbar whenever the user is in an edit mode. Renders mode-specific
 * actions (Add / Delete / Rotate / Duplicate / Auto-connect, etc.) so the
 * user has explicit, labeled CTAs instead of having to discover them via
 * right-click or keyboard shortcuts.
 *
 * The bar is rendered as a sticky strip above the canvas so the canvas does
 * not jump when modes change.
 */
import { useMemo } from 'react'
import {
  Plus,
  Trash2,
  RotateCw,
  Copy,
  Wand2,
  Undo2,
  Redo2,
  Eye,
  Layers,
  Box,
  Cable,
  Building2,
  Square,
  GitFork,
  HelpCircle,
  X,
  Sparkles,
} from 'lucide-react'
import { useWarehouseMapStore } from '@/stores/warehouse-map-store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { EditMode } from './types'

interface EditActionBarProps {
  selectedRackId: string | null
  selectedZoneId: string | null
  selectedAisleNodeId: string | null
  hasUndo: boolean
  hasRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onAddRack: () => void
  onDeleteRack: (id: string) => void
  onRotateRack: (id: string, deltaDegrees: number) => void
  onDuplicateRack: (id: string) => void
  onDeleteZone: (id: string) => void
  onAutoConnectAisles: () => void
  onSeedAisleNodes: () => void
  onBackfillAnchors: () => void
  onClearAisleGraph: () => void
  onShowHelp: () => void
}

const MODE_META: Record<
  EditMode,
  { label: string; icon: typeof Eye; color: string }
> = {
  view: { label: 'View', icon: Eye, color: 'text-muted-foreground' },
  'edit-building': {
    label: 'Building outline',
    icon: Building2,
    color: 'text-amber-400',
  },
  'edit-zones': {
    label: 'Zones',
    icon: Square,
    color: 'text-blue-400',
  },
  'edit-racks': {
    label: 'Racks',
    icon: Box,
    color: 'text-emerald-400',
  },
  'edit-aisles': {
    label: 'Aisles',
    icon: GitFork,
    color: 'text-purple-400',
  },
  // 3D scene editor mode — driven from the 3D HUD, not this legacy 2D bar;
  // present here for EditMode record completeness.
  'edit-objects': {
    label: '3D Layout',
    icon: Box,
    color: 'text-cyan-400',
  },
}

export function EditActionBar({
  selectedRackId,
  selectedZoneId,
  selectedAisleNodeId: _selectedAisleNodeId,
  hasUndo,
  hasRedo,
  onUndo,
  onRedo,
  onAddRack,
  onDeleteRack,
  onRotateRack,
  onDuplicateRack,
  onDeleteZone,
  onAutoConnectAisles,
  onSeedAisleNodes,
  onBackfillAnchors,
  onClearAisleGraph,
  onShowHelp,
}: EditActionBarProps) {
  const editMode = useWarehouseMapStore((s) => s.editMode)
  const setEditMode = useWarehouseMapStore((s) => s.setEditMode)

  const meta = MODE_META[editMode]
  const ModeIcon = meta.icon

  // Don't render in view mode
  if (editMode === 'view') return null

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className='bg-card/95 flex flex-wrap items-center gap-1 rounded-lg border-2 px-3 py-2 shadow-md backdrop-blur-sm'
        style={{
          borderColor:
            editMode === 'edit-building'
              ? 'rgba(245,158,11,0.45)'
              : editMode === 'edit-zones'
                ? 'rgba(59,130,246,0.45)'
                : editMode === 'edit-racks'
                  ? 'rgba(16,185,129,0.45)'
                  : 'rgba(168,85,247,0.45)',
        }}
        role='toolbar'
        aria-label={`${meta.label} edit toolbar`}
      >
        {/* Mode badge */}
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium',
            meta.color
          )}
        >
          <ModeIcon className='h-4 w-4' />
          <span>{meta.label}</span>
        </div>

        <div className='bg-border mx-1 h-6 w-px' />

        {/* Undo / Redo (always visible in edit mode) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={onUndo}
              disabled={!hasUndo}
              aria-label='Undo'
            >
              <Undo2 className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo (⌘Z)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={onRedo}
              disabled={!hasRedo}
              aria-label='Redo'
            >
              <Redo2 className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo (⌘⇧Z)</TooltipContent>
        </Tooltip>

        <div className='bg-border mx-1 h-6 w-px' />

        {/* Mode-specific actions */}
        {editMode === 'edit-building' && <BuildingActions />}

        {editMode === 'edit-zones' && (
          <ZoneActions
            selectedZoneId={selectedZoneId}
            onDeleteZone={onDeleteZone}
          />
        )}

        {editMode === 'edit-racks' && (
          <RackActions
            selectedRackId={selectedRackId}
            onAddRack={onAddRack}
            onDeleteRack={onDeleteRack}
            onRotateRack={onRotateRack}
            onDuplicateRack={onDuplicateRack}
          />
        )}

        {editMode === 'edit-aisles' && (
          <AisleActions
            onAutoConnect={onAutoConnectAisles}
            onSeed={onSeedAisleNodes}
            onBackfill={onBackfillAnchors}
            onClear={onClearAisleGraph}
          />
        )}

        <div className='ml-auto flex items-center gap-1'>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                onClick={onShowHelp}
                aria-label='Help'
              >
                <HelpCircle className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Keyboard shortcuts</TooltipContent>
          </Tooltip>

          <Button
            variant='outline'
            size='sm'
            onClick={() => setEditMode('view')}
          >
            <X className='mr-1 h-3 w-3' />
            Done
          </Button>
        </div>
      </div>
    </TooltipProvider>
  )
}

// ---------------------------------------------------------------------------
// Mode-specific actions
// ---------------------------------------------------------------------------

function BuildingActions() {
  return (
    <div className='text-xs text-amber-300 italic'>
      Click on the canvas to add corners. Click the first corner (or
      double-click) to close. Esc to cancel · Enter to commit.
    </div>
  )
}

function ZoneActions({
  selectedZoneId,
  onDeleteZone,
}: {
  selectedZoneId: string | null
  onDeleteZone: (id: string) => void
}) {
  return (
    <div className='flex items-center gap-1'>
      <span className='mr-2 text-xs text-blue-300 italic'>
        Click to add zone corners · Esc to cancel · Enter to commit
      </span>
      {selectedZoneId && (
        <>
          <div className='bg-border mx-1 h-6 w-px' />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='outline'
                size='sm'
                className='text-destructive border-destructive/40 hover:bg-destructive/10'
                onClick={() => onDeleteZone(selectedZoneId)}
              >
                <Trash2 className='mr-1 h-3.5 w-3.5' />
                Delete zone
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete the selected zone</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  )
}

function Tooltip2(_: { children: React.ReactNode }) {
  return null
}
void Tooltip2

function RackActions({
  selectedRackId,
  onAddRack,
  onDeleteRack,
  onRotateRack,
  onDuplicateRack,
}: {
  selectedRackId: string | null
  onAddRack: () => void
  onDeleteRack: (id: string) => void
  onRotateRack: (id: string, deltaDegrees: number) => void
  onDuplicateRack: (id: string) => void
}) {
  return (
    <div className='flex items-center gap-1'>
      <Button variant='default' size='sm' onClick={onAddRack}>
        <Plus className='mr-1 h-3.5 w-3.5' />
        Add rack
      </Button>

      {selectedRackId && (
        <>
          <div className='bg-border mx-1 h-6 w-px' />
          <span className='text-muted-foreground mx-1 text-xs'>Selected:</span>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='outline'
                size='sm'
                onClick={() => onDuplicateRack(selectedRackId)}
              >
                <Copy className='mr-1 h-3.5 w-3.5' />
                Duplicate
              </Button>
            </TooltipTrigger>
            <TooltipContent>Duplicate rack (⌘D)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='outline'
                size='sm'
                onClick={() => onRotateRack(selectedRackId, 90)}
              >
                <RotateCw className='mr-1 h-3.5 w-3.5' />
                Rotate
              </Button>
            </TooltipTrigger>
            <TooltipContent>Rotate 90° clockwise (R)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='outline'
                size='sm'
                className='text-destructive border-destructive/40 hover:bg-destructive/10'
                onClick={() => onDeleteRack(selectedRackId)}
              >
                <Trash2 className='mr-1 h-3.5 w-3.5' />
                Delete
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete rack (⌫)</TooltipContent>
          </Tooltip>
        </>
      )}

      {!selectedRackId && (
        <span className='text-muted-foreground ml-2 text-xs italic'>
          Click a rack to edit · drag to move · or click "Add rack"
        </span>
      )}
    </div>
  )
}

function AisleActions({
  onAutoConnect,
  onSeed,
  onBackfill,
  onClear,
}: {
  onAutoConnect: () => void
  onSeed: () => void
  onBackfill: () => void
  onClear: () => void
}) {
  return (
    <div className='flex flex-wrap items-center gap-1'>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant='outline' size='sm' onClick={onSeed}>
            <Sparkles className='mr-1 h-3.5 w-3.5' />
            Seed from racks
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Auto-place a node at each rack end as a starting graph
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant='outline' size='sm' onClick={onAutoConnect}>
            <Cable className='mr-1 h-3.5 w-3.5' />
            Auto-connect (k=4)
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Connect each node to its 4 nearest neighbours
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant='outline' size='sm' onClick={onBackfill}>
            <Wand2 className='mr-1 h-3.5 w-3.5' />
            Anchor bins
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Snap every storage bin to its nearest aisle node
        </TooltipContent>
      </Tooltip>

      <div className='bg-border mx-1 h-6 w-px' />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='outline'
            size='sm'
            className='text-destructive border-destructive/40 hover:bg-destructive/10'
            onClick={onClear}
          >
            <Trash2 className='mr-1 h-3.5 w-3.5' />
            Clear all
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete all aisle nodes &amp; edges</TooltipContent>
      </Tooltip>

      <span className='text-muted-foreground ml-2 text-xs italic'>
        Click empty space to add a node · click two nodes to connect
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mode segmented control (used by the toolbar above the action bar)
// ---------------------------------------------------------------------------

const MODES: EditMode[] = [
  'view',
  'edit-building',
  'edit-zones',
  'edit-racks',
  'edit-aisles',
]

interface ModeSegmentedProps {
  readOnly?: boolean
}

export function ModeSegmented({ readOnly }: ModeSegmentedProps) {
  const editMode = useWarehouseMapStore((s) => s.editMode)
  const setEditMode = useWarehouseMapStore((s) => s.setEditMode)

  const visible = useMemo(
    () => (readOnly ? (['view'] as EditMode[]) : MODES),
    [readOnly]
  )

  return (
    <div
      role='tablist'
      aria-label='Edit mode'
      className='bg-muted/40 inline-flex items-center rounded-md p-0.5'
    >
      {visible.map((m) => {
        const meta = MODE_META[m]
        const Icon = meta.icon
        const active = editMode === m
        return (
          <button
            key={m}
            role='tab'
            type='button'
            aria-selected={active}
            onClick={() => setEditMode(m)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className='h-3.5 w-3.5' />
            <span className='hidden md:inline'>
              {m === 'view'
                ? 'View'
                : m === 'edit-building'
                  ? 'Building'
                  : m === 'edit-zones'
                    ? 'Zones'
                    : m === 'edit-racks'
                      ? 'Racks'
                      : 'Aisles'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// re-export icon if needed elsewhere
export { Layers as LayersIcon }

// Created and developed by Jai Singh
