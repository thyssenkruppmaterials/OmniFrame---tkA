/**
 * Template Builder Component
 * Main visual drag-and-drop form builder for standard work templates
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { ArrowLeft, Eye, EyeOff, Save, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'
import {
  useStandardWork,
  type StandardWorkTemplate,
  type StandardWorkItem,
} from '@/hooks/use-standard-work'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { BuilderCanvas } from './canvas'
import { ItemPalette } from './item-palette'
import { PropertiesPanel } from './properties-panel'
import { type Section, type ItemType, ITEM_TYPE_CONFIG } from './types'

interface TemplateBuilderProps {
  template: StandardWorkTemplate
  onClose: () => void
}

export function TemplateBuilder({ template, onClose }: TemplateBuilderProps) {
  const { useTemplateItems, createItem, updateItem, deleteItem, reorderItems } =
    useStandardWork()

  const { data: items = [], isLoading: itemsLoading } = useTemplateItems(
    template.id
  )

  const [sections, setSections] = useState<Section[]>([])
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Initialize sections from items
  useEffect(() => {
    if (items.length > 0) {
      const groupedItems: Record<string, StandardWorkItem[]> = {}
      items.forEach((item) => {
        const sectionName = item.section_name || 'General'
        if (!groupedItems[sectionName]) {
          groupedItems[sectionName] = []
        }
        groupedItems[sectionName].push(item)
      })

      const newSections: Section[] = Object.entries(groupedItems).map(
        ([name, sectionItems]) => ({
          id: `section-${name.toLowerCase().replace(/\s+/g, '-')}`,
          name,
          items: sectionItems.sort((a, b) => a.display_order - b.display_order),
          isCollapsed: false,
        })
      )

      // Ensure 'General' section is first
      newSections.sort((a, b) => {
        if (a.name === 'General') return -1
        if (b.name === 'General') return 1
        return a.name.localeCompare(b.name)
      })

      setSections(newSections)
    } else {
      setSections([
        {
          id: 'section-general',
          name: 'General',
          items: [],
          isCollapsed: false,
        },
      ])
    }
  }, [items])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null
    for (const section of sections) {
      const item = section.items.find((i) => i.id === selectedItemId)
      if (item) return item
    }
    return null
  }, [selectedItemId, sections])

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (!over) return

    const activeData = active.data.current
    const overData = over.data.current

    // Handle dropping a palette item
    if (activeData?.type === 'palette-item') {
      const itemType = activeData.itemType as ItemType
      const config = ITEM_TYPE_CONFIG[itemType]

      // Find target section
      let targetSectionId = sections[0]?.id
      if (overData?.type === 'section') {
        targetSectionId = overData.sectionId
      } else if (overData?.type === 'canvas-item') {
        // Find section containing the target item
        for (const section of sections) {
          if (section.items.some((i) => i.id === over.id)) {
            targetSectionId = section.id
            break
          }
        }
      }

      const targetSection = sections.find((s) => s.id === targetSectionId)
      if (!targetSection) return

      try {
        // Create the new item
        const newItem = await createItem({
          template_id: template.id,
          item_title: config.defaultTitle,
          item_type: itemType,
          section_name:
            targetSection.name === 'General' ? undefined : targetSection.name,
          display_order: targetSection.items.length,
          is_required: false,
          validation_rules: {},
          options: [],
        })

        // Update local state
        setSections((prev) =>
          prev.map((s) =>
            s.id === targetSectionId
              ? { ...s, items: [...s.items, newItem] }
              : s
          )
        )

        // Select the new item
        setSelectedItemId(newItem.id)
        setHasUnsavedChanges(true)
      } catch (error) {
        logger.error('Failed to create item:', error)
      }
      return
    }

    // Handle reordering canvas items
    if (activeData?.type === 'canvas-item') {
      const activeItemId = active.id as string

      // Find source and target sections
      let sourceSectionId: string | null = null
      let targetSectionId: string | null = null

      for (const section of sections) {
        if (section.items.some((i) => i.id === activeItemId)) {
          sourceSectionId = section.id
        }
        if (overData?.type === 'section' && overData.sectionId === section.id) {
          targetSectionId = section.id
        }
        if (section.items.some((i) => i.id === over.id)) {
          targetSectionId = section.id
        }
      }

      if (!sourceSectionId) return

      // Same section reorder
      if (sourceSectionId === targetSectionId || !targetSectionId) {
        const section = sections.find((s) => s.id === sourceSectionId)
        if (!section) return

        const oldIndex = section.items.findIndex((i) => i.id === activeItemId)
        const newIndex = section.items.findIndex((i) => i.id === over.id)

        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          const newItems = arrayMove(section.items, oldIndex, newIndex)
          setSections((prev) =>
            prev.map((s) =>
              s.id === sourceSectionId ? { ...s, items: newItems } : s
            )
          )
          setHasUnsavedChanges(true)
        }
      } else {
        // Cross-section move
        const sourceSection = sections.find((s) => s.id === sourceSectionId)
        const targetSection = sections.find((s) => s.id === targetSectionId)
        if (!sourceSection || !targetSection) return

        const itemToMove = sourceSection.items.find(
          (i) => i.id === activeItemId
        )
        if (!itemToMove) return

        const targetIndex = targetSection.items.findIndex(
          (i) => i.id === over.id
        )
        const insertIndex =
          targetIndex === -1 ? targetSection.items.length : targetIndex

        setSections((prev) =>
          prev.map((s) => {
            if (s.id === sourceSectionId) {
              return {
                ...s,
                items: s.items.filter((i) => i.id !== activeItemId),
              }
            }
            if (s.id === targetSectionId) {
              const newItems = [...s.items]
              newItems.splice(insertIndex, 0, {
                ...itemToMove,
                section_name: s.name,
              })
              return { ...s, items: newItems }
            }
            return s
          })
        )
        setHasUnsavedChanges(true)
      }
    }
  }

  // Debounce timer for item property changes
  const itemSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (itemSaveTimerRef.current) clearTimeout(itemSaveTimerRef.current)
    }
  }, [])

  const handleItemChange = useCallback(
    (updatedItem: StandardWorkItem) => {
      // 1. Update local state immediately for instant UI feedback
      setSections((prev) =>
        prev.map((s) => ({
          ...s,
          items: s.items.map((i) =>
            i.id === updatedItem.id ? updatedItem : i
          ),
        }))
      )
      setHasUnsavedChanges(true)

      // 2. Debounce the API save (800ms) to avoid firing on every keystroke
      if (itemSaveTimerRef.current) clearTimeout(itemSaveTimerRef.current)
      itemSaveTimerRef.current = setTimeout(async () => {
        try {
          await updateItem({
            id: updatedItem.id,
            updates: {
              item_title: updatedItem.item_title,
              item_description: updatedItem.item_description,
              item_type: updatedItem.item_type,
              is_required: updatedItem.is_required,
              validation_rules: updatedItem.validation_rules,
              options: updatedItem.options,
              help_text: updatedItem.help_text,
              placeholder: updatedItem.placeholder,
              default_value: updatedItem.default_value,
            },
            templateId: template.id,
          })
        } catch (error) {
          logger.error('Failed to update item:', error)
        }
      }, 800)
    },
    [updateItem, template.id]
  )

  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      try {
        await deleteItem({ itemId, templateId: template.id })
        setSections((prev) =>
          prev.map((s) => ({
            ...s,
            items: s.items.filter((i) => i.id !== itemId),
          }))
        )
        if (selectedItemId === itemId) {
          setSelectedItemId(null)
        }
        setHasUnsavedChanges(true)
      } catch (error) {
        logger.error('Failed to delete item:', error)
      }
    },
    [deleteItem, template.id, selectedItemId]
  )

  const handleSaveOrder = async () => {
    setIsSaving(true)
    try {
      // Build item orders with section names
      const itemOrders: Array<{
        id: string
        display_order: number
        section_name?: string
      }> = []
      sections.forEach((section) => {
        section.items.forEach((item, index) => {
          itemOrders.push({
            id: item.id,
            display_order: index,
            section_name: section.name === 'General' ? undefined : section.name,
          })
        })
      })

      await reorderItems({ templateId: template.id, itemOrders })
      setHasUnsavedChanges(false)
      toast.success('Changes saved successfully')
    } catch (error) {
      logger.error('Failed to save order:', error)
      toast.error('Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }

  if (itemsLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-8 w-48' />
        <div className='grid grid-cols-12 gap-4'>
          <Skeleton className='col-span-3 h-[400px]' />
          <Skeleton className='col-span-6 h-[400px]' />
          <Skeleton className='col-span-3 h-[400px]' />
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-4'>
          <Button variant='ghost' size='sm' onClick={onClose}>
            <ArrowLeft className='mr-2 h-4 w-4' />
            Back
          </Button>
          <Separator orientation='vertical' className='h-6' />
          <div>
            <h3 className='flex items-center gap-2 text-lg font-semibold'>
              <div
                className='flex h-8 w-8 items-center justify-center rounded-lg'
                style={{ backgroundColor: `${template.color}20` }}
              >
                <span className='text-sm' style={{ color: template.color }}>
                  {template.template_name.charAt(0)}
                </span>
              </div>
              {template.template_name}
              {hasUnsavedChanges && (
                <Badge variant='outline' className='text-xs text-yellow-600'>
                  Unsaved
                </Badge>
              )}
            </h3>
            <p className='text-muted-foreground text-sm'>
              {sections.reduce((acc, s) => acc + s.items.length, 0)} items
              configured
            </p>
          </div>
        </div>

        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setPreviewMode(!previewMode)}
            className='gap-2'
          >
            {previewMode ? (
              <>
                <EyeOff className='h-4 w-4' />
                Edit Mode
              </>
            ) : (
              <>
                <Eye className='h-4 w-4' />
                Preview
              </>
            )}
          </Button>
          <Button
            size='sm'
            onClick={handleSaveOrder}
            disabled={!hasUnsavedChanges || isSaving}
            className='gap-2'
          >
            {isSaving ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <Save className='h-4 w-4' />
            )}
            Save Changes
          </Button>
        </div>
      </div>

      {/* Builder Layout */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className='grid min-h-[600px] grid-cols-12 gap-4'>
          {/* Left Panel - Item Palette */}
          <div className='bg-muted/30 col-span-3 rounded-lg p-4'>
            <ItemPalette />
          </div>

          {/* Center - Canvas */}
          <div className='col-span-6 rounded-lg border p-4'>
            <BuilderCanvas
              sections={sections}
              selectedItemId={selectedItemId}
              onSectionsChange={setSections}
              onItemClick={(item) => setSelectedItemId(item.id)}
              onDeleteItem={handleDeleteItem}
            />
          </div>

          {/* Right Panel - Properties */}
          <div className='bg-muted/30 col-span-3 rounded-lg p-4'>
            <PropertiesPanel
              item={selectedItem}
              onItemChange={handleItemChange}
              onClose={() => setSelectedItemId(null)}
            />
          </div>
        </div>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeId && activeId.startsWith('palette-') && (
            <div className='bg-primary text-primary-foreground rounded-lg px-4 py-2 shadow-lg'>
              {
                ITEM_TYPE_CONFIG[activeId.replace('palette-', '') as ItemType]
                  ?.label
              }
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
