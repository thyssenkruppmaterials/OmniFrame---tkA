// Created and developed by Jai Singh
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck - New warehouse map tables not yet in generated database.types.ts
'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { Search } from 'lucide-react'
import { useWarehouseMapStore } from '@/stores/warehouse-map-store'
import { supabase } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type {
  WarehouseMapSettings,
  WarehouseLocationMapping,
  OperationalStatus,
} from './types'
import { STATUS_COLORS, STATUS_BADGE_TEXT } from './types'

interface AccessibleListProps {
  mapId: string
  settings: WarehouseMapSettings
  readOnly: boolean
}

type MappingRow = WarehouseLocationMapping & { zone_name?: string }

const STATUS_OPTIONS: OperationalStatus[] = [
  'active',
  'maintenance',
  'shutdown',
  'reserved',
  'blocked',
]

function StatusBadge({ status }: { status: OperationalStatus }) {
  const color = STATUS_COLORS[status]
  return (
    <Badge variant='outline' className='gap-1.5' style={{ borderColor: color }}>
      <span
        className='inline-block size-2 rounded-full'
        style={{ backgroundColor: color }}
        aria-hidden='true'
      />
      {STATUS_BADGE_TEXT[status]}
    </Badge>
  )
}

export function WarehouseMapAccessibleList({
  mapId,
  settings: _settings,
  readOnly: _readOnly,
}: AccessibleListProps) {
  const setSelectedLocationId = useWarehouseMapStore(
    (s) => s.setSelectedLocationId
  )
  const setSidebarPanel = useWarehouseMapStore((s) => s.setSidebarPanel)

  const [sorting, setSorting] = useState<SortingState>([])
  const [binSearch, setBinSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [zoneFilter, setZoneFilter] = useState<string>('all')

  const { data: mappings = [], isLoading } = useQuery({
    queryKey: ['warehouse-map-layout', mapId, 'accessible-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('warehouse_location_mappings')
        .select('*')
        .eq('map_id', mapId)
        .order('storage_bin')
      if (error) throw error
      return (data ?? []) as unknown as MappingRow[]
    },
  })

  const zones = useMemo(() => {
    const set = new Set<string>()
    for (const m of mappings) if (m.zone_name) set.add(m.zone_name)
    return Array.from(set).sort()
  }, [mappings])

  const filtered = useMemo(() => {
    let rows = mappings
    if (binSearch) {
      const q = binSearch.toLowerCase()
      rows = rows.filter((r) => r.storage_bin.toLowerCase().includes(q))
    }
    if (statusFilter !== 'all') {
      rows = rows.filter((r) => r.operational_status === statusFilter)
    }
    if (zoneFilter !== 'all') {
      rows = rows.filter((r) => r.zone_name === zoneFilter)
    }
    return rows
  }, [mappings, binSearch, statusFilter, zoneFilter])

  const stats = useMemo(() => {
    const total = mappings.length
    const active = mappings.filter(
      (m) => m.operational_status === 'active'
    ).length
    const maint = mappings.filter(
      (m) => m.operational_status === 'maintenance'
    ).length
    return { total, active, maint }
  }, [mappings])

  const columns = useMemo<ColumnDef<MappingRow>[]>(
    () => [
      {
        accessorKey: 'storage_bin',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='Storage Bin' />
        ),
        cell: ({ row }) => (
          <span className='font-mono text-sm'>
            {row.getValue('storage_bin')}
          </span>
        ),
      },
      {
        accessorKey: 'rack_id',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='Rack' />
        ),
        cell: ({ row }) => (
          <span className='truncate text-sm'>
            {(row.getValue('rack_id') as string).slice(0, 8)}
          </span>
        ),
      },
      {
        accessorKey: 'rack_row',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='Row' />
        ),
      },
      {
        accessorKey: 'rack_column',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='Col' />
        ),
      },
      {
        accessorKey: 'operational_status',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='Status' />
        ),
        cell: ({ row }) => (
          <StatusBadge
            status={row.getValue('operational_status') as OperationalStatus}
          />
        ),
      },
      {
        accessorKey: 'zone_name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='Zone' />
        ),
        cell: ({ row }) => row.getValue('zone_name') ?? '—',
      },
    ],
    []
  )

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  })

  const openDetail = (id: string) => {
    setSelectedLocationId(id)
    setSidebarPanel('location-detail')
  }

  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 768

  return (
    <div
      className='flex flex-col gap-4'
      role='region'
      aria-label='Warehouse locations list'
    >
      {/* Filters */}
      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative min-w-[200px] flex-1'>
          <Search className='text-muted-foreground absolute top-2.5 left-2.5 size-4' />
          <Input
            placeholder='Search storage bin…'
            value={binSearch}
            onChange={(e) => setBinSearch(e.target.value)}
            className='pl-8'
            aria-label='Search storage bins'
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className='w-[150px]' aria-label='Filter by status'>
            <SelectValue placeholder='Status' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_BADGE_TEXT[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {zones.length > 0 && (
          <Select value={zoneFilter} onValueChange={setZoneFilter}>
            <SelectTrigger className='w-[150px]' aria-label='Filter by zone'>
              <SelectValue placeholder='Zone' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All zones</SelectItem>
              {zones.map((z) => (
                <SelectItem key={z} value={z}>
                  {z}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Stats summary */}
      <p className='text-muted-foreground text-sm' aria-live='polite'>
        {stats.total} locations &middot; {stats.active} active &middot;{' '}
        {stats.maint} maintenance
      </p>

      {isLoading && (
        <p className='text-muted-foreground py-12 text-center text-sm'>
          Loading locations…
        </p>
      )}

      {/* Card list for narrow screens */}
      {!isLoading && isNarrow && (
        <ul className='flex flex-col gap-2' role='list'>
          {table.getRowModel().rows.map((row) => {
            const m = row.original
            return (
              <li key={m.id}>
                <button
                  type='button'
                  className='border-border bg-card hover:bg-accent/50 flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition-colors'
                  onClick={() => openDetail(m.id)}
                  aria-label={`Location ${m.storage_bin}, status ${m.operational_status}`}
                >
                  <div className='flex items-center justify-between'>
                    <span className='font-mono text-sm font-medium'>
                      {m.storage_bin}
                    </span>
                    <StatusBadge status={m.operational_status} />
                  </div>
                  <span className='text-muted-foreground text-xs'>
                    Row {m.rack_row}, Col {m.rack_column}
                    {m.zone_name ? ` · ${m.zone_name}` : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* Table for wider screens */}
      {!isLoading && !isNarrow && (
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className='text-muted-foreground h-24 text-center'
                  >
                    No locations found.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className='cursor-pointer'
                    tabIndex={0}
                    role='button'
                    aria-label={`Location ${row.original.storage_bin}`}
                    onClick={() => openDetail(row.original.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openDetail(row.original.id)
                      }
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {!isLoading && filtered.length > 0 && (
        <div className='flex items-center justify-between text-sm'>
          <span className='text-muted-foreground'>
            Page {table.getState().pagination.pageIndex + 1} of{' '}
            {table.getPageCount()}
          </span>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
