// Created and developed by Jai Singh
/**
 * Kit Build Sheet Component
 * Printable document for kit assembly matching the production layout
 * Design based on production Kit Build Sheet template
 *
 * @component
 * Created: December 19, 2025
 */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, Loader2, Printer, X } from 'lucide-react'
import QRCode from 'qrcode'
import { RRKittingDataService } from '@/lib/supabase/rr-kitting-data.service'
import { logger } from '@/lib/utils/logger'
import { useKittingOptions } from '@/hooks/use-kitting-options'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// Spring animation configuration
const springTransition = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
  mass: 0.8,
}

interface TOLine {
  id: string
  transferOrderNumber: string
  material: string
  materialDescription: string
  sourceStorageBin: string
  destStorageBin: string
  quantity: string
  picked: boolean
  kitted: boolean
}

// INCORA item structure
interface IncoraItem {
  lineNumber: number
  value: string
}

// Authorized to Ship Short item structure
interface AuthorizedShipShortItem {
  lineNumber: number
  partNumber: string
  description: string
  // Display name of the operator who authorized the ship-short (migration 101
  // format). May be null for legacy items authorized before this was stamped.
  authorizedBy?: string | null
}

interface KitBuildSheetData {
  kitPoNumber: string
  kitBuildNumber: string
  kitSerialNumber: string
  engineProgram: string
  kitNumber: string
  deliverToPlant: string
  dueDate: string | null
  status: string
  priority: number
  addedBy: string | null
  addedAt: string | null
  kitCartColor: string | null
  kitContainerType: string | null
  chargeCode: string | null
  toLines: TOLine[]
  incoraItems: IncoraItem[]
  authorizedShipShortItems: AuthorizedShipShortItem[]
}

interface KitBuildSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kitPoNumber: string | null
  // Optional kit serial. When provided the sheet loads the specific kit
  // by serial so a PO covering multiple kits reprints the exact kit the
  // caller opened (multi-kit-per-PO correctness — see [[Kit-Serial-Scoping]]).
  // Falls back to PO resolution when omitted (e.g. the kanban Start-Kit flow).
  kitSerialNumber?: string | null
}

// Generate a random Visiprise number for tracking
const generateVisiprise = () => {
  return Math.floor(10000 + Math.random() * 90000).toString()
}

