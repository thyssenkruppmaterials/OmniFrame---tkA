// Created and developed by Jai Singh
import { useEffect, useRef } from 'react'

interface MinimalWakeLockSentinel {
  release: () => Promise<void>
  addEventListener: (
    type: 'release',
    handler: () => void,
    options?: AddEventListenerOptions
  ) => void
  removeEventListener?: (type: 'release', handler: () => void) => void
}

/**
 * Acquire a screen wake lock for the lifetime of the component.
 * No-ops silently when the Wake Lock API is unavailable (Safari < 16.4,
 * many internal browsers, etc).
 *
 * Re-acquires automatically when the document becomes visible again,
 * because the browser releases wake locks on tab hide.
 */
export function useScreenWakeLock(enabled: boolean = true): void {
  const sentinelRef = useRef<MinimalWakeLockSentinel | null>(null)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    const wakeLock = (
      navigator as Navigator & {
        wakeLock?: {
          request: (type: 'screen') => Promise<MinimalWakeLockSentinel>
        }
      }
    ).wakeLock

    if (!wakeLock || typeof wakeLock.request !== 'function') {
      return
    }

    const acquire = async (): Promise<void> => {
      try {
        const sentinel = await wakeLock.request('screen')
        if (cancelled) {
          await sentinel.release().catch(() => {})
          return
        }
        sentinelRef.current = sentinel
        sentinel.addEventListener('release', () => {
          sentinelRef.current = null
        })
      } catch {
        // User-rejected, document hidden, or unsupported — fall through.
      }
    }

    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible' && !sentinelRef.current) {
        void acquire()
      }
    }

    void acquire()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibility)
      const current = sentinelRef.current
      sentinelRef.current = null
      if (current) {
        void current.release().catch(() => {})
      }
    }
  }, [enabled])
}

// Created and developed by Jai Singh
