// Created and developed by Jai Singh
/**
 * SqcdpCategoryManagerDialog — curator-facing CRUD surface for the
 * per-org SQCDP category list (table added in migration 306).
 *
 * Surfaces:
 *   * List view grouped by tier (Primary / Secondary). Each row is
 *     drag-to-reorderable via `@dnd-kit/sortable`.
 *   * Inline "+ New category" form (label, slug, icon, color, tier).
 *   * Per-row action menu: Edit | Hide/Unhide | Delete.
 *   * "Reset to defaults" footer affordance — re-applies the canonical
 *     builtin shape (label, icon, color, tier, display_order, is_hidden=false).
 *
 * Concurrency: every mutation invalidates the org's `sqcdp-categories`
 * query key on settle (via `useSqcdpCategories`). No Realtime channels
 * — the workspace's "no new Supabase Realtime" rule applies.
 */
import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react'
import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconDotsVertical,
  IconEye,
  IconEyeOff,
  IconGripVertical,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ColorPickerInput } from '@/components/ui/color-picker-input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  useSqcdpCategories,
  type SqcdpCategoryRow,
} from '../hooks/use-sqcdp-categories'
import { useSqcdpMetrics } from '../hooks/use-sqcdp-metrics'
import {
  BUILTIN_CATEGORY_SEED,
  slugifyCategoryLabel,
  type SqcdpCategoryTier,
} from '../lib/categories'
import { resolveCategoryIcon } from '../lib/category-icons'
import { SqcdpCategoryIconPicker } from './sqcdp-category-icon-picker'

interface SqcdpCategoryManagerDialogProps {
  open: boolean
  onClose: () => void
  initialMode?: 'list' | 'create'
  initialTier?: SqcdpCategoryTier
}

interface FormDraft {
  /** When set, the dialog is in edit-mode for that rowId. */
  editingRowId: string | null
  label: string
  slug: string
  iconName: string
  defaultColorHex: string
  tier: SqcdpCategoryTier
  /** Set when slug auto-derives from label (so user-typed slug isn't overwritten). */
  slugAutoSync: boolean
}

const SQCDP_RECOMMENDED_PALETTE = [
  '#DC2626',
  '#16A34A',
  '#EA580C',
  '#0EA5A9',
  '#CA8A04',
  '#7C3AED',
  '#9333EA',
  '#1E3A8A',
  '#0EA5E9',
  '#0F172A',
  '#475569',
  '#10B981',
] as const

const EMPTY_DRAFT: FormDraft = {
  editingRowId: null,
  label: '',
  slug: '',
  iconName: 'IconCircleDashed',
  defaultColorHex: '#0EA5A9',
  tier: 'primary',
  slugAutoSync: true,
}

const TIER_LABELS: Record<SqcdpCategoryTier, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
}

