/**
 * Sortable Item Component
 * Draggable item within the canvas
 */
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical,
  Trash2,
  Check,
  Type,
  Hash,
  List,
  Calendar,
  Clock,
  Asterisk,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StandardWorkItem } from '@/hooks/use-standard-work'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ITEM_TYPE_CONFIG } from './types'

const iconMap = {
  Check,
  Type,
  Hash,
  List,
  ListChecks: List,
  Calendar,
  Clock,
}

interface SortableItemProps {
  item: StandardWorkItem
  isSelected: boolean
  onClick: () => void
  onDelete: () => void
}

export function SortableItem({
  item,
  isSelected,
  onClick,
  onDelete,
}: SortableItemProps) {
  const config =
    ITEM_TYPE_CONFIG[item.item_type as keyof typeof ITEM_TYPE_CONFIG]
  const Icon = iconMap[config?.icon as keyof typeof iconMap] || Check

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
        !isDragging && 'hover:border-primary/50'
      )}
      onClick={onClick}
    >
      {/* Drag Handle */}
      <button
        {...attributes}
        {...listeners}
        className='hover:bg-muted -ml-1 cursor-grab touch-none rounded p-1 active:cursor-grabbing'
      >
        <GripVertical className='text-muted-foreground h-4 w-4' />
      </button>

      {/* Type Icon */}
      <div className='bg-muted flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md'>
        <Icon className='text-muted-foreground h-4 w-4' />
      </div>

      {/* Item Info */}
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='truncate text-sm font-medium'>
            {item.item_title}
          </span>
          {item.is_required && (
            <Asterisk className='text-destructive h-3 w-3 flex-shrink-0' />
          )}
        </div>
        {item.item_description && (
          <p className='text-muted-foreground truncate text-xs'>
            {item.item_description}
          </p>
        )}
      </div>

      {/* Type Badge */}
      <Badge variant='outline' className='flex-shrink-0 text-xs capitalize'>
        {config?.label || item.item_type}
      </Badge>

      {/* Delete Button */}
      <Button
        variant='ghost'
        size='icon'
        className='text-muted-foreground hover:text-destructive h-7 w-7 flex-shrink-0 opacity-0 group-hover:opacity-100'
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        <Trash2 className='h-4 w-4' />
      </Button>
    </div>
  )
}
