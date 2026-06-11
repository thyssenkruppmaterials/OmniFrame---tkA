// Created and developed by Jai Singh
/**
 * Bordered "section" panel used by the composer body and the per-kind
 * section extras. Mirrors the recipe from
 * `Patterns/Editable-Board-Dialogs.md` § "Bordered sections + column
 * headers for dense forms" — promoted out of the SQCDP editor's in-file
 * helper so the four composer kinds can share the same visual rhythm.
 *
 * Three optional slots:
 *   - description: one-sentence helper under the title.
 *   - action: right-aligned button (e.g. "Reset" / "Generate sample").
 *   - children: the form rows themselves (caller controls spacing via
 *     gap-N on its own container if needed; the section adds gap-3).
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SectionProps {
  title: string
  description?: string
  action?: ReactNode
  className?: string
  children: ReactNode
}

export function Section({
  title,
  description,
  action,
  className,
  children,
}: SectionProps) {
  return (
    <section
      className={cn(
        'border-border/50 bg-muted/20 rounded-lg border p-4',
        className
      )}
    >
      <header className='border-border/40 mb-4 flex items-start justify-between gap-4 border-b pb-2'>
        <div className='flex flex-col gap-0.5'>
          <h3 className='text-foreground text-sm font-semibold'>{title}</h3>
          {description ? (
            <p className='text-muted-foreground text-xs'>{description}</p>
          ) : null}
        </div>
        {action ? (
          <div className='flex shrink-0 items-center'>{action}</div>
        ) : null}
      </header>
      <div className='flex flex-col gap-3'>{children}</div>
    </section>
  )
}

// Created and developed by Jai Singh
