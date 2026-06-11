// Created and developed by Jai Singh
/**
 * SqcdpCategoryCombobox — search-as-you-type picker over the org's
 * resolved category list. Replaces the v14 fixed-list `<Select>` so
 * curators can scan long lists (or freshly-created categories) without
 * scrolling.
 *
 * Keeps the v14 visual cues:
 *   * Color dot + icon in the trigger.
 *   * "(hidden)" affix when the saved category is hidden — surfaces to
 *     the curator that the metric is referencing a category that no
 *     longer renders on the board.
 *
 * Adds:
 *   * Sticky footer in the popover with "+ New category…" / "Manage…"
 *     entry points to the manager dialog.
 *   * Group rows by tier (Primary / Secondary) inside the popover for
 *     readability.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { IconChevronDown, IconPlus, IconSettings } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useSqcdpCategoriesContext } from '../hooks/use-sqcdp-categories-context'
import {
  getCategory,
  type SqcdpCategoryDef,
  type SqcdpCategoryId,
} from '../lib/categories'

interface SqcdpCategoryComboboxProps {
  value: SqcdpCategoryId
  onChange: (next: SqcdpCategoryId) => void
  disabled?: boolean
  /**
   * Optional hard-coded list. When omitted, reads from the categories
   * provider so all consumers stay in sync after manager mutations.
   */
  categoriesOverride?: readonly SqcdpCategoryDef[]
}

export function SqcdpCategoryCombobox({
  value,
  onChange,
  disabled,
  categoriesOverride,
}: SqcdpCategoryComboboxProps): ReactNode {
  const ctx = useSqcdpCategoriesContext()
  const categories = useMemo(
    () => categoriesOverride ?? ctx.categories,
    [categoriesOverride, ctx.categories]
  )
  const [open, setOpen] = useState(false)

  const visible = useMemo(
    () =>
      categories
        .filter((c) => !c.isHidden)
        .sort((a, b) =>
          a.tier === b.tier
            ? a.displayOrder - b.displayOrder
            : a.tier === 'primary'
              ? -1
              : 1
        ),
    [categories]
  )
  const hidden = useMemo(
    () => categories.filter((c) => c.isHidden),
    [categories]
  )
  const selected = getCategory(value, categories)
  const Icon = selected?.Icon

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          role='combobox'
          aria-expanded={open}
          aria-haspopup='listbox'
          disabled={disabled}
          className='w-full justify-between font-normal'
          data-testid='sqcdp-category-combobox-trigger'
        >
          <span className='flex min-w-0 items-center gap-2'>
            {selected ? (
              <>
                <span
                  aria-hidden
                  className='inline-block h-2 w-2 shrink-0 rounded-full'
                  style={{ backgroundColor: selected.defaultColor }}
                />
                {Icon && (
                  <Icon
                    className='text-muted-foreground h-3.5 w-3.5 shrink-0'
                    aria-hidden
                  />
                )}
                <span className='truncate'>{selected.label}</span>
                {selected.isHidden && (
                  <span className='text-muted-foreground text-[11px]'>
                    (hidden)
                  </span>
                )}
              </>
            ) : (
              <span className='text-muted-foreground'>Pick a category…</span>
            )}
          </span>
          <IconChevronDown
            className='text-muted-foreground h-3.5 w-3.5 shrink-0'
            aria-hidden
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className='w-[var(--radix-popover-trigger-width)] p-0'
        align='start'
      >
        <Command>
          <CommandInput placeholder='Search categories…' />
          <CommandList>
            <CommandEmpty>
              <div className='flex flex-col items-center gap-2 px-3 py-4 text-center'>
                <p className='text-foreground text-sm'>No categories match.</p>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  className='gap-1.5 text-xs'
                  onClick={() => {
                    setOpen(false)
                    ctx.openManager({ initialMode: 'create' })
                  }}
                >
                  <IconPlus className='h-3.5 w-3.5' aria-hidden />
                  Add a new category
                </Button>
              </div>
            </CommandEmpty>

            <CommandGroup heading='Primary'>
              {visible
                .filter((c) => c.tier === 'primary')
                .map((c) => (
                  <CategoryItem
                    key={c.id}
                    category={c}
                    isSelected={c.id === value}
                    onSelect={() => {
                      onChange(c.id)
                      setOpen(false)
                    }}
                  />
                ))}
            </CommandGroup>

            <CommandGroup heading='Secondary'>
              {visible
                .filter((c) => c.tier === 'secondary')
                .map((c) => (
                  <CategoryItem
                    key={c.id}
                    category={c}
                    isSelected={c.id === value}
                    onSelect={() => {
                      onChange(c.id)
                      setOpen(false)
                    }}
                  />
                ))}
            </CommandGroup>

            {hidden.length > 0 && (
              <CommandGroup heading='Hidden'>
                {hidden.map((c) => (
                  <CategoryItem
                    key={c.id}
                    category={c}
                    isSelected={c.id === value}
                    onSelect={() => {
                      onChange(c.id)
                      setOpen(false)
                    }}
                  />
                ))}
              </CommandGroup>
            )}

            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value='__sqcdp_action_new__'
                onSelect={() => {
                  setOpen(false)
                  ctx.openManager({ initialMode: 'create' })
                }}
              >
                <IconPlus className='mr-2 h-4 w-4' aria-hidden />
                New category…
              </CommandItem>
              <CommandItem
                value='__sqcdp_action_manage__'
                onSelect={() => {
                  setOpen(false)
                  ctx.openManager({ initialMode: 'list' })
                }}
              >
                <IconSettings className='mr-2 h-4 w-4' aria-hidden />
                Manage categories
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

interface CategoryItemProps {
  category: SqcdpCategoryDef
  isSelected: boolean
  onSelect: () => void
}

function CategoryItem({
  category,
  isSelected,
  onSelect,
}: CategoryItemProps): ReactNode {
  const Icon = category.Icon
  return (
    <CommandItem
      value={`${category.label} ${category.id}`}
      onSelect={onSelect}
      data-testid='sqcdp-category-combobox-item'
      data-category-id={category.id}
      className={cn('flex items-center gap-2', isSelected && 'bg-accent/40')}
    >
      <span
        aria-hidden
        className='inline-block h-2 w-2 shrink-0 rounded-full'
        style={{ backgroundColor: category.defaultColor }}
      />
      <Icon
        className='text-muted-foreground h-3.5 w-3.5 shrink-0'
        aria-hidden
      />
      <span className='truncate'>{category.label}</span>
      {category.isHidden && (
        <span className='text-muted-foreground ml-auto text-[10px] tracking-wide uppercase'>
          hidden
        </span>
      )}
      {category.isBuiltin && !category.isHidden && (
        <span className='text-muted-foreground ml-auto text-[10px] tracking-wide uppercase'>
          builtin
        </span>
      )}
    </CommandItem>
  )
}

// Created and developed by Jai Singh
