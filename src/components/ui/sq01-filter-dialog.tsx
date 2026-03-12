'use client'

import { useState } from 'react'
import { X, Filter as FilterIcon } from 'lucide-react'
import type { SQ01Data } from '@/lib/supabase/sq01-data.service'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MultiSelect } from '@/components/ui/multi-select'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface FilterConfig {
  [key: string]: string | string[]
}

interface SQ01FilterDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  filterConfig: FilterConfig
  onFilterChange: (key: string, value: string | string[]) => void
  onClearAllFilters: () => void
  data: SQ01Data[]
}

interface FilterField {
  key: keyof SQ01Data
  label: string
  type: 'select' | 'multi-select' | 'text' | 'number'
}

// Define filterable fields covering ALL columns from rr_sq01_data table
const FILTER_FIELDS: FilterField[] = [
  { key: 'plant', label: 'Plant', type: 'multi-select' },
  { key: 'val_type', label: 'Val. Type', type: 'multi-select' },
  { key: 'sloc', label: 'SLoc', type: 'multi-select' },
  { key: 'conf_cert_ref', label: 'Conf Cert Ref', type: 'text' },
  { key: 'material', label: 'Material', type: 'text' },
  { key: 'material_description', label: 'Material Description', type: 'text' },
  { key: 'batch', label: 'Batch', type: 'text' },
  { key: 'serial_number', label: 'Serial Number', type: 'text' },
  { key: 'unrestricted', label: 'Unrestricted', type: 'number' },
  { key: 'blocked', label: 'Blocked', type: 'number' },
  { key: 'in_qual_insp', label: 'In Qual. Insp.', type: 'number' },
  { key: 'confirmed_yield', label: 'Confirmed Yield', type: 'number' },
  { key: 'ext_mov_avg_price', label: 'Ext MovAvgPrice', type: 'number' },
  { key: 'general_info', label: 'General Info', type: 'text' },
]

