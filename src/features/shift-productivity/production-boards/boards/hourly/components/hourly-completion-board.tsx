// Created and developed by Jai Singh
import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  BOARD_HOURS,
  BOARD_OPENING_HOUR,
  formatHour,
  isWithinBoardHours,
} from '../lib/hour-bucket'
import type {
  AssociateRow,
  BoardDensity,
  HourBucket,
  HourCellState,
} from '../lib/types'
import { AssociateIdCard } from './associate-id-card'
import { BoardHeader } from './board-header'

interface HourlyCompletionBoardProps {
  associates: AssociateRow[]
  currentHour: number
  isToday: boolean
  isLoading: boolean
  isFetching: boolean
  lastUpdatedAt: Date | null
  timezone: string
  selectedDate: Date
  getCellState: (userId: string, hour: number) => HourCellState
  getCellBucket: (userId: string, hour: number) => HourBucket | undefined
  density?: BoardDensity
  /** When true, render only the inner table without the outer Card chrome. */
  bare?: boolean
}

const STATE_BG: Record<HourCellState, string> = {
  'no-activity': 'bg-muted/40 text-muted-foreground',
  below: 'bg-emerald-500/40 text-emerald-50',
  on: 'bg-emerald-500/70 text-white',
  above: 'bg-emerald-500 text-white',
  'off-shift': 'bg-muted/20 text-muted-foreground/40',
}

const DENSITY = {
  normal: {
    // 280 (id card) + 13 hour cells × ~56px ≈ 1010px. Round up so the
    // grid fills a 1280-wide laptop without scroll while leaving each
    // cell readable on the lower end of the range.
    minWidth: 'min-w-[1000px]',
    fontSize: 'text-[10px]',
    cell: 'h-8 min-w-[56px] text-[11px]',
    // Match the AssociateIdCard footprint — 260px on lg, 280px once
    // there's enough horizontal real estate. The actual visible card
    // sits inside this column.
    userCol: 'min-w-[260px] lg:min-w-[280px]',
    hourLabel: 'text-[10px] font-medium',
    hourMeridiem: 'text-[9px] text-muted-foreground/70',
  },
  tv: {
    // 340 (id card) + 13 cells × ~80px ≈ 1380px → 1500 leaves comfortable
    // padding so the grid fills 1080p TV widths without horizontal scroll.
    minWidth: 'min-w-[1500px]',
    fontSize: 'text-[12px]',
    cell: 'h-10 min-w-[80px] text-[13px]',
    userCol: 'min-w-[340px]',
    hourLabel: 'text-xs font-semibold',
    hourMeridiem: 'text-[10px] text-muted-foreground/70',
  },
} as const satisfies Record<BoardDensity, Record<string, string>>

function meridiemFor(h: number): 'AM' | 'PM' {
  return h < 12 ? 'AM' : 'PM'
}

/**
 * Subtle vertical divider drawn on the 12 PM column header + cells so the
 * morning / afternoon split reads from across a TV. Returned as a
 * Tailwind class fragment that the caller composes onto the `<th>` /
 * `<td>` directly.
 */
function bandDivider(hour: number): string | false {
  return hour === 12 && 'border-l border-border/40'
}

function HourCell({
  userId,
  hour,
  state,
  bucket,
  associateName,
  density,
  isCurrentHour,
}: {
  userId: string
  hour: number
  state: HourCellState
  bucket: HourBucket | undefined
  associateName: string
  density: BoardDensity
  isCurrentHour: boolean
}) {
  const d = DENSITY[density]
  const count = bucket?.total ?? 0
  const isOff = state === 'off-shift'

  const tooltip = (
    <div className='space-y-1 text-xs'>
      <p className='font-medium'>{associateName}</p>
      <p className='text-muted-foreground'>
        {formatHour(hour)}–{formatHour((hour + 1) % 24)} · {count} task
        {count === 1 ? '' : 's'}
        {isOff ? ' · off-shift' : ''}
      </p>
      {bucket && Object.keys(bucket.byType).length > 0 && (
        <ul className='space-y-0.5'>
          {Object.entries(bucket.byType)
            .sort(([, a], [, b]) => b - a)
            .map(([type, c]) => (
              <li
                key={`${userId}-${hour}-${type}`}
                className='flex items-center justify-between gap-3'
              >
                <span className='text-muted-foreground'>{type}</span>
                <span className='font-mono tabular-nums'>{c}</span>
              </li>
            ))}
        </ul>
      )}
      {state === 'no-activity' && !isOff && (
        <p className='text-muted-foreground'>No activity recorded.</p>
      )}
    </div>
  )

  return (
    <td
      className={cn(
        'px-0.5 py-1.5',
        bandDivider(hour),
        isCurrentHour && 'bg-primary/5'
      )}
      data-state={state}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'flex w-full cursor-default items-center justify-center rounded-sm font-semibold tabular-nums transition-all',
              d.cell,
              STATE_BG[state],
              isOff && 'opacity-30',
              'hover:ring-primary/30 hover:ring-2'
            )}
          >
            {count > 0 ? count : ''}
          </div>
        </TooltipTrigger>
        <TooltipContent side='top'>{tooltip}</TooltipContent>
      </Tooltip>
    </td>
  )
}