export function SqcdpCategoryManagerDialog({
  open,
  onClose,
  initialMode = 'list',
  initialTier = 'primary',
}: SqcdpCategoryManagerDialogProps): ReactNode {
  const {
    categories,
    isLoading,
    createCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    resetToBuiltins,
  } = useSqcdpCategories()
  const { metrics } = useSqcdpMetrics()

  // Sets of slugs that have at least one referencing metric. Powers the
  // "this builtin's slug can't be renamed" guard + the Delete action's
  // pre-flight (cleaner UX than waiting for the FK error).
  //
  // Note: the `production_board_sqcdp_problems` table also has a composite
  // FK onto this table (`ON DELETE RESTRICT`), but its UI surface was
  // retired on 2026-05-17 (see Sessions/2026-05-17.md) so we no longer
  // load it client-side. If a curator tries to delete a category that is
  // still referenced by a legacy problem row, the DB FK will surface a
  // friendly error via the `useSqcdpCategories.deleteCategory` mutation's
  // FK translator — the only thing we lose is the proactive pre-flight UX.
  const referencedSlugs = useMemo(() => {
    const set = new Set<string>()
    for (const m of metrics) set.add(m.category)
    return set
  }, [metrics])

  const [draft, setDraft] = useState<FormDraft>({
    ...EMPTY_DRAFT,
    tier: initialTier,
  })
  const [showForm, setShowForm] = useState(initialMode === 'create')
  const [confirmDelete, setConfirmDelete] = useState<SqcdpCategoryRow | null>(
    null
  )
  const [confirmReset, setConfirmReset] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // When the dialog re-opens with new initial-mode props, reset the
  // local form state so prior runs don't leak.
  useEffect(() => {
    if (open) {
      setDraft({ ...EMPTY_DRAFT, tier: initialTier })
      setShowForm(initialMode === 'create')
      setSubmitError(null)
    }
  }, [open, initialMode, initialTier])

  const primary = useMemo(
    () =>
      categories
        .filter((c) => c.tier === 'primary')
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [categories]
  )
  const secondary = useMemo(
    () =>
      categories
        .filter((c) => c.tier === 'secondary')
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [categories]
  )

  const startCreate = (tier: SqcdpCategoryTier): void => {
    setDraft({ ...EMPTY_DRAFT, tier })
    setShowForm(true)
    setSubmitError(null)
  }

  const startEdit = (cat: SqcdpCategoryRow): void => {
    setDraft({
      editingRowId: cat.rowId,
      label: cat.label,
      slug: cat.id,
      iconName: cat.iconName,
      defaultColorHex: cat.defaultColor,
      tier: cat.tier,
      slugAutoSync: false,
    })
    setShowForm(true)
    setSubmitError(null)
  }

  const cancelForm = (): void => {
    setShowForm(false)
    setDraft({ ...EMPTY_DRAFT, tier: initialTier })
    setSubmitError(null)
  }

  const onLabelChange = (next: string): void => {
    setDraft((prev) => ({
      ...prev,
      label: next,
      slug: prev.slugAutoSync ? slugifyCategoryLabel(next) : prev.slug,
    }))
  }

  const onSlugChange = (next: string): void => {
    setDraft((prev) => ({
      ...prev,
      slug: slugifyCategoryLabel(next),
      slugAutoSync: false,
    }))
  }

  const submitForm = async (): Promise<void> => {
    setSubmitError(null)
    if (!draft.label.trim()) {
      setSubmitError('Label is required.')
      return
    }
    if (!draft.slug) {
      setSubmitError('Slug is required.')
      return
    }
    try {
      if (draft.editingRowId) {
        await updateCategory.mutateAsync({
          rowId: draft.editingRowId,
          patch: {
            label: draft.label.trim(),
            iconName: draft.iconName,
            defaultColorHex: draft.defaultColorHex.toUpperCase(),
            tier: draft.tier,
          },
        })
      } else {
        // Reject duplicate slugs proactively (the DB unique constraint
        // would catch it but we surface a friendlier message inline).
        if (categories.some((c) => c.id === draft.slug)) {
          setSubmitError(
            `A category with the slug "${draft.slug}" already exists.`
          )
          return
        }
        await createCategory.mutateAsync({
          slug: draft.slug,
          label: draft.label.trim(),
          iconName: draft.iconName,
          defaultColorHex: draft.defaultColorHex.toUpperCase(),
          tier: draft.tier,
        })
      }
      cancelForm()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    }
  }

  const onReorder = (
    tier: SqcdpCategoryTier,
    rowIds: readonly string[]
  ): void => {
    reorderCategories.mutate({ tier, rowIds })
  }

  const onToggleHidden = async (cat: SqcdpCategoryRow): Promise<void> => {
    await updateCategory.mutateAsync({
      rowId: cat.rowId,
      patch: { isHidden: !cat.isHidden },
    })
  }

  const onDelete = async (cat: SqcdpCategoryRow): Promise<void> => {
    await deleteCategory.mutateAsync(cat.rowId)
    setConfirmDelete(null)
  }

  const slugIsReferenced = (slug: string): boolean => referencedSlugs.has(slug)

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className='flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]'>
          <DialogHeader className='border-border/40 shrink-0 border-b px-6 py-4'>
            <DialogTitle>Manage SQCDP categories</DialogTitle>
            <DialogDescription>
              Add, hide, reorder, or remove the categories curators can pick
              when editing a metric. Builtins stay available even if hidden;
              custom categories can be deleted once nothing references them.
            </DialogDescription>
          </DialogHeader>

          <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5'>
            {showForm && (
              <CategoryForm
                draft={draft}
                isEdit={!!draft.editingRowId}
                isPending={createCategory.isPending || updateCategory.isPending}
                onLabelChange={onLabelChange}
                onSlugChange={onSlugChange}
                onIconNameChange={(name) =>
                  setDraft((p) => ({ ...p, iconName: name }))
                }
                onColorChange={(hex) =>
                  setDraft((p) => ({ ...p, defaultColorHex: hex }))
                }
                onTierChange={(tier) => setDraft((p) => ({ ...p, tier }))}
                slugLocked={
                  !!draft.editingRowId && slugIsReferenced(draft.slug)
                }
                error={submitError}
                onCancel={cancelForm}
                onSubmit={submitForm}
              />
            )}

            <CategorySection
              tier='primary'
              categories={primary}
              showCreate={!showForm}
              onCreate={() => startCreate('primary')}
              onEdit={startEdit}
              onToggleHidden={(c) => void onToggleHidden(c)}
              onDelete={(c) => setConfirmDelete(c)}
              onReorder={(rowIds) => onReorder('primary', rowIds)}
              referencedSlugs={referencedSlugs}
              isLoading={isLoading}
            />

            <CategorySection
              tier='secondary'
              categories={secondary}
              showCreate={!showForm}
              onCreate={() => startCreate('secondary')}
              onEdit={startEdit}
              onToggleHidden={(c) => void onToggleHidden(c)}
              onDelete={(c) => setConfirmDelete(c)}
              onReorder={(rowIds) => onReorder('secondary', rowIds)}
              referencedSlugs={referencedSlugs}
              isLoading={isLoading}
            />
          </div>

          <DialogFooter className='border-border/40 bg-background shrink-0 items-center gap-2 border-t px-6 py-3'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='sm:mr-auto'
              onClick={() => setConfirmReset(true)}
              disabled={resetToBuiltins.isPending}
            >
              <IconRefresh className='mr-1 h-3.5 w-3.5' aria-hidden />
              Reset to defaults
            </Button>
            <Button type='button' variant='outline' onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        title='Delete category?'
        message={
          confirmDelete && referencedSlugs.has(confirmDelete.id)
            ? `"${confirmDelete.label}" is still used by at least one metric. The delete will fail until you reassign or remove those rows. Hide the category instead if you want it gone from the picker.`
            : `"${confirmDelete?.label ?? ''}" will be permanently removed for this organization.`
        }
        variant='danger'
        confirmText='Delete category'
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void onDelete(confirmDelete)}
        isProcessing={deleteCategory.isPending}
      />

      <ConfirmDialog
        isOpen={confirmReset}
        title='Reset builtins to defaults?'
        message={`Re-applies the canonical SQCDP shape (label, icon, color, tier, order) to all ${BUILTIN_CATEGORY_SEED.length} builtin categories and unhides any that you previously hid. Custom categories are untouched.`}
        variant='warning'
        confirmText='Reset builtins'
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          await resetToBuiltins.mutateAsync()
          setConfirmReset(false)
        }}
        isProcessing={resetToBuiltins.isPending}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Category form (create + edit)
