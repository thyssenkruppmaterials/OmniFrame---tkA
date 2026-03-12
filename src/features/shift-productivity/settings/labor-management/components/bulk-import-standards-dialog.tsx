/**
 * Bulk Import Labor Standards Dialog Component
 * CSV/Excel import functionality for labor standards
 * Created: October 25, 2025
 */
import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Upload,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'
import { useLaborManagement } from '@/hooks/use-labor-management'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'

interface BulkImportStandardsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ImportResult {
  total: number
  successful: number
  failed: number
  errors: string[]
}

export function BulkImportStandardsDialog({
  open,
  onOpenChange,
}: BulkImportStandardsDialogProps) {
  const { createLaborStandard, shiftPositions, workingAreas } =
    useLaborManagement()
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)

  const downloadTemplate = () => {
    const headers = [
      'standard_name',
      'standard_type',
      'task_type',
      'position_code',
      'area_code',
      'target_value',
      'unit_of_measure',
      'minimum_acceptable',
      'maximum_acceptable',
      'excellent_threshold',
      'effective_from',
      'effective_to',
      'is_active',
    ]

    const exampleRows = [
      [
        'Warehouse Picking Productivity',
        'productivity',
        'picking',
        'WH-ASSOC-01',
        '',
        '85',
        'units_per_hour',
        '70',
        '100',
        '95',
        '2025-01-01',
        '',
        'true',
      ],
      [
        'Quality Inspection Accuracy',
        'quality',
        'inspection',
        '',
        'QUAL-LAB-01',
        '98.5',
        'accuracy_percentage',
        '95',
        '100',
        '99.5',
        '2025-01-01',
        '',
        'true',
      ],
    ]

    const csvContent = [headers, ...exampleRows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `labor-standards-template.csv`
    link.click()

    toast.success('Template downloaded successfully')
  }

  const handleImport = async () => {
    try {
      setImporting(true)
      setProgress(0)
      setResult(null)

      // Read from clipboard
      const clipboardText = await navigator.clipboard.readText()
      if (!clipboardText.trim()) {
        toast.error(
          'Clipboard is empty. Please copy data from Excel/CSV first.'
        )
        return
      }

      // Parse CSV
      const lines = clipboardText.trim().split('\n')
      if (lines.length < 2) {
        toast.error(
          'Invalid data format. Expected at least header row and one data row.'
        )
        return
      }

      const headers = lines[0]
        .split(/,|\t/)
        .map((h) => h.trim().replace(/"/g, '').toLowerCase())
      const dataRows = lines.slice(1)

      // Validate headers
      const requiredHeaders = [
        'standard_name',
        'standard_type',
        'task_type',
        'target_value',
        'unit_of_measure',
      ]
      const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h))
      if (missingHeaders.length > 0) {
        toast.error(`Missing required columns: ${missingHeaders.join(', ')}`)
        return
      }

      // Process rows
      let successful = 0
      let failed = 0
      const errors: string[] = []

      for (let i = 0; i < dataRows.length; i++) {
        try {
          const values = dataRows[i]
            .split(/,|\t/)
            .map((v) => v.trim().replace(/"/g, ''))
          const row: Record<string, string> = {}
          headers.forEach((header, index) => {
            row[header] = values[index] || ''
          })

          // Validate required fields
          if (
            !row.standard_name ||
            !row.standard_type ||
            !row.task_type ||
            !row.target_value ||
            !row.unit_of_measure
          ) {
            throw new Error('Missing required fields')
          }

          // Find position and area IDs if codes provided
          let position_id: string | undefined
          let working_area_id: string | undefined

          if (row.position_code) {
            const position = shiftPositions.find(
              (p) => p.position_code === row.position_code
            )
            if (position) {
              position_id = position.id
            } else {
              errors.push(
                `Row ${i + 2}: Position code "${row.position_code}" not found`
              )
            }
          }

          if (row.area_code) {
            const area = workingAreas.find(
              (a: { area_code: string }) => a.area_code === row.area_code
            )
            if (area) {
              working_area_id = area.id
            } else {
              errors.push(
                `Row ${i + 2}: Area code "${row.area_code}" not found`
              )
            }
          }

          // Create standard
          await createLaborStandard({
            standard_name: row.standard_name,
            standard_type: row.standard_type,
            task_type: row.task_type,
            position_id,
            working_area_id,
            target_value: parseFloat(row.target_value),
            unit_of_measure: row.unit_of_measure,
            minimum_acceptable: row.minimum_acceptable
              ? parseFloat(row.minimum_acceptable)
              : undefined,
            maximum_acceptable: row.maximum_acceptable
              ? parseFloat(row.maximum_acceptable)
              : undefined,
            excellent_threshold: row.excellent_threshold
              ? parseFloat(row.excellent_threshold)
              : undefined,
            effective_from:
              row.effective_from || new Date().toISOString().split('T')[0],
            effective_to: row.effective_to || undefined,
            is_active: row.is_active !== 'false',
          })

          successful++
          setProgress(Math.round(((i + 1) / dataRows.length) * 100))
        } catch (error: unknown) {
          failed++
          errors.push(
            `Row ${i + 2}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }

      setResult({
        total: dataRows.length,
        successful,
        failed,
        errors: errors.slice(0, 10), // Limit to first 10 errors
      })

      if (successful > 0) {
        toast.success(`Successfully imported ${successful} standards`)
      }
      if (failed > 0) {
        toast.error(`Failed to import ${failed} standards`)
      }
    } catch (error: unknown) {
      logger.error('Import error:', error)
      toast.error(
        `Import failed: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Bulk Import Labor Standards</DialogTitle>
          <DialogDescription>
            Import multiple labor standards from Excel or CSV data
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          {/* Instructions */}
          <Alert>
            <AlertDescription>
              <div className='space-y-2'>
                <p className='font-medium'>How to import:</p>
                <ol className='list-inside list-decimal space-y-1 text-sm'>
                  <li>Download the template CSV file</li>
                  <li>
                    Fill in your labor standards data in Excel or CSV editor
                  </li>
                  <li>Copy all data including headers (Ctrl+A, Ctrl+C)</li>
                  <li>Click "Import from Clipboard" button</li>
                </ol>
              </div>
            </AlertDescription>
          </Alert>

          {/* Template Download */}
          <Button
            variant='outline'
            onClick={downloadTemplate}
            className='w-full'
          >
            <Download className='mr-2 h-4 w-4' />
            Download Template CSV
          </Button>

          {/* Import Progress */}
          {importing && (
            <div className='space-y-2'>
              <div className='flex items-center justify-between text-sm'>
                <span>Importing standards...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          {/* Import Results */}
          {result && (
            <div className='space-y-3'>
              <div className='grid grid-cols-3 gap-3'>
                <div className='flex items-center gap-2 rounded-lg border p-3'>
                  <CheckCircle2 className='h-4 w-4 text-green-600' />
                  <div>
                    <div className='text-2xl font-bold text-green-600'>
                      {result.successful}
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      Successful
                    </div>
                  </div>
                </div>
                <div className='flex items-center gap-2 rounded-lg border p-3'>
                  <XCircle className='h-4 w-4 text-red-600' />
                  <div>
                    <div className='text-2xl font-bold text-red-600'>
                      {result.failed}
                    </div>
                    <div className='text-muted-foreground text-xs'>Failed</div>
                  </div>
                </div>
                <div className='flex items-center gap-2 rounded-lg border p-3'>
                  <Upload className='h-4 w-4 text-blue-600' />
                  <div>
                    <div className='text-2xl font-bold text-blue-600'>
                      {result.total}
                    </div>
                    <div className='text-muted-foreground text-xs'>Total</div>
                  </div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <Alert variant='destructive'>
                  <AlertTriangle className='h-4 w-4' />
                  <AlertDescription>
                    <div className='mb-2 font-medium'>Import Errors:</div>
                    <div className='max-h-40 space-y-1 overflow-y-auto text-sm'>
                      {result.errors.map((error, index) => (
                        <div key={index}>• {error}</div>
                      ))}
                      {result.failed > result.errors.length && (
                        <div>
                          • And {result.failed - result.errors.length} more
                          errors...
                        </div>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => {
              setResult(null)
              setProgress(0)
              onOpenChange(false)
            }}
            disabled={importing}
          >
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button onClick={handleImport} disabled={importing}>
              {importing ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className='mr-2 h-4 w-4' />
                  Import from Clipboard
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
