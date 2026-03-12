/**
 * Builder Canvas Component
 * Main drag-and-drop canvas for arranging items
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
import type { Section } from './types'

interface BuilderCanvasProps {
  sections: Section[]
  selectedItemId: string | null
  onSectionsChange: (sections: Section[]) => void
  onItemClick: (item: StandardWorkItem) => void
  onDeleteItem: (itemId: string) => void
  className?: string
}

export function BuilderCanvas({
  sections,
  selectedItemId,
  onSectionsChange,
  onItemClick,
  onDeleteItem,
  className,
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
        id: `section-${Date.now()}`,
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
    // Move items to first section or remove them
    const sectionToDelete = sections.find((s) => s.id === sectionId)
    if (!sectionToDelete) return

    const firstSection = sections.find((s) => s.id !== sectionId)
    if (firstSection && sectionToDelete.items.length > 0) {
      // Move items to first section
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

  const handleToggleCollapse = (sectionId: string) => {
    onSectionsChange(
      sections.map((s) =>
        s.id === sectionId ? { ...s, isCollapsed: !s.isCollapsed } : s
      )
    )
  }

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
      {/* Header */}
      <div className='mb-4 flex items-center justify-between'>
        <div>
          <h3 className='text-muted-foreground text-sm font-semibold tracking-wider uppercase'>
            Checklist Items
          </h3>
          <p className='text-muted-foreground text-xs'>
            {sections.reduce((acc, s) => acc + s.items.length, 0)} items in{' '}
            {sections.length} sections
          </p>
        </div>
        {!isAddingSection && (
          <Button
            variant='outline'
            size='sm'
            onClick={() => setIsAddingSection(true)}
            className='gap-2'
          >
            <FolderPlus className='h-4 w-4' />
            Add Section
          </Button>
        )}
      </div>

      {/* Add Section Input */}
      {isAddingSection && (
        <div className='mb-4 flex items-center gap-2'>
          <Input
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Section name...'
            className='flex-1'
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

      {/* Canvas Area */}
      <ScrollArea className='flex-1'>
        <div
          ref={setNodeRef}
          className={cn(
            'min-h-[400px] space-y-4 p-1',
            isOver && 'bg-primary/5 rounded-lg'
          )}
        >
          {sections.length === 0 ? (
            <div className='text-muted-foreground flex h-[400px] flex-col items-center justify-center rounded-lg border-2 border-dashed'>
              <Plus className='mb-2 h-8 w-8 opacity-50' />
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
                selectedItemId={selectedItemId}
                isFirst={index === 0}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
