// Created and developed by Jai Singh
/**
 * Builder Canvas
 *
 * Section list + drop target for the template builder. Sections use UUID-
 * based ids (see `generateSectionId`) so two human-readable names that slug
 * to the same string don't collide as React keys or droppable ids.
 */
import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { Plus, FolderPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StandardWorkItem } from '@/hooks/use-standard-work'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SectionEditor } from './section-editor'
import { generateSectionId, type Section } from './types'

interface BuilderCanvasProps {
  sections: Section[]
  selectedItemId: string | null
  /**
   * Structural changes (add / rename / delete section, item moves). Parent
   * marks the template as having pending order changes when this fires.
   */
  onSectionsChange: (sections: Section[]) => void
  /**
   * UI-only updates (collapse / expand). Parent updates state WITHOUT
   * dirtying the "Order pending" indicator — collapsed-ness is not persisted.
   */
  onSectionsUIChange: (sections: Section[]) => void
  onItemClick: (item: StandardWorkItem) => void
  onDeleteItem: (itemId: string) => void
  onDuplicateItem?: (itemId: string) => void
  className?: string
  readOnly?: boolean
}

export function BuilderCanvas({
  sections,
  selectedItemId,
  onSectionsChange,
  onSectionsUIChange,
  onItemClick,
  onDeleteItem,
  onDuplicateItem,
  className,
  readOnly = false,
}: BuilderCanvasProps) {
  const [isAddingSection, setIsAddingSection] = useState(false)
  const [newSectionName, setNewSectionName] = useState('')

  const { setNodeRef, isOver } = useDroppable({
    id: 'canvas-root',
    data: {
      type: 'canvas',
    },
  })

  const handleAddSection = () => {
    if (newSectionName.trim()) {
      const newSection: Section = {
        id: generateSectionId(),
        name: newSectionName.trim(),
        items: [],
        isCollapsed: false,
      }
      onSectionsChange([...sections, newSection])
      setNewSectionName('')
      setIsAddingSection(false)
    }
  }

  const handleUpdateSection = (sectionId: string, name: string) => {
    onSectionsChange(
      sections.map((s) => (s.id === sectionId ? { ...s, name } : s))
    )
  }

  const handleDeleteSection = (sectionId: string) => {
    const sectionToDelete = sections.find((s) => s.id === sectionId)
    if (!sectionToDelete) return

    const firstSection = sections.find((s) => s.id !== sectionId)
    if (firstSection && sectionToDelete.items.length > 0) {
      onSectionsChange(
        sections
          .filter((s) => s.id !== sectionId)
          .map((s) =>
            s.id === firstSection.id
              ? { ...s, items: [...s.items, ...sectionToDelete.items] }
              : s
          )
      )
    } else {
      onSectionsChange(sections.filter((s) => s.id !== sectionId))
    }
  }

  // Toggle collapse routes through onSectionsUIChange so this doesn't flag
  // the template as having unsaved structural changes — collapsed-ness is a
  // local UI affordance, never persisted.
  const handleToggleCollapse = (sectionId: string) => {
    onSectionsUIChange(
      sections.map((s) =>
        s.id === sectionId ? { ...s, isCollapsed: !s.isCollapsed } : s
      )
    )
  }

  const totalItems = sections.reduce((acc, s) => acc + s.items.length, 0)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddSection()
    } else if (e.key === 'Escape') {
      setIsAddingSection(false)
      setNewSectionName('')
    }
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className='mb-4 flex items-center justify-between'>
        <div>
          <h3 className='text-muted-foreground text-sm font-semibold tracking-wider uppercase'>
            {readOnly ? 'Preview' : 'Checklist Items'}
          </h3>
          <p className='text-muted-foreground text-xs'>
            {totalItems} item{totalItems === 1 ? '' : 's'} in {sections.length}{' '}
            section{sections.length === 1 ? '' : 's'}
          </p>
        </div>
        {!isAddingSection && !readOnly && (
          <Button
            variant='outline'
            size='sm'
            onClick={() => setIsAddingSection(true)}
            className='gap-2'
          >
            <FolderPlus className='h-4 w-4' aria-hidden='true' />
            Add Section
          </Button>
        )}
      </div>

      {isAddingSection && (
        <div className='mb-4 flex items-center gap-2'>
          <Input
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Section name...'
            className='flex-1'
            aria-label='New section name'
            autoFocus
          />
          <Button size='sm' onClick={handleAddSection}>
            Add
          </Button>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => {
              setIsAddingSection(false)
              setNewSectionName('')
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      <ScrollArea className='flex-1'>
        <div
          ref={setNodeRef}
          className={cn(
            'min-h-[400px] space-y-4 p-1',
            isOver && !readOnly && 'bg-primary/5 rounded-lg'
          )}
        >
          {sections.length === 0 ? (
            <div className='text-muted-foreground flex h-[400px] flex-col items-center justify-center rounded-lg border-2 border-dashed'>
              <Plus className='mb-2 h-8 w-8 opacity-50' aria-hidden='true' />
              <p className='text-sm'>Add a section to get started</p>
              <p className='mt-1 text-xs'>or drag items from the palette</p>
            </div>
          ) : (
            sections.map((section, index) => (
              <SectionEditor
                key={section.id}
                section={section}
                onUpdateSection={handleUpdateSection}
                onDeleteSection={handleDeleteSection}
                onToggleCollapse={handleToggleCollapse}
                onItemClick={onItemClick}
                onDeleteItem={onDeleteItem}
                onDuplicateItem={onDuplicateItem}
                selectedItemId={selectedItemId}
                isFirst={index === 0}
                readOnly={readOnly}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// Created and developed by Jai Singh
