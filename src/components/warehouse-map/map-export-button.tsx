// Created and developed by Jai Singh
import { useRef, useState } from 'react'
import { toPng, toJpeg } from 'html-to-image'
import { Download, FileImage, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

type ExportFormat = 'png' | 'jpeg' | 'pdf'

interface MapExportButtonProps {
  /** Element id (or ref) of the container that wraps the map. Required. */
  targetElementId: string
  /** Used in filenames, defaults to 'warehouse-map'. */
  filenamePrefix?: string
  /** Disable while loading. */
  disabled?: boolean
}

const MAP_BACKGROUND_COLOR = '#020617'
const PRINT_FALLBACK_CLOSE_MS = 2000

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'Unknown error'
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function triggerDownload(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function resolveTarget(targetElementId: string): HTMLElement {
  const el = document.getElementById(targetElementId)
  if (!el) {
    throw new Error(`Element "#${targetElementId}" not found in DOM`)
  }
  return el
}

/**
 * Build the HTML document used for the PDF print preview window.
 * The captured PNG is embedded inline and `window.print()` is invoked
 * once the image finishes loading. The window is closed on
 * `afterprint` or via a 2 s fallback timer.
 */
function buildPrintDocument(dataUrl: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  @page { size: A3 landscape; margin: 0; }
  html, body { margin: 0; padding: 0; background: ${MAP_BACKGROUND_COLOR}; }
  img { display: block; width: 100%; height: auto; }
</style>
</head>
<body>
<img id="snapshot" alt="${title}" />
<script>
  (function () {
    var img = document.getElementById('snapshot');
    var closed = false;
    function safeClose() {
      if (closed) return;
      closed = true;
      try { window.close(); } catch (e) { /* noop */ }
    }
    img.onload = function () {
      try { window.focus(); window.print(); }
      catch (e) { safeClose(); }
    };
    img.onerror = safeClose;
    window.onafterprint = safeClose;
    setTimeout(safeClose, ${PRINT_FALLBACK_CLOSE_MS});
    img.src = ${JSON.stringify(dataUrl)};
  })();
</script>
</body>
</html>`
}

/**
 * `MapExportButton` is a small dropdown-menu button that exports the
 * currently rendered map view as a PNG, JPEG (95% quality), or
 * A3-landscape PDF.
 *
 * The component captures the DOM subtree referenced by
 * `targetElementId` using `html-to-image`. For PDF, the captured PNG
 * is embedded into a freshly-opened print preview window which auto
 * triggers `window.print()` and self-closes once printing finishes.
 *
 * The parent is responsible for placing a stable `id={targetElementId}`
 * on the wrapper div that contains the map *and all overlays* it
 * should capture (legend, mini-map, route overlay, etc.).
 */
export function MapExportButton({
  targetElementId,
  filenamePrefix = 'warehouse-map',
  disabled = false,
}: MapExportButtonProps) {
  const [loading, setLoading] = useState(false)
  const printWindowRef = useRef<Window | null>(null)

  const isDisabled = disabled || loading

  const handleExport = async (format: ExportFormat): Promise<void> => {
    if (loading) return
    setLoading(true)

    const ext = format === 'jpeg' ? 'jpg' : format
    const filename = `${filenamePrefix}-${isoDate()}.${ext}`

    try {
      const target = resolveTarget(targetElementId)

      if (format === 'png') {
        const dataUrl = await toPng(target, {
          pixelRatio: 2,
          backgroundColor: MAP_BACKGROUND_COLOR,
        })
        triggerDownload(dataUrl, filename)
        toast.success(`Exported ${filename}`)
        return
      }

      if (format === 'jpeg') {
        const dataUrl = await toJpeg(target, {
          pixelRatio: 2,
          quality: 0.95,
          backgroundColor: MAP_BACKGROUND_COLOR,
        })
        triggerDownload(dataUrl, filename)
        toast.success(`Exported ${filename}`)
        return
      }

      try {
        const dataUrl = await toPng(target, {
          pixelRatio: 2,
          backgroundColor: MAP_BACKGROUND_COLOR,
        })
        const printWindow = window.open('', '_blank', 'width=1280,height=860')
        if (!printWindow) {
          throw new Error('Popup blocked — allow popups to export PDF')
        }
        printWindowRef.current = printWindow
        const title = `${filenamePrefix}-${isoDate()}`
        printWindow.document.open()
        printWindow.document.write(buildPrintDocument(dataUrl, title))
        printWindow.document.close()
        toast.success('Opened PDF print preview')
      } catch (pdfErr: unknown) {
        if (printWindowRef.current && !printWindowRef.current.closed) {
          printWindowRef.current.close()
        }
        printWindowRef.current = null
        throw pdfErr
      }
    } catch (err: unknown) {
      toast.error(`Export failed: ${getErrorMessage(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          disabled={isDisabled}
          aria-label='Export map'
        >
          <Download className='mr-2 h-4 w-4' />
          {loading ? 'Exporting…' : 'Export'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-48'>
        <DropdownMenuLabel>Export map as</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isDisabled}
          onSelect={() => {
            void handleExport('png')
          }}
        >
          <FileImage className='mr-2 h-4 w-4' />
          PNG image
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isDisabled}
          onSelect={() => {
            void handleExport('jpeg')
          }}
        >
          <FileImage className='mr-2 h-4 w-4' />
          JPEG (95% quality)
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isDisabled}
          onSelect={() => {
            void handleExport('pdf')
          }}
        >
          <FileText className='mr-2 h-4 w-4' />
          PDF (A3 landscape)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Created and developed by Jai Singh
