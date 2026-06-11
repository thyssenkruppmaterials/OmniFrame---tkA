// Created and developed by Jai Singh
'use client'

import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
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
  pageResource?: string
  showHiddenTabs?: boolean
  fallbackTab?: string
}

const SCROLL_AMOUNT = 200

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
    const [canScrollLeft, setCanScrollLeft] = useState(false)
    const [canScrollRight, setCanScrollRight] = useState(false)
    const tabRefs = useRef<(HTMLDivElement | null)[]>([])
    const containerRef = useRef<HTMLDivElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)

    const { hasTabAccess, isLoading } = useTabPermissions(
      pageResource || '',
      Boolean(pageResource)
    )

    const visibleTabs = useMemo(() => {
      if (isLoading && pageResource) {
        return tabs
      }
      if (showHiddenTabs || !pageResource) {
        return tabs
      }
      return tabs.filter((tab) => hasTabAccess(tab.id))
    }, [tabs, pageResource, showHiddenTabs, hasTabAccess, isLoading])

    const effectiveActiveTab = useMemo(() => {
      if (!pageResource || showHiddenTabs) {
        return activeTab
      }
      if (activeTab && hasTabAccess(activeTab)) {
        return activeTab
      }
      if (fallbackTab && hasTabAccess(fallbackTab)) {
        return fallbackTab
      }
      if (visibleTabs.length > 0) {
        return visibleTabs[0].id
      }
      return activeTab
    }, [
      activeTab,
      fallbackTab,
      pageResource,
      showHiddenTabs,
      hasTabAccess,
      visibleTabs,
    ])

    const updateScrollState = useCallback(() => {
      const el = scrollRef.current
      if (!el) return
      const threshold = 2
      setCanScrollLeft(el.scrollLeft > threshold)
      setCanScrollRight(
        el.scrollLeft + el.clientWidth < el.scrollWidth - threshold
      )
    }, [])

    const scrollBy = useCallback(
      (direction: 'left' | 'right') => {
        const el = scrollRef.current
        if (!el) return
        el.scrollBy({
          left: direction === 'left' ? -SCROLL_AMOUNT : SCROLL_AMOUNT,
          behavior: 'smooth',
        })
        requestAnimationFrame(updateScrollState)
      },
      [updateScrollState]
    )

    const scrollActiveTabIntoView = useCallback((index: number) => {
      const tabEl = tabRefs.current[index]
      const scrollEl = scrollRef.current
      if (!tabEl || !scrollEl) return
      const tabLeft = tabEl.offsetLeft
      const tabRight = tabLeft + tabEl.offsetWidth
      const viewLeft = scrollEl.scrollLeft
      const viewRight = viewLeft + scrollEl.clientWidth
      if (tabLeft < viewLeft) {
        scrollEl.scrollTo({ left: tabLeft - 12, behavior: 'smooth' })
      } else if (tabRight > viewRight) {
        scrollEl.scrollTo({
          left: tabRight - scrollEl.clientWidth + 12,
          behavior: 'smooth',
        })
      }
    }, [])

    const recalculatePositions = useCallback(() => {
      const activeElement = tabRefs.current[activeIndex]
      if (activeElement) {
        const { offsetLeft, offsetWidth } = activeElement
        setActiveStyle({
          left: `${offsetLeft}px`,
          width: `${offsetWidth}px`,
        })
      }
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

    useEffect(() => {
      if (effectiveActiveTab) {
        const tabIndex = visibleTabs.findIndex(
          (tab) => tab.id === effectiveActiveTab
        )
        if (tabIndex !== -1 && tabIndex !== activeIndex) {
          setActiveIndex(tabIndex)
        }
        if (effectiveActiveTab !== activeTab) {
          onTabChange?.(effectiveActiveTab)
        }
      }
    }, [effectiveActiveTab, visibleTabs, activeIndex, activeTab, onTabChange])

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

    useEffect(() => {
      const activeElement = tabRefs.current[activeIndex]
      if (activeElement) {
        const { offsetLeft, offsetWidth } = activeElement
        setActiveStyle({
          left: `${offsetLeft}px`,
          width: `${offsetWidth}px`,
        })
      }
      scrollActiveTabIntoView(activeIndex)
    }, [activeIndex, scrollActiveTabIntoView])

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
        updateScrollState()
      }
      const timeoutId = setTimeout(initializePositions, 10)
      return () => clearTimeout(timeoutId)
    }, [visibleTabs, effectiveActiveTab, activeIndex, updateScrollState])

    useEffect(() => {
      const handleResize = () => {
        requestAnimationFrame(() => {
          recalculatePositions()
          updateScrollState()
        })
      }
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
    }, [recalculatePositions, updateScrollState])

    useEffect(() => {
      if (!containerRef.current) return
      const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          recalculatePositions()
          updateScrollState()
        })
      })
      resizeObserver.observe(containerRef.current)
      return () => resizeObserver.disconnect()
    }, [recalculatePositions, updateScrollState])

    useEffect(() => {
      const el = scrollRef.current
      if (!el) return
      el.addEventListener('scroll', updateScrollState, { passive: true })
      return () => el.removeEventListener('scroll', updateScrollState)
    }, [updateScrollState])

    const handleWheel = useCallback(
      (e: React.WheelEvent) => {
        const el = scrollRef.current
        if (!el) return
        const hasOverflow = el.scrollWidth > el.clientWidth
        if (!hasOverflow) return
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault()
          el.scrollLeft += e.deltaY
          updateScrollState()
        }
      },
      [updateScrollState]
    )

    if (visibleTabs.length === 0 && !isLoading && pageResource) {
      return (
        <div className='text-muted-foreground py-4 text-center'>
          <p>No tabs available for your current permissions.</p>
        </div>
      )
    }

    return (
      <div ref={ref} className={cn('relative', className)} {...props}>
        {/* Left scroll button */}
        <div
          className={cn(
            'from-background pointer-events-none absolute top-0 bottom-0 left-0 z-10 flex items-center bg-linear-to-r to-transparent pr-4 transition-opacity duration-200',
            canScrollLeft ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <button
            type='button'
            tabIndex={-1}
            onClick={() => scrollBy('left')}
            className='bg-background hover:bg-muted border-border pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full border shadow-sm transition-colors'
            aria-label='Scroll tabs left'
          >
            <IconChevronLeft size={14} />
          </button>
        </div>

        {/* Scrollable tab area */}
        <div
          ref={scrollRef}
          onWheel={handleWheel}
          className='overflow-x-auto'
          style={{ scrollbarWidth: 'none' }}
        >
          <div ref={containerRef} className='relative mx-auto w-fit pb-[8px]'>
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
              className='bg-primary absolute bottom-0 h-[2px] transition-all duration-300 ease-out'
              style={activeStyle}
            />

            {/* Tabs */}
            <div className='relative flex items-center space-x-[6px]'>
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
                    isLoading && 'cursor-wait opacity-70'
                  )}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onClick={() => {
                    if (isLoading) return
                    setActiveIndex(index)
                    onTabChange?.(tab.id)
                  }}
                >
                  <div className='flex h-full items-center justify-center text-sm leading-5 font-medium whitespace-nowrap'>
                    {tab.label}
                    {isLoading && pageResource && (
                      <div className='ml-2 h-3 w-3 animate-spin rounded-full border border-current border-t-transparent opacity-50' />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right scroll button */}
        <div
          className={cn(
            'from-background pointer-events-none absolute top-0 right-0 bottom-0 z-10 flex items-center bg-linear-to-l to-transparent pl-4 transition-opacity duration-200',
            canScrollRight ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <button
            type='button'
            tabIndex={-1}
            onClick={() => scrollBy('right')}
            className='bg-background hover:bg-muted border-border pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full border shadow-sm transition-colors'
            aria-label='Scroll tabs right'
          >
            <IconChevronRight size={14} />
          </button>
        </div>
      </div>
    )
  }
)
TabMenu.displayName = 'TabMenu'

export { TabMenu }

// Created and developed by Jai Singh
