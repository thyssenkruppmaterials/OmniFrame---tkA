// Created and developed by Jai Singh
import { useCallback, useEffect, useState } from 'react'

/**
 * Hook that syncs tab state with URL search params.
 *
 * Reads the `?tab=xxx` search parameter from the URL and keeps it in sync
 * with the component's active tab state. This enables:
 * - Tab state persistence across page refreshes
 * - Deep linking to specific tabs (e.g., /apps/grs?tab=tracking)
 * - Proper redirect-back after login preserving the active tab
 * - Bookmarkable tab URLs
 *
 * @param defaultTab - The default tab to use if no `tab` param is in the URL
 * @returns [activeTab, setActiveTab] - Similar to useState but synced with URL
 *
 * @example
 * ```tsx
 * const [activeTab, setActiveTab] = useTabSearchParam('overview')
 *
 * <TabMenu
 *   tabs={tabs}
 *   activeTab={activeTab}
 *   onTabChange={setActiveTab}
 * />
 * ```
 *
 * @date 2026-02-05
 */
export function useTabSearchParam(
  defaultTab: string
): [string, (tab: string) => void] {
  // Read the initial tab from the URL, falling back to the default
  const getTabFromUrl = useCallback((): string => {
    if (typeof window === 'undefined') return defaultTab
    const params = new URLSearchParams(window.location.search)
    return params.get('tab') || defaultTab
  }, [defaultTab])

  const [activeTab, setActiveTabState] = useState<string>(getTabFromUrl)

  // Update the URL when the tab changes
  const setActiveTab = useCallback(
    (tab: string) => {
      setActiveTabState(tab)

      if (typeof window === 'undefined') return

      const url = new URL(window.location.href)

      if (tab === defaultTab) {
        // Remove the param for default tab to keep URLs clean
        url.searchParams.delete('tab')
      } else {
        url.searchParams.set('tab', tab)
      }

      // Use replaceState to avoid polluting browser history with tab changes
      window.history.replaceState({}, '', url.toString())
    },
    [defaultTab]
  )

  // Sync with URL on popstate (back/forward navigation)
  useEffect(() => {
    const handlePopState = () => {
      const tabFromUrl = getTabFromUrl()
      setActiveTabState(tabFromUrl)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [getTabFromUrl])

  return [activeTab, setActiveTab]
}

// Created and developed by Jai Singh
