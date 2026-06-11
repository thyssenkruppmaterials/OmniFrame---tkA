// Created and developed by Jai Singh
/**
 * Drag-and-drop multi-attachment uploader for the post composer.
 *
 * Features:
 *   - Drag-drop zone + click-to-browse
 *   - Image preview thumbnails + PDF generic icon
 *   - Per-attachment caption (optional, persisted on the row)
 *   - dnd-kit reorder via drag handle (persists display_order)
 *   - Delete (best-effort storage cleanup; the row gets removed even on
 *     storage error because the user might be cleaning up a stale entry
 *     after a previous quota / 403)
 *   - Max files configurable (default 8). File size capped to 10 MB to
 *     match the bucket's `file_size_limit` set in migration 305.
 *
 * The uploads write to the SAME `production-board-images` bucket the
 * legacy editor used; the path convention is now
 * `{org_id}/{draft_or_post_id}/{uuid}.{ext}` (vs the legacy
 * `{org_id}/{uuid}.{ext}` flat layout) so attachments cluster per-post,
 * which makes admin cleanup (e.g. delete-post → recursive delete) easy
 * later.
 */
import { useCallback, useRef, useState } from 'react'
import {
  IconFileText,
  IconGripVertical,
  IconUpload,
  IconX,
} from '@tabler/icons-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Attachment } from './composer-types'

const BUCKET = 'production-board-images'
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MiB
const ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
])

interface ComposerAttachmentUploaderProps {
  value: Attachment[]
  onChange: (next: Attachment[]) => void
  organizationId: string
  /** Used in the storage path. For unsaved posts, pass a stable draft id
   * (e.g. crypto.randomUUID() generated once per composer open). */
  bucketScope: string
  maxFiles?: number
  disabled?: boolean
}

