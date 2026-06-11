// Created and developed by Jai Singh
/**
 * Properties Panel
 *
 * Right-rail editor for the currently selected item in the template builder.
 *
 * IMPORTANT — typing safety / sync model
 * The panel owns local editor state (`localItem`, `optionsText`) that drives
 * the inputs while the user types. The `item` prop comes from the parent's
 * sections array which is rebuilt every time the server-side items query
 * refetches (e.g. after a debounced field auto-save). If we synced `localItem`
 * from `item` on every render the user would lose characters as soon as a
 * refetch round-tripped mid-keystroke. The `lastSyncedIdRef` guard makes the
 * sync only happen when the *selected item* actually changes (id flip), so
 * the user's in-flight edits are preserved across refetches.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { X, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StandardWorkItem } from '@/hooks/use-standard-work'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ITEM_TYPE_CONFIG, type ItemType } from './types'

interface PropertiesPanelProps {
  item: StandardWorkItem | null
  /** All items in the template — used to populate the conditional-display picker. */
  allItems?: StandardWorkItem[]
  onItemChange: (item: StandardWorkItem) => void
  onClose: () => void
  /** Whether the parent just created this item and the title should auto-focus. */
  autoFocusOnCreate?: boolean
  className?: string
}

type ConditionalCondition = 'equals' | 'not_equals' | 'contains'

const CONDITION_OPTIONS: Array<{ value: ConditionalCondition; label: string }> =
  [
    { value: 'equals', label: 'is equal to' },
    { value: 'not_equals', label: 'is not equal to' },
    { value: 'contains', label: 'contains' },
  ]

