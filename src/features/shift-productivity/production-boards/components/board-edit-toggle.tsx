// Created and developed by Jai Singh
import { IconPencil } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useBoardEditMode } from '../hooks/use-board-edit-mode'
import { useCanEditBoards } from '../hooks/use-can-edit-boards'

/**
 * Visible only when the current user has `production_boards:edit`. Flips
 * the `?edit=1` URL bit (via `useBoardEditMode`) so per-card pencils and
 * inline `+ Add` CTAs across every board mount their edit affordances.
 *
 * The hook itself was moved to `../hooks/use-board-edit-mode.ts` to (a)
 * silence the `react-refresh/only-export-components` lint warning that
 * the previous colocation triggered and (b) sit alongside the rest of
 * the feature's URL-state hooks.
 */
export function BoardEditToggle({ className }: { className?: string }) {
  const { canEdit, isLoading } = useCanEditBoards()
  const [editMode, setEditMode] = useBoardEditMode()

  if (isLoading) return null
  if (!canEdit) return null

  const onClick = (): void => setEditMode(!editMode)

  return (
    <Button
      type='button'
      variant={editMode ? 'default' : 'outline'}
      size='sm'
      onClick={onClick}
      aria-pressed={editMode}
      className={cn(
        'gap-2',
        editMode && 'bg-sky-500 text-white hover:bg-sky-500/90 dark:bg-sky-500',
        className
      )}
    >
      <IconPencil className='h-4 w-4' aria-hidden />
      {editMode ? 'Editing' : 'Edit'}
    </Button>
  )
}

// Created and developed by Jai Singh
