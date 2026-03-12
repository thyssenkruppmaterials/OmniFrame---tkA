/**
 * Ticket Attachments Panel Component
 *
 * Panel for viewing and managing ticket attachments.
 * Uses Rust Core Smartsheet service for data.
 *
 * Features:
 * - Upload files directly
 * - Attach URLs/links
 * - Download attachments
 * - Preview attachments (images, PDFs, Excel)
 */
import { useState, useRef } from 'react'
import {
  IconDownload,
  IconLink,
  IconFile,
  IconPhoto,
  IconFileText,
  IconFileSpreadsheet,
  IconUpload,
  IconLoader2,
  IconEye,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { rustSmartsheetService } from '@/lib/rust-core/smartsheet.service'
import { cn } from '@/lib/utils'
import { useGetAttachmentDownloadUrl } from '@/hooks/useSmartsheet'
import { Badge } from '@/components/ui/badge'
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
import {
  useAttachTicketUrl,
  useUploadTicketFile,
  type Attachment,
  TICKET_SHEET_ID,
} from '../hooks/useTickets'
import { AttachmentPreviewDialog } from './AttachmentPreviewDialog'

interface TicketAttachmentsPanelProps {
  ticketId: number
  attachments: Attachment[]
  onAttachmentAdded?: () => void
}

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024

export function TicketAttachmentsPanel({
  ticketId,
  attachments,
  onAttachmentAdded,
}: TicketAttachmentsPanelProps) {
  const [urlDialogOpen, setUrlDialogOpen] = useState(false)
  const [urlData, setUrlData] = useState({ url: '', name: '' })
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Preview dialog state
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false)
  const [selectedAttachment, setSelectedAttachment] =
    useState<Attachment | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isLoadingPreviewUrl, setIsLoadingPreviewUrl] = useState(false)

  const { attachUrl, isPending: isAttachingUrl } = useAttachTicketUrl()
  const { uploadFile, isPending: isUploadingFile } = useUploadTicketFile()
  const downloadMutation = useGetAttachmentDownloadUrl()

  const isUploading = isAttachingUrl || isUploadingFile

  const handleAttachUrl = async () => {
    if (!urlData.url.trim() || !urlData.name.trim()) {
      toast.error('URL and name are required')
      return
    }

    try {
      await attachUrl(ticketId, urlData.url, urlData.name)
      // Note: Toast is shown by the underlying useAttachUrlToRow hook
      setUrlData({ url: '', name: '' })
      setUrlDialogOpen(false)
      onAttachmentAdded?.()
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to attach URL'
      )
    }
  }

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const file = files[0]

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      toast.error(
        `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`
      )
      return
    }

    try {
      await uploadFile(ticketId, file)
      // Note: Toast is shown by the underlying useUploadFileToRow hook
      onAttachmentAdded?.()
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to upload file'
      )
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files)
    }
  }

  const handleDownload = async (attachment: Attachment) => {
    try {
      downloadMutation.mutate({
        sheetId: TICKET_SHEET_ID,
        attachmentId: attachment.id,
      })
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to get download URL'
      )
    }
  }

  const handlePreviewClick = async (attachment: Attachment) => {
    setSelectedAttachment(attachment)
    setPreviewDialogOpen(true)
    setPreviewUrl(null)

    // For LINK attachments, we already have the URL
    if (attachment.attachment_type === 'LINK' && attachment.url) {
      setPreviewUrl(attachment.url)
      return
    }

    // For FILE attachments, fetch the download URL
    setIsLoadingPreviewUrl(true)
    try {
      const result = await rustSmartsheetService.getAttachment(
        TICKET_SHEET_ID,
        attachment.id
      )
      if (result.success && result.data?.url) {
        setPreviewUrl(result.data.url)
      }
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to load preview'
      )
    } finally {
      setIsLoadingPreviewUrl(false)
    }
  }

  const handlePreviewDownload = () => {
    if (selectedAttachment) {
      handleDownload(selectedAttachment)
    }
  }

  const getFileIcon = (mimeType?: string, attachmentType?: string) => {
    if (attachmentType === 'LINK') {
      return <IconLink className='h-8 w-8 text-blue-500' />
    }
    if (mimeType?.includes('image')) {
      return <IconPhoto className='h-8 w-8 text-green-500' />
    }
    if (mimeType?.includes('pdf')) {
      return <IconFileText className='h-8 w-8 text-red-500' />
    }
    if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) {
      return <IconFileSpreadsheet className='h-8 w-8 text-green-600' />
    }
    return <IconFile className='text-muted-foreground h-8 w-8' />
  }

  return (
    <div className='space-y-4'>
      {/* Upload Actions */}
      <div className='flex gap-2'>
        {/* File Upload Button */}
        <input
          ref={fileInputRef}
          type='file'
          className='hidden'
          onChange={(e) => handleFileSelect(e.target.files)}
          disabled={isUploading}
        />
        <Button
          variant='default'
          size='sm'
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploadingFile ? (
            <IconLoader2 className='mr-1 h-4 w-4 animate-spin' />
          ) : (
            <IconUpload className='mr-1 h-4 w-4' />
          )}
          Upload File
        </Button>

        {/* Attach URL Button */}
        <Button
          variant='outline'
          size='sm'
          onClick={() => setUrlDialogOpen(true)}
          disabled={isUploading}
        >
          <IconLink className='mr-1 h-4 w-4' />
          Attach URL
        </Button>
      </div>

      {/* Drag & Drop Zone */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={cn(
          'rounded-lg border-2 border-dashed p-4 text-center transition-colors',
          dragActive
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-muted-foreground/50',
          isUploading && 'pointer-events-none opacity-50'
        )}
      >
        <IconUpload className='text-muted-foreground mx-auto mb-2 h-8 w-8' />
        <p className='text-muted-foreground text-sm'>
          Drag and drop a file here, or click "Upload File"
        </p>
        <p className='text-muted-foreground mt-1 text-xs'>
          Max file size: 10MB
        </p>
      </div>

      {/* Attachments List */}
      {attachments.length === 0 ? (
        <div className='text-muted-foreground py-4 text-center'>
          <IconFile className='mx-auto mb-2 h-10 w-10 opacity-40' />
          <p className='text-sm'>No attachments yet</p>
        </div>
      ) : (
        <div className='space-y-2'>
          <h4 className='text-muted-foreground text-sm font-medium'>
            {attachments.length} Attachment{attachments.length !== 1 ? 's' : ''}
          </h4>
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className='bg-card hover:bg-accent/50 group flex cursor-pointer items-center gap-4 rounded-lg border p-3 transition-colors'
              onClick={() => handlePreviewClick(attachment)}
              role='button'
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handlePreviewClick(attachment)
                }
              }}
            >
              {/* Icon */}
              <div className='shrink-0'>
                {getFileIcon(attachment.mime_type, attachment.attachment_type)}
              </div>

              {/* Info */}
              <div className='min-w-0 flex-1'>
                <p className='truncate text-sm font-medium'>
                  {attachment.name}
                </p>
                <div className='text-muted-foreground flex items-center gap-2 text-xs'>
                  <Badge variant='outline' className='text-xs'>
                    {attachment.attachment_type}
                  </Badge>
                  {attachment.size_in_kb && (
                    <span>{attachment.size_in_kb} KB</span>
                  )}
                  {attachment.created_at && (
                    <span>
                      {new Date(attachment.created_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className='flex shrink-0 items-center gap-1'>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={(e) => {
                    e.stopPropagation()
                    handlePreviewClick(attachment)
                  }}
                  title='Preview'
                  className='opacity-0 transition-opacity group-hover:opacity-100'
                >
                  <IconEye className='h-4 w-4' />
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDownload(attachment)
                  }}
                  disabled={downloadMutation.isPending}
                  title='Download'
                >
                  <IconDownload className='h-4 w-4' />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Attach URL Dialog */}
      <Dialog open={urlDialogOpen} onOpenChange={setUrlDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attach URL</DialogTitle>
            <DialogDescription>Add a link to this ticket</DialogDescription>
          </DialogHeader>
          <div className='space-y-4 py-4'>
            <div className='space-y-2'>
              <Label>URL</Label>
              <Input
                value={urlData.url}
                onChange={(e) =>
                  setUrlData({ ...urlData, url: e.target.value })
                }
                placeholder='https://example.com/document'
              />
            </div>
            <div className='space-y-2'>
              <Label>Display Name</Label>
              <Input
                value={urlData.name}
                onChange={(e) =>
                  setUrlData({ ...urlData, name: e.target.value })
                }
                placeholder='Document Name'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setUrlDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAttachUrl} disabled={isAttachingUrl}>
              {isAttachingUrl ? (
                <>
                  <IconLoader2 className='mr-1 h-4 w-4 animate-spin' />
                  Attaching...
                </>
              ) : (
                'Attach'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attachment Preview Dialog */}
      <AttachmentPreviewDialog
        open={previewDialogOpen}
        onOpenChange={setPreviewDialogOpen}
        attachment={selectedAttachment}
        downloadUrl={previewUrl}
        isLoadingUrl={isLoadingPreviewUrl}
        onDownload={handlePreviewDownload}
      />
    </div>
  )
}
