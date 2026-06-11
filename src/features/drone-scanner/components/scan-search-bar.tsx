// Created and developed by Jai Singh
/**
 * Scan Search Bar Component
 *
 * Full-text search input for drone scan records.
 */
import { useState, useCallback } from 'react'
import { Search, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ScanSearchBarProps {
  onSearch: (query: string) => void
  isSearching?: boolean
  placeholder?: string
}

export function ScanSearchBar({
  onSearch,
  isSearching = false,
  placeholder = 'Search scans (SKU, lot, barcode, description...)',
}: ScanSearchBarProps) {
  const [query, setQuery] = useState('')

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (query.trim()) {
        onSearch(query.trim())
      }
    },
    [query, onSearch]
  )

  const handleClear = useCallback(() => {
    setQuery('')
    onSearch('')
  }, [onSearch])

  return (
    <form onSubmit={handleSubmit} className='relative'>
      <div className='flex gap-2'>
        <div className='relative flex-1'>
          <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            type='text'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className='pr-8 pl-9'
            disabled={isSearching}
          />
          {query && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='absolute top-1/2 right-1 h-6 w-6 -translate-y-1/2 p-0'
              onClick={handleClear}
            >
              <X className='h-3 w-3' />
            </Button>
          )}
        </div>
        <Button type='submit' disabled={isSearching || !query.trim()}>
          {isSearching ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            'Search'
          )}
        </Button>
      </div>
    </form>
  )
}

// Created and developed by Jai Singh
