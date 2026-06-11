// Created and developed by Jai Singh
/**
 * SqcdpGoalLinesEditor — UI for the v13 `chartConfig.goal_lines` array.
 *
 * Lives inside the editor dialog's Chart tab, under the "Reference lines"
 * section. Curators add one or more horizontal reference lines (each with
 * its own value, label, color, line style, line width). The list is
 * reordered with `@dnd-kit` (already in bundle — same pattern as
 * `<SqcdpSubMetricsEditor>`). Stack order matters only for stable
 * persistence — visually the lines are independent, so reorder is a
 * convenience.
 *
 * No DB persistence happens here — the editor dialog owns state and
 * writes via `updateMetric({ patch: { chartConfig } })`. This component
 * is a pure controlled value/onChange surface so dirty-tracking inside
 * the react-hook-form parent stays correct.
 */
import { useId, type ChangeEvent } from 'react'
import { IconGripVertical, IconPlus, IconTrash } from '@tabler/icons-react'
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
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { ColorPickerInput } from '@/components/ui/color-picker-input'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { GoalLine, LineStyle, LineWidth } from '../lib/chart-config'

const STYLE_OPTIONS: { id: LineStyle; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'dotted', label: 'Dotted' },
]

const WIDTH_OPTIONS: { id: LineWidth; label: string }[] = [
  { id: 1, label: '1px' },
  { id: 2, label: '2px' },
  { id: 3, label: '3px' },
]

const GOAL_LINE_LABEL_MAX = 60

/**
 * Crypto-safe stable ID. Falls back to a Math.random hex string in jsdom
 * environments that don't expose `crypto.randomUUID()`. Same shape as
 * `freshId` in `SqcdpSubMetricsEditor`.
 */
function freshId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `gl_${Math.random().toString(16).slice(2, 10)}_${Date.now().toString(
    16
  )}`
}

interface GoalLinesEditorProps {
  value: GoalLine[]
  onChange: (next: GoalLine[]) => void
}

export function SqcdpGoalLinesEditor({
  value,
  onChange,
}: GoalLinesEditorProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = value.findIndex((g) => g.id === active.id)
    const newIndex = value.findIndex((g) => g.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onChange(arrayMove(value, oldIndex, newIndex))
  }

  const addRow = (): void => {
    onChange([
      ...value,
      {
        id: freshId(),
        value: 0,
        label: '',
        color_hex: null,
        style: 'dashed',
        width: 1,
      },
    ])
  }

  const updateRow = (id: string, patch: Partial<GoalLine>): void => {
    onChange(value.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  }

  const removeRow = (id: string): void => {
    onChange(value.filter((g) => g.id !== id))
  }

  return (
    <div className='flex flex-col gap-3'>
      {value.length === 0 ? (
        <div className='border-border/60 bg-muted/20 rounded-md border border-dashed p-3 text-center'>
          <p className='text-muted-foreground text-xs'>
            No additional goal lines yet. Add one to layer a custom horizontal
            reference on top of the chart.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={value.map((g) => g.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul
              className='flex flex-col gap-2'
              data-testid='sqcdp-goal-lines-list'
            >
              {value.map((goal) => (
                <SortableGoalLineRow
                  key={goal.id}
                  goal={goal}
                  onUpdate={(patch) => updateRow(goal.id, patch)}
                  onRemove={() => removeRow(goal.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='w-fit gap-1.5'
        onClick={addRow}
      >
        <IconPlus className='h-3.5 w-3.5' aria-hidden />
        Add goal line
      </Button>
    </div>
  )
}

interface SortableRowProps {
  goal: GoalLine
  onUpdate: (patch: Partial<GoalLine>) => void
  onRemove: () => void
}

function SortableGoalLineRow({ goal, onUpdate, onRemove }: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: goal.id })
  const labelInputId = useId()
  const valueInputId = useId()
  const styleSelectId = useId()
  const widthSelectId = useId()

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`sqcdp-goal-line-row-${goal.id}`}
      className={`border-border/60 bg-card relative flex items-center gap-2 rounded-md border p-2 ${
        isDragging ? 'ring-ring/40 z-10 shadow-md ring-2' : ''
      }`}
    >
      <button
        type='button'
        aria-label='Drag to reorder'
        className='text-muted-foreground hover:text-foreground flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded'
        {...attributes}
        {...listeners}
      >
        <IconGripVertical className='h-4 w-4' aria-hidden />
      </button>

      <div className='grid flex-1 grid-cols-1 gap-2 md:grid-cols-[1.5fr_0.8fr_1fr_1fr_0.8fr]'>
        <div className='flex flex-col gap-1'>
          <label
            htmlFor={labelInputId}
            className='text-muted-foreground text-[10px] font-medium tracking-wide uppercase'
          >
            Label
          </label>
          <Input
            id={labelInputId}
            placeholder='Stretch goal'
            value={goal.label ?? ''}
            maxLength={GOAL_LINE_LABEL_MAX}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onUpdate({ label: e.target.value || null })
            }
            className='h-8'
          />
        </div>

        <div className='flex flex-col gap-1'>
          <label
            htmlFor={valueInputId}
            className='text-muted-foreground text-[10px] font-medium tracking-wide uppercase'
          >
            Value
          </label>
          <Input
            id={valueInputId}
            type='number'
            inputMode='decimal'
            step='any'
            placeholder='0'
            value={Number.isFinite(goal.value) ? String(goal.value) : ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const raw = e.target.value
              if (raw.trim() === '') {
                onUpdate({ value: 0 })
                return
              }
              const numeric = Number(raw)
              onUpdate({ value: Number.isFinite(numeric) ? numeric : 0 })
            }}
            className='h-8 tabular-nums'
          />
        </div>

        <div className='flex flex-col gap-1'>
          <span className='text-muted-foreground text-[10px] font-medium tracking-wide uppercase'>
            Color
          </span>
          <ColorPickerInput
            value={goal.color_hex ?? ''}
            onChange={(next) => onUpdate({ color_hex: next || null })}
          />
        </div>

        <div className='flex flex-col gap-1'>
          <label
            htmlFor={styleSelectId}
            className='text-muted-foreground text-[10px] font-medium tracking-wide uppercase'
          >
            Style
          </label>
          <Select
            value={goal.style ?? 'dashed'}
            onValueChange={(v) => onUpdate({ style: v as LineStyle })}
          >
            <SelectTrigger id={styleSelectId} className='h-8'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STYLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='flex flex-col gap-1'>
          <label
            htmlFor={widthSelectId}
            className='text-muted-foreground text-[10px] font-medium tracking-wide uppercase'
          >
            Width
          </label>
          <Select
            value={String(goal.width ?? 1)}
            onValueChange={(v) => onUpdate({ width: Number(v) as LineWidth })}
          >
            <SelectTrigger id={widthSelectId} className='h-8'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WIDTH_OPTIONS.map((opt) => (
                <SelectItem key={opt.id} value={String(opt.id)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        type='button'
        size='icon'
        variant='ghost'
        className='text-destructive hover:text-destructive h-8 w-8 shrink-0'
        aria-label={`Remove goal line ${goal.label || `value ${goal.value}`}`}
        onClick={onRemove}
      >
        <IconTrash className='h-4 w-4' aria-hidden />
      </Button>
    </li>
  )
}

// Created and developed by Jai Singh
