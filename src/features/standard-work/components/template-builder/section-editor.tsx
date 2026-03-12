/**
 * Section Editor Component
 * Manages sections within the template builder
 */
import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Edit,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StandardWorkItem } from '@/hooks/use-standard-work'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { SortableItem } from './sortable-item'
import type { Section } from './types'

interface SectionEditorProps {
  section: Section
  onUpdateSection: (sectionId: string, name: string) => void
  onDeleteSection: (sectionId: string) => void
  onToggleCollapse: (sectionId: string) => void
  onItemClick: (item: StandardWorkItem) => void
  onDeleteItem: (itemId: string) => void
  selectedItemId: string | null
  isFirst: boolean
}

export function SectionEditor({
  section,
  onUpdateSection,
  onDeleteSection,
  onToggleCollapse,
  onItemClick,
  onDeleteItem,
  selectedItemId,
  isFirst,
}: SectionEditorProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(section.name)

  const { setNodeRef, isOver } = useDroppable({
    id: `section-${section.id}`,
    data: {
      type: 'section',
      sectionId: section.id,
    },
  })

  const handleSaveName = () => {
    if (editName.trim()) {
      onUpdateSection(section.id, editName.trim())
    } else {
      setEditName(section.name)
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveName()
    } else if (e.key === 'Escape') {
      setEditName(section.name)
      setIsEditing(false)
    }
  }

  return (
    <Collapsible
      open={!section.isCollapsed}
      onOpenChange={() => onToggleCollapse(section.id)}
      className='group'
    >
      <div
        className={cn(
          'rounded-lg border transition-colors',
          isOver && 'border-primary bg-primary/5 border-dashed'
        )}
      >
        {/* Section Header */}
        <div className='bg-muted/30 flex items-center gap-2 rounded-t-lg border-b p-3'>
          <CollapsibleTrigger asChild>
            <Button variant='ghost' size='icon' className='h-6 w-6'>
              {section.isCollapsed ? (
                <ChevronRight className='h-4 w-4' />
              ) : (
                <ChevronDown className='h-4 w-4' />
              )}
            </Button>
          </CollapsibleTrigger>

          {isEditing ? (
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={handleKeyDown}
              className='h-7 text-sm font-medium'
              autoFocus
            />
          ) : (
            <span
              className='hover:text-primary flex-1 cursor-pointer text-sm font-medium'
              onClick={() => setIsEditing(true)}
            >
              {section.name}
            </span>
          )}

          <Badge variant='outline' className='text-xs'>
            {section.items.length} items
          </Badge>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='h-6 w-6 opacity-0 group-hover:opacity-100'
              >
                <MoreHorizontal className='h-4 w-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={() => setIsEditing(true)}>
                <Edit className='mr-2 h-4 w-4' />
                Rename Section
              </DropdownMenuItem>
              {!isFirst && (
                <DropdownMenuItem
                  onClick={() => onDeleteSection(section.id)}
                  className='text-destructive'
                >
                  <Trash2 className='mr-2 h-4 w-4' />
                  Delete Section
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Section Content */}
        <CollapsibleContent>
          <div ref={setNodeRef} className='min-h-[100px] p-3'>
            {section.items.length === 0 ? (
              <div className='text-muted-foreground flex h-[80px] items-center justify-center rounded-lg border-2 border-dashed text-sm'>
                Drag items here
              </div>
            ) : (
              <SortableContext
                items={section.items.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className='space-y-2'>
                  {section.items.map((item) => (
                    <SortableItem
                      key={item.id}
                      item={item}
                      isSelected={selectedItemId === item.id}
                      onClick={() => onItemClick(item)}
                      onDelete={() => onDeleteItem(item.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
