// Created and developed by Jai Singh
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { WarehouseMapService } from '@/lib/supabase/warehouse-map.service'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { Textarea } from '@/components/ui/textarea'

interface PublishLayoutDialogProps {
  mapId: string
  open: boolean
  /** Current published revision number (optimistic concurrency hint). */
  expectedRevision?: number
  onClose: () => void
  onPublished: (revisionNumber: number) => void
}

export function PublishLayoutDialog({
  mapId,
  open,
  expectedRevision,
  onClose,
  onPublished,
}: PublishLayoutDialogProps) {
  const [summary, setSummary] = useState('')
  const [isPublishing, setIsPublishing] = useState(false)
  const [conflict, setConflict] = useState(false)
  const queryClient = useQueryClient()

  const canPublish = summary.trim().length > 0 && !isPublishing

  async function handlePublish() {
    if (!canPublish) return
    setIsPublishing(true)
    setConflict(false)

    try {
      const result = await WarehouseMapService.getInstance().publishRevision(
        mapId,
        summary.trim(),
        expectedRevision
      )
      toast.success(`Published revision v${result.version_number}`)
      queryClient.invalidateQueries({ queryKey: ['warehouse-map', mapId] })
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-layout', mapId],
      })
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-revisions', mapId],
      })
      setSummary('')
      onPublished(result.version_number)
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to publish layout changes'
      if (message.includes('Stale publish') || message.includes('40001')) {
        setConflict(true)
      } else {
        toast.error(message)
      }
    } finally {
      setIsPublishing(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSummary('')
      setConflict(false)
      onClose()
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Publish Layout Changes</AlertDialogTitle>
          <AlertDialogDescription>
            This will save all your building, zone, rack, and bin changes as a
            new immutable revision. You can roll back to any prior revision from
            the Revisions panel.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className='space-y-4'>
          <Textarea
            placeholder='Describe what changed…'
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
          />

          {conflict && (
            <p className='text-destructive text-sm'>
              Another user has published changes since you started editing.
              Refresh the layout and try again.
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPublishing}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!canPublish} onClick={handlePublish}>
            {isPublishing ? 'Publishing…' : 'Publish'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// Created and developed by Jai Singh