// ---------------------------------------------------------------------------

interface CategoryFormProps {
  draft: FormDraft
  isEdit: boolean
  isPending: boolean
  slugLocked: boolean
  error: string | null
  onLabelChange: (next: string) => void
  onSlugChange: (next: string) => void
  onIconNameChange: (name: string) => void
  onColorChange: (hex: string) => void
  onTierChange: (tier: SqcdpCategoryTier) => void
  onCancel: () => void
  onSubmit: () => Promise<void>
}

function CategoryForm({
  draft,
  isEdit,
  isPending,
  slugLocked,
  error,
  onLabelChange,
  onSlugChange,
  onIconNameChange,
  onColorChange,
  onTierChange,
  onCancel,
  onSubmit,
}: CategoryFormProps): ReactNode {
  return (
    <section
      className='border-border/50 bg-muted/15 rounded-lg border p-4'
      data-testid='sqcdp-category-form'
    >
      <header className='border-border/40 mb-4 flex items-start justify-between gap-4 border-b pb-2'>
        <div className='flex flex-col gap-0.5'>
          <h3 className='text-foreground text-sm font-semibold'>
            {isEdit ? 'Edit category' : 'New category'}
          </h3>
          <p className='text-muted-foreground text-xs'>
            {isEdit
              ? 'Updates apply to every metric already using this category.'
              : 'Pick a label, slug, icon, and color — the new category appears in the picker immediately.'}
          </p>
        </div>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-7 px-2 text-xs'
          onClick={onCancel}
          disabled={isPending}
        >
          <IconX className='mr-1 h-3 w-3' aria-hidden />
          Cancel
        </Button>
      </header>

      <div className='flex flex-col gap-3'>
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <div className='flex flex-col gap-1.5'>
            <Label
              htmlFor='sqcdp-category-label'
              className='text-sm font-medium'
            >
              Label
            </Label>
            <Input
              id='sqcdp-category-label'
              value={draft.label}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onLabelChange(e.target.value)
              }
              placeholder='e.g. Compliance'
              autoFocus
              disabled={isPending}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label
              htmlFor='sqcdp-category-slug'
              className='text-sm font-medium'
            >
              Slug
            </Label>
            <Input
              id='sqcdp-category-slug'
              value={draft.slug}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onSlugChange(e.target.value)
              }
              placeholder='compliance'
              disabled={isPending || slugLocked}
              className='font-mono'
            />
            <p className='text-muted-foreground text-[11px]'>
              {slugLocked
                ? 'Slug is locked because metrics or problems already use this category.'
                : 'Lowercase letters, digits, and underscores only. Auto-fills from the label.'}
            </p>
          </div>
        </div>

        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <div className='flex flex-col gap-1.5'>
            <Label className='text-sm font-medium'>Tier</Label>
            <ToggleGroup
              type='single'
              size='sm'
              value={draft.tier}
              onValueChange={(v) => {
                if (v === 'primary' || v === 'secondary') onTierChange(v)
              }}
              aria-label='Category tier'
              className='w-full'
            >
              <ToggleGroupItem value='primary' className='flex-1 text-xs'>
                Primary (5 cards + chart)
              </ToggleGroupItem>
              <ToggleGroupItem value='secondary' className='flex-1 text-xs'>
                Secondary
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label className='text-sm font-medium'>Default color</Label>
            <ColorPickerInput
              value={draft.defaultColorHex}
              onChange={(next) => onColorChange(next || '#0EA5A9')}
              presetColors={SQCDP_RECOMMENDED_PALETTE.map((value) => ({
                value,
              }))}
            />
          </div>
        </div>

        <div className='flex flex-col gap-1.5'>
          <Label className='text-sm font-medium'>Icon</Label>
          <div className='border-border/40 bg-background rounded-md border p-3'>
            <SqcdpCategoryIconPicker
              value={draft.iconName}
              onChange={onIconNameChange}
              accentColor={draft.defaultColorHex}
            />
          </div>
        </div>

        {error && (
          <p
            className='flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400'
            role='alert'
          >
            <IconAlertCircle
              className='mt-0.5 h-3.5 w-3.5 shrink-0'
              aria-hidden
            />
            {error}
          </p>
        )}

        <div className='flex justify-end gap-2 pt-1'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type='button'
            size='sm'
            onClick={() => void onSubmit()}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <IconRefresh
                  className='mr-1 h-3.5 w-3.5 animate-spin'
                  aria-hidden
                />
                {isEdit ? 'Saving…' : 'Creating…'}
              </>
            ) : isEdit ? (
              'Save changes'
            ) : (
              'Create category'
            )}
          </Button>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Tier section (sortable list)
