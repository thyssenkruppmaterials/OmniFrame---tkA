/**
 * Putback Log Hook - October 20, 2025
 *
 * React Query hook for putback ticket operations.
 * Follows established patterns from usePutawayOperations.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import type { PutbackTicket } from '@/lib/supabase/database.types'
import {
  putbackLogService,
  type PutbackTicketWithUser,
} from '@/lib/supabase/putback-log.service'
import { logger } from '@/lib/utils/logger'

interface UsePutbackLogOptions {
  enableRealtime?: boolean
}

export interface UsePutbackLogReturn {
  data: PutbackTicketWithUser[]
  filteredData: PutbackTicketWithUser[]
  statistics: {
    totalTickets: number
    todayTickets: number
    openTickets: number
    completedTickets: number
    uniqueMaterials: number
    uniqueCreators: number
  }
  isLoading: boolean
  error: Error | null
  searchQuery: string
  setSearchQuery: (query: string) => void
  refreshData: () => void
  exportToCSV: () => void
  updatePutbackTicket: (
    id: string,
    updates: Partial<PutbackTicket>
  ) => Promise<void>
}

export function usePutbackLog({
  enableRealtime = true,
}: UsePutbackLogOptions = {}): UsePutbackLogReturn {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(
    null
  )

  // Fetch putback tickets
  const {
    data: tickets = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['putback-tickets-controlled'],
    queryFn: () => putbackLogService.fetchPutbackTickets(),
    staleTime: 30000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 60000, // Refresh every 60 seconds
  })

  // Fetch statistics
  const { data: statistics } = useQuery({
    queryKey: ['putback-statistics-controlled'],
    queryFn: () => putbackLogService.getStatistics(),
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 60000,
  })

  // Real-time subscription setup
  useEffect(() => {
    if (!enableRealtime || !authState.profile?.organization_id) {
      return
    }

    logger.log('🔄 Setting up real-time subscription for putback tickets...')

    const channel = supabase
      .channel('putback-tickets-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'putback_tickets',
          filter: `organization_id=eq.${authState.profile.organization_id}`,
        },
        (payload) => {
          logger.log('🔔 Putback ticket change detected:', payload)

          // Invalidate queries to refresh data
          queryClient.invalidateQueries({
            queryKey: ['putback-tickets-controlled'],
          })
          queryClient.invalidateQueries({
            queryKey: ['putback-statistics-controlled'],
          })

          // Show toast notification
          if (payload.eventType === 'INSERT') {
            toast.success('New putback ticket created')
          } else if (payload.eventType === 'UPDATE') {
            toast.info('Putback ticket updated')
          } else if (payload.eventType === 'DELETE') {
            toast.info('Putback ticket deleted')
          }
        }
      )
      .subscribe()

    subscriptionRef.current = channel

    return () => {
      logger.log('🔌 Cleaning up putback tickets subscription')
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current)
        subscriptionRef.current = null
      }
    }
  }, [enableRealtime, authState.profile?.organization_id, queryClient])

  // Filter tickets by search query
  const filteredData = putbackLogService.filterPutbackTickets(
    tickets,
    searchQuery
  )

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<PutbackTicket>
    }) => {
      const result = await putbackLogService.updatePutbackTicket(id, updates)
      if (result.error) {
        throw new Error(
          result.error.message || 'Failed to update putback ticket'
        )
      }
      return result.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['putback-tickets-controlled'],
      })
      queryClient.invalidateQueries({
        queryKey: ['putback-statistics-controlled'],
      })
      toast.success('Putback ticket updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update putback ticket: ${error.message}`)
    },
  })

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: ['putback-tickets-controlled'] })
    queryClient.invalidateQueries({
      queryKey: ['putback-statistics-controlled'],
    })
  }

  const exportToCSV = () => {
    const csvContent = putbackLogService.exportToCSV(filteredData)

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)

    link.setAttribute('href', url)
    link.setAttribute(
      'download',
      `putback-tickets-${new Date().toISOString().split('T')[0]}.csv`
    )
    link.style.visibility = 'hidden'

    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    toast.success(`Exported ${filteredData.length} putback tickets`)
  }

  const updatePutbackTicket = async (
    id: string,
    updates: Partial<PutbackTicket>
  ) => {
    await updateMutation.mutateAsync({ id, updates })
  }

  return {
    data: tickets,
    filteredData,
    statistics: statistics || {
      totalTickets: 0,
      todayTickets: 0,
      openTickets: 0,
      completedTickets: 0,
      uniqueMaterials: 0,
      uniqueCreators: 0,
    },
    isLoading,
    error: error as Error | null,
    searchQuery,
    setSearchQuery,
    refreshData,
    exportToCSV,
    updatePutbackTicket,
  }
}
