// Created and developed by Jai Singh
/**
 * KeyboardShortcutsDialog — modal cheatsheet of warehouse-map keyboard
 * shortcuts. Triggered from the help button on the EditActionBar.
 */
import { Keyboard } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

interface ShortcutGroup {
  heading: string
  shortcuts: { keys: string[]; description: string }[]
}

const GROUPS: ShortcutGroup[] = [
  {
    heading: 'General',
    shortcuts: [
      { keys: ['⌘', 'K'], description: 'Open command palette' },
      { keys: ['⌘', 'Z'], description: 'Undo' },
      { keys: ['⌘', '⇧', 'Z'], description: 'Redo' },
      { keys: ['Esc'], description: 'Cancel current edit / clear selection' },
      { keys: ['?'], description: 'Show this help' },
    ],
  },
  {
    heading: 'Map navigation',
    shortcuts: [
      { keys: ['Scroll'], description: 'Zoom around cursor' },
      { keys: ['Drag'], description: 'Pan' },
      { keys: ['F'], description: 'Fit to view' },
      { keys: ['+'], description: 'Zoom in' },
      { keys: ['-'], description: 'Zoom out' },
      { keys: ['2'], description: 'Switch to 2D view' },
      { keys: ['3'], description: 'Toggle 3D view' },
    ],
  },
  {
    heading: '3D view',
    shortcuts: [
      { keys: ['Drag'], description: 'Orbit around the warehouse' },
      { keys: ['Right-drag'], description: 'Pan' },
      { keys: ['Scroll'], description: 'Zoom in/out' },
      { keys: ['Click cell'], description: 'Open location details' },
    ],
  },
  {
    heading: 'Edit racks',
    shortcuts: [
      { keys: ['Click'], description: 'Select rack' },
      { keys: ['Drag'], description: 'Move rack' },
      { keys: ['R'], description: 'Rotate selected rack 90°' },
      { keys: ['⌘', 'D'], description: 'Duplicate selected rack' },
      { keys: ['⌫'], description: 'Delete selected rack' },
    ],
  },
  {
    heading: 'Edit zones / building',
    shortcuts: [
      { keys: ['Click'], description: 'Add polygon vertex' },
      { keys: ['Click first'], description: 'Close polygon' },
      { keys: ['Double-click'], description: 'Close polygon' },
      { keys: ['Enter'], description: 'Commit current polygon' },
      { keys: ['⌫'], description: 'Remove last vertex' },
      { keys: ['Esc'], description: 'Cancel polygon' },
    ],
  },
  {
    heading: 'Edit aisles',
    shortcuts: [
      { keys: ['Click empty'], description: 'Add a waypoint node' },
      { keys: ['Click node'], description: 'Select / start connection' },
      { keys: ['Click 2nd node'], description: 'Connect two nodes' },
      { keys: ['Drag node'], description: 'Move waypoint' },
    ],
  },
]

interface KeyboardShortcutsDialogProps {
  open: boolean
  onClose: () => void
}

export function KeyboardShortcutsDialog({
  open,
  onClose,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className='max-w-xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Keyboard className='h-4 w-4' />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            All warehouse-map shortcuts at a glance.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className='max-h-[60vh] pr-4'>
          <div className='grid grid-cols-1 gap-5 sm:grid-cols-2'>
            {GROUPS.map((group) => (
              <div key={group.heading}>
                <h4 className='text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase'>
                  {group.heading}
                </h4>
                <ul className='space-y-1.5'>
                  {group.shortcuts.map((s, i) => (
                    <li
                      key={i}
                      className='flex items-center justify-between gap-2 text-sm'
                    >
                      <span className='text-muted-foreground'>
                        {s.description}
                      </span>
                      <span className='flex items-center gap-1'>
                        {s.keys.map((k) => (
                          <kbd
                            key={k}
                            className='bg-muted text-foreground inline-flex h-5 min-w-[18px] items-center justify-center rounded border px-1 text-[11px] font-medium'
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
