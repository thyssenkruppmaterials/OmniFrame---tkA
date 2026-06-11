---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# DataTable - Reusable Table

## Purpose
Generic, reusable data table system built on **TanStack React Table v8** and shadcn/ui `Table` primitives. Provides sorting, filtering, pagination, row selection, column visibility, and faceted filtering out of the box.

## Architecture

### DataTable (`data-table.tsx`)
Generic component accepting typed `ColumnDef` and data arrays.

**Generic signature:**
```typescript
interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchKey?: string
  placeholder?: string
}
```

**Built-in features (all via TanStack React Table):**
- `getCoreRowModel()` - base row model
- `getSortedRowModel()` - column sorting
- `getFilteredRowModel()` - column filtering
- `getPaginationRowModel()` - client-side pagination
- `getFacetedRowModel()` - faceted filtering
- `getFacetedUniqueValues()` - unique value extraction for facets
- Row selection (`enableRowSelection: true`)
- Column visibility toggling

**State management (all via `useState`):**
- `sorting: SortingState`
- `columnFilters: ColumnFiltersState`
- `columnVisibility: VisibilityState`
- `rowSelection: {}`

**Rendering:**
- Uses `flexRender()` for header and cell rendering
- Empty state: "No results." centered message
- Wrapped in `rounded-md border` container

### DataTableColumnHeader (`data-table-column-header.tsx`)
Reusable column header with sort controls and visibility toggle.

**Features:**
- Click-to-sort dropdown menu with Asc/Desc options
- Column hide option
- Sort direction indicators: `ArrowUp`, `ArrowDown`, `ArrowUpDown` (unsorted)
- Non-sortable columns render plain text
- Uses `DropdownMenu` from shadcn/ui

**Props:**
```typescript
interface DataTableColumnHeaderProps<TData, TValue> {
  column: Column<TData, TValue>
  title: string
  className?: string
}
```

### Barrel Export (`index.ts`)
```typescript
export { DataTable } from './data-table'
export { DataTableColumnHeader } from './data-table-column-header'
```

## Usage Pattern
```typescript
import { DataTable, DataTableColumnHeader } from '@/components/data-table'

const columns: ColumnDef<MyData>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
  },
]

<DataTable columns={columns} data={myData} />
```

## Dependencies
- `@tanstack/react-table` - Table engine
- `@/components/ui/table` - Styled HTML table primitives
- `@/components/ui/button` - Sort trigger button
- `@/components/ui/dropdown-menu` - Sort/hide menu
- `lucide-react` - Sort direction icons

## Related
- [[UILibrary - Component Catalog]]
- [[UI-Component-Conventions]]