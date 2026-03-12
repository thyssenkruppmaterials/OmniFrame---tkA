'use client'

import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useTabPermissions } from '@/hooks/useTabPermissions'

interface Tab {
  id: string
  label: string
}

interface TabMenuProps extends React.HTMLAttributes<HTMLDivElement> {
  tabs: Tab[]
  activeTab?: string
  onTabChange?: (tabId: string) => void
  pageResource?: string // New prop for permission filtering
  showHiddenTabs?: boolean // For admin override (show all tabs regardless of permissions)
  fallbackTab?: string // Tab to fallback to if activeTab is not accessible
}

const TabMenu = React.forwardRef<HTMLDivElement, TabMenuProps>(
  (
    {
      className,
      tabs,
      activeTab,
      onTabChange,
      pageResource,
      showHiddenTabs = false,
      fallbackTab,
      ...props
    },
    ref
  ) => {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
    const [activeIndex, setActiveIndex] = useState(0)
    const [hoverStyle, setHoverStyle] = useState({})
    const [activeStyle, setActiveStyle] = useState({
      left: '0px',
      width: '0px',
    })
    const tabRefs = useRef<(HTMLDivElement | null)[]>([])
    const containerRef = useRef<HTMLDivElement>(null)

    // Permission-aware tab filtering
    const { hasTabAccess, isLoading } = useTabPermissions(
      pageResource || '',
      !pageResource
    )

    // Filter tabs based on permissions
    const visibleTabs = useMemo(() => {
      // Show all tabs during loading to prevent the empty-state flash
      if (isLoading && pageResource) {
        return tabs
      }

      if (showHiddenTabs || !pageResource) {
        return tabs
      }

      // Filter using hasTabAccess (which already handles admin bypass and loading)
      return tabs.filter((tab) => hasTabAccess(tab.id))
    }, [tabs, pageResource, showHiddenTabs, hasTabAccess, isLoading])

    // Handle active tab fallback when permissions change
    const effectiveActiveTab = useMemo(() => {
      if (!pageResource || showHiddenTabs) {
        return activeTab
      }

      // Check if current activeTab is accessible
      if (activeTab && hasTabAccess(activeTab)) {
        return activeTab
      }

      // Fallback to specified fallback tab if accessible
      if (fallbackTab && hasTabAccess(fallbackTab)) {
        return fallbackTab
      }

      // Fallback to first visible tab
      if (visibleTabs.length > 0) {
        return visibleTabs[0].id
      }

      return activeTab // Return original even if not accessible (for debugging)
    }, [
      activeTab,
      fallbackTab,
      pageResource,
      showHiddenTabs,
      hasTabAccess,
      visibleTabs,
    ])

    // Recalculate positions for active and hover states
    const recalculatePositions = useCallback(() => {
      // Recalculate active position
      const activeElement = tabRefs.current[activeIndex]
      if (activeElement) {
        const { offsetLeft, offsetWidth } = activeElement
        setActiveStyle({
          left: `${offsetLeft}px`,
          width: `${offsetWidth}px`,
        })
      }

      // Recalculate hover position if hovering
      if (hoveredIndex !== null) {
        const hoveredElement = tabRefs.current[hoveredIndex]
        if (hoveredElement) {
          const { offsetLeft, offsetWidth } = hoveredElement
          setHoverStyle({
            left: `${offsetLeft}px`,
            width: `${offsetWidth}px`,
          })
        }
      }
    }, [activeIndex, hoveredIndex])

    // Sync effectiveActiveTab with activeIndex state and notify parent of changes
    useEffect(() => {
      if (effectiveActiveTab) {
        const tabIndex = visibleTabs.findIndex(
          (tab) => tab.id === effectiveActiveTab
        )
        if (tabIndex !== -1 && tabIndex !== activeIndex) {
          setActiveIndex(tabIndex)
        }

        // Notify parent if the effective active tab changed
        if (effectiveActiveTab !== activeTab) {
          onTabChange?.(effectiveActiveTab)
        }
      }
    }, [effectiveActiveTab, visibleTabs, activeIndex, activeTab, onTabChange])

    // Update hover style when hovered index changes
    useEffect(() => {
      if (hoveredIndex !== null) {
        const hoveredElement = tabRefs.current[hoveredIndex]
        if (hoveredElement) {
          const { offsetLeft, offsetWidth } = hoveredElement
          setHoverStyle({
            left: `${offsetLeft}px`,
            width: `${offsetWidth}px`,
          })
        }
      }
    }, [hoveredIndex])

    // Update active style when active index changes
    useEffect(() => {
      const activeElement = tabRefs.current[activeIndex]
      if (activeElement) {
        const { offsetLeft, offsetWidth } = activeElement
        setActiveStyle({
          left: `${offsetLeft}px`,
          width: `${offsetWidth}px`,
        })
      }
    }, [activeIndex])

    // Initialize positions on mount
    useEffect(() => {
      const initializePositions = () => {
        const initialIndex = effectiveActiveTab
          ? visibleTabs.findIndex((tab) => tab.id === effectiveActiveTab)
          : 0
        const finalIndex = initialIndex !== -1 ? initialIndex : 0

        if (finalIndex !== activeIndex) {
          setActiveIndex(finalIndex)
        }

        const activeElement = tabRefs.current[finalIndex]
        if (activeElement) {
          const { offsetLeft, offsetWidth } = activeElement
          setActiveStyle({
            left: `${offsetLeft}px`,
            width: `${offsetWidth}px`,
          })
        }
      }

      // Use a small delay to ensure elements are rendered
      const timeoutId = setTimeout(initializePositions, 10)
      return () => clearTimeout(timeoutId)
    }, [visibleTabs, effectiveActiveTab, activeIndex])

    // Handle window resize
    useEffect(() => {
      const handleResize = () => {
        // Use requestAnimationFrame to ensure DOM updates are complete
        requestAnimationFrame(recalculatePositions)
      }

      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
    }, [recalculatePositions])

    // ResizeObserver for more granular resize detection
    useEffect(() => {
      if (!containerRef.current) return

      const resizeObserver = new ResizeObserver(() => {
        // Debounce rapid resize events
        requestAnimationFrame(recalculatePositions)
      })

      resizeObserver.observe(containerRef.current)

      return () => {
        resizeObserver.disconnect()
      }
    }, [recalculatePositions])

    if (visibleTabs.length === 0 && !isLoading && pageResource) {
      return (
        <div className='text-muted-foreground py-4 text-center'>
          <p>No tabs available for your current permissions.</p>
        </div>
      )
    }

    return (
      <div ref={ref} className={cn('relative', className)} {...props}>
        <div ref={containerRef} className='relative'>
          {/* Hover Highlight */}
          <div
            className='bg-primary/10 absolute flex h-[33px] items-center rounded-[6px] transition-all duration-300 ease-out'
            style={{
              ...hoverStyle,
              opacity: hoveredIndex !== null ? 1 : 0,
            }}
          />

          {/* Active Indicator */}
          <div
            className='bg-primary absolute bottom-[-6px] h-[2px] transition-all duration-300 ease-out'
            style={activeStyle}
          />

          {/* Tabs */}
          <div className='relative flex items-center justify-center space-x-[6px]'>
            {visibleTabs.map((tab, index) => (
              <div
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[index] = el
                }}
                className={cn(
                  'h-[33px] cursor-pointer px-3 py-2 transition-colors duration-300',
                  index === activeIndex
                    ? 'text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground/80',
                  // ✅ CRITICAL FIX: Add visual loading state
                  isLoading && 'cursor-wait opacity-70'
                )}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => {
                  // ✅ CRITICAL FIX: Prevent clicks during loading
                  if (isLoading) return
                  setActiveIndex(index)
                  onTabChange?.(tab.id)
                }}
              >
                <div className='flex h-full items-center justify-center text-sm leading-5 font-medium whitespace-nowrap'>
                  {tab.label}
                  {/* ✅ CRITICAL FIX: Show loading indicator on tabs during permission loading */}
                  {isLoading && pageResource && (
                    <div className='ml-2 h-3 w-3 animate-spin rounded-full border border-current border-t-transparent opacity-50' />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }
)
TabMenu.displayName = 'TabMenu'

export { TabMenu }
