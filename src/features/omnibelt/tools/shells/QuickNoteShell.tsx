// Created and developed by Jai Singh
/**
 * OmniBelt — Quick Note shell
 *
 * Per-user localStorage scratchpad. Persistence is keyed by the
 * current OmniBelt store's userId so two users on the same machine
 * never see each other's notes (mirrors the
 * `omniframe.omnibelt.${userId}.v1` shape used by the main store).
 *
 * Saving is debounced via a simple 250ms timer — keeps storage
 * writes off the keystroke critical path without losing more than
 * a fraction of a second on close.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { IconNotebook, IconX } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  getOmnibeltStoreUserId,
  type ToolShellProps,
} from '@/features/omnibelt'

function storageKeyFor(userId: string | null): string | null {
  if (!userId) return null
  return `omniframe.omnibelt.quick-note.${userId}`
}

function loadInitial(key: string | null): string {
  if (!key) return ''
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

export default function QuickNoteShell({ onClose }: ToolShellProps) {
  const userId = useMemo(() => getOmnibeltStoreUserId(), [])
  const key = useMemo(() => storageKeyFor(userId), [userId])
  const [value, setValue] = useState<string>(() => loadInitial(key))
  const writeTimer = useRef<number | null>(null)

  // Debounced persist — 250 ms after the last keystroke so we don't
  // pay a localStorage round-trip per character on long notes.
  useEffect(() => {
    if (!key) return
    if (writeTimer.current !== null) {
      window.clearTimeout(writeTimer.current)
    }
    writeTimer.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // Quota / private-mode — silently drop, user can still
        // copy the text by selection.
      }
    }, 250)
    return () => {
      if (writeTimer.current !== null) {
        window.clearTimeout(writeTimer.current)
        writeTimer.current = null
      }
    }
  }, [value, key])

  // Flush on unmount so closing the panel persists the latest text
  // even if the debounce timer hasn't fired.
  useEffect(() => {
    return () => {
      if (!key) return
      try {
        window.localStorage.setItem(key, value)
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className='flex h-full flex-col gap-3 text-sm'>
      <header className='flex items-center justify-between'>
        <h2 className='flex items-center gap-2 text-base font-semibold'>
          <IconNotebook className='size-4' />
          Quick Note
        </h2>
        <Button
          variant='ghost'
          size='icon'
          aria-label='Close Quick Note'
          onClick={onClose}
        >
          <IconX className='size-4' />
        </Button>
      </header>

      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder='Jot down what you need to remember…'
        aria-label='Quick note text'
        className='min-h-[160px] font-mono text-xs'
      />

      <p className='text-muted-foreground text-[11px]'>
        Saved to this browser only. Wipe via your browser's local storage if
        you'd like a clean slate.
      </p>
    </div>
  )
}

// Created and developed by Jai Singh
