/**
 * Real-time update functionality for tickets
 * Implements polling-based updates with webhook event support
 */
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Polling interval in milliseconds (5 seconds)
const POLL_INTERVAL = 5000

export interface TicketEvent {
  event_id: string
  event_type: string
  object_type: string
  object_id: number
  timestamp: string
  additional_details?: Record<string, unknown>
}

export interface TicketEventsResponse {
  ticket_id: string
  events: TicketEvent[]
  last_updated: string
  has_more: boolean
}

/**
 * Fetch events for a ticket since a specific timestamp
 */
async function fetchTicketEvents(
  rowId: number,
  since?: string
): Promise<TicketEventsResponse> {
  const params = new URLSearchParams()
  if (since) {
    params.append('since', since)
  }

  // Attach auth headers for authenticated endpoints
  const headers: Record<string, string> = {}
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    }
  } catch {
    /* continue without token */
  }

  const response = await fetch(
    `${API_BASE_URL}/api/customer-tickets/${rowId}/events?${params}`,
    { headers }
  )

  if (!response.ok) {
    throw new Error('Failed to fetch ticket events')
  }

  return response.json()
}

/**
 * Hook for real-time ticket updates via polling
 *
 * Automatically polls for ticket events and invalidates queries when changes occur
 *
 * @param ticketId - The ticket row ID to monitor
 * @param options - Configuration options
 * @returns Object with polling status and event information
 */
export function useTicketRealtime(
  ticketId: number | null,
  options?: {
    enabled?: boolean
    pollInterval?: number
    onEvent?: (event: TicketEvent) => void
  }
) {
  const {
    enabled = true,
    pollInterval = POLL_INTERVAL,
    onEvent,
  } = options || {}

  const queryClient = useQueryClient()
  const [lastChecked, setLastChecked] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [latestEvents, setLatestEvents] = useState<TicketEvent[]>([])
  const [error, setError] = useState<Error | null>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Don't start polling if disabled or no ticket ID
    if (!enabled || !ticketId) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      setIsPolling(false)
      return
    }

    const poll = async () => {
      try {
        setError(null)
        const response = await fetchTicketEvents(
          ticketId,
          lastChecked || undefined
        )

        if (response.events && response.events.length > 0) {
          setLatestEvents(response.events)

          // Process each event
          response.events.forEach((event) => {
            // Call event handler if provided
            if (onEvent) {
              onEvent(event)
            }

            // Invalidate queries based on event type
            if (event.event_type.includes('row.updated')) {
              queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] })
            } else if (
              event.event_type.includes('discussion') ||
              event.event_type.includes('comment')
            ) {
              queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] })
            } else if (event.event_type.includes('attachment')) {
              queryClient.invalidateQueries({
                queryKey: ['tickets', ticketId, 'attachments'],
              })
              queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] })
            }
          })

          // Update last checked timestamp
          setLastChecked(response.last_updated)
        }
      } catch (err) {
        logger.error('Error polling for ticket updates:', err)
        setError(
          err instanceof Error ? err : new Error('Unknown polling error')
        )
      }
    }

    // Initial poll
    setIsPolling(true)
    poll()

    // Set up polling interval
    pollingRef.current = setInterval(poll, pollInterval)

    // Cleanup on unmount or when dependencies change
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      setIsPolling(false)
    }
  }, [ticketId, enabled, pollInterval, onEvent, lastChecked, queryClient])

  return {
    isPolling,
    latestEvents,
    error,
    lastChecked,
  }
}

/**
 * Hook for displaying real-time status indicator
 *
 * Shows a visual indicator when new updates are available
 *
 * @param ticketId - The ticket row ID to monitor
 * @returns Object with update status and control functions
 */
export function useTicketUpdateIndicator(ticketId: number | null) {
  const [hasUpdates, setHasUpdates] = useState(false)
  const [updateCount, setUpdateCount] = useState(0)

  const { latestEvents, isPolling } = useTicketRealtime(ticketId, {
    enabled: !!ticketId,
    onEvent: () => {
      setHasUpdates(true)
      setUpdateCount((prev) => prev + 1)
    },
  })

  const clearUpdates = () => {
    setHasUpdates(false)
    setUpdateCount(0)
  }

  return {
    hasUpdates,
    updateCount,
    latestEvents,
    isPolling,
    clearUpdates,
  }
}

/**
 * Hook for monitoring ticket status changes
 *
 * Specifically watches for status field updates
 *
 * @param ticketId - The ticket row ID to monitor
 * @param onStatusChange - Callback when status changes
 */
export function useTicketStatusMonitor(
  ticketId: number | null,
  onStatusChange?: (event: TicketEvent) => void
) {
  useTicketRealtime(ticketId, {
    enabled: !!ticketId,
    onEvent: (event) => {
      // Check if this is a status-related update
      if (
        event.event_type === 'row.updated' &&
        (
          event.additional_details?.column_name as string | undefined
        )?.toLowerCase() === 'status'
      ) {
        if (onStatusChange) {
          onStatusChange(event)
        }
      }
    },
  })
}
