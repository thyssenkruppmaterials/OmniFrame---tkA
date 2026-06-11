// Created and developed by Jai Singh
/**
 * OmniBelt — Agent Chat: image preview dialog
 *
 * Lightweight overlay rendered when the user taps a chat attachment
 * thumbnail. Uses the project's shadcn `<Dialog>` (NOT a fresh Radix
 * wrapper) so focus management, backdrop, and Escape handling come
 * for free.
 *
 * Closes via the built-in Dialog close button (top-right ×) and via
 * `onOpenChange(false)` when the backdrop is clicked.
 */
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type ImageViewDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  src: string | null
  alt?: string
  className?: string
}

export function ImageViewDialog({
  open,
  onOpenChange,
  src,
  alt = 'Attached image',
  className,
}: ImageViewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'border-white/10 bg-black/90 p-4 sm:max-w-3xl',
          className
        )}
      >
        <DialogHeader className='sr-only'>
          <DialogTitle>Image preview</DialogTitle>
          <DialogDescription>
            Full-size view of the attached image. Press Escape or click outside
            to close.
          </DialogDescription>
        </DialogHeader>
        {src ? (
          <img
            src={src}
            alt={alt}
            className='mx-auto max-h-[80vh] w-auto rounded-md object-contain'
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
