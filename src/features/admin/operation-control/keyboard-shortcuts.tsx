// Created and developed by Jai Singh
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const SHORTCUTS: Array<[string, string]> = [
  ['?', 'Toggle this overlay'],
  ['Space', 'Pause / resume the live feed'],
  ['↑ ↓ ← →', 'Navigate zones in the Zone Map'],
  ['Enter', 'Open zone detail drawer'],
  ['R', 'Reassign focused operator → zone'],
  ['Shift+drag', 'Push 5 tasks to operator'],
  ['Cmd+drag', 'Fill remaining capacity'],
  ['Esc', 'Close overlays / cancel reassignment'],
]

export function KeyboardShortcuts({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <ul className='space-y-1.5 text-sm'>
          {SHORTCUTS.map(([k, label]) => (
            <li key={k} className='flex items-center justify-between gap-3'>
              <kbd className='bg-muted text-foreground inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-xs'>
                {k}
              </kbd>
              <span className='text-muted-foreground text-right'>{label}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
