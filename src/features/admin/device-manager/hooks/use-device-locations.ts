// Created and developed by Jai Singh
import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { DeviceManagerService } from '@/lib/supabase/device-manager.service'
import type {
  LocationUpdate,
  DeviceLocation,
} from '../types/device-manager.types'

const MDM_SERVICE_URL =
  import.meta.env.VITE_MDM_SERVICE_URL || 'http://localhost:8040'

export function useLocationStream() {
  const [locations, setLocations] = useState<Map<string, LocationUpdate>>(
    new Map()
  )
  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const mountedRef = useRef(true)

  const connect = useCallback(async () => {
    if (!mountedRef.current) return

    const baseWsUrl =
      MDM_SERVICE_URL.replace(/^http/, 'ws') + '/api/v1/admin/streams/locations'

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token || ''
      const wsUrl = token
        ? `${baseWsUrl}?token=${encodeURIComponent(token)}`
        : baseWsUrl
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) return
        setIsConnected(true)
      }

      ws.onmessage = (event) => {
        if (!mountedRef.current) return
        try {
          const data = JSON.parse(event.data)
          if (data.payload?.latitude && data.device_id) {
            const loc: LocationUpdate = {
              device_id: data.device_id,
              latitude: data.payload.latitude,
              longitude: data.payload.longitude,
              accuracy: data.payload.accuracy || null,
              speed: data.payload.speed || null,
              heading: data.payload.heading || null,
              timestamp: data.payload.timestamp || data.timestamp,
            }
            setLocations((prev) => {
              const next = new Map(prev)
              next.set(loc.device_id, loc)
              return next
            })
          }
        } catch {
          /* ignore */
        }
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setIsConnected(false)
        setTimeout(connect, 3000)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      wsRef.current?.close()
    }
  }, [connect])

  return { locations, isConnected }
}

export function useLocationHistory(params: {
  deviceId: string | null
  startDate?: string
  endDate?: string
  limit?: number
}) {
  return useQuery({
    queryKey: [
      'mdm-location-history',
      params.deviceId,
      params.startDate,
      params.endDate,
    ],
    queryFn: () =>
      DeviceManagerService.getLocationHistory({
        deviceId: params.deviceId!,
        startDate: params.startDate,
        endDate: params.endDate,
        limit: params.limit,
      }),
    enabled: !!params.deviceId,
    staleTime: 30_000,
  })
}

export function useLatestLocations() {
  return useQuery<DeviceLocation[]>({
    queryKey: ['mdm-latest-locations'],
    queryFn: DeviceManagerService.getLatestLocations,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

// Created and developed by Jai Singh
