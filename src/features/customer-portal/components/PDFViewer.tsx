// Created and developed by Jai Singh
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  IconLoader2,
  IconChevronLeft,
  IconChevronRight,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset,
  IconArrowsMaximize,
} from '@tabler/icons-react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { TICKET_SHEET_ID } from '../hooks/useTickets'

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

// Zoom configuration
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.0
const ZOOM_STEP = 0.25
const ZOOM_DEFAULT = 1.0

interface PDFViewerProps {
  url?: string
  attachmentId?: number
  sheetId?: number
  onError?: () => void
}

/**
 * Get the URL to fetch the PDF file.
 * Prefers the direct proxy endpoint with attachment ID (avoids URL encoding issues).
 * Falls back to URL-based proxy for backwards compatibility.
 */
function getPdfUrl(
  url?: string,
  attachmentId?: number,
  sheetId?: number
): string {
  // Prefer attachment ID based proxy (avoids URL encoding issues with S3 pre-signed URLs)
  if (attachmentId && sheetId) {
    return `/api/proxy/smartsheet/${sheetId}/attachment/${attachmentId}`
  }

  // Fall back to URL-based approach
  if (url) {
    const needsProxy =
      url.includes('s3.amazonaws.com') ||
      url.includes('smartsheet') ||
      url.includes('amazonaws.com')

    if (needsProxy) {
      return `/api/proxy/attachment?url=${encodeURIComponent(url)}`
    }
    return url
  }

  return ''
}

export function PDFViewer({
  url,
  attachmentId,
  sheetId = TICKET_SHEET_ID,
  onError,
}: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)

  // Zoom state
  const [zoom, setZoom] = useState<number>(ZOOM_DEFAULT)

  // Pan/drag state
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [scrollStart, setScrollStart] = useState({ x: 0, y: 0 })

  // Refs
  const blobUrlRef = useRef<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(ZOOM_MAX, prev + ZOOM_STEP))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(ZOOM_MIN, prev - ZOOM_STEP))
  }, [])

  const handleZoomReset = useCallback(() => {
    setZoom(ZOOM_DEFAULT)
  }, [])

  const handleFitToWidth = useCallback(() => {
    // Reset to a comfortable fit - this is a simplified version
    // In a more complex implementation, you'd calculate based on container width
    setZoom(1.0)
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0
    }
  }, [])

  // Pan/drag handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only enable dragging when zoomed in
      if (zoom <= 1.0) return

      setIsDragging(true)
      setDragStart({ x: e.clientX, y: e.clientY })
      if (containerRef.current) {
        setScrollStart({
          x: containerRef.current.scrollLeft,
          y: containerRef.current.scrollTop,
        })
      }
    },
    [zoom]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return

      const deltaX = e.clientX - dragStart.x
      const deltaY = e.clientY - dragStart.y

      if (containerRef.current) {
        containerRef.current.scrollLeft = scrollStart.x - deltaX
        containerRef.current.scrollTop = scrollStart.y - deltaY
      }
    },
    [isDragging, dragStart, scrollStart]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    async function fetchPdf() {
      const fetchUrl = getPdfUrl(url, attachmentId, sheetId)
      if (!fetchUrl) {
        setError(true)
        onError?.()
        return
      }

      try {
        setIsLoading(true)
        setError(false)

        // Clean up previous blob URL before creating a new one
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current)
          blobUrlRef.current = null
        }

        // Attach auth headers for proxy endpoints that require authentication
        const fetchHeaders: Record<string, string> = {}
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession()
          if (session?.access_token) {
            fetchHeaders['Authorization'] = `Bearer ${session.access_token}`
          }
        } catch {
          /* continue without token */
        }

        const response = await fetch(fetchUrl, { headers: fetchHeaders })
        if (!response.ok) throw new Error('Failed to fetch')
        const arrayBuffer = await response.arrayBuffer()

        // Create a Blob URL instead of passing ArrayBuffer directly
        // This prevents "detached ArrayBuffer" errors when react-pdf
        // transfers data to its web worker
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' })
        const newBlobUrl = URL.createObjectURL(blob)
        blobUrlRef.current = newBlobUrl
        setBlobUrl(newBlobUrl)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        setError(true)
        onError?.()
      } finally {
        setIsLoading(false)
      }
    }
    fetchPdf()

    // Cleanup function to revoke the blob URL when component unmounts
    // or when dependencies change
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [url, attachmentId, sheetId, onError])

  if (isLoading) {
    return (
      <div className='flex h-full flex-col items-center justify-center py-16'>
        <IconLoader2 className='text-muted-foreground mb-4 h-8 w-8 animate-spin' />
        <p className='text-muted-foreground text-sm'>Loading PDF...</p>
      </div>
    )
  }

  if (error || !blobUrl) {
    return null // Let parent handle error state
  }

  return (
    <div className='flex h-full flex-col'>
      {/* Toolbar: Page navigation and Zoom controls */}
      <div className='bg-muted/30 flex items-center justify-between gap-4 border-b px-4 py-2'>
        {/* Page navigation */}
        <div className='flex items-center gap-2'>
          {numPages > 1 ? (
            <>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                title='Previous page'
              >
                <IconChevronLeft className='h-4 w-4' />
              </Button>
              <span className='min-w-[100px] text-center text-sm'>
                Page {currentPage} of {numPages}
              </span>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                disabled={currentPage >= numPages}
                title='Next page'
              >
                <IconChevronRight className='h-4 w-4' />
              </Button>
            </>
          ) : (
            <span className='text-muted-foreground text-sm'>Single page</span>
          )}
        </div>

        {/* Zoom controls */}
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={handleZoomOut}
            disabled={zoom <= ZOOM_MIN}
            title='Zoom out'
          >
            <IconZoomOut className='h-4 w-4' />
          </Button>

          <span className='min-w-[50px] text-center text-sm font-medium'>
            {Math.round(zoom * 100)}%
          </span>

          <Button
            variant='outline'
            size='sm'
            onClick={handleZoomIn}
            disabled={zoom >= ZOOM_MAX}
            title='Zoom in'
          >
            <IconZoomIn className='h-4 w-4' />
          </Button>

          <div className='bg-border mx-1 h-5 w-px' />

          <Button
            variant='outline'
            size='sm'
            onClick={handleZoomReset}
            disabled={zoom === ZOOM_DEFAULT}
            title='Reset zoom (100%)'
          >
            <IconZoomReset className='h-4 w-4' />
          </Button>

          <Button
            variant='outline'
            size='sm'
            onClick={handleFitToWidth}
            title='Fit to width'
          >
            <IconArrowsMaximize className='h-4 w-4' />
          </Button>
        </div>
      </div>

      {/* PDF content with pan/drag support */}
      <div
        ref={containerRef}
        className={`flex flex-1 justify-center overflow-auto p-4 ${
          zoom > 1.0
            ? isDragging
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : 'cursor-default'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{ userSelect: isDragging ? 'none' : 'auto' }}
      >
        <Document
          file={blobUrl}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={() => {
            setError(true)
            onError?.()
          }}
          loading={
            <div className='flex items-center justify-center py-16'>
              <IconLoader2 className='text-muted-foreground h-8 w-8 animate-spin' />
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            scale={zoom}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            className='shadow-lg'
          />
        </Document>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
