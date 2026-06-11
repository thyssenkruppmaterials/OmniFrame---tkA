// Created and developed by Jai Singh
import { useState, useCallback } from 'react'
import type { GeoLocation } from '../types/weather.types'

const STORAGE_KEY = 'weather-location'

const DEFAULT_LOCATION: GeoLocation = {
  latitude: 52.9548,
  longitude: -1.1581,
  name: 'Derby',
  country: 'United Kingdom',
  admin1: 'England',
}

export function useGeolocation() {
  const [location, setLocationState] = useState<GeoLocation>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return JSON.parse(stored) as GeoLocation
    } catch {
      /* ignore */
    }
    return DEFAULT_LOCATION
  })
  const [isLocating, setIsLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setLocation = useCallback((loc: GeoLocation) => {
    setLocationState(loc)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loc))
    } catch {
      /* ignore */
    }
  }, [])

  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported')
      return
    }

    setIsLocating(true)
    setError(null)

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        try {
          const reverseUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&timezone=auto`
          const reverseRes = await fetch(reverseUrl)
          const reverseData = await reverseRes.json()

          const loc: GeoLocation = {
            latitude,
            longitude,
            name:
              reverseData.timezone?.split('/').pop()?.replace(/_/g, ' ') ??
              'Current Location',
            country: undefined,
            admin1: undefined,
          }

          // Try reverse geocoding for a better name
          try {
            const geoRes = await fetch(
              `https://geocoding-api.open-meteo.com/v1/search?name=${loc.name}&count=1`
            )
            const geoData = await geoRes.json()
            if (geoData.results?.[0]) {
              loc.name = geoData.results[0].name
              loc.country = geoData.results[0].country
              loc.admin1 = geoData.results[0].admin1
            }
          } catch {
            /* use timezone-derived name */
          }

          setLocation(loc)
        } catch {
          setLocation({
            latitude,
            longitude,
            name: 'Current Location',
          })
        } finally {
          setIsLocating(false)
        }
      },
      (err) => {
        setError(err.message)
        setIsLocating(false)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    )
  }, [setLocation])

  return { location, setLocation, detectLocation, isLocating, error }
}

// Created and developed by Jai Singh
