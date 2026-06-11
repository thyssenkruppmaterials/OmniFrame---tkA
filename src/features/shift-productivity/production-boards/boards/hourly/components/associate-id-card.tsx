// Created and developed by Jai Singh
/**
 * AssociateIdCard
 *
 * The User-column cell for the Hourly Completion Tracker. Reads like a
 * physical workplace badge: a coloured avatar block on the left, the
 * associate's name + primary-skill pill + sub line in the middle, and a
 * compact skills matrix below. A tiny clock icon on the right shows
 * shift state.
 *
 * Designed to sit on the sticky-left column inside a `<td>` that uses
 * `bg-card/0` so the heatmap behind doesn't compete with the badge.
 */
import { IconClock, IconClockOff } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  getAreaColorClasses,
  getPrimarySkillPillCode,
  getSkillLabel,
} from '../lib/skills'
import type { AssociateRow, BoardDensity } from '../lib/types'
import { SkillsMatrix } from './skills-matrix'

export interface AssociateIdCardProps {
  associate: AssociateRow
  density?: BoardDensity
  /** True if the associate currently has any activity / is on shift now. */
  isActive?: boolean
  /** True to render the off-shift visual treatment (faded). */
  isOffShift?: boolean
}

const DENSITY = {
  normal: {
    cardPadding: 'px-3 py-2',
    cardMinHeight: 'min-h-[68px]',
    avatarSize: 'h-10 w-10',
    avatarFont: 'text-sm',
    initialsFont: 'text-sm',
    nameFont: 'text-sm font-semibold tracking-tight',
    subFont: 'text-[10px]',
    pillFont: 'text-[9px]',
    pillPadding: 'px-1.5 py-px',
    iconSize: 'h-3.5 w-3.5',
  },
  tv: {
    cardPadding: 'px-4 py-3',
    cardMinHeight: 'min-h-[88px]',
    avatarSize: 'h-14 w-14',
    avatarFont: 'text-lg',
    initialsFont: 'text-lg',
    nameFont: 'text-base font-semibold tracking-tight',
    subFont: 'text-xs',
    pillFont: 'text-[10px]',
    pillPadding: 'px-2 py-0.5',
    iconSize: 'h-4 w-4',
  },
} as const satisfies Record<BoardDensity, Record<string, string>>

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0 || parts[0] === '') return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function AssociateIdCard({
  associate,
  density = 'normal',
  isActive = false,
  isOffShift = false,
}: AssociateIdCardProps) {
  const d = DENSITY[density]
  const colors = getAreaColorClasses(associate.areaColor)
  const isTv = density === 'tv'

  const subLineParts = [
    associate.positionTitle,
    associate.workingAreaCode,
    associate.workingAreaName &&
    associate.workingAreaName !== associate.workingAreaCode
      ? null
      : associate.workingAreaName,
  ].filter((v): v is string => Boolean(v))

  return (
    <div
      data-component='associate-id-card'
      data-density={density}
      className={cn(
        // Base "ID card" surface — quiet but distinctly card-like.
        'bg-card/80 flex items-center gap-3 rounded-xl border shadow-sm backdrop-blur-sm',
        d.cardPadding,
        d.cardMinHeight,
        // TV mode prefers a slightly cooler border + faint outer ring.
        isTv ? 'border-border/40 ring-border/30 ring-1' : 'border-border/60',
        // Active-row accent — picks up the area colour.
        isActive && colors.cardActiveBorder,
        isActive && `ring-1 ${colors.cardActiveRing}`,
        isOffShift && 'opacity-60'
      )}
    >
      {/* Avatar block — gradient + ring sets the area-colour tone */}
      <div
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1',
          d.avatarSize,
          colors.avatarGradient,
          colors.avatarRing
        )}
      >
        {associate.avatarUrl ? (
          <img
            src={associate.avatarUrl}
            alt=''
            aria-hidden
            className='h-full w-full object-cover'
          />
        ) : (
          <span
            className={cn('font-semibold', d.initialsFont, colors.avatarText)}
          >
            {initials(associate.fullName)}
          </span>
        )}
      </div>

      {/* Identity block (name + pill, sub-line, skills matrix) */}
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1.5'>
          <p className={cn('truncate', d.nameFont)} title={associate.fullName}>
            {associate.fullName}
          </p>
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded-sm border font-semibold tracking-wider uppercase tabular-nums',
              d.pillFont,
              d.pillPadding,
              colors.pillBg,
              colors.pillBorder,
              colors.pillText
            )}
            title={`${getSkillLabel(associate.primarySkill)} (primary)`}
          >
            {getPrimarySkillPillCode(associate.primarySkill)}
          </span>
        </div>
        {subLineParts.length > 0 && (
          <p
            className={cn('text-muted-foreground mt-px truncate', d.subFont)}
            title={subLineParts.join(' · ')}
          >
            {subLineParts.join(' · ')}
          </p>
        )}
        <SkillsMatrix skills={associate} density={density} className='mt-1.5' />
      </div>

      {/* Right rail — shift state */}
      <ShiftStateIcon
        isActive={isActive}
        isOffShift={isOffShift}
        density={density}
      />
    </div>
  )
}

function ShiftStateIcon({
  isActive,
  isOffShift,
  density,
}: {
  isActive: boolean
  isOffShift: boolean
  density: BoardDensity
}) {
  const d = DENSITY[density]
  const Icon = isOffShift ? IconClockOff : IconClock
  const tooltip = isOffShift
    ? 'Off shift'
    : isActive
      ? 'On shift · activity recorded today'
      : 'On shift · no activity yet'
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={tooltip}
            className={cn(
              'text-muted-foreground/60 flex shrink-0 items-center justify-center',
              isActive && 'text-emerald-500/80',
              isOffShift && 'text-muted-foreground/40'
            )}
          >
            <Icon className={d.iconSize} aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent side='left' className='text-xs'>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Created and developed by Jai Singh
