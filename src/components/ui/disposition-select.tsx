// Created and developed by Jai Singh
import React, { useState, useEffect } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  deliveryStatusService,
  type DeliveryDisposition,
} from '@/lib/supabase/delivery-status.service'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Global cache for dispositions to prevent redundant loading
const dispositionsCache = new Map<
  string,
  { data: DeliveryDisposition[]; timestamp: number }
>()
const loadingPromises = new Map<string, Promise<DeliveryDisposition[]>>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

interface DispositionSelectProps {
  deliveryId: string
  currentDispositionId: string | null
  onDispositionChange?: () => void
}

// Memoized component to prevent unnecessary rerenders during table sorting/filtering
export const DispositionSelect = React.memo(
  function DispositionSelect({
    deliveryId,
    currentDispositionId,
    onDispositionChange,
  }: DispositionSelectProps) {
    const { authState } = useUnifiedAuth()
    const organizationId = authState.profile?.organization_id

    const [dispositions, setDispositions] = useState<DeliveryDisposition[]>([])
    const [selectedDisposition, setSelectedDisposition] =
      useState<DeliveryDisposition | null>(null)

    // Load dispositions with coordinated caching - prevents sequential popping
    useEffect(() => {
      if (!organizationId) return

      const cacheKey = `dispositions-${organizationId}`
      const cached = dispositionsCache.get(cacheKey)
      const now = Date.now()

      // Use cache if valid - instant synchronous update
      if (cached && now - cached.timestamp < CACHE_TTL) {
        setDispositions(cached.data)
        return
      }

      // Check if another component is already loading
      const existingPromise = loadingPromises.get(cacheKey)
      if (existingPromise) {
        // Wait for the existing load to complete
        existingPromise
          .then((data) => setDispositions(data))
          .catch((error) => {
            logger.error('Failed to load dispositions:', error)
          })
        return
      }

      // Create new loading promise
      const loadPromise = deliveryStatusService
        .getDispositions(organizationId)
        .then((data) => {
          dispositionsCache.set(cacheKey, { data, timestamp: now })
          loadingPromises.delete(cacheKey)
          return data
        })
        .catch((error) => {
          logger.error('Failed to load dispositions:', error)
          loadingPromises.delete(cacheKey)
          throw error
        })

      // Store promise for other components to use
      loadingPromises.set(cacheKey, loadPromise)

      // Update this component
      loadPromise
        .then((data) => setDispositions(data))
        .catch(() => {
          // Fail silently
        })
    }, [organizationId])

    // Update selected disposition when prop changes
    useEffect(() => {
      if (currentDispositionId && dispositions.length > 0) {
        const disposition = dispositions.find(
          (d) => d.id === currentDispositionId
        )
        setSelectedDisposition(disposition || null)
      } else {
        setSelectedDisposition(null)
      }
    }, [currentDispositionId, dispositions])

    const handleSelectDisposition = async (dispositionId: string | null) => {
      // Optimistic update - update UI immediately
      const previousDisposition = selectedDisposition

      if (dispositionId) {
        const disposition = dispositions.find((d) => d.id === dispositionId)
        setSelectedDisposition(disposition || null)
      } else {
        setSelectedDisposition(null)
      }

      try {
        // Update database in background
        await deliveryStatusService.updateDeliveryDisposition(
          deliveryId,
          dispositionId
        )

        // Show success toast
        if (dispositionId) {
          const disposition = dispositions.find((d) => d.id === dispositionId)
          toast.success(`Disposition set to: ${disposition?.name || 'Unknown'}`)
        } else {
          toast.success('Disposition cleared')
        }

        // Only call refresh callback if update succeeded
        onDispositionChange?.()
      } catch (error) {
        logger.error('Failed to update disposition:', error)
        // Revert to previous state on error
        setSelectedDisposition(previousDisposition)
        toast.error('Failed to update disposition')
      }
    }

    const getColorClass = (color: string) => {
      const colorMap: Record<string, string> = {
        gray: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
        red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
        orange:
          'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
        yellow:
          'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
        green:
          'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
        blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
        purple:
          'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
        pink: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300',
      }
      return colorMap[color] || colorMap.gray
    }

    // Don't show loading state to prevent flicker during table operations
    // If no dispositions yet, show minimal placeholder
    if (dispositions.length === 0) {
      return (
        <Badge
          variant='outline'
          className='text-muted-foreground border-muted bg-transparent px-2 py-0.5 text-xs'
        >
          —
        </Badge>
      )
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div className='group flex cursor-pointer items-center gap-1'>
            {selectedDisposition ? (
              <Badge
                variant='outline'
                className={`${getColorClass(selectedDisposition.color ?? 'gray')} border-0 px-2 py-0.5 text-xs`}
              >
                {selectedDisposition.name}
              </Badge>
            ) : (
              <Badge
                variant='outline'
                className='text-muted-foreground border-muted group-hover:border-border group-hover:bg-muted/50 bg-transparent px-2 py-0.5 text-xs'
              >
                —
              </Badge>
            )}
            <ChevronDown className='text-muted-foreground h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100' />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='start'
          className='bg-background border-border'
        >
          {selectedDisposition && (
            <DropdownMenuItem
              onClick={() => handleSelectDisposition(null)}
              className='hover:bg-accent'
            >
              <X className='text-muted-foreground mr-2 h-4 w-4' />
              Clear Disposition
            </DropdownMenuItem>
          )}
          {dispositions.map((disposition) => (
            <DropdownMenuItem
              key={disposition.id}
              onClick={() => handleSelectDisposition(disposition.id)}
              className='hover:bg-accent'
            >
              <Badge
                variant='outline'
                className={`${getColorClass(disposition.color ?? 'gray')} mr-2 border-0`}
              >
                {disposition.name}
              </Badge>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  },
  (prevProps, nextProps) => {
    // Custom comparison function for React.memo
    // Only rerender if deliveryId or currentDispositionId actually changed
    return (
      prevProps.deliveryId === nextProps.deliveryId &&
      prevProps.currentDispositionId === nextProps.currentDispositionId
    )
  }
)

// Created and developed by Jai Singh
