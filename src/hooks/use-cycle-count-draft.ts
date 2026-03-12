/**
 * Cycle Count Draft Auto-Save Hook
 * Automatically saves cycle count progress to localStorage
 * Prevents data loss on connection failures or unexpected app closures
 */
import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'

interface CycleCountFormData {
  countedQuantity?: number
  notes?: string
  scannedLocation?: string
  locationVerified?: boolean
}

interface DraftData {
  countId: string
  step: number
  formData: {
    countedQuantity: number
    notes: string
    scannedLocation?: string
    locationVerified?: boolean
  }
  assignedCount: Record<string, unknown>
  timestamp: number
}

const DRAFT_KEY_PREFIX = 'cycle-count-draft'
const DRAFT_MAX_AGE_MS = 3600000 // 1 hour

export function useCycleCountDraft(
  countId: string | null,
  currentStep: number,
  formData: CycleCountFormData,
  assignedCount: Record<string, unknown> | null
) {
  /**
   * Auto-save draft to localStorage
   * Triggers after 3 seconds of inactivity to avoid excessive writes
   */
  useEffect(() => {
    if (!countId || !assignedCount) return

    // Only save drafts for in-progress counts (steps 2-4)
    if (currentStep < 2 || currentStep > 4) return

    const draft: DraftData = {
      countId,
      step: currentStep,
      formData: {
        countedQuantity: formData.countedQuantity || 0,
        notes: formData.notes || '',
        scannedLocation: formData.scannedLocation,
        locationVerified: formData.locationVerified,
      },
      assignedCount,
      timestamp: Date.now(),
    }

    // Debounce the save to avoid excessive localStorage writes
    const timeoutId = setTimeout(() => {
      try {
        localStorage.setItem(
          `${DRAFT_KEY_PREFIX}-${countId}`,
          JSON.stringify(draft)
        )
        logger.log('💾 Draft auto-saved:', {
          countId,
          step: currentStep,
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        logger.error('❌ Error saving draft:', error)
        // Don't show toast for save errors to avoid UI clutter
      }
    }, 3000) // 3 second debounce

    return () => clearTimeout(timeoutId)
  }, [countId, currentStep, formData, assignedCount])

  /**
   * Load the most recent draft on mount
   * Returns draft data or null if no valid draft exists
   */
  const loadDraft = useCallback((): DraftData | null => {
    try {
      // Find all draft keys
      const draftKeys = Object.keys(localStorage).filter((k) =>
        k.startsWith(DRAFT_KEY_PREFIX)
      )

      if (draftKeys.length === 0) return null

      // Find the most recent draft
      let mostRecentDraft: DraftData | null = null
      let mostRecentTime = 0

      for (const key of draftKeys) {
        const draftData = localStorage.getItem(key)
        if (!draftData) continue

        try {
          const draft: DraftData = JSON.parse(draftData)
          const age = Date.now() - draft.timestamp

          // Skip drafts older than 1 hour
          if (age > DRAFT_MAX_AGE_MS) {
            localStorage.removeItem(key)
            logger.log('🗑️ Removed expired draft:', key)
            continue
          }

          // Track most recent draft
          if (draft.timestamp > mostRecentTime) {
            mostRecentTime = draft.timestamp
            mostRecentDraft = draft
          }
        } catch (parseError) {
          logger.error('Error parsing draft:', parseError)
          localStorage.removeItem(key)
        }
      }

      if (mostRecentDraft) {
        const ageMinutes = Math.floor(
          (Date.now() - mostRecentDraft.timestamp) / 60000
        )
        logger.log('📋 Found draft:', {
          countId: mostRecentDraft.countId,
          step: mostRecentDraft.step,
          ageMinutes,
        })
      }

      return mostRecentDraft
    } catch (error) {
      logger.error('❌ Error loading draft:', error)
      return null
    }
  }, [])

  /**
   * Clear a specific draft by count ID
   */
  const clearDraft = useCallback((draftCountId: string) => {
    try {
      const key = `${DRAFT_KEY_PREFIX}-${draftCountId}`
      localStorage.removeItem(key)
      logger.log('🗑️ Draft cleared:', key)
    } catch (error) {
      logger.error('❌ Error clearing draft:', error)
    }
  }, [])

  /**
   * Clear all cycle count drafts
   */
  const clearAllDrafts = useCallback(() => {
    try {
      const draftKeys = Object.keys(localStorage).filter((k) =>
        k.startsWith(DRAFT_KEY_PREFIX)
      )

      draftKeys.forEach((key) => localStorage.removeItem(key))
      logger.log('🗑️ Cleared all drafts:', draftKeys.length)
    } catch (error) {
      logger.error('❌ Error clearing all drafts:', error)
    }
  }, [])

  /**
   * Show draft recovery UI
   * Returns a promise that resolves to true if user wants to resume, false otherwise
   */
  const promptDraftRecovery = useCallback(
    (draft: DraftData): Promise<boolean> => {
      return new Promise((resolve) => {
        const ageMinutes = Math.floor((Date.now() - draft.timestamp) / 60000)
        const ageText =
          ageMinutes < 1
            ? 'just now'
            : ageMinutes === 1
              ? '1 minute ago'
              : `${ageMinutes} minutes ago`

        toast.info(
          `Found a saved count from ${ageText}. Would you like to resume?`,
          {
            duration: 10000,
            action: {
              label: 'Resume',
              onClick: () => resolve(true),
            },
            cancel: {
              label: 'Start Fresh',
              onClick: () => {
                clearDraft(draft.countId)
                resolve(false)
              },
            },
          }
        )

        // Auto-decline after 10 seconds
        setTimeout(() => {
          clearDraft(draft.countId)
          resolve(false)
        }, 10000)
      })
    },
    [clearDraft]
  )

  return {
    loadDraft,
    clearDraft,
    clearAllDrafts,
    promptDraftRecovery,
  }
}

/**
 * Utility function to check if drafts exist
 */
export function hasCycleCountDrafts(): boolean {
  try {
    const draftKeys = Object.keys(localStorage).filter((k) =>
      k.startsWith(DRAFT_KEY_PREFIX)
    )
    return draftKeys.length > 0
  } catch {
    return false
  }
}

/**
 * Utility function to get draft count
 */
export function getCycleCountDraftCount(): number {
  try {
    const draftKeys = Object.keys(localStorage).filter((k) =>
      k.startsWith(DRAFT_KEY_PREFIX)
    )
    return draftKeys.length
  } catch {
    return 0
  }
}
