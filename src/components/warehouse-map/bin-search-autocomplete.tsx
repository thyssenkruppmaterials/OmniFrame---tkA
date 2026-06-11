// Created and developed by Jai Singh
/**
 * BinSearchAutocomplete — combobox-style search box for the warehouse map
 * toolbar. Matches against current map mappings and lets the user quickly
 * jump to / highlight a specific bin.
 */
import { useMemo, useRef, useState } from 'react'
import { Search, Navigation } from 'lucide-react'
import { useWarehouseMapStore } from '@/stores/warehouse-map-store'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import type { WarehouseLocationMapping } from './types'

interface BinSearchAutocompleteProps {
  mappings: WarehouseLocationMapping[]
  /** Optional callback fired when user picks a bin to navigate from. */
  onNavigateFrom?: (bin: string) => void
}

const MAX_RESULTS = 12

export function BinSearchAutocomplete({
  mappings,
  onNavigateFrom,
}: BinSearchAutocompleteProps) {
  const setSearchQuery = useWarehouseMapStore((s) => s.setSearchQuery)
  const setHighlightedBin = useWarehouseMapStore((s) => s.setHighlightedBin)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    if (!query.trim()) return [] as WarehouseLocationMapping[]
    const q = query.toLowerCase()
    const out: WarehouseLocationMapping[] = []
    for (const m of mappings) {
      if (m.storage_bin.toLowerCase().includes(q)) {
        out.push(m)
        if (out.length >= MAX_RESULTS) break
      }
    }
    return out
  }, [query, mappings])

  const handlePick = (bin: string) => {
    setSearchQuery(bin)
    setHighlightedBin(bin)
    setQuery(bin)
    setOpen(false)
  }

  return (
    <Popover open={open && matches.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className='relative'>
          <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2' />
          <Input
            ref={inputRef}
            placeholder='Search bins…'
            className='w-[200px] pl-8 font-mono'
            value={query}
            onChange={(e) => {
              const v = e.target.value
              setQuery(v)
              setSearchQuery(v)
              setOpen(v.trim().length > 0)
            }}
            onFocus={() => setOpen(query.trim().length > 0)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setOpen(false)
                setQuery('')
                setSearchQuery('')
                setHighlightedBin(null)
              }
            }}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align='start'
        className='w-[280px] p-0'
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder='Type a bin id…'
            value={query}
            onValueChange={(v) => {
              setQuery(v)
              setSearchQuery(v)
            }}
            className='hidden'
          />
          <CommandList className='max-h-72'>
            <CommandEmpty>No matching bins.</CommandEmpty>
            {matches.length > 0 && (
              <CommandGroup
                heading={`${matches.length} match${matches.length === 1 ? '' : 'es'}`}
              >
                {matches.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={m.storage_bin}
                    onSelect={() => handlePick(m.storage_bin)}
                    className='flex items-center justify-between gap-2'
                  >
                    <span className='font-mono text-xs'>{m.storage_bin}</span>
                    <span className='text-muted-foreground text-[10px] capitalize'>
                      {m.operational_status}
                    </span>
                    {onNavigateFrom && (
                      <Button
                        variant='ghost'
                        size='icon'
                        className='ml-1 h-6 w-6'
                        onClick={(e) => {
                          e.stopPropagation()
                          onNavigateFrom(m.storage_bin)
                          setOpen(false)
                        }}
                        aria-label={`Navigate from ${m.storage_bin}`}
                      >
                        <Navigation className='h-3 w-3' />
                      </Button>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// Created and developed by Jai Singh
