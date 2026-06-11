// Created and developed by Jai Singh
/**
 * SqcdpSubMetricsEditor — UI for the v12 stacked sub-metrics array.
 *
 * Lives inside the editor dialog's Advanced tab. When the curator adds at
 * least one sub-metric, the rendered card swaps from the legacy single
 * big-number layout to the stacked layout (each sub-metric block carries
 * its own title / value / subtitle).
 *
 * The list is reordered with `@dnd-kit` (already in the bundle — see
 * `package.json`'s `@dnd-kit/{core,sortable,modifiers,utilities}`). Stack
 * order matters: index 0 is the top block on the rendered card.
 *
 * No DB persistence happens here — the editor dialog owns state and writes
 * to `style_config` / `sub_metrics` via `updateMetric`. This component is
 * a pure controlled value/onChange surface so dirty-tracking inside the
 * react-hook-form parent stays correct.
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
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SubMetric } from '../hooks/use-sqcdp-metrics'
import type { ValueFormat } from '../lib/format'

const VALUE_FORMATS: { id: ValueFormat; label: string }[] = [
  { id: 'number', label: 'Number' },
  { id: 'percent', label: 'Percent' },
  { id: 'currency', label: 'Currency' },
  { id: 'duration', label: 'Duration (min)' },
  { id: 'text', label: 'Text' },
]

const SUB_METRIC_TITLE_MAX = 60

/**
 * Crypto-safe stable ID. Falls back to a Math.random hex string in jsdom
 * environments that don't expose `crypto.randomUUID()` even though the
 * project polyfills crypto in `src/test-setup.ts`.
 */
function freshId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `sm_${Math.random().toString(16).slice(2, 10)}_${Date.now().toString(
    16
  )}`
}

interface SubMetricsEditorProps {
  value: SubMetric[]
  onChange: (next: SubMetric[]) => void
}

export function SqcdpSubMetricsEditor({
  value,
  onChange,
}: SubMetricsEditorProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = value.findIndex((s) => s.id === active.id)
    const newIndex = value.findIndex((s) => s.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onChange(arrayMove(value, oldIndex, newIndex))
  }

  const addRow = (): void => {
    onChange([
      ...value,
      {
        id: freshId(),
        title: '',
        value: null,
        value_format: 'number',
        subtitle: null,
        unit: null,
        decimal_places: null,
      },
    ])
  }

  const updateRow = (id: string, patch: Partial<SubMetric>): void => {
    onChange(value.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  const removeRow = (id: string): void => {
    onChange(value.filter((s) => s.id !== id))
  }

  if (value.length === 0) {
    return (
      <div className='flex flex-col gap-3'>
        <div className='border-border/60 bg-muted/15 flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-5 text-center'>
          <p className='text-foreground text-sm font-semibold'>
            No sub-metrics yet
          </p>
          <p className='text-muted-foreground max-w-md text-xs'>
            Stacked sub-metrics let one card show multiple paired values
            (e.g.&nbsp;Maintenance with Open Work Orders + Machine Down). Add at
            least one to switch the card from the single-value layout to the
            stacked layout.
          </p>
          <Button
            type='button'
            variant='default'
            size='sm'
            className='mt-2 gap-1.5'
            onClick={addRow}
          >
            <IconPlus className='h-3.5 w-3.5' aria-hidden />
            Add first sub-metric
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={value.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul
            className='flex flex-col gap-2'
            data-testid='sqcdp-sub-metrics-list'
          >
            {value.map((sub) => (
              <SortableSubMetricRow
                key={sub.id}
                sub={sub}
                onUpdate={(patch) => updateRow(sub.id, patch)}
                onRemove={() => removeRow(sub.id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='w-fit gap-1.5'
        onClick={addRow}
      >
        <IconPlus className='h-3.5 w-3.5' aria-hidden />
        Add sub-metric
      </Button>
    </div>
  )
}

interface SortableRowProps {
  sub: SubMetric
  onUpdate: (patch: Partial<SubMetric>) => void
  onRemove: () => void
}

function SortableSubMetricRow({ sub, onUpdate, onRemove }: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sub.id })
  const titleInputId = useId()
  const valueInputId = useId()
  const formatSelectId = useId()
  const subtitleInputId = useId()

  const isInvalid =
    sub.title.length === 0 || sub.title.length > SUB_METRIC_TITLE_MAX

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`sqcdp-sub-metric-row-${sub.id}`}
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

      <div className='grid flex-1 grid-cols-1 gap-2 md:grid-cols-[1.6fr_1fr_1fr_1.6fr]'>
        <div className='flex flex-col gap-1'>
          <label
            htmlFor={titleInputId}
            className='text-muted-foreground text-[10px] font-medium tracking-wide uppercase'
          >
            Title
          </label>
          <Input
            id={titleInputId}
            placeholder='Open Work Orders'
            value={sub.title}
            maxLength={SUB_METRIC_TITLE_MAX}
            aria-invalid={isInvalid}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onUpdate({ title: e.target.value })
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
            value={sub.value === null ? '' : String(sub.value)}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const raw = e.target.value
              if (raw.trim() === '') {
                onUpdate({ value: null })
                return
              }
              const numeric = Number(raw)
              onUpdate({ value: Number.isFinite(numeric) ? numeric : null })
            }}
            className='h-8 tabular-nums'
          />
        </div>

        <div className='flex flex-col gap-1'>
          <label
            htmlFor={formatSelectId}
            className='text-muted-foreground text-[10px] font-medium tracking-wide uppercase'
          >
            Format
          </label>
          <Select
            value={sub.value_format}
            onValueChange={(v) => onUpdate({ value_format: v as ValueFormat })}
          >
            <SelectTrigger id={formatSelectId} className='h-8'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VALUE_FORMATS.map((fmt) => (
                <SelectItem key={fmt.id} value={fmt.id}>
                  {fmt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='flex flex-col gap-1'>
          <label
            htmlFor={subtitleInputId}
            className='text-muted-foreground text-[10px] font-medium tracking-wide uppercase'
          >
            Subtitle
          </label>
          <Input
            id={subtitleInputId}
            placeholder='This Month'
            value={sub.subtitle ?? ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onUpdate({ subtitle: e.target.value || null })
            }
            className='h-8'
          />
        </div>
      </div>

      <Button
        type='button'
        size='icon'
        variant='ghost'
        className='text-destructive hover:text-destructive h-8 w-8 shrink-0'
        aria-label={`Remove sub-metric ${sub.title || '(untitled)'}`}
        onClick={onRemove}
      >
        <IconTrash className='h-4 w-4' aria-hidden />
      </Button>
    </li>
  )
}

// Created and developed by Jai Singh
