/**
 * LL01ReportButton — "Generate Report" dropdown (2026-06-01).
 *
 * Builds a beautifully-designed Warehouse Activity report (heatmap + per-
 * category aging, no trend) from the currently-shown run as either a PDF
 * (print-styled view → "Save as PDF") or a styled Excel workbook. Renders from
 * whatever `result` the view is showing, so it works for live AND saved
 * (History) runs.
 */
import { useState } from 'react'
import { ChevronDown, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { buildLL01ReportModel } from '../lib/ll01-report'
import type { LL01RunResult } from './warehouse-activity-monitor-types'

interface LL01ReportButtonProps {
  result: LL01RunResult | null
}

export function LL01ReportButton({ result }: LL01ReportButtonProps) {
  const [busy, setBusy] = useState<null | 'pdf' | 'excel'>(null)

  const canReport = Boolean(result && result.ok && result.categories.length > 0)

  const handlePdf = async () => {
    if (!result) return
    setBusy('pdf')
    try {
      // Lazy-load the generator so its print-HTML string never bloats the
      // initial chunk.
      const { generateLL01Pdf } = await import('../lib/ll01-report-pdf')
      generateLL01Pdf(buildLL01ReportModel(result))
      toast.success('Report ready', {
        description: 'Choose "Save as PDF" in the print dialog.',
      })
    } catch (e) {
      toast.error('Could not generate the PDF report', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setBusy(null)
    }
  }

  const handleExcel = async () => {
    if (!result) return
    setBusy('excel')
    try {
      const { generateLL01Excel } = await import('../lib/ll01-report-excel')
      await generateLL01Excel(buildLL01ReportModel(result))
      toast.success('Excel report downloaded')
    } catch (e) {
      toast.error('Could not generate the Excel report', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          disabled={!canReport || busy !== null}
          title={
            canReport
              ? 'Generate a Warehouse Activity report (heatmap + aging)'
              : 'Run the query first to generate a report'
          }
        >
          {busy ? (
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          ) : (
            <FileText className='mr-2 h-4 w-4' />
          )}
          Generate Report
          <ChevronDown className='ml-1.5 h-3.5 w-3.5 opacity-70' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-44'>
        <DropdownMenuItem
          onClick={() => void handlePdf()}
          disabled={busy !== null}
        >
          <FileText className='mr-2 h-4 w-4 text-red-600' />
          Download PDF
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void handleExcel()}
          disabled={busy !== null}
        >
          <FileSpreadsheet className='mr-2 h-4 w-4 text-emerald-600' />
          Download Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
