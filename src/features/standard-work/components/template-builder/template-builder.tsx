// Created and developed by Jai Singh
/**
 * Template Builder
 *
 * Three-panel visual builder (palette / canvas / properties) for editing a
 * standard work template's items, sections, and layout. The builder mixes
 * two save lifecycles intentionally:
 *
 *   1) Item field edits (title, options, validation) auto-save through a
 *      debounced PATCH and surface as "Saving…" / "Saved" / "Save failed"
 *      in the status pill.
 *   2) Structural changes (reorder, cross-section moves, rename, add,
 *      delete) stay local until the user clicks "Save Order" (or hits
 *      Cmd/Ctrl-S), which fires a single batched call and clears the
 *      "Order pending" pill.
 *
 * Preview mode renders the canvas read-only so reviewers can scan the
 * checklist without accidentally editing it. The page-level guards
 * (`beforeunload` + keyboard shortcut) make sure users don't navigate away
 * with un-persisted reorders sitting in memory.
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
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Save,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import {
  useStandardWork,
  type StandardWorkTemplate,
  type StandardWorkItem,
} from '@/hooks/use-standard-work'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { BuilderCanvas } from './canvas'
import { ItemPalette } from './item-palette'
import { PropertiesPanel } from './properties-panel'
import {
  generateSectionId,
  ITEM_TYPE_CONFIG,
  type ItemType,
  type Section,
} from './types'

interface TemplateBuilderProps {
  template: StandardWorkTemplate
  onClose: () => void
}

type SaveState =
  | 'idle'
  | 'saving-field'
  | 'saved-field'
  | 'order-pending'
  | 'saving-order'
  | 'order-error'
  | 'field-error'

export function TemplateBuilder({ template, onClose }: TemplateBuilderProps) {
  const {
    useTemplateItems,
    createItem,
    updateItem,
    deleteItem,
    restoreItem,
    duplicateItem,
    reorderItems,
  } = useStandardWork()

  const {
    data: items = [],
    isLoading: itemsLoading,
    isFetching: itemsFetching,
    refetch: refetchItems,
  } = useTemplateItems(template.id)

  const [sections, setSections] = useState<Section[]>([])
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [autoFocusNewItem, setAutoFocusNewItem] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState(false)
  const [orderPending, setOrderPending] = useState(false)
  const [fieldSaveState, setFieldSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')
  const [lastFieldError, setLastFieldError] = useState<string | null>(null)
  const [isSavingOrder, setIsSavingOrder] = useState(false)
  const [lastOrderError, setLastOrderError] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  // Track the section.id <-> name binding across re-renders so reorderItems
  // batches sees the correct (renamed) section without losing local edits.
  const sectionIdMapRef = useRef<Record<string, string>>({})
  // Collapsed-ness is local UI state and shouldn't be reset by refetches.
  const collapsedMapRef = useRef<Record<string, boolean>>({})
  // Snapshot of the latest pending in-flight save payload so retry can resend.
  const lastFieldPayloadRef = useRef<StandardWorkItem | null>(null)

  // Initialize sections from items. Section ids are stable UUIDs so two
  // sections with similar names won't collide and so renames don't change
  // the React key (which would unmount sortable contexts mid-edit).
  useEffect(() => {
    const groupedItems: Record<string, StandardWorkItem[]> = {}
    items.forEach((item) => {
      const sectionName = item.section_name || 'General'
      if (!groupedItems[sectionName]) groupedItems[sectionName] = []
      groupedItems[sectionName].push(item)
    })

    const newSections: Section[] = Object.entries(groupedItems).map(
      ([name, sectionItems]) => {
        const existingId = sectionIdMapRef.current[name]
        const id = existingId || generateSectionId()
        sectionIdMapRef.current[name] = id
        return {
          id,
          name,
          items: sectionItems.sort((a, b) => a.display_order - b.display_order),
          isCollapsed: collapsedMapRef.current[id] ?? false,
        }
      }
    )

    if (newSections.length === 0) {
      const generalId =
        sectionIdMapRef.current['General'] || generateSectionId()
      sectionIdMapRef.current['General'] = generalId
      newSections.push({
        id: generalId,
        name: 'General',
        items: [],
        isCollapsed: collapsedMapRef.current[generalId] ?? false,
      })
    }

    newSections.sort((a, b) => {
      if (a.name === 'General') return -1
      if (b.name === 'General') return 1
      return a.name.localeCompare(b.name)
    })

    setSections(newSections)
    // Don't reset orderPending here -- the user might have local pending
    // moves while a refetch happens (e.g. another tab editing the template).
  }, [items])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
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

  const allItems = useMemo(() => sections.flatMap((s) => s.items), [sections])
  const totalItems = allItems.length

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    if (!over || previewMode) return

    const activeData = active.data.current
    const overData = over.data.current

    if (activeData?.type === 'palette-item') {
      const itemType = activeData.itemType as ItemType
      const config = ITEM_TYPE_CONFIG[itemType]

      let targetSectionId = sections[0]?.id
      if (overData?.type === 'section') {
        targetSectionId = overData.sectionId
      } else if (overData?.type === 'canvas-item') {
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

        setSections((prev) =>
          prev.map((s) =>
            s.id === targetSectionId
              ? { ...s, items: [...s.items, newItem] }
              : s
          )
        )

        setSelectedItemId(newItem.id)
        // Bump the auto-focus token so the properties panel selects the
        // default title text immediately -- saves an extra click for users
        // who always rename a fresh item before doing anything else.
        setAutoFocusNewItem(true)
      } catch (error) {
        logger.error('Failed to create item:', error)
      }
      return
    }

    if (activeData?.type === 'canvas-item') {
      const activeItemId = active.id as string

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
          setOrderPending(true)
        }
      } else {
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
        setOrderPending(true)
      }
    }
  }

  const itemSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fieldSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (itemSaveTimerRef.current) clearTimeout(itemSaveTimerRef.current)
      if (fieldSavedTimerRef.current) clearTimeout(fieldSavedTimerRef.current)
    }
  }, [])

  // Once the user starts editing the freshly created item, drop the
  // auto-focus token so subsequent re-renders don't repeatedly steal focus
  // from whatever the user has clicked into.
  useEffect(() => {
    if (!autoFocusNewItem) return
    const t = setTimeout(() => setAutoFocusNewItem(false), 150)
    return () => clearTimeout(t)
  }, [autoFocusNewItem])

  const performFieldSave = useCallback(
    async (payload: StandardWorkItem) => {
      try {
        await updateItem({
          id: payload.id,
          updates: {
            item_title: payload.item_title,
            item_description: payload.item_description,
            item_type: payload.item_type,
            is_required: payload.is_required,
            validation_rules: payload.validation_rules,
            options: payload.options,
            help_text: payload.help_text,
            placeholder: payload.placeholder,
            default_value: payload.default_value,
            conditional_display: payload.conditional_display,
          },
          templateId: template.id,
        })
        setFieldSaveState('saved')
        setLastFieldError(null)
        if (fieldSavedTimerRef.current) clearTimeout(fieldSavedTimerRef.current)
        fieldSavedTimerRef.current = setTimeout(
          () => setFieldSaveState('idle'),
          1500
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        logger.error('Failed to update item:', error)
        setFieldSaveState('error')
        setLastFieldError(message)
      }
    },
    [updateItem, template.id]
  )

  const handleItemChange = useCallback(
    (updatedItem: StandardWorkItem) => {
      setSections((prev) =>
        prev.map((s) => ({
          ...s,
          items: s.items.map((i) =>
            i.id === updatedItem.id ? updatedItem : i
          ),
        }))
      )
      // Empty title is a soft validation: surface it visually, but don't
      // attempt to save until the user types something. Avoids a 400 round
      // trip on every keystroke while the user is still composing.
      if (!updatedItem.item_title.trim()) {
        if (itemSaveTimerRef.current) clearTimeout(itemSaveTimerRef.current)
        setFieldSaveState('idle')
        lastFieldPayloadRef.current = updatedItem
        return
      }
      setFieldSaveState('saving')
      setLastFieldError(null)
      lastFieldPayloadRef.current = updatedItem
      if (itemSaveTimerRef.current) clearTimeout(itemSaveTimerRef.current)
      itemSaveTimerRef.current = setTimeout(() => {
        const payload = lastFieldPayloadRef.current
        if (payload && payload.id === updatedItem.id) {
          void performFieldSave(payload)
        }
      }, 600)
    },
    [performFieldSave]
  )

  const handleRetryFieldSave = useCallback(() => {
    const payload = lastFieldPayloadRef.current
    if (!payload) return
    setFieldSaveState('saving')
    setLastFieldError(null)
    void performFieldSave(payload)
  }, [performFieldSave])

  const handleDuplicateItem = useCallback(
    async (itemId: string) => {
      try {
        const result = await duplicateItem({ itemId, templateId: template.id })
        const newId = result.result.id
        setSelectedItemId(newId)
        toast.success('Item duplicated')
      } catch (error) {
        logger.error('Failed to duplicate item:', error)
      }
    },
    [duplicateItem, template.id]
  )

  const handleRequestDelete = useCallback(
    (itemId: string) => {
      const item = allItems.find((i) => i.id === itemId)
      if (!item) return
      // Items with no configured content (default title, no description) can
      // be removed without a confirmation step -- they're almost certainly
      // a misclick from the palette. Anything beyond that opens the dialog.
      const titleIsDefault = Object.values(ITEM_TYPE_CONFIG).some(
        (c) => c.defaultTitle === item.item_title
      )
      const hasContent =
        !titleIsDefault ||
        !!item.item_description ||
        (item.options?.length ?? 0) > 0 ||
        !!item.help_text ||
        !!item.placeholder ||
        !!item.default_value ||
        !!item.conditional_display
      if (!hasContent) {
        void doDeleteItem(itemId)
        return
      }
      setPendingDeleteId(itemId)
    },
    // doDeleteItem is defined below; React resolves the closure at call time
    // and the value is stable across renders thanks to its own deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allItems]
  )

  const doDeleteItem = useCallback(
    async (itemId: string) => {
      setPendingDeleteId(null)
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
        // Undo lives in the toast itself for the next ~6 seconds. We
        // restore the row server-side so display_order / section_name stay
        // exactly where they were and the row pops back into place.
        toast('Item deleted', {
          duration: 6000,
          action: {
            label: 'Undo',
            onClick: () => {
              void (async () => {
                try {
                  await restoreItem({ itemId, templateId: template.id })
                  toast.success('Item restored')
                } catch (error) {
                  logger.error('Failed to restore item:', error)
                }
              })()
            },
          },
        })
      } catch (error) {
        logger.error('Failed to delete item:', error)
        toast.error('Failed to delete item')
      }
    },
    [deleteItem, restoreItem, template.id, selectedItemId]
  )

  const handleSaveOrder = useCallback(async () => {
    if (!orderPending || isSavingOrder) return
    setIsSavingOrder(true)
    setLastOrderError(null)
    try {
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
      setOrderPending(false)
      toast.success('Order saved')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Failed to save order:', error)
      setLastOrderError(message)
      toast.error(`Failed to save changes: ${message}`)
    } finally {
      setIsSavingOrder(false)
    }
  }, [orderPending, isSavingOrder, sections, reorderItems, template.id])

  // Cmd/Ctrl-S to save the pending structural order. We attach to the
  // document so the shortcut works regardless of which child has focus,
  // including inputs and dropdown menus.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        if (!orderPending || isSavingOrder) return
        e.preventDefault()
        void handleSaveOrder()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [orderPending, isSavingOrder, handleSaveOrder])

  // Warn before navigating away with unsaved structural changes. We can't
  // intercept TanStack Router navigations from here cleanly, but the
  // browser-level beforeunload covers tab close / hard reload / external
  // navigations, which is where users have historically lost work.
  useEffect(() => {
    if (!orderPending) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [orderPending])

  const handleCloseRequest = useCallback(() => {
    if (orderPending) {
      const confirmed = window.confirm(
        'You have unsaved structural changes. Leave anyway?'
      )
      if (!confirmed) return
    }
    onClose()
  }, [orderPending, onClose])

  const saveState: SaveState = lastOrderError
    ? 'order-error'
    : isSavingOrder
      ? 'saving-order'
      : orderPending
        ? 'order-pending'
        : fieldSaveState === 'error'
          ? 'field-error'
          : fieldSaveState === 'saving'
            ? 'saving-field'
            : fieldSaveState === 'saved'
              ? 'saved-field'
              : 'idle'

  const pendingDeleteItem = pendingDeleteId
    ? allItems.find((i) => i.id === pendingDeleteId)
    : null

  if (itemsLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-8 w-48' />
        <div className='grid gap-4 lg:grid-cols-12'>
          <Skeleton className='h-[400px] lg:col-span-3' />
          <Skeleton className='h-[400px] lg:col-span-6' />
          <Skeleton className='h-[400px] lg:col-span-3' />
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {/* Header */}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-center gap-4'>
          <Button variant='ghost' size='sm' onClick={handleCloseRequest}>
            <ArrowLeft className='mr-2 h-4 w-4' aria-hidden='true' />
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
              <SaveStatusPill
                state={saveState}
                errorMessage={lastOrderError ?? lastFieldError ?? undefined}
                onRetryField={handleRetryFieldSave}
                onRetryOrder={handleSaveOrder}
              />
            </h3>
            <p className='text-muted-foreground text-sm'>
              {totalItems} item{totalItems === 1 ? '' : 's'} configured
              {previewMode && ' · Read-only preview'}
            </p>
          </div>
        </div>

        <div className='flex items-center gap-2'>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => refetchItems()}
            disabled={itemsFetching}
            className='gap-2'
            aria-label='Refresh template items'
            title='Refresh items from server'
          >
            <RefreshCw
              className={cn('h-4 w-4', itemsFetching && 'animate-spin')}
              aria-hidden='true'
            />
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setPreviewMode(!previewMode)}
            className='gap-2'
            aria-pressed={previewMode}
          >
            {previewMode ? (
              <>
                <EyeOff className='h-4 w-4' aria-hidden='true' />
                Edit Mode
              </>
            ) : (
              <>
                <Eye className='h-4 w-4' aria-hidden='true' />
                Preview
              </>
            )}
          </Button>
          <Button
            size='sm'
            onClick={handleSaveOrder}
            disabled={!orderPending || isSavingOrder}
            className='gap-2'
            title={
              orderPending
                ? 'Save layout changes (\u2318S / Ctrl+S)'
                : 'No layout changes to save'
            }
          >
            {isSavingOrder ? (
              <Loader2 className='h-4 w-4 animate-spin' aria-hidden='true' />
            ) : (
              <Save className='h-4 w-4' aria-hidden='true' />
            )}
            Save Order
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Builder grid -- stacks on small/medium, splits 3/6/3 on lg+ */}
        <div className='grid min-h-[600px] grid-cols-1 gap-4 lg:grid-cols-12'>
          {!previewMode && (
            <div className='bg-muted/30 rounded-lg p-4 lg:col-span-3'>
              <ItemPalette />
            </div>
          )}

          <div
            className={cn(
              'rounded-lg border p-4',
              previewMode ? 'lg:col-span-9' : 'lg:col-span-6'
            )}
          >
            <BuilderCanvas
              sections={sections}
              selectedItemId={selectedItemId}
              onSectionsChange={(next) => {
                setSections(next)
                setOrderPending(true)
              }}
              onSectionsUIChange={(next) => {
                // Keep the local collapsed map in sync so the next items
                // refetch doesn't wipe out the user's expand/collapse choices.
                next.forEach((s) => {
                  collapsedMapRef.current[s.id] = !!s.isCollapsed
                })
                setSections(next)
              }}
              onItemClick={(item) => setSelectedItemId(item.id)}
              onDeleteItem={handleRequestDelete}
              onDuplicateItem={handleDuplicateItem}
              readOnly={previewMode}
            />
          </div>

          {!previewMode && (
            <div className='bg-muted/30 rounded-lg p-4 lg:col-span-3'>
              <PropertiesPanel
                item={selectedItem}
                allItems={allItems}
                onItemChange={handleItemChange}
                onClose={() => setSelectedItemId(null)}
                autoFocusOnCreate={autoFocusNewItem}
              />
            </div>
          )}
        </div>

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

      <AlertDialog
        open={!!pendingDeleteId}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteItem
                ? `"${pendingDeleteItem.item_title || 'Untitled item'}" will be removed from the template. You'll have a few seconds to undo from the toast.`
                : 'The item will be removed.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                pendingDeleteId && void doDeleteItem(pendingDeleteId)
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SaveStatusPill({
  state,
  errorMessage,
  onRetryField,
  onRetryOrder,
}: {
  state: SaveState
  errorMessage?: string
  onRetryField: () => void
  onRetryOrder: () => void
}) {
  switch (state) {
    case 'saving-field':
      return (
        <Badge
          variant='outline'
          className='border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400'
        >
          <Loader2 className='mr-1 h-3 w-3 animate-spin' aria-hidden='true' />
          Saving…
        </Badge>
      )
    case 'saved-field':
      return (
        <Badge
          variant='outline'
          className='border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400'
        >
          <Check className='mr-1 h-3 w-3' aria-hidden='true' />
          Saved
        </Badge>
      )
    case 'order-pending':
      return (
        <Badge
          variant='outline'
          className='border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
        >
          Order pending
        </Badge>
      )
    case 'saving-order':
      return (
        <Badge
          variant='outline'
          className='border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400'
        >
          <Loader2 className='mr-1 h-3 w-3 animate-spin' aria-hidden='true' />
          Saving order…
        </Badge>
      )
    case 'order-error':
      return (
        <Badge
          variant='outline'
          className='border-destructive/30 bg-destructive/10 text-destructive cursor-pointer'
          title={errorMessage}
          onClick={onRetryOrder}
          role='button'
        >
          <AlertTriangle className='mr-1 h-3 w-3' aria-hidden='true' />
          Save failed · Retry
        </Badge>
      )
    case 'field-error':
      return (
        <Badge
          variant='outline'
          className='border-destructive/30 bg-destructive/10 text-destructive cursor-pointer'
          title={errorMessage}
          onClick={onRetryField}
          role='button'
        >
          <AlertTriangle className='mr-1 h-3 w-3' aria-hidden='true' />
          Save failed · Retry
        </Badge>
      )
    default:
      return null
  }
}

// Created and developed by Jai Singh
