// Created and developed by Jai Singh
import { useState, useEffect } from 'react'
import { IconLoader2 } from '@tabler/icons-react'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { TICKET_SHEET_ID } from '../hooks/useTickets'

interface SheetData {
  name: string
  headers: string[]
  rows: (string | number | null)[][]
}

interface ExcelViewerProps {
  url?: string
  attachmentId?: number
  sheetId?: number
  onError?: () => void
}

/** Extract a display-friendly primitive from an ExcelJS cell value. */
function resolveCellValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return value.toLocaleDateString()
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if ('formula' in obj && 'result' in obj) {
      return resolveCellValue(obj.result)
    }
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return (obj.richText as { text: string }[]).map((t) => t.text).join('')
    }
    if ('text' in obj && 'hyperlink' in obj) {
      return String(obj.text)
    }
    if ('error' in obj) {
      return String(obj.error)
    }
    return String(value)
  }
  return String(value)
}

/**
 * Get the URL to fetch the Excel file.
 * Prefers the direct proxy endpoint with attachment ID (avoids URL encoding issues).
 * Falls back to URL-based proxy for backwards compatibility.
 */
function getExcelUrl(
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

export function ExcelViewer({
  url,
  attachmentId,
  sheetId = TICKET_SHEET_ID,
  onError,
}: ExcelViewerProps) {
  const [sheets, setSheets] = useState<SheetData[]>([])
  const [activeSheet, setActiveSheet] = useState<number>(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function fetchExcel() {
      const fetchUrl = getExcelUrl(url, attachmentId, sheetId)
      if (!fetchUrl) {
        setError(true)
        onError?.()
        return
      }

      try {
        setIsLoading(true)
        setError(false)
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

        const controller = new AbortController()
        const fetchTimeout = setTimeout(() => controller.abort(), 30_000)
        const response = await fetch(fetchUrl, {
          headers: fetchHeaders,
          signal: controller.signal,
        })
        clearTimeout(fetchTimeout)
        if (!response.ok) throw new Error('Failed to fetch')

        const arrayBuffer = await response.arrayBuffer()

        const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB hard limit
        if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
          throw new Error(
            `File too large (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`
          )
        }

        const ExcelJS = await import('exceljs')
        const workbook = new ExcelJS.default.Workbook()
        // ExcelJS types expect Node Buffer; ArrayBuffer works at runtime in browsers
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await workbook.xlsx.load(arrayBuffer as any)

        const parsedSheets: SheetData[] = workbook.worksheets.map(
          (worksheet) => {
            const allRows: (string | number | null)[][] = []
            const colCount = worksheet.columnCount

            worksheet.eachRow((row) => {
              const rowData: (string | number | null)[] = []
              for (let col = 1; col <= colCount; col++) {
                rowData.push(resolveCellValue(row.getCell(col).value))
              }
              allRows.push(rowData)
            })

            return {
              name: worksheet.name,
              headers: allRows.length > 0 ? allRows[0].map(String) : [],
              rows: allRows.slice(1),
            }
          }
        )

        setSheets(parsedSheets)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        setError(true)
        onError?.()
      } finally {
        setIsLoading(false)
      }
    }
    fetchExcel()
  }, [url, attachmentId, sheetId, onError])

  if (isLoading) {
    return (
      <div className='flex h-full flex-col items-center justify-center py-16'>
        <IconLoader2 className='text-muted-foreground mb-4 h-8 w-8 animate-spin' />
        <p className='text-muted-foreground text-sm'>Loading spreadsheet...</p>
      </div>
    )
  }

  if (error || sheets.length === 0) {
    return null // Let parent handle error state
  }

  const currentSheet = sheets[activeSheet]

  return (
    <div className='flex h-full flex-col'>
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className='bg-muted/30 flex items-center gap-1 overflow-x-auto border-b px-2 py-1'>
          {sheets.map((sheet, index) => (
            <button
              key={sheet.name}
              onClick={() => setActiveSheet(index)}
              className={cn(
                'rounded-t border-b-2 px-3 py-1.5 text-xs font-medium transition-colors',
                activeSheet === index
                  ? 'bg-background border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted border-transparent'
              )}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      {/* Table content */}
      <div className='flex-1 overflow-auto'>
        <table className='min-w-full border-collapse text-sm'>
          <thead className='bg-muted sticky top-0'>
            <tr>
              <th className='border-border text-muted-foreground w-12 border px-3 py-2 text-left font-medium'>
                #
              </th>
              {currentSheet.headers.map((header, i) => (
                <th
                  key={i}
                  className='border-border border px-3 py-2 text-left font-medium whitespace-nowrap'
                >
                  {header || `Column ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currentSheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className='hover:bg-muted/50'>
                <td className='border-border text-muted-foreground border px-3 py-1.5 text-center'>
                  {rowIndex + 1}
                </td>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className='border-border border px-3 py-1.5 whitespace-nowrap'
                  >
                    {cell ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer with row count */}
      <div className='bg-muted/30 text-muted-foreground border-t px-3 py-2 text-xs'>
        {currentSheet.rows.length} rows × {currentSheet.headers.length} columns
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
