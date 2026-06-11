// Created and developed by Jai Singh
import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useUnifiedAuth } from '@/stores/unifiedAuthStore'

/**
 * Tracks the current route and saves it as the last-visited path.
 * Only tracks authenticated routes (ignores auth pages).
 * Should be used once in the authenticated layout.
 *
 * @date 2026-02-05
 */
export function useRouteTracker() {
  const router = useRouter()
  const setLastVisitedPath = useUnifiedAuth((s) => s.setLastVisitedPath)

  useEffect(() => {
    // Subscribe to route changes after navigation resolves
    const unsubscribe = router.subscribe('onResolved', (event) => {
      const path =
        event.toLocation.pathname + (event.toLocation.searchStr || '')

      // Only track non-auth routes (guard is also in setLastVisitedPath, but filter early)
      const authPaths = [
        '/sign-in',
        '/sign-up',
        '/forgot-password',
        '/500',
        '/403',
      ]
      if (!authPaths.some((p) => path.startsWith(p))) {
        setLastVisitedPath(path)
      }
    })

    return unsubscribe
  }, [router, setLastVisitedPath])
}

// Created and developed by Jai Singh
