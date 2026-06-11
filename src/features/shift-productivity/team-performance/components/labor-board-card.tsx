// Created and developed by Jai Singh
/**
 * Labor Board Card Component
 * Draggable associate card for the interactive labor board
 * Uses @dnd-kit for drag mechanics, anime.js for imperative hover effects
 * FLIP animations handled at the board level via useAnimeFlip hook
 * Created: February 7, 2026
 * Updated: February 8, 2026 - Replaced framer-motion with anime.js
 */
import { memo, useCallback, useRef } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { animate } from 'animejs'
import { GripVertical, Lock, ArrowRightLeft, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type {
  AssociateProductivity,
  LaborBoardColumn,
} from '../types/team-performance.types'
import { getEfficiencyColor } from '../types/team-performance.types'

interface LaborBoardCardProps {
  associate: AssociateProductivity
  isDragging?: boolean
  isOverlay?: boolean
  readOnly?: boolean
  availableAreas?: LaborBoardColumn[]
  onMoveToArea?: (associateId: string, targetAreaId: string | null) => void
}

// Get user initials from name
function getInitials(name: string): string {
  if (!name || !name.trim()) return '??'
  const parts = name.trim().split(' ').filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return name.trim().substring(0, 2).toUpperCase()
}

const statusConfig = {
  active: {
    color: 'bg-green-500',
    label: 'Active',
    ringColor: 'ring-green-500/20',
  },
  break: {
    color: 'bg-yellow-500',
    label: 'On Break',
    ringColor: 'ring-yellow-500/20',
  },
  offline: {
    color: 'bg-gray-400',
    label: 'Offline',
    ringColor: 'ring-gray-400/20',
  },
} as const

function LaborBoardCardInner({
  associate,
  isDragging = false,
  isOverlay = false,
  readOnly = false,
  availableAreas = [],
  onMoveToArea,
}: LaborBoardCardProps) {
  const isDisabled = readOnly || associate.status === 'offline'
  const cardInnerRef = useRef<HTMLDivElement>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging: isDraggingFromHook,
  } = useDraggable({
    id: associate.user_id,
    data: {
      type: 'associate',
      associateId: associate.user_id,
      associateName: associate.user_name,
      fromColumnId: associate.working_area_id || 'unassigned',
      fromAreaName: associate.working_area_name || 'Unassigned',
    },
    disabled: isDisabled,
  })

  const isCurrentlyDragging = isDragging || isDraggingFromHook

  const style =
    transform && !isOverlay
      ? { transform: CSS.Translate.toString(transform) }
      : undefined

  const status = statusConfig[associate.status] || statusConfig.offline
  const efficiencyColor = getEfficiencyColor(associate.efficiency)

  // Anime.js hover effect -- subtle lift + shadow
  const handleMouseEnter = useCallback(() => {
    if (!cardInnerRef.current || isDisabled || isOverlay) return
    animate(cardInnerRef.current, {
      translateY: -1.5,
      boxShadow: '0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06)',
      ease: 'outExpo',
      duration: 200,
    })
  }, [isDisabled, isOverlay])

  const handleMouseLeave = useCallback(() => {
    if (!cardInnerRef.current || isDisabled || isOverlay) return
    animate(cardInnerRef.current, {
      translateY: 0,
      boxShadow: '0 0px 0px rgba(0,0,0,0), 0 0px 0px rgba(0,0,0,0)',
      ease: 'outExpo',
      duration: 250,
    })
  }, [isDisabled, isOverlay])

  const handleMoveToArea = useCallback(
    (areaId: string | null) => {
      onMoveToArea?.(associate.user_id, areaId)
    },
    [associate.user_id, onMoveToArea]
  )

  // Filter out the current area from the dropdown
  const moveableAreas = availableAreas.filter(
    (area) => area.id !== (associate.working_area_id || 'unassigned')
  )

  return (
    <div
      ref={!isOverlay ? setNodeRef : undefined}
      style={style}
      data-card-id={associate.user_id}
      role='option'
      aria-selected={isCurrentlyDragging}
      className={cn(
        'group relative',
        isCurrentlyDragging && !isOverlay && 'opacity-30'
      )}
    >
      <div
        ref={cardInnerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn(
          'bg-card flex items-center gap-2.5 rounded-lg border p-2.5',
          'will-change-transform',
          isOverlay && 'border-primary/50 bg-card scale-[1.02] shadow-xl',
          isDisabled && 'cursor-not-allowed opacity-60',
          !isDisabled && !readOnly && 'cursor-grab active:cursor-grabbing'
        )}
        aria-label={`Associate ${associate.user_name}, ${associate.working_area_name || 'Unassigned'}, ${associate.efficiency}% efficiency, ${status.label}`}
        aria-roledescription='draggable associate card'
      >
        {/* Grip Handle */}
        {!isDisabled && !readOnly && (
          <div
            {...attributes}
            {...listeners}
            className='text-muted-foreground/40 hover:text-muted-foreground/70 shrink-0 cursor-grab touch-none active:cursor-grabbing'
            aria-label={`Drag ${associate.user_name}`}
          >
            <GripVertical className='h-4 w-4' />
          </div>
        )}
        {isDisabled && !readOnly && (
          <div className='text-muted-foreground/30 shrink-0'>
            <Lock className='h-4 w-4' />
          </div>
        )}

        {/* Avatar with Status Dot */}
        <div className='relative shrink-0'>
          <Avatar className='h-8 w-8'>
            <AvatarImage
              src={associate.avatar_url || undefined}
              alt={associate.user_name}
            />
            <AvatarFallback className='bg-muted text-xs font-medium'>
              {getInitials(associate.user_name)}
            </AvatarFallback>
          </Avatar>
          <div
            className={cn(
              'border-card absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2',
              status.color
            )}
            title={status.label}
          />
        </div>

        {/* Name + Position */}
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm leading-tight font-medium'>
            {associate.user_name}
          </p>
          {associate.position_title && (
            <p className='text-muted-foreground truncate text-[11px] leading-tight'>
              {associate.position_title}
            </p>
          )}
        </div>

        {/* Efficiency Badge */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant='outline'
                className={cn(
                  'h-5 shrink-0 px-1.5 py-0 text-[11px] font-semibold tabular-nums',
                  efficiencyColor
                )}
              >
                {associate.efficiency}%
              </Badge>
            </TooltipTrigger>
            <TooltipContent side='left' className='text-xs'>
              <p className='font-medium'>{associate.efficiency}% efficiency</p>
              <p className='text-muted-foreground'>
                {associate.total_tasks} tasks completed
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Move To Dropdown (non-DnD fallback) */}
        {!readOnly && !isOverlay && moveableAreas.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100'
                aria-label={`Move ${associate.user_name} to another area`}
              >
                <ArrowRightLeft className='h-3.5 w-3.5' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-48'>
              <div className='text-muted-foreground px-2 py-1.5 text-xs font-medium'>
                Move to area
              </div>
              <DropdownMenuSeparator />
              {moveableAreas.map((area) => (
                <DropdownMenuItem
                  key={area.id}
                  onClick={() =>
                    handleMoveToArea(area.id === 'unassigned' ? null : area.id)
                  }
                  className='gap-2'
                >
                  <MapPin
                    className='h-3.5 w-3.5'
                    style={{ color: area.color }}
                  />
                  <span className='truncate'>{area.area_name}</span>
                  {area.capacity != null && (
                    <span className='text-muted-foreground ml-auto text-[10px]'>
                      {area.totalAssociates}/{area.capacity}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

// Memoize to prevent cascade re-renders during drag
export const LaborBoardCard = memo(LaborBoardCardInner, (prev, next) => {
  return (
    prev.associate.user_id === next.associate.user_id &&
    prev.associate.status === next.associate.status &&
    prev.associate.efficiency === next.associate.efficiency &&
    prev.associate.working_area_id === next.associate.working_area_id &&
    prev.associate.total_tasks === next.associate.total_tasks &&
    prev.isDragging === next.isDragging &&
    prev.isOverlay === next.isOverlay &&
    prev.readOnly === next.readOnly &&
    prev.availableAreas === next.availableAreas
  )
})

LaborBoardCard.displayName = 'LaborBoardCard'

export default LaborBoardCard

// Created and developed by Jai Singh
