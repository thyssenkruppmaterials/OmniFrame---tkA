// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// ShortcutsDialog — single source of truth for the editor keymap.
// ---------------------------------------------------------------------------
import { Keyboard, X } from 'lucide-react'

interface Shortcut {
  keys: string
  label: string
}

const GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Navigation',
    items: [
      { keys: 'Drag', label: 'Pan (iso) / orbit' },
      { keys: 'Scroll', label: 'Zoom' },
      { keys: 'F', label: 'Frame selection' },
      { keys: 'WASD', label: 'Move (fly mode)' },
    ],
  },
  {
    title: 'Selection',
    items: [
      { keys: 'Click', label: 'Select' },
      { keys: '⇧ Click', label: 'Add / remove from selection' },
      { keys: '⌘ A', label: 'Select all objects' },
      { keys: 'Esc', label: 'Cancel · deselect · exit edit' },
    ],
  },
  {
    title: 'Edit',
    items: [
      { keys: 'Drag gizmo', label: 'Move / rotate' },
      { keys: '← ↑ → ↓', label: 'Nudge (⇧ = ×10)' },
      { keys: 'Q / E', label: 'Rotate − / + (⇧ = 90°)' },
      { keys: 'D', label: 'Duplicate' },
      { keys: 'Del / ⌫', label: 'Delete' },
      { keys: '⌘ Z / ⌘⇧ Z', label: 'Undo / Redo' },
    ],
  },
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className='absolute inset-0 z-20 flex items-center justify-center bg-black/30 backdrop-blur-[1px]'
      onClick={onClose}
      role='dialog'
      aria-modal='true'
      aria-label='Keyboard shortcuts'
    >
      <div
        className='bg-card w-[26rem] max-w-[90%] rounded-xl border p-4 shadow-2xl'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='mb-3 flex items-center justify-between'>
          <h3 className='flex items-center gap-2 text-sm font-semibold'>
            <Keyboard className='h-4 w-4' /> Keyboard shortcuts
          </h3>
          <button
            type='button'
            onClick={onClose}
            aria-label='Close'
            className='text-muted-foreground hover:text-foreground rounded p-0.5'
          >
            <X className='h-4 w-4' />
          </button>
        </div>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className='text-muted-foreground mb-1.5 text-[10px] font-semibold uppercase'>
                {g.title}
              </div>
              <ul className='space-y-1.5'>
                {g.items.map((s) => (
                  <li key={s.keys} className='flex flex-col gap-0.5'>
                    <kbd className='bg-muted text-foreground w-fit rounded border px-1.5 py-0.5 font-mono text-[11px]'>
                      {s.keys}
                    </kbd>
                    <span className='text-muted-foreground text-[11px]'>
                      {s.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
