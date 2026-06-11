// Created and developed by Jai Singh
/**
 * Item Palette
 *
 * Draggable inventory of every supported checklist item type. Drag onto the
 * canvas to create a new item in the targeted section.
 */
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  Calendar,
  Camera,
  Check,
  Clock,
  Hash,
  List,
  ListChecks,
  PenTool,
  Type,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { ITEM_TYPE_CONFIG, type ItemType } from './types'

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

interface PaletteItemProps {
  itemType: ItemType
  disabled?: boolean
}

function PaletteItem({ itemType, disabled }: PaletteItemProps) {
  const config = ITEM_TYPE_CONFIG[itemType]
  const Icon = iconMap[config.icon as keyof typeof iconMap] ?? Check

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `palette-${itemType}`,
      data: {
        type: 'palette-item',
        itemType,
      },
      disabled,
    })

  const style = {
    transform: CSS.Translate.toString(transform),
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      aria-label={`Drag to add ${config.label} item`}
      className={cn(
        'cursor-grab touch-none active:cursor-grabbing',
        isDragging && 'opacity-50',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      <Card className='hover:border-primary/50 hover:bg-muted/50 transition-colors'>
        <CardContent className='flex items-center gap-3 p-3'>
          <div className='bg-primary/10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md'>
            <Icon className='text-primary h-4 w-4' aria-hidden='true' />
          </div>
          <div className='min-w-0'>
            <p className='truncate text-sm font-medium'>{config.label}</p>
            <p className='text-muted-foreground truncate text-xs'>
              {config.description}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

interface ItemPaletteProps {
  className?: string
  disabled?: boolean
}

export function ItemPalette({ className, disabled }: ItemPaletteProps) {
  // Order palette by frequency of use, with capture-style items at the end.
  const itemTypes: ItemType[] = [
    'checkbox',
    'text',
    'number',
    'select',
    'multi_select',
    'date',
    'time',
    'photo',
    'signature',
  ]

  return (
    <div className={cn('space-y-2', className)}>
      <h3 className='text-muted-foreground px-1 text-sm font-semibold tracking-wider uppercase'>
        Item Types
      </h3>
      <p className='text-muted-foreground mb-4 px-1 text-xs'>
        Drag onto the canvas to add an item.
      </p>
      <div className='space-y-2'>
        {itemTypes.map((type) => (
          <PaletteItem key={type} itemType={type} disabled={disabled} />
        ))}
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
