// Created and developed by Jai Singh
/**
 * AuditLogTable — paginated table of derived OmniBelt admin changes.
 *
 * Pagination state is owned by the parent section (so filter + page
 * are co-located there); this component only renders the current
 * page slice plus prev/next controls.
 */
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { AuditEntry } from '../hooks/useAuditLog'

interface AuditLogTableProps {
  entries: AuditEntry[]
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}

export function AuditLogTable({
  entries,
  page,
  pageCount,
  onPageChange,
}: AuditLogTableProps) {
  return (
    <div className='space-y-3'>
      <div className='border-border/60 rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Role affected</TableHead>
              <TableHead>Change summary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className='text-muted-foreground py-6 text-center text-sm'
                >
                  No admin changes recorded yet.
                </TableCell>
              </TableRow>
            )}
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className='font-mono text-xs'>
                  {formatTs(entry.timestamp)}
                </TableCell>
                <TableCell className='font-mono text-xs'>
                  {entry.actor_label}
                </TableCell>
                <TableCell>{entry.target}</TableCell>
                <TableCell className='text-xs'>
                  <DiffSummary diff={entry.diff_after} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 && (
        <div className='flex items-center justify-end gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={page === 0}
            onClick={() => onPageChange(Math.max(0, page - 1))}
          >
            Previous
          </Button>
          <span className='text-muted-foreground text-xs'>
            Page {page + 1} of {pageCount}
          </span>
          <Button
            variant='outline'
            size='sm'
            disabled={page >= pageCount - 1}
            onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}

function DiffSummary({ diff }: { diff: Record<string, unknown> }) {
  const pinned = (diff.default_pinned_ids as string[] | undefined) ?? []
  const tools = (diff.default_tool_ids as string[] | undefined) ?? []
  const skin = (diff.default_skin as string | undefined) ?? '—'
  const pos = diff.default_position as { anchor?: string } | null | undefined
  return (
    <div className='space-y-0.5'>
      <div>
        <span className='text-muted-foreground'>Tools:</span> {tools.length} (
        {pinned.length} pinned)
      </div>
      <div>
        <span className='text-muted-foreground'>Skin:</span> {skin}{' '}
        <span className='text-muted-foreground'>· Anchor:</span>{' '}
        {pos?.anchor ?? '—'}
      </div>
    </div>
  )
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString()
  } catch {
    return iso
  }
}

// Created and developed by Jai Singh
