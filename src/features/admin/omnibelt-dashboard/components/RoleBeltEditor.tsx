// Created and developed by Jai Singh
/**
 * RoleBeltEditor — per-role default belt editor.
 *
 * Lets an admin curate the default tool set, pinned subset, anchor
 * position, and skin for a single role. Drag-drop reorders the
 * tool list (`@dnd-kit/sortable`). Pinned vs unpinned is a checkbox
 * on each row.
 *
 * Save flow:
 *   1. Build the canonical `RoleConfigMutationInput` payload from
 *      local state.
 *   2. Fire `useUpdateRoleConfig.mutate`. The hook writes via
 *      FastAPI (`POST /api/admin/omnibelt/role-config`) so the
 *      Postgres trigger fans the change out via
 *      `OmnibeltConfigChanged` to every connected client in the org.
 *   3. Cancel reverts to the last saved state.
 *
 * The mini preview at the bottom shows a stub of the icon row in
 * the chosen anchor — enough to communicate the layout intent
 * without lifting the full skin renderer into the admin chunk.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  IconCheck,
  IconGripVertical,
  IconPin,
  IconPinnedOff,
  IconRefresh,
} from '@tabler/icons-react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { OmnibeltRoleConfig } from '@/lib/supabase/database.types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TOOL_REGISTRY, type ToolDef } from '@/features/omnibelt/tools/registry'
import { useUpdateRoleConfig } from '../hooks/useUpdateRoleConfig'

export type AnchorOption =
  | 'TL'
  | 'TC'
  | 'TR'
  | 'ML'
  | 'MR'
  | 'BL'
  | 'BC'
  | 'BR'
  | 'NUB_L'
  | 'NUB_R'
  | 'NUB_T'
  | 'NUB_B'

export type SkinOption = 'pill' | 'orb' | 'skystrip'

const ANCHOR_OPTIONS: ReadonlyArray<{ id: AnchorOption; label: string }> = [
  { id: 'TL', label: 'Top Left' },
  { id: 'TC', label: 'Top Center' },
  { id: 'TR', label: 'Top Right' },
  { id: 'ML', label: 'Middle Left' },
  { id: 'MR', label: 'Middle Right' },
  { id: 'BL', label: 'Bottom Left' },
  { id: 'BC', label: 'Bottom Center' },
  { id: 'BR', label: 'Bottom Right' },
  { id: 'NUB_L', label: 'Nub — Left edge' },
  { id: 'NUB_R', label: 'Nub — Right edge' },
  { id: 'NUB_T', label: 'Nub — Top edge' },
  { id: 'NUB_B', label: 'Nub — Bottom edge' },
]

const SKIN_OPTIONS: ReadonlyArray<{ id: SkinOption; label: string }> = [
  { id: 'pill', label: 'Pill' },
  { id: 'orb', label: 'Orb' },
  { id: 'skystrip', label: 'Sky Strip' },
]

interface RoleBeltEditorProps {
  /** Role row (id + display name) sourced from the bootstrap query. */
  role: { id: string; name: string; display_name: string }
  /** Existing role-config row, or `null` if this role has no defaults yet. */
  config: OmnibeltRoleConfig | null
  /** Current org allow-list (null = no restriction). */
  allowList: string[] | null
}

interface DraftState {
  toolIds: string[]
  pinnedIds: Set<string>
  anchor: AnchorOption
  skin: SkinOption
}

function buildDraft(
  config: OmnibeltRoleConfig | null,
  allowList: string[] | null
): DraftState {
  const allow = allowList === null ? null : new Set(allowList)
  const registryIds = TOOL_REGISTRY.map((t) => t.id).filter(
    (id) => allow === null || allow.has(id)
  )

  const configIds = config?.default_tool_ids ?? registryIds
  // Keep only ids that still exist in the registry and (when constrained)
  // sit inside the org allow-list. Preserves the curated order.
  const validIds = configIds.filter(
    (id) =>
      TOOL_REGISTRY.some((t) => t.id === id) &&
      (allow === null || allow.has(id))
  )

  const pinned = new Set(
    (config?.default_pinned_ids ?? []).filter((id) => validIds.includes(id))
  )

  const position = (config?.default_position as {
    anchor?: AnchorOption
  } | null) ?? { anchor: 'BR' }
  const anchor = position.anchor ?? 'BR'

  const skin = (config?.default_skin as SkinOption | undefined) ?? 'pill'

  return {
    toolIds: validIds,
    pinnedIds: pinned,
    anchor,
    skin,
  }
}

