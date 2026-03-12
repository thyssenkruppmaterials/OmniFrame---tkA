import { Table } from '@tanstack/react-table'
import { Columns, Download, Filter, RefreshCw, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import {
  SYSTEM_ROLES,
  USER_STATUS_CONFIG,
  type UserFilters,
  type UserStatus,
} from '../types'

interface DataTableToolbarProps<TData> {
  table: Table<TData>
  filters: UserFilters
  onFiltersChange: (filters: UserFilters) => void
  searchInput: string // Current search input value (immediate)
  onSearchInputChange: (value: string) => void // Direct setter for search input
  onExport: () => void
  onRefresh: () => void
  selectedCount: number
  onBulkAction: () => void
  isLoading?: boolean
}

const STATUS_OPTIONS: { value: UserStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'invited', label: 'Invited' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'terminated', label: 'Terminated' },
  { value: 'on_leave', label: 'On Leave' },
]

const ROLE_OPTIONS = SYSTEM_ROLES.map((role) => ({
  value: role,
  label: role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' '),
}))

export function DataTableToolbar<TData>({
  table,
  filters,
  onFiltersChange,
  searchInput,
  onSearchInputChange,
  onExport,
  onRefresh,
  selectedCount,
  onBulkAction,
  isLoading = false,
}: DataTableToolbarProps<TData>) {
  // Search state is managed by the hook - no local state needed
  // searchInput = current typed value (immediate)
  // filters.search = display filters (also immediate for UI)
  // Debouncing happens in the hook for API calls

  const isFiltered =
    searchInput.length > 0 ||
    (filters.status && filters.status.length > 0) ||
    (filters.role && filters.role.length > 0) ||
    filters.email_verified !== undefined

  const activeFilterCount = [
    searchInput ? 1 : 0,
    filters.status?.length || 0,
    filters.role?.length || 0,
    filters.email_verified !== undefined ? 1 : 0,
  ].reduce((a, b) => a + b, 0)

  const handleSearchChange = (value: string) => {
    onSearchInputChange(value) // Direct update to hook state
  }

  const handleStatusToggle = (status: UserStatus, checked: boolean) => {
    const currentStatuses = filters.status || []
    const newStatuses = checked
      ? [...currentStatuses, status]
      : currentStatuses.filter((s) => s !== status)
    onFiltersChange({
      ...filters,
      status: newStatuses.length > 0 ? newStatuses : undefined,
    })
  }

  const handleRoleToggle = (role: string, checked: boolean) => {
    const currentRoles = filters.role || []
    const newRoles = checked
      ? [...currentRoles, role]
      : currentRoles.filter((r) => r !== role)
    onFiltersChange({
      ...filters,
      role: newRoles.length > 0 ? newRoles : undefined,
    })
  }

  const handleEmailVerifiedToggle = (value: boolean | undefined) => {
    onFiltersChange({ ...filters, email_verified: value })
  }

  const clearAllFilters = () => {
    onFiltersChange({}) // This clears search and other filters via the hook
  }

  return (
    <div className='flex flex-col gap-4'>
      {/* Main toolbar row */}
      <div className='flex flex-wrap items-center gap-2'>
        {/* Search input */}
        <div className='relative max-w-sm min-w-[200px] flex-1'>
          <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search users...'
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className='pl-9'
          />
        </div>

        {/* Filters dropdown */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant='outline' size='sm' className='h-9'>
              <Filter className='mr-2 h-4 w-4' />
              Filters
              {activeFilterCount > 0 && (
                <Badge
                  variant='secondary'
                  className='ml-2 rounded-sm px-1 font-normal'
                >
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className='w-80' align='start'>
            <div className='space-y-4'>
              <h4 className='leading-none font-medium'>Filter Users</h4>

              {/* Status Filter */}
              <div className='space-y-2'>
                <Label className='text-sm font-medium'>Status</Label>
                <div className='grid grid-cols-2 gap-2'>
                  {STATUS_OPTIONS.map((option) => (
                    <div
                      key={option.value}
                      className='flex items-center space-x-2'
                    >
                      <Checkbox
                        id={`status-${option.value}`}
                        checked={
                          filters.status?.includes(option.value) || false
                        }
                        onCheckedChange={(checked) =>
                          handleStatusToggle(option.value, checked as boolean)
                        }
                      />
                      <Label
                        htmlFor={`status-${option.value}`}
                        className='cursor-pointer text-sm font-normal'
                      >
                        {option.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Role Filter */}
              <div className='space-y-2'>
                <Label className='text-sm font-medium'>Role</Label>
                <div className='grid max-h-32 grid-cols-2 gap-2 overflow-y-auto'>
                  {ROLE_OPTIONS.map((option) => (
                    <div
                      key={option.value}
                      className='flex items-center space-x-2'
                    >
                      <Checkbox
                        id={`role-${option.value}`}
                        checked={filters.role?.includes(option.value) || false}
                        onCheckedChange={(checked) =>
                          handleRoleToggle(option.value, checked as boolean)
                        }
                      />
                      <Label
                        htmlFor={`role-${option.value}`}
                        className='cursor-pointer truncate text-sm font-normal'
                      >
                        {option.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Email Verified Filter */}
              <div className='space-y-2'>
                <Label className='text-sm font-medium'>Email Verified</Label>
                <div className='flex gap-2'>
                  <Button
                    variant={
                      filters.email_verified === true ? 'default' : 'outline'
                    }
                    size='sm'
                    onClick={() =>
                      handleEmailVerifiedToggle(
                        filters.email_verified === true ? undefined : true
                      )
                    }
                  >
                    Verified
                  </Button>
                  <Button
                    variant={
                      filters.email_verified === false ? 'default' : 'outline'
                    }
                    size='sm'
                    onClick={() =>
                      handleEmailVerifiedToggle(
                        filters.email_verified === false ? undefined : false
                      )
                    }
                  >
                    Unverified
                  </Button>
                </div>
              </div>

              {isFiltered && (
                <>
                  <Separator />
                  <Button
                    variant='ghost'
                    onClick={clearAllFilters}
                    className='w-full'
                  >
                    Clear all filters
                  </Button>
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Column visibility */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='outline' size='sm' className='h-9'>
              <Columns className='mr-2 h-4 w-4' />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-[180px]'>
            <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllColumns()
              .filter(
                (column) =>
                  typeof column.accessorFn !== 'undefined' &&
                  column.getCanHide()
              )
              .map((column) => {
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className='capitalize'
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                  >
                    {column.id.replace(/_/g, ' ')}
                  </DropdownMenuCheckboxItem>
                )
              })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Actions */}
        <div className='ml-auto flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            className='h-9'
            onClick={onRefresh}
            disabled={isLoading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>

          <Button
            variant='outline'
            size='sm'
            className='h-9'
            onClick={onExport}
          >
            <Download className='mr-2 h-4 w-4' />
            Export
          </Button>

          {selectedCount > 0 && (
            <Button
              variant='default'
              size='sm'
              className='h-9'
              onClick={onBulkAction}
            >
              Actions ({selectedCount})
            </Button>
          )}
        </div>
      </div>

      {/* Active filters display */}
      {isFiltered && (
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-muted-foreground text-sm'>Active filters:</span>

          {searchInput && (
            <Badge variant='secondary' className='rounded-sm'>
              Search: {searchInput}
              <button
                className='hover:text-foreground ml-1'
                onClick={() => onSearchInputChange('')}
              >
                <X className='h-3 w-3' />
              </button>
            </Badge>
          )}

          {filters.status?.map((status) => (
            <Badge key={status} variant='secondary' className='rounded-sm'>
              Status: {USER_STATUS_CONFIG[status]?.label || status}
              <button
                className='hover:text-foreground ml-1'
                onClick={() => handleStatusToggle(status, false)}
              >
                <X className='h-3 w-3' />
              </button>
            </Badge>
          ))}

          {filters.role?.map((role) => (
            <Badge key={role} variant='secondary' className='rounded-sm'>
              Role:{' '}
              {role
                .split('_')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ')}
              <button
                className='hover:text-foreground ml-1'
                onClick={() => handleRoleToggle(role, false)}
              >
                <X className='h-3 w-3' />
              </button>
            </Badge>
          ))}

          {filters.email_verified !== undefined && (
            <Badge variant='secondary' className='rounded-sm'>
              {filters.email_verified ? 'Email Verified' : 'Email Unverified'}
              <button
                className='hover:text-foreground ml-1'
                onClick={() => handleEmailVerifiedToggle(undefined)}
              >
                <X className='h-3 w-3' />
              </button>
            </Badge>
          )}

          <Button
            variant='ghost'
            size='sm'
            onClick={clearAllFilters}
            className='h-6 px-2 text-xs'
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  )
}
