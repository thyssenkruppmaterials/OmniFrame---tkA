/**
 * Attachment Preview Dialog Component
 *
 * Displays a preview of attachments in a popup dialog.
 * Supports images, PDFs, Excel files, and shows download option for other file types.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  IconDownload,
  IconLoader2,
  IconFileOff,
  IconPrinter,
  IconMaximize,
  IconMinimize,
  IconExternalLink,
} from '@tabler/icons-react'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Attachment } from '../hooks/useTickets'
import { TICKET_SHEET_ID } from '../hooks/useTickets'
import { ExcelViewer } from './ExcelViewer'
import { PDFViewer } from './PDFViewer'

type FileType = 'image' | 'pdf' | 'excel' | 'unknown'

interface AttachmentPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  attachment: Attachment | null
  downloadUrl?: string | null
  isLoadingUrl?: boolean
  onDownload: () => void
}

/**
 * Determine file type from MIME type or file extension
 */
function getFileType(mimeType?: string, fileName?: string): FileType {
  const mime = mimeType?.toLowerCase() || ''
  const name = fileName?.toLowerCase() || ''

  // Check for images
  if (
    mime.includes('image/') ||
    /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(name)
  ) {
    return 'image'
  }

  // Check for PDFs
  if (mime.includes('pdf') || /\.pdf$/i.test(name)) {
    return 'pdf'
  }

  // Check for Excel files
  if (
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    mime.includes('application/vnd.ms-excel') ||
    mime.includes(
      'application/vnd.openxmlformats-officedocument.spreadsheetml'
    ) ||
    /\.(xlsx|xls|csv)$/i.test(name)
  ) {
    return 'excel'
  }

  return 'unknown'
}

/**
 * Get file extension from filename
 */
function getFileExtension(fileName: string): string {
  const parts = fileName.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : ''
}