export function ComposerAttachmentUploader({
  value,
  onChange,
  organizationId,
  bucketScope,
  maxFiles = 8,
  disabled,
}: ComposerAttachmentUploaderProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const remainingSlots = Math.max(0, maxFiles - value.length)

  const uploadFile = useCallback(
    async (file: File): Promise<Attachment | null> => {
      if (!ALLOWED_MIME.has(file.type)) {
        toast.error(`${file.name} — unsupported type (${file.type})`)
        return null
      }
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} — exceeds 10 MB limit`)
        return null
      }
      const ext = file.name.includes('.')
        ? (file.name.split('.').pop() ?? '').toLowerCase()
        : ''
      const id = crypto.randomUUID()
      const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin'
      const path = `${organizationId}/${bucketScope}/${id}.${safeExt}`

      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type,
        upsert: false,
      })
      if (error) {
        logger.error('[ComposerAttachmentUploader] upload failed', error)
        toast.error(`${file.name} — ${error.message}`)
        return null
      }

      let width: number | undefined
      let height: number | undefined
      if (file.type.startsWith('image/')) {
        try {
          const dims = await measureImage(file)
          width = dims.width
          height = dims.height
        } catch {
          /* dimensions are nice-to-have */
        }
      }

      return {
        id,
        storage_path: path,
        mime_type: file.type,
        file_name: file.name,
        caption: undefined,
        width,
        height,
        size_bytes: file.size,
        display_order: 0, // re-numbered on every commit (see commitAttachments)
      }
    },
    [bucketScope, organizationId]
  )

  const commitAttachments = useCallback(
    (next: Attachment[]): void => {
      const renumbered = next.map((a, idx) => ({
        ...a,
        display_order: idx,
      }))
      onChange(renumbered)
    },
    [onChange]
  )

  const handleFiles = useCallback(
    async (filesList: FileList | File[]): Promise<void> => {
      if (!organizationId) {
        toast.error('Missing organization context — sign in again.')
        return
      }
      const files = Array.from(filesList).slice(0, remainingSlots)
      if (files.length === 0) return
      setIsUploading(true)
      try {
        const uploaded = await Promise.all(files.map(uploadFile))
        const next = [...value, ...uploaded.filter((x): x is Attachment => !!x)]
        commitAttachments(next)
      } finally {
        setIsUploading(false)
      }
    },
    [commitAttachments, organizationId, remainingSlots, uploadFile, value]
  )

  const handleRemove = useCallback(
    async (attachment: Attachment): Promise<void> => {
      // Best-effort storage cleanup. We persist the JSONB removal even on
      // storage error so a forbidden / stale orphan can still be cleared.
      try {
        await supabase.storage.from(BUCKET).remove([attachment.storage_path])
      } catch (err) {
        logger.warn(
          '[ComposerAttachmentUploader] storage delete failed (continuing)',
          err
        )
      }
      commitAttachments(value.filter((a) => a.id !== attachment.id))
    },
    [commitAttachments, value]
  )

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = value.findIndex((a) => a.id === active.id)
    const newIndex = value.findIndex((a) => a.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    commitAttachments(arrayMove(value, oldIndex, newIndex))
  }

  const handleCaptionChange = (id: string, caption: string): void => {
    onChange(value.map((a) => (a.id === id ? { ...a, caption } : a)))
  }

  const dropzoneDisabled = disabled || remainingSlots === 0

  return (
    <div className='flex flex-col gap-3'>
      <label
        onDragOver={(e) => {
          if (dropzoneDisabled) return
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          if (dropzoneDisabled) return
          e.preventDefault()
          setDragOver(false)
          await handleFiles(e.dataTransfer.files)
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6 text-sm transition-colors',
          'border-border/60 hover:bg-muted/40',
          dragOver && 'border-primary/60 bg-primary/5',
          dropzoneDisabled && 'pointer-events-none opacity-60'
        )}
      >
        <IconUpload className='text-muted-foreground h-6 w-6' aria-hidden />
        <span className='text-foreground/90 font-medium'>
          {isUploading
            ? 'Uploading…'
            : remainingSlots === 0
              ? `Maximum ${maxFiles} attachments reached`
              : 'Drop files or click to upload'}
        </span>
        <span className='text-muted-foreground text-xs'>
          {remainingSlots > 0
            ? `JPG · PNG · WEBP · GIF · PDF — up to 10 MB each, ${remainingSlots} slot${remainingSlots === 1 ? '' : 's'} left`
            : 'Remove an attachment to add another'}
        </span>
        <input
          ref={inputRef}
          type='file'
          accept={Array.from(ALLOWED_MIME).join(',')}
          multiple
          disabled={dropzoneDisabled}
          className='sr-only'
          onChange={async (e) => {
            if (e.target.files) await handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </label>

      {value.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={value.map((a) => a.id)}
            strategy={rectSortingStrategy}
          >
            <ul className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              {value.map((attachment) => (
                <AttachmentPreviewItem
                  key={attachment.id}
                  attachment={attachment}
                  disabled={disabled}
                  onRemove={() => handleRemove(attachment)}
                  onCaptionChange={(c) => handleCaptionChange(attachment.id, c)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}

interface AttachmentPreviewItemProps {
  attachment: Attachment
  disabled?: boolean
  onRemove: () => void
  onCaptionChange: (caption: string) => void
}

function AttachmentPreviewItem({
  attachment,
  disabled,
  onRemove,
  onCaptionChange,
}: AttachmentPreviewItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: attachment.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }

  const publicUrl = supabase.storage
    .from(BUCKET)
    .getPublicUrl(attachment.storage_path).data.publicUrl

  const isImage = attachment.mime_type.startsWith('image/')

  return (
    <li
      ref={setNodeRef}
      style={style}
      className='border-border/60 bg-card flex flex-col gap-2 rounded-md border p-2'
    >
      <div className='border-border/40 bg-muted/30 relative flex h-32 items-center justify-center overflow-hidden rounded-sm border'>
        {isImage ? (
          // Attachments are user-supplied content; alt is the file_name +
          // a fallback so screen readers can identify them.
          <img
            src={publicUrl}
            alt={attachment.caption || attachment.file_name}
            className='h-full w-full object-cover'
          />
        ) : (
          <div className='flex flex-col items-center gap-1 text-xs'>
            <IconFileText
              className='text-muted-foreground h-8 w-8'
              aria-hidden
            />
            <span className='text-muted-foreground'>PDF</span>
          </div>
        )}
        <Button
          type='button'
          size='icon'
          variant='secondary'
          disabled={disabled}
          className='absolute top-1 right-1 h-7 w-7'
          onClick={onRemove}
          aria-label={`Remove ${attachment.file_name}`}
        >
          <IconX className='h-4 w-4' />
        </Button>
        <button
          type='button'
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={`Reorder ${attachment.file_name}`}
          className='text-muted-foreground hover:text-foreground absolute top-1 left-1 flex h-7 w-7 cursor-grab items-center justify-center rounded-md bg-black/30 backdrop-blur-sm active:cursor-grabbing'
        >
          <IconGripVertical className='h-4 w-4' aria-hidden />
        </button>
      </div>
      <div className='flex flex-col gap-1'>
        <span
          className='text-foreground/90 truncate text-xs'
          title={attachment.file_name}
        >
          {attachment.file_name}
        </span>
        <Input
          type='text'
          placeholder='Caption (optional)'
          value={attachment.caption ?? ''}
          onChange={(e) => onCaptionChange(e.target.value)}
          disabled={disabled}
          className='h-7 text-xs'
        />
      </div>
    </li>
  )
}

async function measureImage(
  file: File
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight }
      URL.revokeObjectURL(url)
      resolve(dims)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Image load failed'))
    }
    img.src = url
  })
}

// Created and developed by Jai Singh
