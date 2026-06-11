// Created and developed by Jai Singh
/**
 * Template Grid Card
 *
 * Compact card for the Templates listing. Designed for density: a single
 * card occupies roughly half the vertical space of the prior layout, lets
 * 3-4 columns render comfortably on wide screens, and still surfaces every
 * action (Build is primary; everything else lives in a kebab menu).
 *
 * Click anywhere on the card body opens the builder so the entire surface
 * acts as the primary affordance.
 */
import { motion, useReducedMotion } from 'framer-motion'
import {
  Archive,
  Blocks,
  CalendarClock,
  Clock,
  Copy,
  Edit,
  FileText,
  MapPin,
  MoreHorizontal,
  UserPlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StandardWorkTemplate } from '@/hooks/use-standard-work'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface TemplateCardProps {
  template: StandardWorkTemplate
  areaName?: string
  onOpenBuilder: () => void
  onOpenAssignment: () => void
  onOpenScheduling: () => void
  onEdit: () => void
  onDuplicate: () => void
  onArchive: () => void
  index?: number
}

const STATUS_TONE: Record<
  StandardWorkTemplate['status'],
  { dot: string; label: string; text: string }
> = {
  active: {
    dot: 'bg-green-500',
    label: 'Active',
    text: 'text-green-600 dark:text-green-400',
  },
  draft: {
    dot: 'bg-muted-foreground/60',
    label: 'Draft',
    text: 'text-muted-foreground',
  },
  archived: {
    dot: 'bg-yellow-500',
    label: 'Archived',
    text: 'text-yellow-600 dark:text-yellow-400',
  },
  deprecated: {
    dot: 'bg-destructive',
    label: 'Deprecated',
    text: 'text-destructive',
  },
}

export function TemplateCard({
  template,
  areaName,
  onOpenBuilder,
  onOpenAssignment,
  onOpenScheduling,
  onEdit,
  onDuplicate,
  onArchive,
  index = 0,
}: TemplateCardProps) {
  const reduce = useReducedMotion()
  const tone = STATUS_TONE[template.status] ?? STATUS_TONE.draft

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.25,
        delay: reduce ? 0 : Math.min(index * 0.03, 0.18),
      }}
    >
      <Card className='group hover:border-primary/30 hover:shadow-primary/5 relative flex h-full flex-col overflow-hidden p-0 transition-all duration-200 hover:shadow-md'>
        {/* Top color stripe -- preserves the visual identity from the
            original card without consuming a full block of space. */}
        <div
          className='h-0.5 w-full'
          style={{ backgroundColor: template.color }}
          aria-hidden='true'
        />

        {/* Body. The button-as-region pattern lets the entire card act as
            the primary "Open builder" affordance while keeping the kebab
            menu separately interactive (stopPropagation in the trigger). */}
        <button
          type='button'
          onClick={onOpenBuilder}
          aria-label={`Open builder for ${template.template_name}`}
          className='hover:bg-muted/30 focus-visible:ring-ring flex flex-1 flex-col gap-2.5 p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-inset'
        >
          {/* Top row: icon + name + kebab */}
          <div className='flex items-start justify-between gap-2'>
            <div className='flex min-w-0 items-start gap-2.5'>
              <div
                className='mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg'
                style={{ backgroundColor: `${template.color}14` }}
              >
                <FileText
                  className='h-4 w-4'
                  style={{ color: template.color }}
                  aria-hidden='true'
                />
              </div>
              <div className='min-w-0 flex-1'>
                <div className='flex items-baseline gap-2'>
                  <h3 className='truncate text-sm leading-tight font-semibold'>
                    {template.template_name}
                  </h3>
                </div>
                {template.template_code ? (
                  <p className='text-muted-foreground/80 mt-0.5 truncate font-mono text-[10px] tracking-wide'>
                    {template.template_code}
                  </p>
                ) : null}
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label={`Actions for ${template.template_name}`}
                  className='-mr-1 h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className='h-4 w-4' aria-hidden='true' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenuItem onClick={onOpenBuilder}>
                  <Blocks className='mr-2 h-4 w-4' />
                  Build checklist
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onOpenAssignment}>
                  <UserPlus className='mr-2 h-4 w-4' />
                  Assign
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onOpenScheduling}>
                  <CalendarClock className='mr-2 h-4 w-4' />
                  Schedule
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onEdit}>
                  <Edit className='mr-2 h-4 w-4' />
                  Edit details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy className='mr-2 h-4 w-4' />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onArchive}
                  className='text-destructive focus:text-destructive'
                >
                  <Archive className='mr-2 h-4 w-4' />
                  Archive
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Compact meta row: status dot + frequency + items + duration. */}
          <div className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
            <span className={cn('flex items-center gap-1.5', tone.text)}>
              <span
                className={cn('h-1.5 w-1.5 rounded-full', tone.dot)}
                aria-hidden='true'
              />
              <span className='font-medium'>{tone.label}</span>
            </span>
            <Badge
              variant='outline'
              className='h-4 px-1.5 text-[10px] capitalize'
            >
              {template.frequency.replace('_', ' ')}
            </Badge>
            <span className='flex items-center gap-1'>
              <FileText className='h-3 w-3' aria-hidden='true' />
              {template.items_count ?? 0}
            </span>
            <span className='flex items-center gap-1'>
              <Clock className='h-3 w-3' aria-hidden='true' />~
              {template.estimated_duration_minutes}m
            </span>
            {areaName ? (
              <span className='flex min-w-0 items-center gap-1 truncate'>
                <MapPin className='h-3 w-3 shrink-0' aria-hidden='true' />
                <span className='truncate'>{areaName}</span>
              </span>
            ) : null}
          </div>

          {/* Optional 1-line description -- avoids the prior 2-line block
              that doubled the card height when present. */}
          {template.description ? (
            <p className='text-muted-foreground/90 line-clamp-1 text-xs'>
              {template.description}
            </p>
          ) : null}
        </button>

        {/* Footer with secondary actions surfaced as inline icon buttons.
            They're below the click region so the primary affordance stays
            unambiguous; we keep them visible (not group-hover only) on this
            denser card so users always have a quick path to assign/schedule. */}
        <div className='border-border/60 flex items-center justify-end gap-1 border-t px-2 py-1.5'>
          <Button
            variant='ghost'
            size='icon'
            className='text-muted-foreground hover:text-foreground h-7 w-7'
            onClick={onOpenAssignment}
            aria-label={`Assign template: ${template.template_name}`}
            title='Assign'
          >
            <UserPlus className='h-3.5 w-3.5' aria-hidden='true' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='text-muted-foreground hover:text-foreground h-7 w-7'
            onClick={onOpenScheduling}
            aria-label={`Schedule template: ${template.template_name}`}
            title='Schedule'
          >
            <CalendarClock className='h-3.5 w-3.5' aria-hidden='true' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='text-muted-foreground hover:text-foreground h-7 w-7'
            onClick={onEdit}
            aria-label={`Edit details: ${template.template_name}`}
            title='Edit details'
          >
            <Edit className='h-3.5 w-3.5' aria-hidden='true' />
          </Button>
        </div>
      </Card>
    </motion.div>
  )
}

// Created and developed by Jai Singh
