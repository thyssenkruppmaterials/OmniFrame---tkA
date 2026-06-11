// Created and developed by Jai Singh
/**
 * RevisionsPanel — sidebar listing of map revisions with rollback support.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { History, RotateCcw, Check } from 'lucide-react'
import { toast } from 'sonner'
import { WarehouseMapService } from '@/lib/supabase/warehouse-map.service'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { MapRevisionListEntry } from './types'

const service = WarehouseMapService.getInstance()

interface RevisionsPanelProps {
  mapId: string | null
  open: boolean
  onClose: () => void
}

export function RevisionsPanel({ mapId, open, onClose }: RevisionsPanelProps) {
  const queryClient = useQueryClient()
  const [confirmRollback, setConfirmRollback] =
    useState<MapRevisionListEntry | null>(null)

  const { data: revisions = [], isLoading } = useQuery<MapRevisionListEntry[]>({
    queryKey: ['warehouse-map-revisions', mapId],
    queryFn: () => service.getRevisions(mapId!),
    enabled: !!mapId && open,
  })

  const rollbackMutation = useMutation({
    mutationFn: (revisionId: string) =>
      service.rollbackRevision(mapId!, revisionId),
    onSuccess: () => {
      toast.success('Rolled back to revision')
      queryClient.invalidateQueries({ queryKey: ['warehouse-map', mapId] })
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-layout', mapId],
      })
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-mappings', mapId],
      })
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-revisions', mapId],
      })
      setConfirmRollback(null)
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Failed to roll back')
    },
  })

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side='right' className='flex w-96 flex-col'>
          <SheetHeader>
            <SheetTitle className='flex items-center gap-2'>
              <History className='h-4 w-4' />
              Revisions
            </SheetTitle>
            <SheetDescription>
              Each publish snapshots the entire layout. Roll back to undo
              changes.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className='flex-1 px-4 py-2'>
            {isLoading ? (
              <p className='text-muted-foreground p-2 text-sm'>Loading…</p>
            ) : revisions.length === 0 ? (
              <p className='text-muted-foreground p-2 text-sm'>
                No revisions yet. Publish to create your first.
              </p>
            ) : (
              <ol className='border-border relative space-y-3 border-l pl-4'>
                {revisions.map((rev, idx) => (
                  <li key={rev.id} className='relative'>
                    <span className='border-background absolute -left-[22px] flex h-3 w-3 items-center justify-center rounded-full border-2 bg-blue-500' />
                    <div className='flex items-center justify-between'>
                      <div className='flex items-center gap-2'>
                        <span className='font-mono text-sm font-medium'>
                          v{rev.version_number}
                        </span>
                        <Badge variant='outline'>{rev.status}</Badge>
                        {idx === 0 && (
                          <Badge className='gap-1 bg-emerald-500/20 text-emerald-300'>
                            <Check className='h-3 w-3' />
                            Active
                          </Badge>
                        )}
                      </div>
                      {idx > 0 && rev.status === 'published' && (
                        <Button
                          size='sm'
                          variant='ghost'
                          className='h-7 px-2 text-xs'
                          onClick={() => setConfirmRollback(rev)}
                        >
                          <RotateCcw className='mr-1 h-3 w-3' />
                          Roll back
                        </Button>
                      )}
                    </div>
                    {rev.change_summary && (
                      <p className='mt-1 text-sm'>{rev.change_summary}</p>
                    )}
                    <p className='text-muted-foreground mt-0.5 text-xs'>
                      {new Date(rev.created_at).toLocaleString()}
                    </p>
                    {rev.rolled_back_from_revision_id && (
                      <p className='text-muted-foreground text-xs italic'>
                        ← rollback
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!confirmRollback}
        onOpenChange={(v) => !v && setConfirmRollback(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Roll back to v{confirmRollback?.version_number}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the current zones, racks, and bin assignments
              with the snapshot from this revision. A new "rollback" revision
              will be created so you can undo this if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirmRollback && rollbackMutation.mutate(confirmRollback.id)
              }
              disabled={rollbackMutation.isPending}
            >
              {rollbackMutation.isPending ? 'Rolling back…' : 'Roll back'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// Created and developed by Jai Singh
