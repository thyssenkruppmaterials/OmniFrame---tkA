// Created and developed by Jai Singh
/**
 * OmniBelt — Panel search box
 *
 * Controlled `<Input>` with a `⌘B` (Mac) / `Ctrl B` shortcut chip on
 * the right that hints at the global toggle. Fuzzy/substring match
 * is the consumer's job; this component just owns the visible text.
 *
 * Auto-focuses on mount so the panel-open keystroke flows directly
 * into the search field (matches the existing `CommandPalette`
 * pattern in `src/components/layout/command-palette.tsx`).
 */
import { useEffect, useRef } from 'react'
import { IconSearch } from '@tabler/icons-react'
import { Input } from '@/components/ui/input'

type PanelSearchProps = {
  value: string
  onValueChange: (v: string) => void
  placeholder?: string
}

function shortcutLabel(): string {
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  return isMac ? '⌘B' : 'Ctrl B'
}

export function PanelSearch({
  value,
  onValueChange,
  placeholder = 'Search tools…',
}: PanelSearchProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className='relative'>
      <IconSearch className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2' />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        aria-label='Search OmniBelt tools'
        className='pr-14 pl-9'
      />
      <kbd className='border-border bg-muted/60 text-muted-foreground pointer-events-none absolute top-1/2 right-2 inline-flex h-5 -translate-y-1/2 items-center rounded border px-1.5 font-mono text-[10px]'>
        {shortcutLabel()}
      </kbd>
    </div>
  )
}

// Created and developed by Jai Singh