export function PropertiesPanel({
  item,
  allItems = [],
  onItemChange,
  onClose,
  autoFocusOnCreate = false,
  className,
}: PropertiesPanelProps) {
  const titleId = useId()
  const descriptionId = useId()
  const typeId = useId()
  const optionsId = useId()
  const minId = useId()
  const maxId = useId()
  const helpId = useId()
  const placeholderId = useId()
  const defaultId = useId()
  const requiredId = useId()
  const condDependsId = useId()
  const condConditionId = useId()
  const condValueId = useId()

  const [localItem, setLocalItem] = useState<StandardWorkItem | null>(null)
  const [optionsText, setOptionsText] = useState('')
  const lastSyncedIdRef = useRef<string | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  // Sync local editor state ONLY when the selected item changes (id flip).
  // See the file header for the rationale — preserves in-flight keystrokes
  // when the parent refetches items after a debounced save.
  useEffect(() => {
    if (!item) {
      setLocalItem(null)
      setOptionsText('')
      lastSyncedIdRef.current = null
      return
    }
    if (item.id !== lastSyncedIdRef.current) {
      setLocalItem({ ...item })
      setOptionsText(item.options?.map((o) => o.label).join('\n') || '')
      lastSyncedIdRef.current = item.id
    }
  }, [item])

  // When the parent flips `autoFocusOnCreate` for a freshly created item,
  // pull focus into the title field and select its contents so the user
  // can immediately start typing without an extra click.
  useEffect(() => {
    if (!autoFocusOnCreate || !item) return
    // RAF defers focus until after the input has actually mounted from the
    // selection change (selectedItemId update happens in the same tick).
    const raf = requestAnimationFrame(() => {
      const el = titleInputRef.current
      if (!el) return
      el.focus()
      el.select()
    })
    return () => cancelAnimationFrame(raf)
  }, [autoFocusOnCreate, item])

  const handleChange = <K extends keyof StandardWorkItem>(
    field: K,
    value: StandardWorkItem[K]
  ) => {
    if (!localItem) return
    const updated = { ...localItem, [field]: value }
    setLocalItem(updated)
    onItemChange(updated)
  }

  const handleOptionsChange = (text: string) => {
    setOptionsText(text)
    // Preserve existing option *values* when only labels change. This keeps
    // any in-flight or historical responses keyed correctly even after the
    // admin tweaks the wording of an option.
    const previous = localItem?.options ?? []
    const seen = new Map<string, string>()
    previous.forEach((o) => {
      if (o.label) seen.set(o.label.trim(), o.value)
    })
    const options = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((label) => ({
        value:
          seen.get(label) ||
          label
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, ''),
        label,
      }))
    if (!localItem) return
    const updated = { ...localItem, options }
    setLocalItem(updated)
    onItemChange(updated)
  }

  const handleValidationChange = (field: string, value: number | undefined) => {
    if (!localItem) return
    // Drop the key entirely when the user clears the field so we don't keep
    // stale {min: undefined} payloads that look like the user explicitly
    // unset a bound.
    const nextRules: Record<string, unknown> = {
      ...(localItem.validation_rules ?? {}),
    }
    if (value === undefined || Number.isNaN(value)) {
      delete nextRules[field]
    } else {
      nextRules[field] = value
    }
    const updated = { ...localItem, validation_rules: nextRules }
    setLocalItem(updated)
    onItemChange(updated)
  }

  const handleConditionalChange = (
    next: Partial<NonNullable<StandardWorkItem['conditional_display']>> | null
  ) => {
    if (!localItem) return
    if (next === null) {
      const { conditional_display: _drop, ...rest } = localItem
      const updated = { ...(rest as StandardWorkItem) }
      setLocalItem(updated)
      onItemChange(updated)
      return
    }
    const current = localItem.conditional_display ?? {
      depends_on: '',
      condition: 'equals',
      value: '',
    }
    const merged = { ...current, ...next }
    if (!merged.depends_on) {
      const { conditional_display: _drop, ...rest } = localItem
      const updated = { ...(rest as StandardWorkItem) }
      setLocalItem(updated)
      onItemChange(updated)
      return
    }
    const updated = {
      ...localItem,
      conditional_display: merged,
    }
    setLocalItem(updated)
    onItemChange(updated)
  }

  // Eligible "depends on" candidates: every other item in the template.
  // Filtered to types that hold a comparable, predictable value.
  const conditionalCandidates = useMemo(
    () =>
      allItems.filter(
        (other) =>
          other.id !== localItem?.id &&
          (other.item_type === 'checkbox' ||
            other.item_type === 'text' ||
            other.item_type === 'number' ||
            other.item_type === 'select' ||
            other.item_type === 'multi_select')
      ),
    [allItems, localItem?.id]
  )

  if (!localItem) {
    return (
      <div
        className={cn(
          'text-muted-foreground flex h-full flex-col items-center justify-center',
          className
        )}
      >
        <Settings2 className='mb-2 h-8 w-8 opacity-50' aria-hidden='true' />
        <p className='text-sm'>Select an item to edit</p>
        <p className='mt-1 text-xs'>Click on any item in the canvas</p>
      </div>
    )
  }

  const conditional = localItem.conditional_display
  const dependsOnItem = conditional
    ? allItems.find((i) => i.id === conditional.depends_on)
    : null

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className='mb-4 flex items-center justify-between'>
        <h3 className='text-muted-foreground text-sm font-semibold tracking-wider uppercase'>
          Item Properties
        </h3>
        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6'
          onClick={onClose}
          aria-label='Close properties panel'
        >
          <X className='h-4 w-4' aria-hidden='true' />
        </Button>
      </div>

      <ScrollArea className='-mr-4 flex-1 pr-4'>
        <div className='space-y-6'>
          {/* Basic Info */}
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor={titleId}>
                Title <span className='text-destructive'>*</span>
              </Label>
              <Input
                id={titleId}
                ref={titleInputRef}
                value={localItem.item_title}
                onChange={(e) => handleChange('item_title', e.target.value)}
                placeholder='Item title…'
                aria-invalid={!localItem.item_title.trim()}
                aria-describedby={
                  !localItem.item_title.trim() ? `${titleId}-error` : undefined
                }
              />
              {!localItem.item_title.trim() && (
                <p
                  id={`${titleId}-error`}
                  className='text-destructive text-xs'
                  role='alert'
                >
                  A title is required.
                </p>
              )}
            </div>

            <div className='space-y-2'>
              <Label htmlFor={descriptionId}>Description</Label>
              <Textarea
                id={descriptionId}
                value={localItem.item_description || ''}
                onChange={(e) =>
                  handleChange('item_description', e.target.value)
                }
                placeholder='Additional details…'
                rows={2}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor={typeId}>Type</Label>
              <Select
                value={localItem.item_type}
                onValueChange={(value) =>
                  handleChange('item_type', value as ItemType)
                }
              >
                <SelectTrigger id={typeId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ITEM_TYPE_CONFIG).map(([type, config]) => (
                    <SelectItem key={type} value={type}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Type-specific Options */}
          {(localItem.item_type === 'select' ||
            localItem.item_type === 'multi_select') && (
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor={optionsId}>Options</Label>
                <Badge variant='outline' className='text-[10px]'>
                  {localItem.options?.length ?? 0} option
                  {(localItem.options?.length ?? 0) === 1 ? '' : 's'}
                </Badge>
              </div>
              <Textarea
                id={optionsId}
                value={optionsText}
                onChange={(e) => handleOptionsChange(e.target.value)}
                placeholder={'Option 1\nOption 2\nOption 3'}
                rows={5}
                spellCheck={false}
                className='font-mono text-sm'
              />
              <p className='text-muted-foreground text-xs'>
                One option per line. Existing option keys are preserved when you
                rename a label.
              </p>
            </div>
          )}

          {localItem.item_type === 'number' && (
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <Label htmlFor={minId}>Min Value</Label>
                <Input
                  id={minId}
                  type='number'
                  inputMode='decimal'
                  value={
                    (localItem.validation_rules?.min as number | undefined) ??
                    ''
                  }
                  onChange={(e) => {
                    const raw = e.target.value
                    if (raw === '') {
                      handleValidationChange('min', undefined)
                      return
                    }
                    const parsed = parseFloat(raw)
                    handleValidationChange(
                      'min',
                      Number.isFinite(parsed) ? parsed : undefined
                    )
                  }}
                  placeholder='No min'
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor={maxId}>Max Value</Label>
                <Input
                  id={maxId}
                  type='number'
                  inputMode='decimal'
                  value={
                    (localItem.validation_rules?.max as number | undefined) ??
                    ''
                  }
                  onChange={(e) => {
                    const raw = e.target.value
                    if (raw === '') {
                      handleValidationChange('max', undefined)
                      return
                    }
                    const parsed = parseFloat(raw)
                    handleValidationChange(
                      'max',
                      Number.isFinite(parsed) ? parsed : undefined
                    )
                  }}
                  placeholder='No max'
                />
              </div>
            </div>
          )}

          {(localItem.item_type === 'text' ||
            localItem.item_type === 'number') && <Separator />}

          {/* Help & Placeholder */}
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor={helpId}>Help Text</Label>
              <Input
                id={helpId}
                value={localItem.help_text || ''}
                onChange={(e) => handleChange('help_text', e.target.value)}
                placeholder='Additional guidance…'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor={placeholderId}>Placeholder</Label>
              <Input
                id={placeholderId}
                value={localItem.placeholder || ''}
                onChange={(e) => handleChange('placeholder', e.target.value)}
                placeholder='Input placeholder…'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor={defaultId}>Default Value</Label>
              <Input
                id={defaultId}
                value={localItem.default_value || ''}
                onChange={(e) => handleChange('default_value', e.target.value)}
                placeholder='Default value…'
              />
            </div>
          </div>

          <Separator />

          {/* Settings */}
          <div className='space-y-4'>
            <div className='flex items-center justify-between'>
              <div className='space-y-0.5'>
                <Label htmlFor={requiredId}>Required</Label>
                <p className='text-muted-foreground text-xs'>
                  Must be completed before submission
                </p>
              </div>
              <Switch
                id={requiredId}
                checked={localItem.is_required}
                onCheckedChange={(checked) =>
                  handleChange('is_required', checked)
                }
              />
            </div>
          </div>

          <Separator />

          {/* Conditional Display */}
          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <div className='space-y-0.5'>
                <Label className='text-sm'>Show only when…</Label>
                <p className='text-muted-foreground text-xs'>
                  Hide this item unless another item meets a condition.
                </p>
              </div>
              <Switch
                checked={!!conditional}
                onCheckedChange={(checked) => {
                  if (!checked) {
                    handleConditionalChange(null)
                    return
                  }
                  const first = conditionalCandidates[0]
                  handleConditionalChange({
                    depends_on: first?.id ?? '',
                    condition: 'equals',
                    value: '',
                  })
                }}
                disabled={conditionalCandidates.length === 0}
                aria-label='Toggle conditional display'
              />
            </div>

            {conditional && (
              <div className='bg-muted/30 space-y-3 rounded-lg border p-3'>
                <div className='space-y-1.5'>
                  <Label htmlFor={condDependsId} className='text-xs'>
                    Depends on
                  </Label>
                  <Select
                    value={conditional.depends_on || ''}
                    onValueChange={(value) =>
                      handleConditionalChange({ depends_on: value })
                    }
                  >
                    <SelectTrigger id={condDependsId} className='h-9'>
                      <SelectValue placeholder='Pick an item…' />
                    </SelectTrigger>
                    <SelectContent>
                      {conditionalCandidates.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {candidate.item_title || '(untitled)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className='grid grid-cols-2 gap-2'>
                  <div className='space-y-1.5'>
                    <Label htmlFor={condConditionId} className='text-xs'>
                      Condition
                    </Label>
                    <Select
                      value={conditional.condition || 'equals'}
                      onValueChange={(value) =>
                        handleConditionalChange({
                          condition: value as ConditionalCondition,
                        })
                      }
                    >
                      <SelectTrigger id={condConditionId} className='h-9'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONDITION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className='space-y-1.5'>
                    <Label htmlFor={condValueId} className='text-xs'>
                      Value
                    </Label>
                    {dependsOnItem?.item_type === 'checkbox' ? (
                      <Select
                        value={conditional.value || 'true'}
                        onValueChange={(value) =>
                          handleConditionalChange({ value })
                        }
                      >
                        <SelectTrigger id={condValueId} className='h-9'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='true'>Checked</SelectItem>
                          <SelectItem value='false'>Unchecked</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : dependsOnItem?.item_type === 'select' ||
                      dependsOnItem?.item_type === 'multi_select' ? (
                      <Select
                        value={conditional.value || ''}
                        onValueChange={(value) =>
                          handleConditionalChange({ value })
                        }
                      >
                        <SelectTrigger id={condValueId} className='h-9'>
                          <SelectValue placeholder='Pick a value…' />
                        </SelectTrigger>
                        <SelectContent>
                          {(dependsOnItem.options ?? []).map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={condValueId}
                        value={conditional.value || ''}
                        onChange={(e) =>
                          handleConditionalChange({ value: e.target.value })
                        }
                        placeholder='Value…'
                        className='h-9'
                      />
                    )}
                  </div>
                </div>

                {conditionalCandidates.length === 0 && (
                  <p className='text-muted-foreground text-xs'>
                    Add at least one other item to set up conditional display.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

// Created and developed by Jai Singh