export function HourlyCompletionBoard({
  associates,
  currentHour,
  isToday,
  isLoading,
  isFetching,
  lastUpdatedAt,
  timezone,
  selectedDate,
  getCellState,
  getCellBucket,
  density = 'normal',
  bare = false,
}: HourlyCompletionBoardProps) {
  const hours = BOARD_HOURS
  const d = DENSITY[density]

  // Resolve the today/current-hour highlight to a single column when the
  // building is open, otherwise null so no header lights up.
  const currentBoardHour: number | null =
    isToday && isWithinBoardHours(currentHour) ? currentHour : null
  // "Building closed" UX: today AND outside the operating window.
  const isClosedNow = isToday && currentBoardHour === null

  const dateLabel = useMemo(
    () =>
      selectedDate.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: timezone,
      }),
    [selectedDate, timezone]
  )

  const inner = (
    <CardContent className={cn(bare ? 'p-0' : 'pt-0')}>
      {isClosedNow && (
        <p
          className={cn(
            'text-muted-foreground/80 mb-3 text-center font-medium tracking-wide',
            density === 'tv' ? 'text-base' : 'text-xs'
          )}
          data-component='production-boards-closed-footnote'
        >
          Building closed · opens {formatHour(BOARD_OPENING_HOUR)}
        </p>
      )}
      <ScrollArea className='w-full'>
        <div className={d.minWidth}>
          <TooltipProvider delayDuration={120}>
            <table
              className={cn('w-full border-collapse', d.fontSize)}
              data-component='hourly-completion-board'
            >
              <thead>
                <tr>
                  <th
                    className={cn(
                      'text-muted-foreground bg-card sticky left-0 z-10 pr-4 pb-2 text-left font-medium',
                      d.userCol
                    )}
                  >
                    Associate
                  </th>
                  {hours.map((hour) => {
                    const isCurrentHour = hour === currentBoardHour
                    return (
                      <th
                        key={hour}
                        className={cn(
                          'px-0.5 pb-2 text-center',
                          bandDivider(hour),
                          isCurrentHour && 'bg-primary/5 rounded-t-md'
                        )}
                      >
                        <div className='flex flex-col items-center'>
                          <span
                            className={cn(
                              d.hourLabel,
                              isCurrentHour
                                ? 'text-primary font-bold'
                                : 'text-muted-foreground'
                            )}
                          >
                            {formatHour(hour)}
                          </span>
                          <span className={d.hourMeridiem}>
                            {meridiemFor(hour)}
                          </span>
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {associates.length === 0 && !isLoading && (
                  <tr>
                    <td
                      colSpan={hours.length + 1}
                      className='text-muted-foreground py-12 text-center text-xs'
                    >
                      No associates match the current filters.
                    </td>
                  </tr>
                )}
                {isLoading && associates.length === 0 && (
                  <tr>
                    <td
                      colSpan={hours.length + 1}
                      className='text-muted-foreground py-12 text-center text-xs'
                    >
                      Loading roster…
                    </td>
                  </tr>
                )}
                {associates.map((associate) => {
                  const hasActivity = associate.demonstratedSkills.size > 0
                  const isOnShiftNow =
                    isToday &&
                    getCellState(associate.userId, currentHour) !== 'off-shift'
                  // "Active today" lights the row's accent — any
                  // demonstrated skill OR currently on shift counts.
                  const cardActive = hasActivity || isOnShiftNow
                  // Off-shift treatment when the associate has a shift
                  // window that the current hour is outside of and there's
                  // no activity at all today (avoid fading rows for
                  // ad-hoc associates who simply have no shift assigned).
                  const cardOffShift =
                    isToday &&
                    !isOnShiftNow &&
                    !hasActivity &&
                    associate.shiftStartMinutes != null &&
                    associate.shiftEndMinutes != null
                  return (
                    <tr key={associate.userId} className='group'>
                      <td
                        className={cn(
                          // The cell itself stays transparent so the
                          // visible card is the inner div, not the <td>.
                          'bg-card/0 sticky left-0 z-10 py-1 pr-3',
                          d.userCol
                        )}
                      >
                        <AssociateIdCard
                          associate={associate}
                          density={density}
                          isActive={cardActive}
                          isOffShift={cardOffShift}
                        />
                      </td>
                      {hours.map((hour) => {
                        const isCurrentHour = hour === currentBoardHour
                        const state = getCellState(associate.userId, hour)
                        const bucket = getCellBucket(associate.userId, hour)
                        return (
                          <HourCell
                            key={`${associate.userId}-${hour}`}
                            userId={associate.userId}
                            hour={hour}
                            state={state}
                            bucket={bucket}
                            associateName={associate.fullName}
                            density={density}
                            isCurrentHour={isCurrentHour}
                          />
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TooltipProvider>
        </div>
        <ScrollBar orientation='horizontal' />
      </ScrollArea>
      {density === 'normal' && (
        <p className='text-muted-foreground mt-3 text-[10px]'>{dateLabel}</p>
      )}
    </CardContent>
  )

  if (bare) return inner

  return (
    <Card className='border-border/50 bg-card/50 backdrop-blur-sm'>
      <BoardHeader
        title='Hourly Completion Tracker'
        description='Per-associate task completions bucketed by clock hour against per-hour targets'
        lastUpdatedAt={lastUpdatedAt}
        isFetching={isFetching}
        timezone={timezone}
      />
      {inner}
    </Card>
  )
}

// Created and developed by Jai Singh