export function SQ01FilterDialog({
  isOpen,
  onOpenChange,
  filterConfig,
  onFilterChange,
  onClearAllFilters,
  data,
}: SQ01FilterDialogProps) {
  const [localFilterConfig, setLocalFilterConfig] =
    useState<FilterConfig>(filterConfig)

  // Get unique values for select fields
  const getUniqueValues = (key: keyof SQ01Data) => {
    const values = data
      .map((item) => {
        const value = item[key]
        return value ? String(value) : ''
      })
      .filter(Boolean)
    return Array.from(new Set(values)).sort()
  }

  const handleLocalFilterChange = (key: string, value: string | string[]) => {
    const field = FILTER_FIELDS.find((f) => f.key === key)

    if (field?.type === 'multi-select') {
      // For multi-select fields, value should be an array
      setLocalFilterConfig((prev) => ({
        ...prev,
        [key]: Array.isArray(value) ? value : [],
      }))
    } else {
      // For regular select, text, and number fields
      setLocalFilterConfig((prev) => ({
        ...prev,
        [key]:
          value === '__all__' ? '' : typeof value === 'string' ? value : '',
      }))
    }
  }

  const handleApplyFilters = () => {
    // Apply all local filters to the parent component
    Object.entries(localFilterConfig).forEach(([key, value]) => {
      onFilterChange(key, value)
    })
    onOpenChange(false)
  }

  const handleClearAll = () => {
    setLocalFilterConfig({})
    onClearAllFilters()
  }

  const activeFilterCount = Object.values(filterConfig).filter((value) => {
    if (Array.isArray(value)) {
      return value.length > 0
    }
    return value && (typeof value === 'string' ? value.trim() : false)
  }).length

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <FilterIcon className='h-5 w-5' />
            Filter SQ01 Data
          </DialogTitle>
          <DialogDescription>
            Apply filters to narrow down your SQ01 data results. You can filter
            by multiple criteria simultaneously across all available columns.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-8 py-6'>
          {/* Active Filters Summary */}
          {activeFilterCount > 0 && (
            <div className='rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950'>
              <div className='mb-2 flex items-center justify-between'>
                <Label className='text-sm font-medium text-blue-900 dark:text-blue-100'>
                  Active Filters ({activeFilterCount})
                </Label>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={handleClearAll}
                  className='h-7 text-xs'
                >
                  <X className='mr-1 h-3 w-3' />
                  Clear All
                </Button>
              </div>
              <div className='flex flex-wrap gap-2'>
                {Object.entries(filterConfig).map(([key, value]) => {
                  const field = FILTER_FIELDS.find((f) => f.key === key)
                  let isEmpty = false
                  let displayValue = ''

                  if (Array.isArray(value)) {
                    isEmpty = value.length === 0
                    displayValue =
                      value.length > 1
                        ? `${value.length} selected`
                        : value[0] || ''
                  } else {
                    isEmpty = !value || !value.trim()
                    displayValue = value || ''
                  }

                  if (isEmpty) return null

                  return (
                    <Badge key={key} variant='secondary' className='text-xs'>
                      {field?.label || key}: {displayValue}
                      <button
                        onClick={() => {
                          const clearValue =
                            field?.type === 'multi-select' ? [] : ''
                          onFilterChange(key, clearValue)
                          setLocalFilterConfig((prev) => ({
                            ...prev,
                            [key]: clearValue,
                          }))
                        }}
                        className='hover:text-destructive ml-1'
                      >
                        <X className='h-3 w-3' />
                      </button>
                    </Badge>
                  )
                })}
              </div>
            </div>
          )}

          {/* Filter Fields */}
          <div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'>
            {FILTER_FIELDS.map((field) => {
              const uniqueValues =
                field.type === 'select' || field.type === 'multi-select'
                  ? getUniqueValues(field.key)
                  : []

              return (
                <div key={field.key} className='space-y-3'>
                  <Label
                    htmlFor={field.key}
                    className='block text-sm font-medium'
                  >
                    {field.label}
                  </Label>

                  {field.type === 'text' ? (
                    <div className='min-h-[40px]'>
                      <Input
                        id={field.key}
                        placeholder={`Filter by ${field.label.toLowerCase()}...`}
                        value={(localFilterConfig[field.key] as string) || ''}
                        onChange={(e) =>
                          handleLocalFilterChange(field.key, e.target.value)
                        }
                        className='h-10 w-full'
                      />
                    </div>
                  ) : field.type === 'number' ? (
                    <div className='min-h-[40px]'>
                      <Input
                        id={field.key}
                        type='number'
                        placeholder={`Filter by ${field.label.toLowerCase()}...`}
                        value={(localFilterConfig[field.key] as string) || ''}
                        onChange={(e) =>
                          handleLocalFilterChange(field.key, e.target.value)
                        }
                        className='h-10 w-full'
                      />
                    </div>
                  ) : field.type === 'multi-select' ? (
                    <div className='min-h-[40px]'>
                      <MultiSelect
                        options={uniqueValues.map((value) => ({
                          label: value,
                          value,
                        }))}
                        selected={
                          Array.isArray(localFilterConfig[field.key])
                            ? (localFilterConfig[field.key] as string[])
                            : []
                        }
                        onSelectionChange={(selected) =>
                          handleLocalFilterChange(field.key, selected)
                        }
                        placeholder={`Select ${field.label.toLowerCase()}...`}
                        maxItems={2}
                      />
                    </div>
                  ) : (
                    <div className='min-h-[40px]'>
                      <Select
                        value={
                          (localFilterConfig[field.key] as string) || '__all__'
                        }
                        onValueChange={(value) =>
                          handleLocalFilterChange(field.key, value)
                        }
                      >
                        <SelectTrigger className='h-10 w-full'>
                          <SelectValue
                            placeholder={`Select ${field.label.toLowerCase()}...`}
                          />
                        </SelectTrigger>
                        <SelectContent
                          className='z-50 max-h-[200px] overflow-y-auto'
                          position='popper'
                          sideOffset={4}
                        >
                          <SelectItem value='__all__'>
                            All {field.label}
                          </SelectItem>
                          {uniqueValues.map((value) => (
                            <SelectItem key={value} value={value}>
                              {value}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApplyFilters}>
            Apply Filters
            {Object.values(localFilterConfig).filter((v) => {
              if (Array.isArray(v)) return v.length > 0
              return v && (typeof v === 'string' ? v.trim() : false)
            }).length > 0 && (
              <Badge variant='secondary' className='ml-2 px-1.5 py-0.5 text-xs'>
                {
                  Object.values(localFilterConfig).filter((v) => {
                    if (Array.isArray(v)) return v.length > 0
                    return v && (typeof v === 'string' ? v.trim() : false)
                  }).length
                }
              </Badge>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