export function AttachmentPreviewDialog({
  open,
  onOpenChange,
  attachment,
  downloadUrl,
  isLoadingUrl,
  onDownload,
}: AttachmentPreviewDialogProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [viewerError, setViewerError] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const dialogContentRef = useRef<HTMLDivElement>(null)

  // Reset states when dialog opens or attachment changes
  useEffect(() => {
    if (open) {
      setIsLoading(true)
      setHasError(false)
      setViewerError(false)
      setIsFullscreen(false)
    }
  }, [open, attachment?.id])

  // Handle browser fullscreen API for true fullscreen
  const toggleFullscreen = useCallback(async () => {
    if (!isFullscreen) {
      // Enter fullscreen
      try {
        if (dialogContentRef.current) {
          await dialogContentRef.current.requestFullscreen()
          setIsFullscreen(true)
        }
      } catch {
        // Fallback: just toggle the size state if fullscreen API fails
        setIsFullscreen(true)
      }
    } else {
      // Exit fullscreen
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      }
      setIsFullscreen(false)
    }
  }, [isFullscreen])

  // Listen for fullscreen change events (e.g., user presses Escape)
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isFullscreen) {
        setIsFullscreen(false)
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () =>
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [isFullscreen])

  /**
   * Print the current attachment
   * Uses an iframe for PDFs/images to enable direct printing
   */
  const handlePrint = useCallback(async () => {
    if (!attachment) return

    const fileType = getFileType(attachment.mime_type, attachment.name)
    setIsPrinting(true)

    try {
      // Build the URL to fetch the printable content
      let printUrl: string | undefined

      if (attachment.attachment_type === 'LINK') {
        printUrl = attachment.url
      } else if (attachment.attachment_type === 'FILE' && attachment.id) {
        // Use the proxy endpoint for FILE attachments
        printUrl = `/api/proxy/smartsheet/${TICKET_SHEET_ID}/attachment/${attachment.id}`
      } else {
        printUrl = downloadUrl ?? undefined
      }

      if (!printUrl) {
        logger.error('No URL available for printing')
        setIsPrinting(false)
        return
      }

      if (fileType === 'pdf') {
        // For PDFs: Create an iframe, load the PDF, and trigger print
        const iframe = document.createElement('iframe')
        iframe.style.position = 'fixed'
        iframe.style.right = '0'
        iframe.style.bottom = '0'
        iframe.style.width = '0'
        iframe.style.height = '0'
        iframe.style.border = 'none'
        iframe.style.visibility = 'hidden'
        document.body.appendChild(iframe)

        // Fetch PDF as blob and create object URL for the iframe
        // Attach auth headers for proxy endpoints that require authentication
        const printHeaders: Record<string, string> = {}
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession()
          if (session?.access_token) {
            printHeaders['Authorization'] = `Bearer ${session.access_token}`
          }
        } catch {
          /* continue without token */
        }

        const response = await fetch(printUrl, { headers: printHeaders })
        if (!response.ok) throw new Error('Failed to fetch PDF for printing')
        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)

        iframe.src = blobUrl

        iframe.onload = () => {
          try {
            iframe.contentWindow?.focus()
            iframe.contentWindow?.print()
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (e) {
            // If print fails (e.g., cross-origin), open in new tab as fallback
            window.open(blobUrl, '_blank')
          }
          // Clean up after a delay to allow print dialog to appear
          setTimeout(() => {
            document.body.removeChild(iframe)
            URL.revokeObjectURL(blobUrl)
            setIsPrinting(false)
          }, 1000)
        }

        iframe.onerror = () => {
          document.body.removeChild(iframe)
          setIsPrinting(false)
          // Fallback: open blob URL (already fetched with auth) in new tab
          window.open(blobUrl, '_blank')
        }
      } else if (fileType === 'image') {
        // For images: Fetch with auth headers (proxy endpoints require Bearer token),
        // create a blob URL, then use it in the print window's img src
        const imgHeaders: Record<string, string> = {}
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession()
          if (session?.access_token) {
            imgHeaders['Authorization'] = `Bearer ${session.access_token}`
          }
        } catch {
          /* continue without token */
        }

        const imgResponse = await fetch(printUrl, { headers: imgHeaders })
        if (!imgResponse.ok)
          throw new Error('Failed to fetch image for printing')
        const imgBlob = await imgResponse.blob()
        const imgBlobUrl = URL.createObjectURL(imgBlob)

        const printWindow = window.open('', '_blank', 'width=800,height=600')
        if (printWindow) {
          printWindow.document.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Print - ${attachment.name}</title>
                <style>
                  body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
                  img { max-width: 100%; max-height: 100vh; object-fit: contain; }
                  @media print {
                    body { margin: 0; }
                    img { max-width: 100%; max-height: 100%; }
                  }
                </style>
              </head>
              <body>
                <img src="${imgBlobUrl}" alt="${attachment.name}" onload="window.print(); setTimeout(() => window.close(), 500);" />
              </body>
            </html>
          `)
          printWindow.document.close()
          // Revoke blob URL after a delay to allow print dialog
          setTimeout(() => URL.revokeObjectURL(imgBlobUrl), 60000)
        } else {
          URL.revokeObjectURL(imgBlobUrl)
        }
        setIsPrinting(false)
      } else {
        // For other file types, just trigger download (can't print directly)
        onDownload()
        setIsPrinting(false)
      }
    } catch (error) {
      logger.error('Print failed:', error)
      setIsPrinting(false)
    }
  }, [attachment, downloadUrl, onDownload])

  if (!attachment) return null

  const fileType = getFileType(attachment.mime_type, attachment.name)
  const fileExtension = getFileExtension(attachment.name)

  // Determine the URL to use for preview
  // For LINK attachments, use the stored URL directly
  // For FILE attachments, use the download URL
  const previewUrl =
    attachment.attachment_type === 'LINK' ? attachment.url : downloadUrl

  const handleContentLoad = () => {
    setIsLoading(false)
  }

  const handleContentError = () => {
    setIsLoading(false)
    setHasError(true)
  }

  const handleOpenExternal = async () => {
    if (!previewUrl) return

    // LINK attachments use external URLs that don't need auth
    if (attachment.attachment_type === 'LINK') {
      window.open(previewUrl, '_blank', 'noopener,noreferrer')
      return
    }

    // FILE attachments use proxy endpoints that require Bearer token auth.
    // window.open() cannot send Authorization headers, so fetch with auth
    // headers first, create a blob URL, then open that.
    try {
      const headers: Record<string, string> = {}
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      const response = await fetch(previewUrl, { headers })
      if (!response.ok) throw new Error('Failed to fetch attachment')
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      window.open(blobUrl, '_blank')
      // Revoke after a delay to allow the new tab to load
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
    } catch {
      // Last resort: try direct URL (may fail with 401 for protected endpoints)
      window.open(previewUrl, '_blank', 'noopener,noreferrer')
    }
  }

  const renderPreviewContent = () => {
    // Show loading state while fetching download URL for FILE attachments
    if (attachment.attachment_type !== 'LINK' && isLoadingUrl) {
      return (
        <div className='text-muted-foreground flex flex-col items-center justify-center py-16'>
          <IconLoader2 className='mb-4 h-12 w-12 animate-spin' />
          <p className='text-sm'>Loading preview...</p>
        </div>
      )
    }

    // Show error if URL couldn't be loaded
    if (!previewUrl && attachment.attachment_type !== 'LINK') {
      return (
        <div className='text-muted-foreground flex flex-col items-center justify-center py-16'>
          <IconFileOff className='mb-4 h-12 w-12 opacity-50' />
          <p className='text-sm font-medium'>Unable to load preview</p>
          <p className='mt-1 text-xs'>Try downloading the file instead</p>
        </div>
      )
    }

    // Render based on file type
    switch (fileType) {
      case 'image':
        return (
          <div className='flex h-full min-h-[400px] items-center justify-center p-4'>
            {isLoading && (
              <div className='absolute inset-0 flex items-center justify-center'>
                <IconLoader2 className='text-muted-foreground h-8 w-8 animate-spin' />
              </div>
            )}
            <img
              src={previewUrl!}
              alt={attachment.name}
              className={cn(
                'max-h-full max-w-full rounded-md object-contain',
                isLoading && 'opacity-0'
              )}
              onLoad={handleContentLoad}
              onError={handleContentError}
            />
            {hasError && (
              <div className='text-muted-foreground flex flex-col items-center justify-center'>
                <IconFileOff className='mb-4 h-12 w-12 opacity-50' />
                <p className='text-sm'>Failed to load image</p>
              </div>
            )}
          </div>
        )

      case 'pdf':
        // If inline viewer fails, show fallback download interface
        if (viewerError) {
          return (
            <div className='flex h-full flex-col items-center justify-center py-16'>
              <div className='mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-red-500/10'>
                <svg
                  className='h-10 w-10 text-red-600'
                  viewBox='0 0 24 24'
                  fill='currentColor'
                >
                  <path d='M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M13,9V3.5L18.5,9H13M10.92,12.31C10.68,11.54 10.15,9.08 11.55,9.04C12.95,9 12.03,12.16 12.03,12.16C12.42,13.65 14.05,14.72 14.05,14.72C14.55,14.57 17.4,14.24 17,15.72C16.57,17.2 13.5,15.81 13.5,15.81C11.55,15.95 10.09,16.47 10.09,16.47C8.96,18.58 7.64,19.5 7.1,18.61C6.43,17.5 9.23,16.07 9.23,16.07C10.68,13.72 10.92,12.31 10.92,12.31Z' />
                </svg>
              </div>
              <p className='mb-1 text-lg font-semibold'>{attachment.name}</p>
              <p className='text-muted-foreground mb-2 text-sm'>
                PDF Document
                {attachment.size_in_kb && <span className='mx-2'>•</span>}
                {attachment.size_in_kb &&
                  (attachment.size_in_kb < 1024
                    ? `${attachment.size_in_kb.toFixed(1)} KB`
                    : `${(attachment.size_in_kb / 1024).toFixed(1)} MB`)}
              </p>
              <p className='text-muted-foreground mb-6 max-w-md text-center text-xs'>
                PDF preview is not available for this file. Download to view in
                your PDF reader, or open in browser to view directly.
              </p>
              <div className='flex items-center gap-3'>
                <Button onClick={onDownload}>
                  <IconDownload className='mr-2 h-4 w-4' />
                  Download File
                </Button>
                <Button variant='outline' onClick={handleOpenExternal}>
                  <IconExternalLink className='mr-2 h-4 w-4' />
                  Open in Browser
                </Button>
              </div>
            </div>
          )
        }
        // Show inline PDF viewer - use attachment ID for FILE attachments to avoid URL encoding issues
        return (
          <div className='h-full min-h-[500px]'>
            <PDFViewer
              url={
                attachment.attachment_type === 'LINK'
                  ? (previewUrl ?? undefined)
                  : undefined
              }
              attachmentId={
                attachment.attachment_type === 'FILE'
                  ? attachment.id
                  : undefined
              }
              onError={() => setViewerError(true)}
            />
          </div>
        )

      case 'excel':
        // If inline viewer fails, show fallback download interface
        if (viewerError) {
          return (
            <div className='flex h-full flex-col items-center justify-center py-16'>
              <div className='mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-green-500/10'>
                <svg
                  className='h-10 w-10 text-green-600'
                  viewBox='0 0 24 24'
                  fill='currentColor'
                >
                  <path d='M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M10,19L12,15H9V10H15V15L13,19H10Z' />
                </svg>
              </div>
              <p className='mb-1 text-lg font-semibold'>{attachment.name}</p>
              <p className='text-muted-foreground mb-2 text-sm'>
                {fileExtension} Spreadsheet
                {attachment.size_in_kb && <span className='mx-2'>•</span>}
                {attachment.size_in_kb &&
                  (attachment.size_in_kb < 1024
                    ? `${attachment.size_in_kb.toFixed(1)} KB`
                    : `${(attachment.size_in_kb / 1024).toFixed(1)} MB`)}
              </p>
              <p className='text-muted-foreground mb-6 max-w-md text-center text-xs'>
                Excel files cannot be previewed directly. Download the file to
                open it in Microsoft Excel, Google Sheets, or another
                spreadsheet application.
              </p>
              <div className='flex items-center gap-3'>
                <Button onClick={onDownload}>
                  <IconDownload className='mr-2 h-4 w-4' />
                  Download File
                </Button>
                <Button variant='outline' onClick={handleOpenExternal}>
                  <IconExternalLink className='mr-2 h-4 w-4' />
                  Open in Browser
                </Button>
              </div>
            </div>
          )
        }
        // Show inline Excel viewer - use attachment ID for FILE attachments to avoid URL encoding issues
        return (
          <div className='h-full min-h-[500px]'>
            <ExcelViewer
              url={
                attachment.attachment_type === 'LINK'
                  ? (previewUrl ?? undefined)
                  : undefined
              }
              attachmentId={
                attachment.attachment_type === 'FILE'
                  ? attachment.id
                  : undefined
              }
              onError={() => setViewerError(true)}
            />
          </div>
        )

      case 'unknown':
      default:
        return (
          <div className='text-muted-foreground flex flex-col items-center justify-center py-16'>
            <IconFileOff className='mb-4 h-16 w-16 opacity-40' />
            <p className='text-sm font-medium'>Preview not available</p>
            <p className='mt-1 text-xs'>
              {fileExtension
                ? `${fileExtension} files cannot be previewed`
                : 'This file type cannot be previewed'}
            </p>
            <Button
              variant='default'
              size='sm'
              className='mt-4'
              onClick={onDownload}
            >
              <IconDownload className='mr-2 h-4 w-4' />
              Download to view
            </Button>
          </div>
        )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={dialogContentRef}
        className={cn(
          'flex flex-col overflow-hidden',
          isFullscreen
            ? '!fixed !inset-0 !top-0 !left-0 !h-screen !max-h-none !w-screen !max-w-none !translate-x-0 !translate-y-0 !rounded-none'
            : 'h-[85vh] max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[900px]'
        )}
        style={
          isFullscreen
            ? {
                width: '100vw',
                height: '100vh',
                maxWidth: '100vw',
                maxHeight: '100vh',
                transform: 'none',
                top: 0,
                left: 0,
                borderRadius: 0,
              }
            : undefined
        }
      >
        <DialogHeader className='shrink-0'>
          <div className='flex items-center justify-between pr-8'>
            <DialogTitle className='truncate pr-4' title={attachment.name}>
              {attachment.name}
            </DialogTitle>
            <div className='flex items-center gap-2'>
              {fileType !== 'unknown' && (
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                >
                  {isFullscreen ? (
                    <IconMinimize className='h-4 w-4' />
                  ) : (
                    <IconMaximize className='h-4 w-4' />
                  )}
                </Button>
              )}
            </div>
          </div>
          {attachment.size_in_kb && (
            <p className='text-muted-foreground text-xs'>
              {attachment.size_in_kb < 1024
                ? `${attachment.size_in_kb.toFixed(1)} KB`
                : `${(attachment.size_in_kb / 1024).toFixed(1)} MB`}
            </p>
          )}
        </DialogHeader>

        <div
          className='bg-muted/30 min-h-0 flex-1 overflow-auto rounded-md border'
          style={{ minHeight: '60vh' }}
        >
          {renderPreviewContent()}
        </div>

        <DialogFooter className='shrink-0 gap-2 sm:gap-2'>
          {previewUrl && (fileType === 'pdf' || fileType === 'image') && (
            <Button
              variant='outline'
              onClick={handlePrint}
              disabled={isPrinting}
            >
              {isPrinting ? (
                <IconLoader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : (
                <IconPrinter className='mr-2 h-4 w-4' />
              )}
              {isPrinting ? 'Preparing...' : 'Print'}
            </Button>
          )}
          <Button onClick={onDownload}>
            <IconDownload className='mr-2 h-4 w-4' />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
