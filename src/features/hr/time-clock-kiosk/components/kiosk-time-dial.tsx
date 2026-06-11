// Created and developed by Jai Singh
/**
 * iOS-style scroll-wheel time picker for kiosk touch devices.
 * Three independently scrollable columns: Hour, Minute, AM/PM.
 * Uses scroll-snap for the "click into place" feel.
 */
import { useRef, useEffect, useCallback, useState } from 'react'

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)
const PERIODS = ['AM', 'PM'] as const

const ITEM_HEIGHT = 52

interface KioskTimeDialProps {
  value: { hour: number; minute: number; period: 'AM' | 'PM' }
  onChange: (val: { hour: number; minute: number; period: 'AM' | 'PM' }) => void
}

function WheelColumn({
  items,
  selected,
  onSelect,
  formatItem,
}: {
  items: readonly (string | number)[]
  selected: string | number
  onSelect: (item: string | number) => void
  formatItem: (item: string | number) => string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isScrolling = useRef(false)
  const scrollTimeout = useRef<ReturnType<typeof setTimeout>>(null)
  const initialSelected = useRef(selected)

  const scrollToIndex = useCallback((index: number, smooth = true) => {
    const el = containerRef.current
    if (!el) return
    el.scrollTo({
      top: index * ITEM_HEIGHT,
      behavior: smooth ? 'smooth' : 'instant',
    })
  }, [])

  useEffect(() => {
    const idx = items.indexOf(initialSelected.current)
    if (idx >= 0) scrollToIndex(idx, false)
  }, [items, scrollToIndex])

  const handleScroll = useCallback(() => {
    isScrolling.current = true
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current)

    scrollTimeout.current = setTimeout(() => {
      isScrolling.current = false
      const el = containerRef.current
      if (!el) return
      const idx = Math.round(el.scrollTop / ITEM_HEIGHT)
      const clamped = Math.max(0, Math.min(items.length - 1, idx))
      if (items[clamped] !== selected) {
        onSelect(items[clamped])
      }
    }, 80)
  }, [items, selected, onSelect])

  const handleTap = useCallback(
    (item: string | number) => {
      const idx = items.indexOf(item)
      if (idx >= 0) {
        scrollToIndex(idx)
        onSelect(item)
      }
    },
    [items, scrollToIndex, onSelect]
  )

  return (
    <div className='relative h-[260px] flex-1 overflow-hidden select-none'>
      {/* Gradient masks */}
      <div className='pointer-events-none absolute inset-x-0 top-0 z-10 h-[104px] bg-gradient-to-b from-zinc-50 via-zinc-50/80 to-transparent dark:from-zinc-900 dark:via-zinc-900/80' />
      <div className='pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[104px] bg-gradient-to-t from-zinc-50 via-zinc-50/80 to-transparent dark:from-zinc-900 dark:via-zinc-900/80' />

      {/* Selection highlight */}
      <div
        className='border-primary/30 bg-primary/8 pointer-events-none absolute inset-x-1 z-10 rounded-lg border'
        style={{ top: ITEM_HEIGHT * 2, height: ITEM_HEIGHT }}
      />

      {/* Scrollable list */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className='no-scrollbar h-full snap-y snap-mandatory overflow-y-auto'
        style={{ scrollSnapType: 'y mandatory' }}
      >
        {/* Top padding (2 blank items) */}
        <div style={{ height: ITEM_HEIGHT * 2 }} />

        {items.map((item) => {
          const isSelected = item === selected
          return (
            <div
              key={String(item)}
              onClick={() => handleTap(item)}
              className='flex cursor-pointer snap-center items-center justify-center transition-all'
              style={{ height: ITEM_HEIGHT }}
            >
              <span
                className={`text-2xl font-semibold transition-all ${
                  isSelected
                    ? 'text-foreground scale-105'
                    : 'text-muted-foreground/50 scale-95'
                }`}
              >
                {formatItem(item)}
              </span>
            </div>
          )
        })}

        {/* Bottom padding (2 blank items) */}
        <div style={{ height: ITEM_HEIGHT * 2 }} />
      </div>
    </div>
  )
}

export default function KioskTimeDial({ value, onChange }: KioskTimeDialProps) {
  const [hour, setHour] = useState(value.hour)
  const [minute, setMinute] = useState(value.minute)
  const [period, setPeriod] = useState<'AM' | 'PM'>(value.period)

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    onChangeRef.current({ hour, minute, period })
  }, [hour, minute, period])

  return (
    <div className='w-full max-w-sm'>
      {/* Column labels */}
      <div className='mb-2 flex px-1'>
        <div className='text-muted-foreground flex-1 text-center text-[11px] font-medium tracking-wider uppercase'>
          Hour
        </div>
        <div className='text-muted-foreground flex-1 text-center text-[11px] font-medium tracking-wider uppercase'>
          Minute
        </div>
        <div className='text-muted-foreground w-20 text-center text-[11px] font-medium tracking-wider uppercase'>
          &nbsp;
        </div>
      </div>

      {/* Dial columns */}
      <div className='flex gap-1 rounded-2xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-900'>
        <WheelColumn
          items={HOURS}
          selected={hour}
          onSelect={(v) => setHour(v as number)}
          formatItem={(v) => String(v)}
        />

        <div className='text-muted-foreground flex items-center justify-center text-2xl font-bold'>
          :
        </div>

        <WheelColumn
          items={MINUTES}
          selected={minute}
          onSelect={(v) => setMinute(v as number)}
          formatItem={(v) => String(v).padStart(2, '0')}
        />

        <WheelColumn
          items={PERIODS}
          selected={period}
          onSelect={(v) => setPeriod(v as 'AM' | 'PM')}
          formatItem={(v) => String(v)}
        />
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
