import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { DeviceStatusEvent } from '../types/device-manager.types'

const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_DELAY_MS = 2000

const MDM_SERVICE_URL =
  import.meta.env.VITE_MDM_SERVICE_URL || 'http://localhost:8040'

export interface UseDeviceStreamReturn {
  devices: Map<string, DeviceStatusEvent>
  isConnected: boolean
  error: string | null
  reconnect: () => void
  disconnect: () => void
}

export function useDeviceStream(): UseDeviceStreamReturn {
  const [devices, setDevices] = useState<Map<string, DeviceStatusEvent>>(
    new Map()
  )
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const connect = useCallback(async () => {
    if (!mountedRef.current) return

    const baseWsUrl =
      MDM_SERVICE_URL.replace(/^http/, 'ws') + '/api/v1/admin/streams/devices'

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
        setError(null)
        reconnectAttemptsRef.current = 0
      }

      ws.onmessage = (event) => {
        if (!mountedRef.current) return
        try {
          const data: DeviceStatusEvent = JSON.parse(event.data)
          if (data.device_id) {
            setDevices((prev) => {
              const next = new Map(prev)
              next.set(data.device_id, data)
              return next
            })
          }
        } catch {
          /* ignore parse errors */
        }
      }

      ws.onerror = () => {
        if (!mountedRef.current) return
        setError('WebSocket connection error')
        setIsConnected(false)
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setIsConnected(false)
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay =
            RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current)
          reconnectAttemptsRef.current++
          reconnectTimeoutRef.current = setTimeout(connect, delay)
        }
      }
    } catch {
      setError('Failed to create WebSocket connection')
    }
  }, [])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsConnected(false)
  }, [])

  const reconnect = useCallback(() => {
    disconnect()
    reconnectAttemptsRef.current = 0
    connect()
  }, [connect, disconnect])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      disconnect()
    }
  }, [connect, disconnect])

  return { devices, isConnected, error, reconnect, disconnect }
}
