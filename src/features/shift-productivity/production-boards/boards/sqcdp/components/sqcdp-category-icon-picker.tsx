// Created and developed by Jai Singh
/**
 * Compact grid picker for the SQCDP category icon. Renders the curated
 * `SQCDP_CATEGORY_ICON_OPTIONS` allowlist as a 6-wide grid with the
 * active icon highlighted. Hover surfaces the human-readable label;
 * clicking commits the icon name to the parent form via `onChange`.
 *
 * Stays out of the bundled icon graph for icons NOT in the allowlist —
 * the JIT only sees the static imports in `category-icons.ts`.
 */
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  SQCDP_CATEGORY_ICON_OPTIONS,
  resolveCategoryIcon,
} from '../lib/category-icons'

interface SqcdpCategoryIconPickerProps {
  value: string
  onChange: (next: string) => void
  /** Background color shown behind the active icon (the chosen accent). */
  accentColor?: string
}

export function SqcdpCategoryIconPicker({
  value,
  onChange,
  accentColor = '#0EA5A9',
}: SqcdpCategoryIconPickerProps): ReactNode {
  return (
    <div
      role='radiogroup'
      aria-label='Category icon'
      className='grid grid-cols-6 gap-1.5'
    >
      {SQCDP_CATEGORY_ICON_OPTIONS.map((opt) => {
        const Icon = resolveCategoryIcon(opt.name)
        const isActive = opt.name === value
        return (
          <button
            key={opt.name}
            type='button'
            role='radio'
            aria-checked={isActive}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => onChange(opt.name)}
            className={cn(
              'border-border/50 hover:border-border hover:bg-muted/40 flex h-9 w-full items-center justify-center rounded-md border transition-colors',
              isActive && 'ring-primary ring-2 ring-offset-1'
            )}
            style={isActive ? { backgroundColor: accentColor } : undefined}
            data-testid='sqcdp-icon-picker-option'
            data-icon-name={opt.name}
          >
            <Icon
              className={cn(
                'h-4 w-4',
                isActive ? 'text-white' : 'text-foreground'
              )}
              aria-hidden
            />
          </button>
        )
      })}
    </div>
  )
}

// Created and developed by Jai Singh
