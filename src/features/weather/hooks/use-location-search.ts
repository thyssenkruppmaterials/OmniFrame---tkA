// Created and developed by Jai Singh
import { useState, useCallback, useRef } from 'react'
import type { GeocodingResult } from '../types/weather.types'

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'

export function useLocationSearch() {
  const [results, setResults] = useState<GeocodingResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (abortRef.current) abortRef.current.abort()

    if (query.trim().length < 2) {
      setResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const url = new URL(GEOCODING_URL)
        url.searchParams.set('name', query.trim())
        url.searchParams.set('count', '8')
        url.searchParams.set('language', 'en')
        url.searchParams.set('format', 'json')

        const response = await fetch(url.toString(), {
          signal: controller.signal,
        })

        if (!response.ok) throw new Error('Geocoding failed')

        const data = await response.json()
        setResults(data.results ?? [])
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)
  }, [])

  const clearResults = useCallback(() => {
    setResults([])
  }, [])

  return { results, isSearching, search, clearResults }
}

// Created and developed by Jai Singh
