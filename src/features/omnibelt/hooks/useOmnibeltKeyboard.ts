// Created and developed by Jai Singh
/**
 * OmniBelt — Global keyboard shortcuts
 *
 * Per spec §18:
 *   - ⌘B / Ctrl+B — toggle: collapses panel → pill, or expands pill →
 *                   panel. Walks through Orb / Nub on the way up so
 *                   the morph plays naturally.
 *   - Esc           — handled by the Panel itself when open.
 *
 * Intentionally does NOT bind ⌘K — that's owned by the existing
 * `CommandPalette` + `CommandMenu` pair. Mounted only by
 * `OmniBeltHost`, so listeners are alive only while the host is.
 */
import { useEffect } from 'react'
import { useOmnibeltStore } from '../store/omnibeltStore'

export function useOmnibeltKeyboard() {
  const collapseState = useOmnibeltStore((s) => s.collapseState)
  const setCollapseState = useOmnibeltStore((s) => s.setCollapseState)

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isToggle =
        (e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')
      if (!isToggle) return
      e.preventDefault()
      if (collapseState === 'panel') {
        setCollapseState('pill')
      } else {
        // From orb / nub / pill → panel. Mirrors the "fast path to
        // launcher" intent: the user hit the shortcut, they want the
        // tools in front of them now.
        setCollapseState('panel')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [collapseState, setCollapseState])
}

// Created and developed by Jai Singh
