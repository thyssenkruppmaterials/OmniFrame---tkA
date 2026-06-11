// Created and developed by Jai Singh
'use client'

import * as React from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export interface MultiSelectOption {
  label: string
  value: string
}

interface MultiSelectProps {
  options: MultiSelectOption[]
  selected?: string[]
  onSelectionChange?: (selected: string[]) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  maxItems?: number
}

export function MultiSelect({
  options,
  selected = [],
  onSelectionChange,
  placeholder = 'Select items...',
  className,
  disabled = false,
  maxItems,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [selectedValues, setSelectedValues] = React.useState<string[]>(selected)

  React.useEffect(() => {
    setSelectedValues(selected)
  }, [selected])

  const handleUnselect = (item: string) => {
    const newSelection = selectedValues.filter((s) => s !== item)
    setSelectedValues(newSelection)
    onSelectionChange?.(newSelection)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const input = e.target as HTMLInputElement
    if (input.value === '') {
      if (e.key === 'Backspace') {
        const newSelection = selectedValues.slice(0, -1)
        setSelectedValues(newSelection)
        onSelectionChange?.(newSelection)
      }
    }
  }

  const selectables = options.filter(
    (option) => !selectedValues.includes(option.value)
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          role='combobox'
          aria-expanded={open}
          className={cn('w-full justify-between', className)}
          disabled={disabled}
        >
          <div className='flex flex-wrap gap-1'>
            {selectedValues.length === 0 && placeholder}
            {selectedValues
              .slice(0, maxItems || selectedValues.length)
              .map((item) => {
                const option = options.find((opt) => opt.value === item)
                return (
                  <Badge
                    variant='secondary'
                    key={item}
                    className='mr-1 mb-1'
                    onClick={(e) => {
                      e.stopPropagation()
                      handleUnselect(item)
                    }}
                  >
                    {option?.label || item}
                    <button
                      className='ring-offset-background focus:ring-ring ml-1 rounded-full outline-none focus:ring-2 focus:ring-offset-2'
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleUnselect(item)
                        }
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        handleUnselect(item)
                      }}
                    >
                      <X className='text-muted-foreground hover:text-foreground h-3 w-3' />
                    </button>
                  </Badge>
                )
              })}
            {maxItems && selectedValues.length > maxItems && (
              <Badge variant='secondary' className='mr-1 mb-1'>
                +{selectedValues.length - maxItems} more
              </Badge>
            )}
          </div>
          <ChevronDown className='h-4 w-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-full p-0' align='start'>
        <Command>
          <CommandInput placeholder='Search...' onKeyDown={handleKeyDown} />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {selectables.map((option) => (
                <CommandItem
                  key={option.value}
                  onSelect={() => {
                    const newSelection = [...selectedValues, option.value]
                    setSelectedValues(newSelection)
                    onSelectionChange?.(newSelection)
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      selectedValues.includes(option.value)
                        ? 'opacity-100'
                        : 'opacity-0'
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// Created and developed by Jai Singh
