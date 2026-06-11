// Created and developed by Jai Singh
/**
 * Sortable Item
 *
 * Draggable row rendered inside the canvas. The drag handle is a real
 * `<button>` with an aria-label so screen reader users get a clear name;
 * keyboard users can also use it (sortable already wires keyboard sensors).
 *
 * Secondary actions (duplicate, delete) live in a hover-revealed kebab menu
 * so the row stays visually calm in the default state but power users can
 * still act on items quickly.
 */
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Asterisk,
  Calendar,
  Camera,
  Check,
  Clock,
  Copy,
  EyeOff,
  GripVertical,
  Hash,
  List,
  ListChecks,
  MoreHorizontal,
  PenTool,
  Trash2,
  Type,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StandardWorkItem } from '@/hooks/use-standard-work'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ITEM_TYPE_CONFIG } from './types'

const iconMap = {
  Check,
  Type,
  Hash,
  List,
  ListChecks,
  Calendar,
  Clock,
  Camera,
  PenTool,
}

interface SortableItemProps {
  item: StandardWorkItem
  isSelected: boolean
  onClick: () => void
  onDelete: () => void
  onDuplicate?: () => void
  /** When true the row hides the drag handle and action buttons (preview). */
  readOnly?: boolean
}

export function SortableItem({
  item,
  isSelected,
  onClick,
  onDelete,
  onDuplicate,
  readOnly = false,
}: SortableItemProps) {
  const config =
    ITEM_TYPE_CONFIG[item.item_type as keyof typeof ITEM_TYPE_CONFIG]
  const Icon = iconMap[config?.icon as keyof typeof iconMap] || Check
  const hasConditional = !!item.conditional_display?.depends_on

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: {
      type: 'canvas-item',
      item,
    },
    disabled: readOnly,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group bg-background flex items-center gap-3 rounded-lg border p-3 transition-all',
        isSelected && 'ring-primary border-primary ring-2',
        isDragging && 'opacity-50 shadow-lg',
        !isDragging && !readOnly && 'hover:border-primary/50',
        readOnly && 'cursor-default'
      )}
      onClick={readOnly ? undefined : onClick}
    >
      {!readOnly && (
        <button
          type='button'
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder: ${item.item_title}`}
          className='hover:bg-muted -ml-1 cursor-grab touch-none rounded p-1 focus-visible:outline-2 focus-visible:outline-offset-2 active:cursor-grabbing'
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical
            className='text-muted-foreground h-4 w-4'
            aria-hidden='true'
          />
        </button>
      )}

      <div className='bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-md'>
        <Icon className='text-muted-foreground h-4 w-4' aria-hidden='true' />
      </div>

      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span
            className={cn(
              'truncate text-sm font-medium',
              !item.item_title.trim() && 'text-muted-foreground italic'
            )}
          >
            {item.item_title.trim() || '(untitled item)'}
          </span>
          {item.is_required && (
            <Asterisk
              className='text-destructive h-3 w-3 shrink-0'
              aria-label='Required'
            />
          )}
          {hasConditional && (
            <EyeOff
              className='text-muted-foreground/70 h-3 w-3 shrink-0'
              aria-label='Has conditional display rule'
            />
          )}
        </div>
        {item.item_description && (
          <p className='text-muted-foreground truncate text-xs'>
            {item.item_description}
          </p>
        )}
      </div>

      <Badge variant='outline' className='shrink-0 text-xs capitalize'>
        {config?.label || item.item_type.replace('_', ' ')}
      </Badge>

      {!readOnly && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              aria-label={`Actions for: ${item.item_title}`}
              className='text-muted-foreground hover:text-foreground h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100'
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className='h-4 w-4' aria-hidden='true' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' onClick={(e) => e.stopPropagation()}>
            {onDuplicate && (
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className='mr-2 h-4 w-4' aria-hidden='true' />
                Duplicate item
              </DropdownMenuItem>
            )}
            {onDuplicate && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={onDelete}
              className='text-destructive focus:text-destructive'
            >
              <Trash2 className='mr-2 h-4 w-4' aria-hidden='true' />
              Delete item
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