// ---------------------------------------------------------------------------

interface CategorySectionProps {
  tier: SqcdpCategoryTier
  categories: SqcdpCategoryRow[]
  showCreate: boolean
  onCreate: () => void
  onEdit: (cat: SqcdpCategoryRow) => void
  onToggleHidden: (cat: SqcdpCategoryRow) => void
  onDelete: (cat: SqcdpCategoryRow) => void
  onReorder: (rowIds: readonly string[]) => void
  referencedSlugs: Set<string>
  isLoading: boolean
}

function CategorySection({
  tier,
  categories,
  showCreate,
  onCreate,
  onEdit,
  onToggleHidden,
  onDelete,
  onReorder,
  referencedSlugs,
  isLoading,
}: CategorySectionProps): ReactNode {
  const [order, setOrder] = useState<string[]>(categories.map((c) => c.rowId))

  // Keep the local sort buffer in sync with prop changes (e.g. when a
  // mutation invalidates the cache and a new order arrives).
  useEffect(() => {
    setOrder(categories.map((c) => c.rowId))
  }, [categories])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = order.indexOf(String(active.id))
    const to = order.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    const next = arrayMove(order, from, to)
    setOrder(next)
    onReorder(next)
  }

  const ordered = order
    .map((rowId) => categories.find((c) => c.rowId === rowId))
    .filter((c): c is SqcdpCategoryRow => !!c)

  return (
    <section
      className='border-border/50 bg-muted/15 rounded-lg border p-4'
      data-testid={`sqcdp-category-section-${tier}`}
    >
      <header className='border-border/40 mb-3 flex items-start justify-between gap-4 border-b pb-2'>
        <div className='flex flex-col gap-0.5'>
          <h3 className='text-foreground text-sm font-semibold'>
            {TIER_LABELS[tier]} categories
            <span className='text-muted-foreground ml-2 text-xs font-normal tabular-nums'>
              {ordered.length}
            </span>
          </h3>
          <p className='text-muted-foreground text-xs'>
            {tier === 'primary'
              ? 'Top row of the SQCDP scorecard. Each card carries a chart strip.'
              : 'Bottom row of the SQCDP scorecard. Meta-only — no chart strip.'}
          </p>
        </div>
        {showCreate && (
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-7 gap-1.5 px-2 text-xs'
            onClick={onCreate}
          >
            <IconPlus className='h-3.5 w-3.5' aria-hidden />
            New
          </Button>
        )}
      </header>

      {isLoading && categories.length === 0 ? (
        <p className='text-muted-foreground py-2 text-xs'>Loading…</p>
      ) : ordered.length === 0 ? (
        <p className='text-muted-foreground py-2 text-xs'>
          No {TIER_LABELS[tier].toLowerCase()} categories. Use <em>+ New</em> to
          add one.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={ordered.map((c) => c.rowId)}
            strategy={verticalListSortingStrategy}
          >
            <ul className='flex flex-col gap-2'>
              {ordered.map((cat) => (
                <SortableCategoryRow
                  key={cat.rowId}
                  cat={cat}
                  onEdit={() => onEdit(cat)}
                  onToggleHidden={() => onToggleHidden(cat)}
                  onDelete={() => onDelete(cat)}
                  isReferenced={referencedSlugs.has(cat.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Sortable row
// ---------------------------------------------------------------------------

interface SortableCategoryRowProps {
  cat: SqcdpCategoryRow
  onEdit: () => void
  onToggleHidden: () => void
  onDelete: () => void
  isReferenced: boolean
}

function SortableCategoryRow({
  cat,
  onEdit,
  onToggleHidden,
  onDelete,
  isReferenced,
}: SortableCategoryRowProps): ReactNode {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cat.rowId })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const Icon = resolveCategoryIcon(cat.iconName)
  const canDelete = !cat.isBuiltin

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid='sqcdp-category-row'
      data-row-id={cat.rowId}
      className={cn(
        'border-border/40 bg-background relative flex items-center gap-3 rounded-md border p-3',
        isDragging && 'ring-primary/40 z-10 ring-1',
        cat.isHidden && 'opacity-60'
      )}
    >
      <button
        type='button'
        className='text-muted-foreground hover:text-foreground cursor-grab touch-none rounded p-1 active:cursor-grabbing'
        aria-label={`Drag to reorder ${cat.label}`}
        {...attributes}
        {...listeners}
      >
        <IconGripVertical className='h-4 w-4' aria-hidden />
      </button>

      <span
        aria-hidden
        className='flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white'
        style={{ backgroundColor: cat.defaultColor }}
      >
        <Icon className='h-4 w-4' />
      </span>

      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex items-center gap-2'>
          <span className='text-foreground truncate text-sm font-medium'>
            {cat.label}
          </span>
          {cat.isBuiltin && (
            <span className='bg-muted/60 text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase'>
              Builtin
            </span>
          )}
          {cat.isHidden && (
            <span className='rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-700 uppercase dark:text-amber-300'>
              Hidden
            </span>
          )}
          {isReferenced && (
            <span
              className='bg-primary/10 text-primary rounded-full px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase'
              title='At least one metric references this category.'
            >
              In use
            </span>
          )}
        </div>
        <code className='text-muted-foreground truncate font-mono text-[11px]'>
          {cat.id}
        </code>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='h-8 w-8'
            aria-label={`Actions for ${cat.label}`}
          >
            <IconDotsVertical className='h-4 w-4' aria-hidden />
            <IconChevronDown className='sr-only h-3 w-3' aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={onEdit}>
            <IconPencil className='mr-2 h-4 w-4' aria-hidden />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleHidden}>
            {cat.isHidden ? (
              <>
                <IconEye className='mr-2 h-4 w-4' aria-hidden />
                Unhide
              </>
            ) : (
              <>
                <IconEyeOff className='mr-2 h-4 w-4' aria-hidden />
                Hide
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            disabled={!canDelete}
            className={cn(
              !canDelete && 'cursor-not-allowed opacity-50',
              'text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400'
            )}
          >
            <IconTrash className='mr-2 h-4 w-4' aria-hidden />
            {canDelete ? 'Delete' : 'Delete (builtins must hide)'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {cat.isHidden && (
        <span aria-hidden className='absolute top-1 right-1'>
          <IconCheck className='h-3 w-3 opacity-0' aria-hidden />
        </span>
      )}
    </li>
  )
}

// Created and developed by Jai Singh