export function KitBuildSheet({
  open,
  onOpenChange,
  kitPoNumber,
  kitSerialNumber = null,
}: KitBuildSheetProps) {
  const { activeOptionsByGroup } = useKittingOptions()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kitData, setKitData] = useState<KitBuildSheetData | null>(null)
  const [visipriseNumber] = useState(() => generateVisiprise())
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null)
  // Code128 barcode data URLs keyed by TO number so each TO line on the
  // printed build sheet is individually scannable. Generated lazily (jsbarcode
  // is dynamically imported) and rendered as <img> so they survive the
  // innerHTML copy into the print window.
  const [toBarcodes, setToBarcodes] = useState<Record<string, string>>({})
  const printRef = useRef<HTMLDivElement>(null)
  const containerTypeLabelMap = useMemo(
    () =>
      Object.fromEntries(
        (activeOptionsByGroup.kit_container_type ?? []).map((option) => [
          option.option_value,
          option.option_label,
        ])
      ) as Record<string, string>,
    [activeOptionsByGroup.kit_container_type]
  )
  const chargeCodeLabelMap = useMemo(
    () =>
      Object.fromEntries(
        (activeOptionsByGroup.charge_code ?? []).map((option) => [
          option.option_value,
          option.option_label,
        ])
      ) as Record<string, string>,
    [activeOptionsByGroup.charge_code]
  )

  // Track which kit we've already loaded to prevent re-fetching
  const loadedKitPoRef = useRef<string | null>(null)

  // Load kit data when dialog opens
  const loadKitData = useCallback(async () => {
    // Prefer the globally-unique kit serial so a PO covering multiple
    // kits reprints the exact kit the caller opened (see
    // [[Kit-Serial-Scoping]]). Fall back to the PO for legacy callers
    // (e.g. the kanban Start-Kit flow) that only pass a PO.
    const loadKey = kitSerialNumber ?? kitPoNumber
    if (!loadKey) return

    setLoading(true)
    setError(null)

    try {
      const details = kitSerialNumber
        ? await RRKittingDataService.getKitBuildPlanDetailsBySerialNumber(
            kitSerialNumber
          )
        : await RRKittingDataService.getKitBuildPlanDetails(loadKey)

      if (details) {
        setKitData({
          kitPoNumber: details.kitPoNumber,
          kitBuildNumber: details.kitBuildNumber,
          kitSerialNumber: details.kitSerialNumber,
          engineProgram: details.engineProgram,
          kitNumber: details.kitNumber,
          deliverToPlant: details.deliverToPlant,
          dueDate: details.dueDate,
          status: details.status,
          priority: details.priority,
          addedBy: details.addedBy,
          addedAt: details.addedAt,
          kitCartColor: details.kitCartColor || null,
          kitContainerType: details.kitContainerType || null,
          chargeCode: details.chargeCode || null,
          toLines: details.toLines.map((line) => ({
            id: line.id,
            transferOrderNumber: line.transferOrderNumber,
            material: line.material,
            materialDescription: line.materialDescription,
            sourceStorageBin: line.sourceStorageBin,
            destStorageBin: line.destStorageBin,
            quantity: line.quantity,
            picked: line.picked,
            kitted: line.kitted,
          })),
          incoraItems: details.incoraItems || [],
          authorizedShipShortItems: details.authorizedShipShortItems || [],
        })
        loadedKitPoRef.current = loadKey

        // Encode the `kit_serial_number` (globally unique PK on
        // RR_Kitting_DATA, format `KIT-YYYYMMDD-NNN`) in the QR — the
        // RF Kit Picking entry point now smart-detects on the serial
        // prefix and drops the operator straight into picking when
        // they scan the QR, bypassing the legacy Select-a-Kit
        // disambiguation step that fired for any PO covering more
        // than one kit. The kit PO number stays human-readable on the
        // sheet (it's still used by downstream SAP processes).
        // Fall back to the PO if a legacy kit has no serial yet so
        // existing printed sheets continue to scan.
        const qrPayload = details.kitSerialNumber || details.kitPoNumber
        try {
          const qrDataUrl = await QRCode.toDataURL(qrPayload, {
            width: 80,
            margin: 1,
            color: {
              dark: '#000000',
              light: '#ffffff',
            },
          })
          setQrCodeDataUrl(qrDataUrl)
        } catch (qrErr) {
          logger.error('Error generating QR code:', qrErr)
          // Don't fail the whole load if QR generation fails
        }

        // Generate a scannable Code128 barcode for each unique TO number so
        // the printed sheet can be scanned line-by-line. jsbarcode is
        // dynamically imported to keep it out of the eager kitting bundle.
        try {
          const uniqueTOs = [
            ...new Set(
              details.toLines
                .map((line) => line.transferOrderNumber)
                .filter((to): to is string => Boolean(to))
            ),
          ]
          if (uniqueTOs.length > 0) {
            const { default: JsBarcode } = await import('jsbarcode')
            const barcodeMap: Record<string, string> = {}
            for (const to of uniqueTOs) {
              try {
                const canvas = document.createElement('canvas')
                JsBarcode(canvas, to, {
                  format: 'CODE128',
                  // Integer module width only: fractional widths (e.g. 1.4)
                  // get anti-aliased on the canvas, distorting the bar-width
                  // ratios Code128 relies on — the result looks fine but does
                  // not decode. Generated at 2x the 28px display height so the
                  // <img> downscales cleanly and stays crisp when printed.
                  width: 2,
                  height: 56,
                  displayValue: false,
                  margin: 0,
                  // Code128 requires a >=10-module quiet zone on each side;
                  // bake it into the PNG so scanning never depends on the
                  // surrounding table-cell whitespace.
                  marginLeft: 20,
                  marginRight: 20,
                  background: '#ffffff',
                  lineColor: '#000000',
                })
                barcodeMap[to] = canvas.toDataURL('image/png')
              } catch (barErr) {
                logger.error(`Error generating barcode for TO ${to}:`, barErr)
              }
            }
            setToBarcodes(barcodeMap)
          }
        } catch (barImportErr) {
          logger.error('Error loading barcode generator:', barImportErr)
          // Non-fatal: the sheet still prints with TO numbers, just no barcodes
        }
      } else {
        setError('Failed to load kit data')
      }
    } catch (err) {
      logger.error('Error loading kit data:', err)
      setError('An error occurred while loading kit data')
    } finally {
      setLoading(false)
    }
  }, [kitPoNumber, kitSerialNumber])

  useEffect(() => {
    const loadKey = kitSerialNumber ?? kitPoNumber
    if (open && loadKey) {
      // Only load if we haven't loaded this kit yet
      if (loadedKitPoRef.current !== loadKey) {
        loadKitData()
      }
    } else if (!open) {
      // Only reset when dialog is actually closed
      setKitData(null)
      setError(null)
      setQrCodeDataUrl(null)
      setToBarcodes({})
      loadedKitPoRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kitPoNumber, kitSerialNumber])

  // Handle print - open a new window with just the build sheet content
  const handlePrint = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!printRef.current) return

    // Get the content to print
    const printContent = printRef.current.innerHTML

    // Open a new window for printing
    const printWindow = window.open('', '_blank', 'width=800,height=600')
    if (!printWindow) {
      logger.error('Failed to open print window - popup blocked?')
      return
    }

    // Write the HTML content with styles
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Kit Build Sheet</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: Arial, sans-serif;
              background: white;
              color: black;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            @page {
              /* Normal 8.5 x 11 sheet, landscape. */
              size: 11in 8.5in;
              margin: 0.4cm;
            }
            #print-scale-wrapper { overflow: hidden; }
            #print-root { transform-origin: top left; }
            /* Tailwind-like utility classes */
            .flex { display: flex; }
            .flex-1 { flex: 1; }
            .flex-shrink-0 { flex-shrink: 0; }
            .items-center { align-items: center; }
            .items-start { align-items: start; }
            .justify-center { justify-content: center; }
            .justify-between { justify-content: space-between; }
            .gap-4 { gap: 1rem; }
            .gap-6 { gap: 1.5rem; }
            .grid { display: grid; }
            .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
            .space-y-1 > * + * { margin-top: 0.25rem; }
            .space-y-2 > * + * { margin-top: 0.5rem; }
            .text-center { text-align: center; }
            .text-left { text-align: left; }
            .text-xs { font-size: 0.75rem; }
            .text-sm { font-size: 0.875rem; }
            .text-lg { font-size: 1.125rem; }
            .text-xl { font-size: 1.25rem; }
            .text-2xl { font-size: 1.5rem; }
            .text-3xl { font-size: 1.875rem; }
            .text-4xl { font-size: 2.25rem; }
            .text-5xl { font-size: 3rem; }
            .font-bold { font-weight: 700; }
            .font-black { font-weight: 900; }
            .font-semibold { font-weight: 600; }
            .font-medium { font-weight: 500; }
            .italic { font-style: italic; }
            .underline { text-decoration: underline; }
            .tracking-tight { letter-spacing: -0.025em; }
            .tracking-widest { letter-spacing: 0.1em; }
            .p-2 { padding: 0.5rem; }
            .p-4 { padding: 1rem; }
            .px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
            .px-4 { padding-left: 1rem; padding-right: 1rem; }
            .py-0\\.5 { padding-top: 0.125rem; padding-bottom: 0.125rem; }
            .py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
            .pl-2 { padding-left: 0.5rem; }
            .mb-1 { margin-bottom: 0.25rem; }
            .mb-2 { margin-bottom: 0.5rem; }
            .mb-4 { margin-bottom: 1rem; }
            .mb-6 { margin-bottom: 1.5rem; }
            .ml-1 { margin-left: 0.25rem; }
            .w-4 { width: 1rem; }
            .w-12 { width: 3rem; }
            .w-16 { width: 4rem; }
            .w-24 { width: 6rem; }
            .w-full { width: 100%; }
            .h-4 { height: 1rem; }
            .min-h-\\[400px\\] { min-height: 400px; }
            .border { border-width: 1px; }
            .border-2 { border-width: 2px; }
            .border-b { border-bottom-width: 1px; }
            .border-black { border-color: black; }
            .border-gray-300 { border-color: #d1d5db; }
            .border-gray-400 { border-color: #9ca3af; }
            .border-gray-600 { border-color: #4b5563; }
            .border-green-600 { border-color: #16a34a; }
            .border-red-600 { border-color: #dc2626; }
            .bg-white { background-color: white; }
            .bg-gray-100 { background-color: #f3f4f6; }
            .bg-green-100 { background-color: #dcfce7; }
            .bg-red-100 { background-color: #fee2e2; }
            .text-white { color: white; }
            .text-black { color: black; }
            .text-yellow-500 { color: #eab308; }
            .text-gray-600 { color: #4b5563; }
            .text-gray-700 { color: #374151; }
            .inline-block { display: inline-block; }
            .relative { position: relative; }
            .absolute { position: absolute; }
            .inset-0 { top: 0; right: 0; bottom: 0; left: 0; }
            .rotate-180 { transform: rotate(180deg); }
            table { border-collapse: collapse; width: 100%; }
            th, td { padding: 0.25rem 0.5rem; }
          </style>
        </head>
        <body>
          <div id="print-scale-wrapper">
            <div id="print-root">
              ${printContent}
            </div>
          </div>
        </body>
      </html>
    `)

    printWindow.document.close()

    // Scale the rendered sheet down to fit a single Letter-landscape page.
    // The cover sheet grows with the number of TO / ship-short rows, so rather
    // than hand-tuning sizes we measure the content at the printable width and
    // shrink it uniformly to fit the printable box (never scaling up).
    const fitToPage = () => {
      try {
        const doc = printWindow.document
        const root = doc.getElementById('print-root')
        const wrapper = doc.getElementById('print-scale-wrapper')
        if (!root || !wrapper) return

        const DPI = 96
        const marginPx = (0.4 / 2.54) * DPI // @page margin (0.4cm) in px
        const safetyPx = 2 // guard against rounding so nothing clips
        const availW = 11 * DPI - 2 * marginPx - safetyPx // 8.5x11 landscape
        const availH = 8.5 * DPI - 2 * marginPx - safetyPx

        // Lay the content out at the printable width so the measurement
        // matches the printed layout regardless of the popup window's size.
        root.style.width = `${availW}px`
        root.style.transformOrigin = 'top left'

        const contentW = root.scrollWidth
        const contentH = root.scrollHeight
        const scale = Math.min(availW / contentW, availH / contentH, 1)

        root.style.transform = `scale(${scale})`
        // Collapse the wrapper to the scaled footprint — a CSS transform does
        // not shrink the layout box, so without this the original full-size
        // box would still spill onto a second page.
        wrapper.style.width = `${contentW * scale}px`
        wrapper.style.height = `${contentH * scale}px`
      } catch (fitErr) {
        logger.error('Error fitting cover sheet to page:', fitErr)
      }
    }

    let hasPrinted = false
    const printOnce = () => {
      if (hasPrinted) return
      hasPrinted = true
      fitToPage()
      printWindow.focus()
      printWindow.print()
      // Close the window after printing (or if cancelled)
      printWindow.onafterprint = () => printWindow.close()
    }

    // Print after content loads; fall back to a timer for browsers that don't
    // fire onload reliably for document.write content.
    printWindow.onload = printOnce
    setTimeout(printOnce, 300)
  }, [])

  // Map hex color to a human-readable label
  const HEX_TO_LABEL: Record<string, string> = {
    '#22c55e': 'Green',
    '#3b82f6': 'Blue',
    '#f97316': 'Orange',
    '#a855f7': 'Purple',
    '#ef4444': 'Red',
    '#eab308': 'Yellow',
    '#6b7280': 'Gray',
    '#ec4899': 'Pink',
    '#14b8a6': 'Teal',
  }

  // Resolve sidebar color: stored kitCartColor takes priority, else derive from engine program
  const getSidebarColor = (): { bg: string; text: string } => {
    if (kitData?.kitCartColor) {
      const label = HEX_TO_LABEL[kitData.kitCartColor.toLowerCase()] ?? 'Custom'
      return { bg: kitData.kitCartColor, text: label }
    }
    return getProgramColor(
      kitData?.kitBuildNumber || kitData?.engineProgram || ''
    )
  }

  // Get program color based on engine program (fallback)
  const getProgramColor = (program: string) => {
    const programUpper = program?.toUpperCase() || ''
    if (programUpper.includes('RR300') || programUpper.includes('300'))
      return { bg: '#22c55e', text: 'Green' }
    if (programUpper.includes('M250') || programUpper.includes('250'))
      return { bg: '#3b82f6', text: 'Blue' }
    if (programUpper.includes('M500') || programUpper.includes('500'))
      return { bg: '#f97316', text: 'Orange' }
    if (programUpper.includes('PEARL') || programUpper.includes('700'))
      return { bg: '#a855f7', text: 'Purple' }
    return { bg: '#6b7280', text: 'Gray' }
  }

  // Extract the engine program type (e.g., "SEAL" from "RR300-Seal" or from kit build number)
  const getEngineProgramType = (
    kitBuildNumber: string,
    engineProgram: string
  ) => {
    // Try to extract from kit build number first (e.g., "RR300-201540" -> look for common types)
    const buildNumberUpper = kitBuildNumber?.toUpperCase() || ''
    const programUpper = engineProgram?.toUpperCase() || ''

    // Check kit build number and engine program for kit type keywords
    const combined = `${buildNumberUpper} ${programUpper}`

    if (combined.includes('SEAL')) return 'SEAL'
    if (combined.includes('STACK')) return 'STACK'
    if (combined.includes('BEARING')) return 'BEARING'
    if (combined.includes('GASKET')) return 'GASKET'

    // Default based on engine program words
    const words =
      engineProgram?.split(/[\s-]/).filter((w) => w.length > 0) || []
    if (words.length > 1) return words[words.length - 1].toUpperCase()

    return 'KIT'
  }

  // Generate tackle box items based on kit type
  const getTackleBoxItems = (engineProgramType: string) => {
    if (engineProgramType === 'STACK') {
      return ['STACK1 1.4', 'STACK1 2.4', 'STACK1 3.4', 'STACK1 4.4']
    }
    if (engineProgramType === 'SEAL') {
      return ['SEAL1 1.2', 'SEAL1 2.2', 'SEAL1 3.2', 'SEAL1 4.2']
    }
    return ['Item 1', 'Item 2', 'Item 3', 'Item 4']
  }

  // Get the engine program short code for sidebar (e.g., "RR300" from "Trent 900" or "RR300-Seal")
  const getProgramCode = (kitBuildNumber: string, engineProgram: string) => {
    // Try to extract program code from kit build number (e.g., "RR300-201540" -> "RR300")
    const buildParts = kitBuildNumber?.split('-') || []
    if (buildParts.length > 0 && /^[A-Z0-9]+$/.test(buildParts[0])) {
      return buildParts[0].toUpperCase()
    }

    // Try from engine program
    if (!engineProgram) return 'N/A'
    const programParts = engineProgram.split(/[\s-]/)

    // Look for a code-like part (e.g., "RR300", "M250")
    for (const part of programParts) {
      if (/^[A-Z0-9]+$/i.test(part) && part.length <= 10) {
        return part.toUpperCase()
      }
    }

    return engineProgram.split(/[\s-]/)[0].toUpperCase()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto print:m-0 print:h-auto print:w-full print:max-w-none print:overflow-visible print:p-0'>
        <DialogHeader className='print:hidden'>
          <DialogTitle className='flex items-center gap-2 text-xl'>
            <Printer className='text-primary h-5 w-5' />
            Kit Build Sheet
          </DialogTitle>
          <DialogDescription>
            Printable document for kit assembly. Click "Print" to print this
            sheet.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode='wait'>
          {loading && (
            <motion.div
              key='loading'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className='flex items-center justify-center py-12 print:hidden'
            >
              <div className='space-y-3 text-center'>
                <Loader2 className='text-primary mx-auto h-8 w-8 animate-spin' />
                <p className='text-muted-foreground text-sm'>
                  Loading kit build sheet...
                </p>
              </div>
            </motion.div>
          )}

          {error && !loading && (
            <motion.div
              key='error'
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className='py-8 print:hidden'
            >
              <div className='flex flex-col items-center space-y-3 text-center'>
                <div className='bg-destructive/10 flex h-12 w-12 items-center justify-center rounded-full'>
                  <AlertCircle className='text-destructive h-6 w-6' />
                </div>
                <p className='text-destructive text-sm'>{error}</p>
                <Button variant='outline' size='sm' onClick={loadKitData}>
                  Retry
                </Button>
              </div>
            </motion.div>
          )}

          {kitData && !loading && !error && (
            <motion.div
              key='build-sheet'
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={springTransition}
              ref={printRef}
              className='kit-build-sheet-print-area bg-white text-black print:bg-white'
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              {/* Main Container with Green Sidebar */}
              <div className='flex print:flex'>
                {/* Left Content Area */}
                <div className='flex-1 p-4 print:p-6'>
                  {/* Header Row */}
                  <div className='mb-2 flex items-start justify-between'>
                    <div className='text-lg font-bold text-yellow-500'>
                      Visiprise-{visipriseNumber}
                    </div>
                    <div
                      className='border-2 border-black px-4 py-1'
                      style={{ backgroundColor: '#ffff00' }}
                    >
                      <span className='font-bold'>Quality:</span>
                      <span className='ml-1 inline-block w-16 border-b border-black'></span>
                    </div>
                  </div>

                  {/* Main Kit Build Number */}
                  <div className='mb-4 text-center'>
                    <h1 className='text-5xl font-black tracking-tight print:text-6xl'>
                      {kitData.kitBuildNumber ||
                        kitData.kitSerialNumber ||
                        'N/A'}
                    </h1>
                  </div>

                  {/* Engine Program and Kit Type */}
                  <div className='mb-6 text-center'>
                    <h2 className='mb-2 text-3xl font-black italic print:text-4xl'>
                      {getEngineProgramType(
                        kitData.kitBuildNumber,
                        kitData.engineProgram
                      )}
                    </h2>
                    <h3 className='text-2xl font-bold underline print:text-3xl'>
                      KIT : {kitData.kitNumber || 'Kit'}
                    </h3>
                    {kitData.kitContainerType && (
                      <p className='mt-1 text-sm font-semibold tracking-widest'>
                        {containerTypeLabelMap[kitData.kitContainerType] ??
                          kitData.kitContainerType}
                      </p>
                    )}
                  </div>

                  {/* Two Column Layout */}
                  <div className='flex gap-6'>
                    {/* Left Column */}
                    <div className='flex-1'>
                      {/* Kit PO Number (human-readable, used by SAP) +
                          QR Code (encodes the kit_serial_number for RF
                          scanning so the operator skips the
                          Select-a-Kit disambiguation step). */}
                      <div className='mb-4 flex items-center gap-3'>
                        <div>
                          <div className='text-3xl font-black print:text-4xl'>
                            {kitData.kitPoNumber}
                          </div>
                          {kitData.kitSerialNumber && (
                            <div className='font-mono text-xs text-gray-600 print:text-sm'>
                              {kitData.kitSerialNumber}
                            </div>
                          )}
                        </div>
                        {qrCodeDataUrl && (
                          <img
                            src={qrCodeDataUrl}
                            alt={`QR Code for kit ${
                              kitData.kitSerialNumber || kitData.kitPoNumber
                            }`}
                            className='h-16 w-16 print:h-20 print:w-20'
                            style={{ imageRendering: 'pixelated' }}
                          />
                        )}
                      </div>

                      {/* Tackle Box */}
                      <div className='mb-4 border-2 border-black'>
                        <div className='bg-black py-1 text-center text-lg font-bold text-white'>
                          Tackle Box
                        </div>
                        <div className='p-2'>
                          <table className='w-full text-sm'>
                            <thead>
                              <tr>
                                <th className='text-left'></th>
                                <th className='text-center font-bold text-green-600'>
                                  Yes
                                </th>
                                <th className='text-center font-bold text-red-600'>
                                  No
                                </th>
                                <th className='text-left'></th>
                              </tr>
                            </thead>
                            <tbody>
                              {getTackleBoxItems(
                                getEngineProgramType(
                                  kitData.kitBuildNumber,
                                  kitData.engineProgram
                                )
                              ).map((item, idx) => (
                                <tr key={idx}>
                                  <td className='py-0.5'>{item}</td>
                                  <td className='text-center'>
                                    <div className='inline-block h-4 w-4 border-2 border-green-600 bg-green-100'></div>
                                  </td>
                                  <td className='text-center'>
                                    <div className='inline-block h-4 w-4 border-2 border-red-600 bg-red-100'></div>
                                  </td>
                                  <td className='pl-2 text-left'>
                                    <span className='text-xs'>Initials:</span>
                                    <span className='ml-1 inline-block w-12 border-b border-black'></span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Signature Fields */}
                      <div className='space-y-2 text-sm'>
                        <div className='flex items-center'>
                          <span className='w-28 font-bold'>
                            Puller Initials:
                          </span>
                          <span className='flex-1 border-b border-black'></span>
                        </div>
                        <div className='flex items-center'>
                          <span className='w-28 font-bold'>
                            Kitter Initials:
                          </span>
                          <span className='flex-1 border-b border-black'></span>
                        </div>
                        <div className='flex items-center'>
                          <span className='w-28 font-bold'>
                            Auditor Initials:
                          </span>
                          <span className='flex-1 border-b border-black'></span>
                        </div>
                        <div className='flex items-center'>
                          <span className='w-28 font-bold'>
                            Transport Initials:
                          </span>
                          <span className='flex-1 border-b border-black'></span>
                        </div>
                      </div>

                      {/* Authorized Ship Short — part numbers + who authorized.
                          Borders/background use inline styles so they survive
                          the print window's limited utility-class subset. */}
                      {(() => {
                        const shipShorts =
                          kitData.authorizedShipShortItems.filter((item) =>
                            item.partNumber?.trim()
                          )
                        if (shipShorts.length === 0) return null
                        return (
                          <div
                            className='mt-4'
                            style={{ border: '2px solid black' }}
                          >
                            <div
                              className='py-1 text-center text-sm font-bold'
                              style={{
                                backgroundColor: '#000000',
                                color: '#ffffff',
                              }}
                            >
                              Authorized Ship Short
                            </div>
                            <table
                              className='w-full text-xs'
                              style={{ borderCollapse: 'collapse' }}
                            >
                              <thead>
                                <tr style={{ borderBottom: '1px solid black' }}>
                                  <th
                                    className='px-2 py-0.5 text-left font-bold'
                                    style={{ borderRight: '1px solid black' }}
                                  >
                                    Part Number
                                  </th>
                                  <th className='px-2 py-0.5 text-left font-bold'>
                                    Authorized By
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {shipShorts.map((item) => (
                                  <tr
                                    key={item.lineNumber}
                                    style={{
                                      borderBottom: '1px solid #9ca3af',
                                    }}
                                  >
                                    <td
                                      className='px-2 py-0.5'
                                      style={{
                                        borderRight: '1px solid black',
                                      }}
                                    >
                                      <span className='font-bold'>
                                        {item.partNumber}
                                      </span>
                                      {item.description && (
                                        <span className='text-gray-600'>
                                          {' '}
                                          — {item.description}
                                        </span>
                                      )}
                                    </td>
                                    <td className='px-2 py-0.5'>
                                      {item.authorizedBy || '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )
                      })()}
                    </div>

                    {/* Right Column */}
                    <div className='flex-1'>
                      {/* Charge Code */}
                      <div className='mb-4'>
                        <span className='text-lg font-bold'>Charge Code: </span>
                        <span className='text-lg font-bold'>
                          {kitData.chargeCode
                            ? (chargeCodeLabelMap[kitData.chargeCode] ??
                              kitData.chargeCode)
                            : '—'}
                        </span>
                      </div>
                      <div className='mb-4'>
                        <span className='text-base font-bold'>
                          Deliver To:{' '}
                        </span>
                        <span className='text-base font-medium'>
                          {kitData.deliverToPlant || '—'}
                        </span>
                      </div>

                      {/* TO's Table */}
                      <div className='mb-2 border border-black'>
                        <table className='w-full text-xs'>
                          <thead>
                            <tr className='border-b border-black'>
                              <th className='w-8 border-r border-black px-1 py-0.5 text-center'></th>
                              <th className='border-r border-black px-1 py-0.5 text-center font-bold'>
                                TO's
                              </th>
                              <th className='w-8 border-r border-black px-1 py-0.5 text-center'></th>
                              <th className='px-1 py-0.5 text-center font-bold'>
                                SHORTAGE
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const uniqueTOs = [
                                ...new Set(
                                  kitData.toLines
                                    .map((line) => line.transferOrderNumber)
                                    .filter(Boolean)
                                ),
                              ]
                              return [...Array(7)].map((_, idx) => {
                                const toNumber = uniqueTOs[idx]
                                const toBarcode = toNumber
                                  ? toBarcodes[toNumber]
                                  : undefined
                                return (
                                  <tr
                                    key={idx}
                                    className='border-b border-black'
                                  >
                                    <td className='border-r border-black px-1 py-0.5 text-center'>
                                      {idx + 1}
                                    </td>
                                    <td className='border-r border-black px-1 py-0.5 text-center font-mono'>
                                      {toNumber ? (
                                        <>
                                          <div>{toNumber}</div>
                                          {toBarcode && (
                                            <img
                                              src={toBarcode}
                                              alt={`Barcode for TO ${toNumber}`}
                                              style={{
                                                display: 'block',
                                                height: '28px',
                                                width: 'auto',
                                                maxWidth: '100%',
                                                margin: '2px auto 0',
                                              }}
                                            />
                                          )}
                                        </>
                                      ) : (
                                        ''
                                      )}
                                    </td>
                                    <td className='border-r border-black px-1 py-0.5 text-center'>
                                      {idx + 1}
                                    </td>
                                    <td className='px-1 py-0.5'></td>
                                  </tr>
                                )
                              })
                            })()}
                          </tbody>
                        </table>
                      </div>

                      {/* INCORA Table */}
                      <div className='mb-4 border border-black'>
                        <table className='w-full text-xs'>
                          <thead>
                            <tr className='border-b border-black'>
                              <th className='w-8 border-r border-black px-1 py-0.5 text-center'></th>
                              <th className='border-r border-black px-1 py-0.5 text-center font-bold'>
                                INCORA
                              </th>
                              <th className='w-8 border-r border-black px-1 py-0.5 text-center'></th>
                              <th className='px-1 py-0.5 text-center text-xs font-bold'>
                                AUTHORIZED TO SHIP SHORT
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...Array(7)].map((_, idx) => {
                              const incoraItem = kitData.incoraItems[idx]
                              const shipShortItem =
                                kitData.authorizedShipShortItems[idx]
                              return (
                                <tr key={idx} className='border-b border-black'>
                                  <td className='border-r border-black px-1 py-0.5 text-center'>
                                    {idx + 1}
                                  </td>
                                  <td className='border-r border-black px-1 py-0.5 text-center font-mono'>
                                    {incoraItem?.value ||
                                      (idx === 0 &&
                                      kitData.incoraItems.length === 0
                                        ? 'N/A'
                                        : '')}
                                  </td>
                                  <td className='border-r border-black px-1 py-0.5 text-center'>
                                    {idx + 1}
                                  </td>
                                  <td className='px-1 py-0.5 text-left'>
                                    {shipShortItem ? (
                                      <span>
                                        <span className='font-mono'>
                                          {shipShortItem.partNumber}
                                        </span>
                                        {shipShortItem.description && (
                                          <span className='text-gray-600'>
                                            {' '}
                                            - {shipShortItem.description}
                                          </span>
                                        )}
                                      </span>
                                    ) : (
                                      ''
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Confirmation Fields */}
                      <div className='space-y-2 text-sm'>
                        <div className='flex items-center'>
                          <span className='font-bold'>
                            Confirmation Initials:
                          </span>
                          <span className='ml-2 flex-1 border-b border-black'></span>
                        </div>
                        <div className='flex items-center'>
                          <span className='font-bold'>Date Confirmed:</span>
                          <span className='ml-2 flex-1 border-b border-black'></span>
                        </div>
                      </div>

                      {/* Notes Section */}
                      <div className='mt-4 border-t border-black pt-2'>
                        <div className='text-sm font-bold text-red-600'>
                          NOTES:
                        </div>
                        <div className='min-h-[40px]'></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Color Sidebar */}
                <div
                  className='relative w-24 flex-shrink-0 print:w-28'
                  style={{ backgroundColor: getSidebarColor().bg }}
                >
                  <div
                    className='absolute inset-0 flex items-center justify-center'
                    style={{
                      writingMode: 'vertical-rl',
                      textOrientation: 'mixed',
                    }}
                  >
                    <span className='rotate-180 text-4xl font-black tracking-widest text-white print:text-5xl'>
                      {getProgramCode(
                        kitData.kitBuildNumber,
                        kitData.engineProgram
                      )}{' '}
                      ({getSidebarColor().text})
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <DialogFooter className='flex gap-2 sm:gap-2 print:hidden'>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            <X className='mr-2 h-4 w-4' />
            Close
          </Button>
          <Button
            type='button'
            onClick={handlePrint}
            disabled={loading || !!error || !kitData}
            className='gap-2'
          >
            <Printer className='h-4 w-4' />
            Print Build Sheet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
