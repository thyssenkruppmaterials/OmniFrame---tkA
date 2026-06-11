// Created and developed by Jai Singh
/**
 * BackgroundUploadDialog — upload a floor-plan image to use as map background.
 * Persists via WarehouseMapService.uploadBackgroundImage and updates the map's
 * active_background_asset_id.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Image as ImageIcon, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { WarehouseMapService } from '@/lib/supabase/warehouse-map.service'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface BackgroundUploadDialogProps {
  mapId: string
  open: boolean
  onClose: () => void
}

const service = WarehouseMapService.getInstance()

export function BackgroundUploadDialog({
  mapId,
  open,
  onClose,
}: BackgroundUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected')
      const asset = await service.uploadBackgroundImage(mapId, file)
      await service.updateMap(mapId, {
        active_background_asset_id: asset.id,
      } as Parameters<typeof service.updateMap>[1])
      return asset
    },
    onSuccess: () => {
      toast.success('Floor plan uploaded')
      queryClient.invalidateQueries({ queryKey: ['warehouse-map', mapId] })
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-layout', mapId],
      })
      setFile(null)
      onClose()
    },
    onError: (err: Error) => toast.error(err.message ?? 'Upload failed'),
  })

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <ImageIcon className='h-4 w-4' />
            Upload floor plan
          </DialogTitle>
          <DialogDescription>
            PNG / JPEG / WEBP. Up to 10 MB. The image is rendered behind zones
            and racks so you can use it as a layout reference.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label htmlFor='bg-file' className='text-xs'>
              File
            </Label>
            <Input
              id='bg-file'
              type='file'
              accept='image/png,image/jpeg,image/webp'
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {file && (
            <p className='text-muted-foreground text-xs'>
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant='ghost'
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            disabled={!file || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <Upload className='mr-1.5 h-3.5 w-3.5' />
            {mutation.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
