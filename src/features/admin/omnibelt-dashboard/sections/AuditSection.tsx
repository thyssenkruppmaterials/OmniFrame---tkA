// Created and developed by Jai Singh
/**
 * AuditSection — derived admin change log.
 *
 * Since there's no standalone OmniBelt audit_log table yet (v1.5
 * follow-up), entries are derived from `omnibelt_role_config`'s
 * `updated_at` / `updated_by` columns. The UI clarifies this
 * provenance with a help line so admins don't expect a richer
 * diff than the data supports.
 */
import { useMemo, useState } from 'react'
import { IconSearch } from '@tabler/icons-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { AuditLogTable } from '../components/AuditLogTable'
import { useAuditLog } from '../hooks/useAuditLog'
import { useOmnibeltAdminBootstrap } from '../hooks/useOmnibeltAdminBootstrap'

const PAGE_SIZE = 25

export function AuditSection() {
  const bootstrap = useOmnibeltAdminBootstrap()
  const auditQuery = useAuditLog(bootstrap.data?.roles)
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return auditQuery.entries
    return auditQuery.entries.filter((e) => {
      return (
        e.target.toLowerCase().includes(q) ||
        e.actor_label.toLowerCase().includes(q) ||
        e.kind.toLowerCase().includes(q)
      )
    })
  }, [auditQuery.entries, filter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageItems = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE
  )

  const isLoading = bootstrap.isLoading || auditQuery.isLoading

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base'>Audit log (derived)</CardTitle>
          <CardDescription>
            Entries are reconstructed from{' '}
            <code>omnibelt_role_config.updated_at</code> /{' '}
            <code>updated_by</code>. A dedicated <code>omnibelt_audit_log</code>{' '}
            table is a v1.5 follow-up; for now we surface the "after" state —
            the "before" diff is not stored.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex items-center gap-2'>
            <div className='relative w-full max-w-sm'>
              <IconSearch
                size={14}
                className='text-muted-foreground absolute top-1/2 left-2 -translate-y-1/2'
                aria-hidden
              />
              <Input
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value)
                  setPage(0)
                }}
                placeholder='Filter by role, actor, or kind…'
                className='pl-7'
                aria-label='Filter audit entries'
              />
            </div>
            <div className='text-muted-foreground text-xs'>
              {filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'}
            </div>
          </div>

          {isLoading ? (
            <div className='space-y-2'>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className='h-9 w-full rounded' />
              ))}
            </div>
          ) : (
            <AuditLogTable
              entries={pageItems}
              page={safePage}
              pageCount={pageCount}
              onPageChange={setPage}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// Created and developed by Jai Singh
