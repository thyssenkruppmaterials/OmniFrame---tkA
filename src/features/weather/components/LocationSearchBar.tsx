// Created and developed by Jai Singh
import { useState, useRef, useEffect } from 'react'
import {
  IconSearch,
  IconCurrentLocation,
  IconMapPin,
  IconLoader2,
  IconX,
} from '@tabler/icons-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLocationSearch } from '../hooks/use-location-search'
import type {
  GeoLocation,
  GeocodingResult,
  TemperatureUnit,
} from '../types/weather.types'

interface LocationSearchBarProps {
  currentLocation: GeoLocation
  onLocationChange: (loc: GeoLocation) => void
  onDetectLocation: () => void
  isLocating: boolean
  unit: TemperatureUnit
  onUnitChange: (unit: TemperatureUnit) => void
}

export function LocationSearchBar({
  currentLocation,
  onLocationChange,
  onDetectLocation,
  isLocating,
  unit,
  onUnitChange,
}: LocationSearchBarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { results, isSearching, search, clearResults } = useLocationSearch()
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen && inputRef.current) inputRef.current.focus()
  }, [isOpen])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
        setQuery('')
        clearResults()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [clearResults])

  const handleSelect = (result: GeocodingResult) => {
    onLocationChange({
      latitude: result.latitude,
      longitude: result.longitude,
      name: result.name,
      country: result.country,
      admin1: result.admin1,
    })
    setIsOpen(false)
    setQuery('')
    clearResults()
  }

  return (
    <div className='flex items-center gap-1.5'>
      {/* Search */}
      <div ref={containerRef} className='relative'>
        <AnimatePresence mode='wait'>
          {isOpen ? (
            <motion.div
              key='input'
              initial={{ width: 180 }}
              animate={{ width: 300 }}
              exit={{ width: 180 }}
              className='relative'
            >
              <IconSearch
                size={14}
                className='absolute top-1/2 left-2.5 -translate-y-1/2 text-white/35'
              />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  search(e.target.value)
                }}
                placeholder='Search city...'
                className='h-8 w-full rounded-lg bg-white/10 pr-8 pl-8 text-sm text-white placeholder-white/30 ring-1 ring-white/15 backdrop-blur-lg outline-none focus:ring-white/30'
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery('')
                    clearResults()
                  }}
                  className='absolute top-1/2 right-2 -translate-y-1/2 text-white/35 hover:text-white'
                >
                  <IconX size={14} />
                </button>
              )}

              <AnimatePresence>
                {(results.length > 0 || isSearching) && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className='absolute top-full right-0 left-0 z-50 mt-1.5 max-h-60 overflow-auto rounded-xl border border-white/10 bg-black/85 py-1 shadow-2xl backdrop-blur-xl'
                  >
                    {isSearching && (
                      <div className='flex items-center gap-2 px-3 py-2.5 text-xs text-white/40'>
                        <IconLoader2 size={14} className='animate-spin' />
                        <span>Searching...</span>
                      </div>
                    )}
                    {results.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => handleSelect(r)}
                        className='flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-white/10'
                      >
                        <IconMapPin
                          size={14}
                          className='shrink-0 text-white/30'
                        />
                        <div>
                          <span className='font-medium text-white/90'>
                            {r.name}
                          </span>
                          <span className='text-white/40'>
                            {r.admin1 ? `, ${r.admin1}` : ''}
                            {r.country ? `, ${r.country}` : ''}
                          </span>
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.button
              key='btn'
              onClick={() => setIsOpen(true)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className='flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm text-white/50 ring-1 ring-white/10 backdrop-blur-lg transition-all hover:bg-white/15 hover:text-white/70'
            >
              <IconSearch size={14} />
              <span className='max-w-[120px] truncate font-medium'>
                {currentLocation.name}
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Geolocation */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onDetectLocation}
        disabled={isLocating}
        className='flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white/50 ring-1 ring-white/10 backdrop-blur-lg transition-all hover:bg-white/15 hover:text-white disabled:opacity-50'
        title='Use my location'
      >
        {isLocating ? (
          <IconLoader2 size={14} className='animate-spin' />
        ) : (
          <IconCurrentLocation size={14} />
        )}
      </motion.button>

      {/* Unit toggle */}
      <div className='flex h-8 items-center overflow-hidden rounded-lg bg-white/10 ring-1 ring-white/10 backdrop-blur-lg'>
        {(['celsius', 'fahrenheit'] as const).map((u) => (
          <motion.button
            key={u}
            onClick={() => onUnitChange(u)}
            whileTap={{ scale: 0.95 }}
            className={`px-2.5 py-1 text-xs font-semibold transition-all ${
              unit === u
                ? 'bg-white/20 text-white shadow-inner'
                : 'text-white/35 hover:text-white/55'
            }`}
          >
            °{u === 'celsius' ? 'C' : 'F'}
          </motion.button>
        ))}
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
