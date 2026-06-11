// Created and developed by Jai Singh
/**
 * Resizable dialog-content wrapper for the post composer.
 *
 * The shadcn `<DialogContent>` is a fixed-width modal by default. The
 * composer's UX brief calls for the dialog body to be **user-resizable**
 * (drag a corner / edge) so power-users (HR, Safety) can stretch the
 * editor to fit a wide screen or shrink it to make the board visible
 * behind it. Implementation: render the inner body inside a `<div>` whose
 * width / height are React-state-driven, persisted to localStorage on
 * commit, with a corner drag handle that mutates the state via pointer
 * events.
 *
 * Why not `react-resizable-panels`? It's tuned for inside-app layout
 * panels (split panes), not dialog resizing — too heavy for the one use
 * site, and not in the dep tree. The corner-handle recipe is ~80 LOC and
 * leans only on `pointerdown` / `pointermove`.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ComposerResizableShellProps {
  /** localStorage key. Different composers (e.g. post vs job) get
   * different keys so each can remember its own dimensions. */
  storageKey: string
  defaultWidth: number
  defaultHeight: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  className?: string
  children: ReactNode
}

interface PersistedSize {
  width: number
  height: number
}

function readPersisted(key: string): PersistedSize | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedSize>
    if (
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number' &&
      parsed.width > 0 &&
      parsed.height > 0
    ) {
      return { width: parsed.width, height: parsed.height }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function ComposerResizableShell({
  storageKey,
  defaultWidth,
  defaultHeight,
  minWidth = 720,
  minHeight = 480,
  maxWidth = 1800,
  maxHeight = 1200,
  className,
  children,
}: ComposerResizableShellProps) {
  const [size, setSize] = useState<PersistedSize>(() => {
    const persisted = readPersisted(storageKey)
    return persisted ?? { width: defaultWidth, height: defaultHeight }
  })

  // Clamp on viewport resize so the shell never overflows the screen.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const clamp = (): void => {
      setSize((prev) => ({
        width: Math.min(prev.width, window.innerWidth - 32),
        height: Math.min(prev.height, window.innerHeight - 32),
      }))
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [])

  const dragOriginRef = useRef<{
    startX: number
    startY: number
    startW: number
    startH: number
  } | null>(null)

  const persist = useCallback(
    (next: PersistedSize) => {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        /* quota — ignore */
      }
    },
    [storageKey]
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    dragOriginRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: size.width,
      startH: size.height,
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const origin = dragOriginRef.current
    if (!origin) return
    const dx = e.clientX - origin.startX
    const dy = e.clientY - origin.startY
    const nextW = Math.min(
      Math.max(origin.startW + dx, minWidth),
      Math.min(maxWidth, window.innerWidth - 32)
    )
    const nextH = Math.min(
      Math.max(origin.startH + dy, minHeight),
      Math.min(maxHeight, window.innerHeight - 32)
    )
    setSize({ width: nextW, height: nextH })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (dragOriginRef.current) {
      dragOriginRef.current = null
      persist(size)
    }
    if ((e.target as Element).hasPointerCapture(e.pointerId)) {
      ;(e.target as Element).releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div
      className={cn('relative', className)}
      style={{ width: `${size.width}px`, height: `${size.height}px` }}
    >
      {children}
      <div
        role='separator'
        aria-orientation='vertical'
        aria-label='Resize composer'
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className='hover:bg-primary/30 absolute right-0 bottom-0 z-20 h-5 w-5 cursor-se-resize touch-none rounded-tl-md bg-transparent transition-colors'
      >
        <svg
          viewBox='0 0 12 12'
          aria-hidden
          className='text-muted-foreground absolute right-1 bottom-1 h-3 w-3 opacity-60'
        >
          <path
            d='M0 12 L12 0 M5 12 L12 5 M10 12 L12 10'
            stroke='currentColor'
            strokeWidth='1.2'
            fill='none'
          />
        </svg>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