function draftEquals(a: DraftState, b: DraftState): boolean {
  if (a.anchor !== b.anchor || a.skin !== b.skin) return false
  if (a.toolIds.length !== b.toolIds.length) return false
  for (let i = 0; i < a.toolIds.length; i += 1) {
    if (a.toolIds[i] !== b.toolIds[i]) return false
  }
  if (a.pinnedIds.size !== b.pinnedIds.size) return false
  for (const id of a.pinnedIds) if (!b.pinnedIds.has(id)) return false
  return true
}

export function RoleBeltEditor({
  role,
  config,
  allowList,
}: RoleBeltEditorProps) {
  const initial = useMemo(
    () => buildDraft(config, allowList),
    [config, allowList]
  )
  const [draft, setDraft] = useState<DraftState>(initial)
  // Reset whenever the role being edited changes or the upstream
  // config/allow-list refreshes.
  useEffect(() => {
    setDraft(initial)
  }, [initial])

  const { mutate, isPending, error } = useUpdateRoleConfig()

  const dirty = !draftEquals(draft, initial)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const toolMap = useMemo(() => {
    const m = new Map<string, ToolDef>()
    for (const tool of TOOL_REGISTRY) m.set(tool.id, tool)
    return m
  }, [])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setDraft((prev) => {
      const oldIndex = prev.toolIds.indexOf(active.id as string)
      const newIndex = prev.toolIds.indexOf(over.id as string)
      if (oldIndex === -1 || newIndex === -1) return prev
      return { ...prev, toolIds: arrayMove(prev.toolIds, oldIndex, newIndex) }
    })
  }

  const togglePinned = (id: string) => {
    setDraft((prev) => {
      const next = new Set(prev.pinnedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...prev, pinnedIds: next }
    })
  }

  const handleSave = () => {
    mutate({
      role_id: role.id,
      default_tool_ids: draft.toolIds,
      default_pinned_ids: Array.from(draft.pinnedIds),
      default_position: { anchor: draft.anchor, offset: { x: 0, y: 0 } },
      default_skin: draft.skin,
    })
  }

  const handleReset = () => setDraft(initial)

  return (
    <Card>
      <CardHeader className='gap-1 pb-3'>
        <CardTitle className='flex items-center justify-between text-base'>
          <span className='flex flex-col gap-0.5'>
            <span>
              <span className='text-primary'>{role.display_name}</span>
            </span>
            <span className='text-muted-foreground text-xs font-normal'>
              {role.name}
            </span>
          </span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={handleReset}
              disabled={!dirty || isPending}
            >
              <IconRefresh className='mr-2 h-4 w-4' aria-hidden /> Cancel
            </Button>
            <Button
              size='sm'
              onClick={handleSave}
              disabled={!dirty || isPending}
            >
              <IconCheck className='mr-2 h-4 w-4' aria-hidden />
              {isPending ? 'Saving…' : 'Save belt'}
            </Button>
          </div>
        </CardTitle>
        <p className='text-muted-foreground text-sm'>
          Reorder tools with drag, toggle pinned-state, then choose the default
          anchor and skin. Save broadcasts the change to every user in this role
          within ~1 second.
        </p>
      </CardHeader>
      <CardContent className='space-y-5'>
        {error && (
          <p className='text-destructive text-sm'>
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}

        <div className='grid gap-4 lg:grid-cols-2'>
          <div className='space-y-2'>
            <label className='text-sm font-medium'>Default anchor</label>
            <Select
              value={draft.anchor}
              onValueChange={(v) =>
                setDraft((prev) => ({ ...prev, anchor: v as AnchorOption }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANCHOR_OPTIONS.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-2'>
            <label className='text-sm font-medium'>Default skin</label>
            <Select
              value={draft.skin}
              onValueChange={(v) =>
                setDraft((prev) => ({ ...prev, skin: v as SkinOption }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SKIN_OPTIONS.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <label className='text-sm font-medium'>
              Tool order + pinned set
            </label>
            <Badge variant='outline' className='text-[10px]'>
              {draft.toolIds.length} tools · {draft.pinnedIds.size} pinned
            </Badge>
          </div>
          {draft.toolIds.length === 0 ? (
            <p className='text-muted-foreground rounded border border-dashed p-3 text-sm'>
              No tools available — every registry tool is excluded by the
              current allow-list.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={draft.toolIds}
                strategy={verticalListSortingStrategy}
              >
                <ul
                  className='flex flex-col gap-1.5'
                  data-testid='role-belt-tool-list'
                >
                  {draft.toolIds.map((id) => {
                    const tool = toolMap.get(id)
                    if (!tool) return null
                    return (
                      <SortableToolRow
                        key={id}
                        tool={tool}
                        pinned={draft.pinnedIds.has(id)}
                        onTogglePinned={() => togglePinned(id)}
                      />
                    )
                  })}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <BeltPreview
          anchor={draft.anchor}
          skin={draft.skin}
          pinnedIds={Array.from(draft.pinnedIds).slice(0, 6)}
          toolMap={toolMap}
        />
      </CardContent>
    </Card>
  )
}

interface SortableToolRowProps {
  tool: ToolDef
  pinned: boolean
  onTogglePinned: () => void
}

function SortableToolRow({
  tool,
  pinned,
  onTogglePinned,
}: SortableToolRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tool.id })
  const Icon = tool.icon

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`bg-card flex items-center gap-3 rounded-md border px-2 py-1.5 text-sm ${
        isDragging ? 'ring-ring/40 z-10 shadow-md ring-2' : ''
      }`}
      data-testid={`role-belt-tool-${tool.id}`}
    >
      <button
        type='button'
        aria-label='Drag to reorder'
        className='text-muted-foreground hover:text-foreground flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded'
        {...attributes}
        {...listeners}
      >
        <IconGripVertical size={16} aria-hidden />
      </button>
      <Icon className='h-4 w-4 shrink-0' aria-hidden />
      <div className='flex flex-1 flex-col leading-tight'>
        <span className='font-medium'>{tool.label}</span>
        <span className='text-muted-foreground text-[11px]'>
          {tool.description ?? tool.id}
        </span>
      </div>
      <label className='flex cursor-pointer items-center gap-1 text-xs'>
        <Checkbox
          checked={pinned}
          onCheckedChange={onTogglePinned}
          aria-label={pinned ? 'Unpin tool' : 'Pin tool'}
        />
        {pinned ? (
          <IconPin size={14} aria-hidden className='text-primary' />
        ) : (
          <IconPinnedOff
            size={14}
            aria-hidden
            className='text-muted-foreground'
          />
        )}
      </label>
    </li>
  )
}

interface BeltPreviewProps {
  anchor: AnchorOption
  skin: SkinOption
  pinnedIds: string[]
  toolMap: Map<string, ToolDef>
}

function BeltPreview({ anchor, skin, pinnedIds, toolMap }: BeltPreviewProps) {
  const pinnedTools = pinnedIds
    .map((id) => toolMap.get(id))
    .filter((t): t is ToolDef => Boolean(t))

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between'>
        <p className='text-sm font-medium'>Preview</p>
        <p className='text-muted-foreground text-xs'>
          Anchor <code>{anchor}</code> · Skin <code>{skin}</code>
        </p>
      </div>
      <div
        className={`bg-muted/30 relative h-32 overflow-hidden rounded-md border ${anchorPositionClass(anchor)}`}
      >
        <div className='bg-background ring-border ring-offset-background absolute flex items-center gap-1 rounded-full px-2 py-1 shadow-md ring-1'>
          {pinnedTools.length === 0 ? (
            <span className='text-muted-foreground px-2 text-xs'>
              No pinned tools yet
            </span>
          ) : (
            pinnedTools.map((tool) => {
              const Icon = tool.icon
              return (
                <span
                  key={tool.id}
                  className='bg-primary/10 text-primary flex h-7 w-7 items-center justify-center rounded-full'
                  title={tool.label}
                >
                  <Icon className='h-4 w-4' aria-hidden />
                </span>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function anchorPositionClass(anchor: AnchorOption): string {
  // Tailwind: place the inner pill via flex+padding rather than absolute
  // positioning so the icons stay centered inside the anchor region.
  switch (anchor) {
    case 'TL':
      return 'flex items-start justify-start p-2'
    case 'TC':
      return 'flex items-start justify-center p-2'
    case 'TR':
      return 'flex items-start justify-end p-2'
    case 'ML':
      return 'flex items-center justify-start p-2'
    case 'MR':
      return 'flex items-center justify-end p-2'
    case 'BL':
      return 'flex items-end justify-start p-2'
    case 'BC':
      return 'flex items-end justify-center p-2'
    case 'BR':
      return 'flex items-end justify-end p-2'
    case 'NUB_L':
      return 'flex items-center justify-start p-1'
    case 'NUB_R':
      return 'flex items-center justify-end p-1'
    case 'NUB_T':
      return 'flex items-start justify-center p-1'
    case 'NUB_B':
      return 'flex items-end justify-center p-1'
    default:
      return 'flex items-end justify-end p-2'
  }
}

// Created and developed by Jai Singh
